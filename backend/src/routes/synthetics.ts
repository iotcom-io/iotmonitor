import { Router } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import SyntheticCheck from '../models/SyntheticCheck';
import Incident from '../models/Incident';
import { runSyntheticCheckById } from '../services/SyntheticRunner';

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

const normalizeUrlKey = (value: unknown) => String(value || '').trim().toLowerCase().replace(/\/+$/, '');
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

        checks.forEach((check: any) => {
            if (check.type !== 'http') return;
            const key = normalizeUrlKey(check.url);
            if (!key || httpByUrl.has(key)) return;
            httpByUrl.set(key, check);
        });

        for (const check of checks) {
            if (check.type !== 'ssl') continue;

            const key = normalizeUrlKey(check.url);
            const httpCheck = httpByUrl.get(key);
            if (!httpCheck) continue;
            if (!looksLikeLegacyCompanion(httpCheck.name, check.name)) continue;

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
router.get('/', async (_req, res) => {
    await consolidateLegacySslCompanions();
    const checks = await SyntheticCheck.find().sort({ updated_at: -1 });
    res.json(checks);
});

// aggregate stats for list/dashboard
router.get('/stats', async (req, res) => {
    try {
        await consolidateLegacySslCompanions();
        const windowHours = clamp(Number(req.query.window_hours || 24), 1, 24 * 30);
        const now = new Date();
        const from = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
        const windowMs = now.getTime() - from.getTime();

        const checks = await SyntheticCheck.find().sort({ updated_at: -1 });
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

// create
router.post('/', async (req: AuthRequest, res) => {
    try {
        const payload = normalizePayload(req.body);
        const check = new SyntheticCheck(payload);
        await check.save();
        res.status(201).json(check);
    } catch (err: any) {
        res.status(400).json({ message: err.message });
    }
});

// update
router.put('/:id', async (req, res) => {
    try {
        const check = await SyntheticCheck.findByIdAndUpdate(req.params.id, normalizePayload(req.body), { new: true });
        if (!check) return res.status(404).json({ message: 'Not found' });
        res.json(check);
    } catch (err: any) {
        res.status(400).json({ message: err.message });
    }
});

// delete
router.delete('/:id', async (req, res) => {
    try {
        await SyntheticCheck.findByIdAndDelete(req.params.id);
        res.json({ ok: true });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// run now
router.post('/:id/run', async (req, res) => {
    try {
        const updated = await runSyntheticCheckById(req.params.id);
        if (!updated) return res.status(404).json({ message: 'Not found' });
        res.json(updated);
    } catch (error: any) {
        res.status(500).json({ message: error.message || 'Failed to execute check' });
    }
});

export default router;
