import SyntheticCheck from '../models/SyntheticCheck';
import Incident from '../models/Incident';
import { NotificationService } from './NotificationService';
import SystemSettings from '../models/SystemSettings';
import https from 'https';
import http from 'http';
import tls from 'tls';
import { URL } from 'url';

const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata';

let timer: NodeJS.Timeout | null = null;
let summaryTimer: NodeJS.Timeout | null = null;

type IncidentSeverity = 'critical' | 'warning';
type SyntheticCategory = 'uptime' | 'response' | 'ssl_expiry' | 'ssl_connectivity' | 'latency';
type SslState = 'ok' | 'warning' | 'critical' | 'expired';

interface SyntheticResult {
    ok: boolean;
    message: string;
    severity: IncidentSeverity;
    category: SyntheticCategory;
    statusCode?: number;
    responseTimeMs?: number;
    expiryAt?: Date;
    expiryDays?: number;
    certCN?: string;
    sslState?: SslState;
}

interface IncidentLifecycle {
    opened: boolean;
    resolved: boolean;
}

const severityRank: Record<IncidentSeverity, number> = {
    warning: 1,
    critical: 2,
};

const getDateKey = (date: Date) => new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
}).format(date);

const getHourKey = (date: Date) => new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
}).format(date);

const getWeekday = (date: Date) => new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE,
    weekday: 'short',
}).format(date);

const formatTime = (date: Date) => date.toLocaleString('en-US', { timeZone: APP_TIMEZONE });

const safeNumber = (value: unknown): number | undefined => {
    if (value === null || value === undefined) return undefined;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
};

const normalizeChannels = (channels?: string[]): ('email' | 'slack' | 'custom' | 'whatsapp')[] => {
    const valid = new Set(['email', 'slack', 'custom', 'whatsapp']);
    const normalized = (Array.isArray(channels) ? channels : ['slack'])
        .map((ch) => ch === 'webhook' ? 'custom' : String(ch || '').toLowerCase())
        .filter((ch) => valid.has(ch));

    return normalized.length > 0
        ? normalized as ('email' | 'slack' | 'custom' | 'whatsapp')[]
        : ['slack'] as ('email' | 'slack' | 'custom' | 'whatsapp')[];
};

const resolveSlackWebhook = (check: any, settings: any) => {
    const group = String(check.slack_webhook_name || '').trim();
    if (!group) return undefined;
    return settings?.slack_webhooks?.find((entry: any) => entry?.name === group)?.url;
};

const evaluateResponseMatcher = (body: string, check: any): { ok: boolean; reason?: string } => {
    const legacyNeedle = String(check.must_include || '').trim();
    const configuredNeedle = String(check.response_match_value || '').trim();
    const expectedValue = configuredNeedle || legacyNeedle;

    if (!expectedValue) {
        return { ok: true };
    }

    const matchType = String(check.response_match_type || 'contains').toLowerCase();

    if (matchType === 'exact') {
        return body.trim() === expectedValue
            ? { ok: true }
            : { ok: false, reason: 'Response exact-match validation failed' };
    }

    if (matchType === 'regex') {
        try {
            const regex = new RegExp(expectedValue, 'm');
            return regex.test(body)
                ? { ok: true }
                : { ok: false, reason: 'Response regex validation failed' };
        } catch {
            return { ok: false, reason: 'Invalid regex in response matcher configuration' };
        }
    }

    return body.includes(expectedValue)
        ? { ok: true }
        : { ok: false, reason: 'Response contains validation failed' };
};

