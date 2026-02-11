import { Router } from 'express';
import { authenticate, authorizePermission, AuthRequest } from '../middleware/auth';
import SyntheticCheck from '../models/SyntheticCheck';
import Incident from '../models/Incident';
import { runSyntheticCheckById } from '../services/SyntheticRunner';
import { canAccessSynthetic, hasPermission } from '../lib/rbac';

const router = Router();
router.use(authenticate);
let legacySslConsolidated = false;

const normalizeStatusCodes = (value: any) => {
    if (!Array.isArray(value)) return [];
    const normalized = value
        .map((entry) => Number(entry))
        .filter((num) => Number.isFinite(num) && num > 0);
    return Array.from(new Set(normalized));
};

const normalizeStringIdArray = (value: unknown) => {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(
        value
            .map((entry) => String(entry || '').trim())
            .filter(Boolean)
    ));
};

const normalizePayload = (payload: any) => {
    const next: any = { ...payload };

    const checkType = String(next.type || '').toLowerCase();
    const requestedSslEnabled = Boolean(next.ssl_enabled || next.enable_ssl_monitor);
    if (next.target_kind !== undefined) {
        const normalizedKind = String(next.target_kind || '').toLowerCase();
        next.target_kind = ['website', 'api'].includes(normalizedKind) ? normalizedKind : 'website';
    }

    if (next.channels !== undefined) {
        next.channels = Array.isArray(next.channels)
            ? next.channels.map((ch: string) => String(ch).toLowerCase())
            : ['slack'];
    }

    if (next.notification_channel_ids !== undefined) {
        next.notification_channel_ids = normalizeStringIdArray(next.notification_channel_ids);
    }

    if (next.expected_status_codes !== undefined) {
        const codes = normalizeStatusCodes(next.expected_status_codes);
        next.expected_status_codes = codes.length > 0 ? codes : [200];
    }

    if (next.max_response_time_ms !== undefined) {
        const maxResponse = Number(next.max_response_time_ms);
        next.max_response_time_ms = Number.isFinite(maxResponse) && maxResponse > 0 ? maxResponse : undefined;
    }

    if (next.ssl_expiry_days !== undefined) {
        const expiryDays = Number(next.ssl_expiry_days);
        next.ssl_expiry_days = Number.isFinite(expiryDays) && expiryDays > 0 ? expiryDays : 7;
    }

    if (checkType === 'ssl') {
        next.ssl_enabled = true;
        delete next.expected_status;
        delete next.expected_status_codes;
        delete next.response_match_type;
        delete next.response_match_value;
        delete next.must_include;
        delete next.max_response_time_ms;
        if (!next.target_kind) {
            next.target_kind = 'website';
        }
    } else if (checkType === 'http') {
        next.ssl_enabled = requestedSslEnabled;
        if (!next.expected_status_codes && next.expected_status) {
            next.expected_status_codes = [Number(next.expected_status)];
        }
    } else if (next.ssl_enabled !== undefined) {
        next.ssl_enabled = Boolean(next.ssl_enabled);
    }

    delete next.enable_ssl_monitor;

    return next;
};

const normalizeAssignedUserIds = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(
        value
            .map((entry) => String(entry || '').trim())
            .filter(Boolean)
    ));
};