const runHttp = async (check: any): Promise<SyntheticResult> => {
    const startedAt = Date.now();
    const url = new URL(check.url);
    const lib = url.protocol === 'https:' ? https : http;

    const opts: any = {
        method: check.method || 'GET',
        timeout: check.timeout || 8000,
        headers: check.headers || {},
    };

    const expectedStatuses = Array.isArray(check.expected_status_codes) && check.expected_status_codes.length > 0
        ? check.expected_status_codes.map((code: any) => Number(code)).filter((code: number) => Number.isFinite(code))
        : [Number(check.expected_status || 200)];

    const maxResponseTimeMs = safeNumber(check.max_response_time_ms);

    return new Promise<SyntheticResult>((resolve) => {
        const req = lib.request(check.url, opts, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                const responseTimeMs = Date.now() - startedAt;
                const statusCode = Number(res.statusCode || 0);

                if (expectedStatuses.length > 0 && !expectedStatuses.includes(statusCode)) {
                    return resolve({
                        ok: false,
                        message: `Expected status ${expectedStatuses.join(', ')} but received ${statusCode}`,
                        severity: 'critical',
                        category: 'response',
                        statusCode,
                        responseTimeMs,
                    });
                }

                const matcher = evaluateResponseMatcher(body, check);
                if (!matcher.ok) {
                    return resolve({
                        ok: false,
                        message: matcher.reason || 'Unexpected API/website response body',
                        severity: 'critical',
                        category: 'response',
                        statusCode,
                        responseTimeMs,
                    });
                }

                if (maxResponseTimeMs !== undefined && responseTimeMs > maxResponseTimeMs) {
                    return resolve({
                        ok: false,
                        message: `Response latency ${responseTimeMs}ms exceeded threshold ${maxResponseTimeMs}ms`,
                        severity: 'warning',
                        category: 'latency',
                        statusCode,
                        responseTimeMs,
                    });
                }

                return resolve({
                    ok: true,
                    message: `Healthy response ${statusCode} in ${responseTimeMs}ms`,
                    severity: 'warning',
                    category: 'uptime',
                    statusCode,
                    responseTimeMs,
                });
            });
        });

        req.on('error', (err) => resolve({
            ok: false,
            message: `Request failed: ${err.message}`,
            severity: 'critical',
            category: 'uptime',
        }));

        req.on('timeout', () => {
            req.destroy(new Error('Timeout'));
            resolve({
                ok: false,
                message: `Request timeout after ${opts.timeout}ms`,
                severity: 'critical',
                category: 'uptime',
            });
        });

        if (check.body) {
            req.write(check.body);
        }
        req.end();
    });
};

const getSslState = (daysUntilExpiry: number, warningDays: number): SslState => {
    if (daysUntilExpiry < 0) return 'expired';
    if (daysUntilExpiry <= 1) return 'critical';
    if (daysUntilExpiry <= warningDays) return 'warning';
    return 'ok';
};