const getSyntheticAccessQuery = (user: AuthRequest['user']) => {
    if (!user || user.role === 'admin') return {};

    if (user.assigned_synthetic_ids.length > 0) {
        return {
            $or: [
                { _id: { $in: user.assigned_synthetic_ids } },
                { assigned_user_ids: user.id },
            ],
        };
    }

    return {
        $or: [
            { assigned_user_ids: user.id },
            { assigned_user_ids: { $exists: false } },
            { assigned_user_ids: { $size: 0 } },
        ],
    };
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const formatDuration = (durationMs: number) => {
    const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
    if (totalSeconds < 60) return `${totalSeconds}s`;
    if (totalSeconds < 3600) {
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}m ${seconds}s`;
    }
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
};
const csvEscape = (value: unknown) => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    if (/[",\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
};

const normalizeUrlKey = (value: unknown) => String(value || '').trim().toLowerCase().replace(/\/+$/, '');
const normalizeHostKey = (value: unknown) => {
    const raw = String(value || '').trim();
    if (!raw) return '';

    try {
        const withProtocol = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;
        return new URL(withProtocol).hostname.toLowerCase();
    } catch {
        return '';
    }
};
const normalizeNameKey = (value: unknown) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');

const looksLikeLegacyCompanion = (httpName: string, sslName: string) => {
    const httpKey = normalizeNameKey(httpName);
    const sslKey = normalizeNameKey(sslName);
    return sslKey === `${httpKey} ssl` || sslKey === `${httpKey} tls`;
};

const consolidateLegacySslCompanions = async () => {
    if (legacySslConsolidated) return;
    try {
        const checks = await SyntheticCheck.find().sort({ created_at: 1 });
        const httpByUrl = new Map<string, any>();
        const httpByHost = new Map<string, any[]>();

        checks.forEach((check: any) => {
            if (check.type !== 'http') return;
            const key = normalizeUrlKey(check.url);
            if (key && !httpByUrl.has(key)) {
                httpByUrl.set(key, check);
            }

            const hostKey = normalizeHostKey(check.url);
            if (hostKey) {
                const list = httpByHost.get(hostKey) || [];
                list.push(check);
                httpByHost.set(hostKey, list);
            }
        });

        for (const check of checks) {
            if (check.type !== 'ssl') continue;

            const key = normalizeUrlKey(check.url);
            const hostKey = normalizeHostKey(check.url);

            let httpCheck = httpByUrl.get(key);
            if (httpCheck && !looksLikeLegacyCompanion(httpCheck.name, check.name)) {
                httpCheck = null;
            }

            if (!httpCheck && hostKey) {
                const hostCandidates = (httpByHost.get(hostKey) || [])
                    .filter((candidate) => looksLikeLegacyCompanion(candidate.name, check.name));

                if (hostCandidates.length > 0) {
                    httpCheck = hostCandidates[0];
                }
            }

            if (!httpCheck) continue;

            let changed = false;
            if (!httpCheck.ssl_enabled) {
                httpCheck.ssl_enabled = true;
                changed = true;
            }
            if (!httpCheck.ssl_expiry_days && check.ssl_expiry_days) {
                httpCheck.ssl_expiry_days = check.ssl_expiry_days;
                changed = true;
            }
            if (!httpCheck.ssl_expiry_at && check.ssl_expiry_at) {
                httpCheck.ssl_expiry_at = check.ssl_expiry_at;
                changed = true;
            }
            if (!httpCheck.ssl_last_state && check.ssl_last_state) {
                httpCheck.ssl_last_state = check.ssl_last_state;
                changed = true;
            }
            if (Array.isArray(check.assigned_user_ids) && check.assigned_user_ids.length > 0) {
                const mergedAssigned = Array.from(new Set([
                    ...(Array.isArray(httpCheck.assigned_user_ids) ? httpCheck.assigned_user_ids : []),
                    ...check.assigned_user_ids,
                ]));
                httpCheck.assigned_user_ids = mergedAssigned;
                changed = true;
            }
            if (changed) {
                await httpCheck.save();
            }

            await Incident.updateMany(
                { target_type: 'synthetic', target_id: String(check._id) },
                {
                    $set: {
                        target_id: String(httpCheck._id),
                        target_name: httpCheck.name,
                    },
                }
            );

            await SyntheticCheck.deleteOne({ _id: check._id });
        }

        legacySslConsolidated = true;
    } catch (error) {
        legacySslConsolidated = false;
        throw error;
    }
};

// list
router.get('/', authorizePermission('synthetics.view'), async (req: AuthRequest, res) => {
    await consolidateLegacySslCompanions();
    const checks = await SyntheticCheck.find(getSyntheticAccessQuery(req.user)).sort({ updated_at: -1 });
    res.json(checks);
});

// aggregate stats for list/dashboard
router.get('/stats', authorizePermission('synthetics.view'), async (req: AuthRequest, res) => {
    try {
        await consolidateLegacySslCompanions();
        const windowHours = clamp(Number(req.query.window_hours || 24), 1, 24 * 30);
        const now = new Date();
        const from = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
        const windowMs = now.getTime() - from.getTime();

        const checks = await SyntheticCheck.find(getSyntheticAccessQuery(req.user)).sort({ updated_at: -1 });
        if (checks.length === 0) {
            return res.json({
                window_hours: windowHours,
                generated_at: now.toISOString(),
                summary: {
                    total_monitors: 0,
                    healthy: 0,
                    degraded: 0,
                    down: 0,
                    avg_uptime_pct: 100,
                    total_outage_minutes: 0,
                },
                monitors: [],
            });
        }

        const checkIds = checks.map((check) => String(check._id));
        const incidents = await Incident.find({
            target_type: 'synthetic',
            target_id: { $in: checkIds },
            started_at: { $lt: now },
            $or: [
                { resolved_at: { $exists: false } },
                { resolved_at: null },
                { resolved_at: { $gt: from } },
            ],
        }).sort({ started_at: -1 });

        const byTarget = incidents.reduce((acc: Record<string, any[]>, incident: any) => {
            const target = String(incident.target_id);
            if (!acc[target]) acc[target] = [];
            acc[target].push(incident);
            return acc;
        }, {});

        let totalUptimePct = 0;
        let totalOutageMs = 0;
        let healthy = 0;
        let degraded = 0;
        let down = 0;

        const monitors = checks.map((check: any) => {
            const list = byTarget[String(check._id)] || [];
            let outageMs = 0;
            const outages: Array<{ started_at: string; ended_at: string | null; duration_ms: number; duration_text: string; ongoing: boolean }> = [];

            list.forEach((incident: any) => {
                const rawStart = new Date(incident.started_at);
                const rawEnd = incident.resolved_at ? new Date(incident.resolved_at) : now;
                const start = rawStart.getTime() < from.getTime() ? from : rawStart;
                const end = rawEnd.getTime() > now.getTime() ? now : rawEnd;
                if (end.getTime() <= start.getTime()) return;

                const duration = end.getTime() - start.getTime();
                outageMs += duration;
                outages.push({
                    started_at: start.toISOString(),
                    ended_at: incident.resolved_at ? end.toISOString() : null,
                    duration_ms: duration,
                    duration_text: formatDuration(duration),
                    ongoing: !incident.resolved_at,
                });
            });

            const boundedOutageMs = clamp(outageMs, 0, windowMs);
            const uptimePct = windowMs > 0 ? Number((((windowMs - boundedOutageMs) / windowMs) * 100).toFixed(2)) : 100;
            const latestOutage = outages[0];

            const state = check.last_status === 'fail'
                ? 'down'
                : uptimePct < 99
                    ? 'degraded'
                    : 'healthy';

            if (state === 'down') down += 1;
            else if (state === 'degraded') degraded += 1;
            else healthy += 1;

            totalUptimePct += uptimePct;
            totalOutageMs += boundedOutageMs;

            return {
                check_id: String(check._id),
                name: check.name,
                type: check.type,
                ssl_enabled: Boolean(check.ssl_enabled || check.type === 'ssl'),
                target_kind: check.target_kind || 'website',
                url: check.url,
                enabled: check.enabled,
                state,
                uptime_pct: uptimePct,
                outage_pct: Number((100 - uptimePct).toFixed(2)),
                outage_duration_ms: boundedOutageMs,
                outage_duration_text: formatDuration(boundedOutageMs),
                outage_count: outages.length,
                latest_outage: latestOutage || null,
            };
        });

        const avgUptime = monitors.length > 0 ? Number((totalUptimePct / monitors.length).toFixed(2)) : 100;

        return res.json({
            window_hours: windowHours,
            generated_at: now.toISOString(),
            summary: {
                total_monitors: monitors.length,
                healthy,
                degraded,
                down,
                avg_uptime_pct: avgUptime,
                total_outage_minutes: Math.floor(totalOutageMs / 60000),
            },
            monitors,
        });
    } catch (error: any) {
        res.status(500).json({ message: error.message || 'Failed to calculate monitor stats' });
    }
});

router.get('/export', authorizePermission('synthetics.view'), async (req: AuthRequest, res) => {
    try {
        await consolidateLegacySslCompanions();
        const checks = await SyntheticCheck.find(getSyntheticAccessQuery(req.user)).sort({ updated_at: -1 });

        const csvRows = checks.map((check: any) => [
            String(check._id || ''),
            String(check.name || ''),
            String(check.target_kind || 'website'),
            String(check.type || ''),
            String(check.url || ''),
            String(check.method || ''),
            String(check.enabled),
            String(Boolean(check.ssl_enabled || check.type === 'ssl')),
            String(check.ssl_last_state || ''),
            check.ssl_expiry_at ? new Date(check.ssl_expiry_at).toISOString() : '',
            String(check.last_status || ''),
            check.last_run ? new Date(check.last_run).toISOString() : '',
            String(check.last_response_status ?? ''),
            String(check.last_response_time_ms ?? ''),
            String(check.last_message || ''),
            String(check.interval ?? ''),
            String(check.timeout ?? ''),
            String(req.user?.email || ''),
            new Date().toISOString(),
        ].map(csvEscape).join(','));

        const csvBody = [
            [
                'monitor_id',
                'name',
                'target_kind',
                'type',
                'url',
                'method',
                'enabled',
                'ssl_enabled',
                'ssl_state',
                'ssl_expiry_at',
                'last_status',
                'last_run',
                'last_response_status',
                'last_response_time_ms',
                'last_message',
                'interval_seconds',
                'timeout_ms',
                'exported_by',
                'exported_at',
            ].join(','),
            ...csvRows,
        ].join('\n');

        const fileName = `web-monitors-${Date.now()}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        return res.send(csvBody);
    } catch (error: any) {
        return res.status(500).json({ message: error.message || 'Failed to export monitors' });
    }
});

// create
router.post('/', authorizePermission('synthetics.create'), async (req: AuthRequest, res) => {
    try {
        const payload = normalizePayload(req.body);
        if (payload.assigned_user_ids !== undefined) {
            if (!hasPermission(req.user, 'devices.assign')) {
                delete payload.assigned_user_ids;
            } else {
                payload.assigned_user_ids = normalizeAssignedUserIds(payload.assigned_user_ids);
            }
        }
        const check = new SyntheticCheck(payload);
        await check.save();
        res.status(201).json(check);
    } catch (err: any) {
        res.status(400).json({ message: err.message });
    }
});

// update
router.put('/:id', authorizePermission('synthetics.update'), async (req: AuthRequest, res) => {
    try {
        const existing = await SyntheticCheck.findById(req.params.id);
        if (!existing) return res.status(404).json({ message: 'Not found' });
        if (!canAccessSynthetic(req.user, existing)) {
            return res.status(403).json({ message: 'Access denied for this web monitor' });
        }

        const updateDoc = normalizePayload(req.body);
        if (updateDoc.assigned_user_ids !== undefined) {
            if (!hasPermission(req.user, 'devices.assign')) {
                delete updateDoc.assigned_user_ids;
            } else {
                updateDoc.assigned_user_ids = normalizeAssignedUserIds(updateDoc.assigned_user_ids);
            }
        }

        const check = await SyntheticCheck.findByIdAndUpdate(req.params.id, updateDoc, { new: true });
        if (!check) return res.status(404).json({ message: 'Not found' });
        res.json(check);
    } catch (err: any) {
        res.status(400).json({ message: err.message });
    }
});

// delete
router.delete('/:id', authorizePermission('synthetics.delete'), async (req: AuthRequest, res) => {
    try {
        const existing = await SyntheticCheck.findById(req.params.id);
        if (!existing) return res.status(404).json({ message: 'Not found' });
        if (!canAccessSynthetic(req.user, existing)) {
            return res.status(403).json({ message: 'Access denied for this web monitor' });
        }

        await SyntheticCheck.findByIdAndDelete(req.params.id);
        res.json({ ok: true });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// run now
router.post('/:id/run', authorizePermission('synthetics.run'), async (req: AuthRequest, res) => {
    try {
        const checkId = String(req.params.id);
        const existing = await SyntheticCheck.findById(checkId);
        if (!existing) return res.status(404).json({ message: 'Not found' });
        if (!canAccessSynthetic(req.user, existing)) {
            return res.status(403).json({ message: 'Access denied for this web monitor' });
        }

        const updated = await runSyntheticCheckById(checkId);
        if (!updated) return res.status(404).json({ message: 'Not found' });
        res.json(updated);
    } catch (error: any) {
        res.status(500).json({ message: error.message || 'Failed to execute check' });
    }
});

export default router;