const runSSL = async (check: any): Promise<SyntheticResult> => {
    return new Promise<SyntheticResult>((resolve) => {
        const url = new URL(check.url);
        const host = url.hostname;
        const port = url.port ? parseInt(url.port, 10) : 443;
        const timeoutMs = check.timeout || 8000;
        const warningDays = Math.max(1, Number(check.ssl_expiry_days || 7));

        const socket = tls.connect(port, host, { servername: host, timeout: timeoutMs }, () => {
            const cert = socket.getPeerCertificate();
            if (!cert || !cert.valid_to) {
                resolve({
                    ok: false,
                    message: 'TLS certificate not available from endpoint',
                    severity: 'critical',
                    category: 'ssl_connectivity',
                });
                socket.end();
                return;
            }

            const expiryAt = new Date(cert.valid_to);
            if (Number.isNaN(expiryAt.getTime())) {
                resolve({
                    ok: false,
                    message: 'Could not parse certificate expiry date',
                    severity: 'critical',
                    category: 'ssl_connectivity',
                });
                socket.end();
                return;
            }

            const daysUntilExpiry = Math.floor((expiryAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
            const sslState = getSslState(daysUntilExpiry, warningDays);
            const certCN = cert.subject?.CN || host;

            if (sslState === 'ok') {
                resolve({
                    ok: true,
                    message: `Certificate valid for ${daysUntilExpiry} days (${certCN})`,
                    severity: 'warning',
                    category: 'ssl_expiry',
                    expiryAt,
                    expiryDays: daysUntilExpiry,
                    certCN,
                    sslState,
                });
            } else {
                const severity: IncidentSeverity = sslState === 'warning' ? 'warning' : 'critical';
                const stateLabel = sslState === 'expired'
                    ? 'Certificate expired'
                    : `Certificate expires in ${daysUntilExpiry} days`;

                resolve({
                    ok: false,
                    message: `${stateLabel} (${certCN})`,
                    severity,
                    category: 'ssl_expiry',
                    expiryAt,
                    expiryDays: daysUntilExpiry,
                    certCN,
                    sslState,
                });
            }

            socket.end();
        });

        socket.on('error', (err) => resolve({
            ok: false,
            message: `TLS handshake failed: ${err.message}`,
            severity: 'critical',
            category: 'ssl_connectivity',
        }));

        socket.on('timeout', () => {
            socket.destroy(new Error('Timeout'));
            resolve({
                ok: false,
                message: `TLS handshake timeout after ${timeoutMs}ms`,
                severity: 'critical',
                category: 'ssl_connectivity',
            });
        });
    });
};

const getFailureSubject = (check: any, result: SyntheticResult) => {
    if (result.category === 'ssl_expiry' || result.category === 'ssl_connectivity') {
        if (result.category === 'ssl_connectivity') return `SSL CHECK DOWN: ${check.name}`;
        if (result.severity === 'critical') return `SSL CRITICAL: ${check.name}`;
        return `SSL WARNING: ${check.name}`;
    }

    if (result.category === 'response') {
        return `API RESPONSE ALERT: ${check.name}`;
    }

    if (result.category === 'latency') {
        return `WEB/API LATENCY ALERT: ${check.name}`;
    }

    return `WEB/API DOWN: ${check.name}`;
};

const getRecoverySubject = (check: any, result: SyntheticResult) => (result.category === 'ssl_expiry' || result.category === 'ssl_connectivity')
    ? `SSL RECOVERED: ${check.name}`
    : `WEB/API RECOVERED: ${check.name}`;

const buildFailureMessage = (check: any, result: SyntheticResult) => {
    const displayType = (result.category === 'ssl_expiry' || result.category === 'ssl_connectivity') ? 'SSL' : check.type.toUpperCase();
    const lines = [
        'ALERT',
        '',
        `Check: ${check.name}`,
        `Category: ${check.target_kind || (check.type === 'ssl' ? 'website' : 'api')}`,
        `Type: ${displayType}`,
        `URL: ${check.url}`,
        `Time: ${formatTime(new Date())}`,
        `Issue: ${result.message}`,
    ];

    if (result.statusCode !== undefined) {
        lines.push(`HTTP Status: ${result.statusCode}`);
    }
    if (result.responseTimeMs !== undefined) {
        lines.push(`Response Time: ${result.responseTimeMs}ms`);
    }
    if (result.expiryDays !== undefined) {
        lines.push(`Days To Expiry: ${result.expiryDays}`);
    }
    if (result.expiryAt) {
        lines.push(`Certificate Expiry: ${formatTime(result.expiryAt)}`);
    }

    return lines.join('\n');
};

const buildRecoveryMessage = (check: any, result: SyntheticResult) => {
    const displayType = (result.category === 'ssl_expiry' || result.category === 'ssl_connectivity') ? 'SSL' : check.type.toUpperCase();
    const lines = [
        'RESOLVED',
        '',
        `Check: ${check.name}`,
        `Category: ${check.target_kind || (check.type === 'ssl' ? 'website' : 'api')}`,
        `Type: ${displayType}`,
        `URL: ${check.url}`,
        `Recovery Time: ${formatTime(new Date())}`,
        `Status: ${result.message}`,
    ];

    if (result.statusCode !== undefined) {
        lines.push(`HTTP Status: ${result.statusCode}`);
    }
    if (result.responseTimeMs !== undefined) {
        lines.push(`Response Time: ${result.responseTimeMs}ms`);
    }
    if (result.expiryAt) {
        lines.push(`Certificate Expiry: ${formatTime(result.expiryAt)}`);
    }

    return lines.join('\n');
};

const sendCheckNotification = async (check: any, subject: string, message: string, settings?: any) => {
    const resolvedSettings = settings || await SystemSettings.findOne();
    const slackWebhook = resolveSlackWebhook(check, resolvedSettings);

    await NotificationService.send({
        subject,
        message,
        channels: normalizeChannels(check.channels),
        recipients: {
            slackWebhook,
            customWebhookName: check.custom_webhook_name,
        },
    });
};

const ensureIncident = async (check: any, result: SyntheticResult): Promise<IncidentLifecycle> => {
    let incident = await Incident.findOne({ target_type: 'synthetic', target_id: check._id, status: 'open' });

    if (!result.ok) {
        const summary = `Web monitor failure: ${result.message}`;

        if (!incident) {
            incident = new Incident({
                target_type: 'synthetic',
                target_id: check._id,
                target_name: check.name,
                severity: result.severity,
                status: 'open',
                summary,
                updates: [{ at: new Date(), message: result.message }],
            });
            await incident.save();

            await sendCheckNotification(check, getFailureSubject(check, result), buildFailureMessage(check, result));
            return { opened: true, resolved: false };
        }

        const previousSeverity = incident.severity as IncidentSeverity;
        incident.summary = summary;
        incident.updates.push({ at: new Date(), message: result.message });
        incident.severity = result.severity;
        await incident.save();

        if (severityRank[result.severity] > severityRank[previousSeverity]) {
            await sendCheckNotification(
                check,
                `ESCALATED ${getFailureSubject(check, result)}`,
                buildFailureMessage(check, result)
            );
        }

        return { opened: false, resolved: false };
    }

    if (incident) {
        incident.status = 'resolved';
        incident.resolved_at = new Date();
        incident.updates.push({ at: new Date(), message: 'Recovered' });
        await incident.save();

        await sendCheckNotification(check, getRecoverySubject(check, result), buildRecoveryMessage(check, result));
        return { opened: false, resolved: true };
    }

    return { opened: false, resolved: false };
};

const sendSslRenewalNotificationIfNeeded = async (check: any, result: SyntheticResult) => {
    const sslEnabled = check.type === 'ssl' || check.ssl_enabled === true;
    if (!sslEnabled || !result.expiryAt) return false;

    const previousExpiryAt = check.ssl_expiry_at ? new Date(check.ssl_expiry_at) : null;
    const nextExpiryAt = new Date(result.expiryAt);

    if (!previousExpiryAt || Number.isNaN(previousExpiryAt.getTime())) return false;
    if (nextExpiryAt.getTime() <= previousExpiryAt.getTime() + (60 * 60 * 1000)) return false;

    const lastRenewalNotified = check.ssl_last_renewal_notified_expiry_at
        ? new Date(check.ssl_last_renewal_notified_expiry_at)
        : null;

    if (lastRenewalNotified && Math.abs(lastRenewalNotified.getTime() - nextExpiryAt.getTime()) < 1000) {
        return false;
    }

    const message = [
        'SSL CERTIFICATE RENEWED',
        '',
        `Check: ${check.name}`,
        `URL: ${check.url}`,
        `Previous Expiry: ${formatTime(previousExpiryAt)}`,
        `New Expiry: ${formatTime(nextExpiryAt)}`,
        `Detected At: ${formatTime(new Date())}`,
    ].join('\n');

    await sendCheckNotification(check, `SSL RENEWED: ${check.name}`, message);

    check.ssl_last_renewal_notified_expiry_at = nextExpiryAt;
    return true;
};

const sendSslReminderIfDue = async (check: any, result: SyntheticResult, lifecycle: IncidentLifecycle) => {
    const sslEnabled = check.type === 'ssl' || check.ssl_enabled === true;
    if (!sslEnabled || result.category !== 'ssl_expiry' || result.ok) return false;
    if (lifecycle.opened) return false;

    const days = result.expiryDays;
    if (days === undefined || days > 7) return false;

    const now = new Date();
    const bucket = days <= 1 ? getHourKey(now) : getDateKey(now);
    if (check.ssl_last_reminder_bucket === bucket) return false;

    const reminderMessage = [
        'SSL EXPIRY REMINDER',
        '',
        `Check: ${check.name}`,
        `URL: ${check.url}`,
        `Current State: ${result.sslState || 'warning'}`,
        `Days To Expiry: ${days}`,
        `Certificate Expiry: ${result.expiryAt ? formatTime(result.expiryAt) : 'N/A'}`,
        `Next Reminder: ${days <= 1 ? 'in 1 hour' : 'tomorrow'}`,
    ].join('\n');

    await sendCheckNotification(check, `SSL REMINDER: ${check.name}`, reminderMessage);
    check.ssl_last_reminder_bucket = bucket;
    return true;
};

const updateCheckRuntimeFields = (check: any, result: SyntheticResult) => {
    check.last_run = new Date();
    check.last_status = result.ok ? 'ok' : 'fail';
    check.last_message = result.message;

    if (result.statusCode !== undefined) {
        check.last_response_status = result.statusCode;
    }
    if (result.responseTimeMs !== undefined) {
        check.last_response_time_ms = result.responseTimeMs;
    }

    const sslEnabled = check.type === 'ssl' || check.ssl_enabled === true;
    if (sslEnabled) {
        if (result.expiryAt) {
            check.ssl_expiry_at = result.expiryAt;
        }
        if (result.sslState) {
            check.ssl_last_state = result.sslState;
        }
        if (result.ok && result.expiryDays !== undefined && result.expiryDays > 7) {
            check.ssl_last_reminder_bucket = undefined;
        }
    }
};

const runCheck = async (check: any) => {
    const sslEnabled = check.type === 'ssl' || check.ssl_enabled === true;
    const httpResult = check.type === 'ssl' ? null : await runHttp(check);
    const sslResult = sslEnabled ? await runSSL(check) : null;

    if (sslResult) {
        await sendSslRenewalNotificationIfNeeded(check, sslResult);
    }

    let effectiveResult: SyntheticResult;
    if (check.type === 'ssl') {
        effectiveResult = sslResult as SyntheticResult;
    } else if (httpResult && !httpResult.ok) {
        effectiveResult = httpResult;
    } else if (sslResult && !sslResult.ok) {
        effectiveResult = sslResult;
    } else {
        effectiveResult = (httpResult || sslResult) as SyntheticResult;
    }

    const lifecycle = await ensureIncident(check, effectiveResult);

    if (sslResult) {
        await sendSslReminderIfDue(check, sslResult, lifecycle);
    }

    if (sslResult) {
        updateCheckRuntimeFields(check, sslResult);
    }
    updateCheckRuntimeFields(check, effectiveResult);
    await check.save();
};

export const runSyntheticCheckById = async (checkId: string) => {
    const check = await SyntheticCheck.findById(checkId);
    if (!check) return null;

    await runCheck(check);
    return check;
};

const tick = async () => {
    const checks = await SyntheticCheck.find({ enabled: true });
    const now = Date.now();

    for (const check of checks) {
        if (check.last_run && now - check.last_run.getTime() < (check.interval || 300) * 1000) {
            continue;
        }

        try {
            await runCheck(check);
        } catch (error: any) {
            console.error(`Synthetic check failed unexpectedly (${check.name}):`, error?.message || error);
            check.last_run = new Date();
            check.last_status = 'fail';
            check.last_message = `Runner error: ${error?.message || 'Unknown error'}`;
            await check.save();
        }
    }
};

const buildSslWeeklySummaryMessage = (rows: Array<{ name: string; url: string; expiryAt?: Date; days?: number }>) => {
    const now = new Date();
    const expired = rows.filter((row) => row.days !== undefined && row.days < 0);
    const critical = rows.filter((row) => row.days !== undefined && row.days >= 0 && row.days <= 1);
    const warning = rows.filter((row) => row.days !== undefined && row.days >= 2 && row.days <= 7);
    const healthy = rows.filter((row) => row.days !== undefined && row.days > 7);
    const unknown = rows.filter((row) => row.days === undefined);

    const topUpcoming = [...rows]
        .filter((row) => row.days !== undefined)
        .sort((a, b) => (a.days as number) - (b.days as number))
        .slice(0, 10);

    const lines: string[] = [
        'WEEKLY SSL EXPIRY SUMMARY',
        '',
        `Generated At: ${formatTime(now)}`,
        `Total SSL Checks: ${rows.length}`,
        `Expired: ${expired.length}`,
        `Critical (<=1 day): ${critical.length}`,
        `Warning (2-7 days): ${warning.length}`,
        `Healthy (>7 days): ${healthy.length}`,
        `Unknown: ${unknown.length}`,
    ];

    if (topUpcoming.length > 0) {
        lines.push('');
        lines.push('Top Upcoming Expiries:');
        topUpcoming.forEach((row, index) => {
            lines.push(
                `${index + 1}. ${row.name} (${row.days}d) - ${row.expiryAt ? formatTime(row.expiryAt) : 'N/A'} - ${row.url}`
            );
        });
    }

    return lines.join('\n');
};

const sendWeeklySslSummaryIfDue = async () => {
    const now = new Date();
    if (getWeekday(now) !== 'Fri') return;

    const today = getDateKey(now);
    const settings = await SystemSettings.findOne();
    if (settings?.ssl_weekly_summary_last_sent_on === today) return;

    const sslChecks = await SyntheticCheck.find({
        enabled: true,
        $or: [
            { type: 'ssl' },
            { ssl_enabled: true },
        ],
    });
    if (sslChecks.length === 0) {
        if (settings) {
            settings.ssl_weekly_summary_last_sent_on = today;
            await settings.save();
        }
        return;
    }

    const summaryRows = sslChecks.map((check: any) => {
        const expiryAt = check.ssl_expiry_at ? new Date(check.ssl_expiry_at) : undefined;
        const days = expiryAt && !Number.isNaN(expiryAt.getTime())
            ? Math.floor((expiryAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
            : undefined;

        return {
            name: check.name,
            url: check.url,
            expiryAt,
            days,
        };
    });

    const message = buildSslWeeklySummaryMessage(summaryRows);

    await NotificationService.send({
        subject: 'Weekly SSL Expiry Summary',
        message,
        channels: ['slack'] as ('email' | 'slack' | 'whatsapp' | 'custom')[],
        recipients: {},
    });

    if (!settings) {
        await SystemSettings.create({ ssl_weekly_summary_last_sent_on: today });
    } else {
        settings.ssl_weekly_summary_last_sent_on = today;
        await settings.save();
    }
};

export const startSyntheticRunner = () => {
    if (!timer) {
        timer = setInterval(() => {
            tick().catch((err) => console.error('Synthetic tick error:', err));
        }, 15 * 1000);
        setTimeout(() => {
            tick().catch((err) => console.error('Synthetic initial tick error:', err));
        }, 3000);
    }

    if (!summaryTimer) {
        summaryTimer = setInterval(() => {
            sendWeeklySslSummaryIfDue().catch((err) => console.error('Weekly SSL summary error:', err));
        }, 60 * 60 * 1000);

        setTimeout(() => {
            sendWeeklySslSummaryIfDue().catch((err) => console.error('Weekly SSL summary initial error:', err));
        }, 30 * 1000);
    }
};

