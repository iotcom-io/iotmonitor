import LicenseAsset from '../models/LicenseAsset';
import Incident from '../models/Incident';
import SystemSettings from '../models/SystemSettings';
import { NotificationService } from './NotificationService';

const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata';

let licenseTimer: NodeJS.Timeout | null = null;
let licenseSummaryTimer: NodeJS.Timeout | null = null;

type LicenseState = 'ok' | 'warning' | 'critical' | 'expired';
type Severity = 'warning' | 'critical';

const dateKey = (date: Date) => new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
}).format(date);

const hourKey = (date: Date) => new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
}).format(date);

const weekdayShort = (date: Date) => new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE,
    weekday: 'short',
}).format(date);

const fmt = (date: Date) => date.toLocaleString('en-US', { timeZone: APP_TIMEZONE });

const daysUntil = (date: Date, now: Date) => Math.floor((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

const resolveState = (days: number, warningDays: number, criticalDays: number): LicenseState => {
    if (days < 0) return 'expired';
    if (days <= criticalDays) return 'critical';
    if (days <= warningDays) return 'warning';
    return 'ok';
};

const buildAlertMessage = (license: any, state: LicenseState, days: number, renewalDate: Date) => {
    const typeLabel = license.type === 'license' ? 'License' : 'Subscription';
    const severityLabel = state.toUpperCase();
    const lines = [
        'ALERT',
        '',
        `${typeLabel}: ${license.name}`,
        `Status: ${severityLabel}`,
        `Vendor/Product: ${license.vendor || 'N/A'} / ${license.product || 'N/A'}`,
        `Owner: ${license.owner || 'N/A'}`,
        `Renewal Date: ${fmt(renewalDate)}`,
        `Days Remaining: ${days}`,
    ];

    if (license.seats_total) {
        lines.push(`Seats: ${license.seats_used || 0}/${license.seats_total}`);
    }
    if (license.amount) {
        lines.push(`Amount: ${license.amount} ${license.currency || 'INR'}`);
    }

    return lines.join('\n');
};

const buildResolvedMessage = (license: any, renewalDate: Date, previousState: LicenseState) => {
    const typeLabel = license.type === 'license' ? 'License' : 'Subscription';
    return [
        'RESOLVED',
        '',
        `${typeLabel}: ${license.name}`,
        `Previous State: ${previousState.toUpperCase()}`,
        `Current State: OK`,
        `Renewal Date: ${fmt(renewalDate)}`,
        `Resolved At: ${fmt(new Date())}`,
    ].join('\n');
};

const channelsForLicense = (license: any): ('slack' | 'email' | 'custom')[] => {
    const channels = Array.isArray(license.channels) && license.channels.length > 0
        ? license.channels
        : ['slack'];
    return channels
        .map((entry: any) => String(entry || '').trim().toLowerCase())
        .filter((entry: string): entry is 'slack' | 'email' | 'custom' => ['slack', 'email', 'custom'].includes(entry));
};

const channelIdsForLicense = (license: any): string[] => {
    if (!Array.isArray(license.notification_channel_ids)) return [];
    return Array.from(new Set<string>(
        license.notification_channel_ids
            .map((entry: any) => String(entry || '').trim())
            .filter(Boolean)
    ));
};

const ensureIncident = async (
    license: any,
    state: LicenseState,
    severity: Severity,
    summary: string,
    updateMessage: string
) => {
    let incident = await Incident.findOne({
        target_type: 'license',
        target_id: String(license._id),
        status: 'open',
    });

    if (state !== 'ok') {
        if (!incident) {
            incident = await Incident.create({
                target_type: 'license',
                target_id: String(license._id),
                target_name: license.name,
                severity,
                status: 'open',
                summary,
                updates: [{ at: new Date(), message: updateMessage }],
            });
            return { opened: true, resolved: false, incident };
        }

        incident.summary = summary;
        incident.severity = severity;
        incident.updates.push({ at: new Date(), message: updateMessage } as any);
        await incident.save();
        return { opened: false, resolved: false, incident };
    }

    if (incident) {
        incident.status = 'resolved';
        incident.resolved_at = new Date();
        incident.updates.push({ at: new Date(), message: 'License state returned to normal' } as any);
        await incident.save();
        return { opened: false, resolved: true, incident };
    }

    return { opened: false, resolved: false, incident: null };
};

const shouldSendReminder = (license: any, state: LicenseState, days: number, now: Date) => {
    if (state === 'ok') return { due: false, bucket: '' };
    if (days > 7) return { due: false, bucket: '' };

    const bucket = days <= 1 ? hourKey(now) : dateKey(now);
    if (license.last_notified_bucket === bucket) return { due: false, bucket };
    return { due: true, bucket };
};

const evaluateOne = async (license: any, settings: any) => {
    if (!license.enabled || license.status === 'paused') return;

    const now = new Date();
    const renewalDate = new Date(license.renewal_date);
    if (Number.isNaN(renewalDate.getTime())) return;

    const days = daysUntil(renewalDate, now);
    const state = resolveState(days, Number(license.warning_days || 30), Number(license.critical_days || 7));
    const previousState: LicenseState = license.last_state || 'ok';
    const severity: Severity = state === 'warning' ? 'warning' : 'critical';
    const summary = `License monitor: ${license.name} is ${state}`;
    const message = `${license.name} renewal state is ${state} (${days} days remaining)`;

    const lifecycle = await ensureIncident(license, state, severity, summary, message);
    const channels = channelsForLicense(license) as ('slack' | 'email' | 'custom')[];
    const channelIds = channelIdsForLicense(license);
    const slackWebhook = settings?.notification_slack_webhook || settings?.slack_webhooks?.[0]?.url;

    // state transition notifications
    if (state !== 'ok' && (lifecycle.opened || previousState === 'ok')) {
        await NotificationService.send({
            subject: `LICENSE ${state.toUpperCase()}: ${license.name}`,
            message: buildAlertMessage(license, state, days, renewalDate),
            channelIds,
            channels,
            recipients: { slackWebhook },
        });
    }

    if (state === 'ok' && previousState !== 'ok') {
        await NotificationService.send({
            subject: `LICENSE RECOVERED: ${license.name}`,
            message: buildResolvedMessage(license, renewalDate, previousState),
            channelIds,
            channels,
            recipients: { slackWebhook },
        });
    }

    // reminder cadence: <=7 days daily, <=1 day hourly
    if (state !== 'ok') {
        const reminder = shouldSendReminder(license, state, days, now);
        if (reminder.due) {
            await NotificationService.send({
                subject: `LICENSE REMINDER: ${license.name}`,
                message: buildAlertMessage(license, state, days, renewalDate),
                channelIds,
                channels,
                recipients: { slackWebhook },
            });
            license.last_notified_bucket = reminder.bucket;
        }
    } else {
        license.last_notified_bucket = undefined;
    }

    license.last_checked_at = now;
    license.last_state = state;
    license.last_message = `${state.toUpperCase()} (${days} days remaining)`;
    license.status = days < 0 ? 'expired' : 'active';
    await license.save();
};

const sendWeeklySummaryIfDue = async () => {
    const now = new Date();
    if (weekdayShort(now) !== 'Fri') return;

    const settings = await SystemSettings.findOne();
    const today = dateKey(now);
    if (settings?.license_weekly_summary_last_sent_on === today) return;

    const rows = await LicenseAsset.find({ enabled: true }).sort({ renewal_date: 1 });
    if (rows.length === 0) {
        if (settings) {
            settings.license_weekly_summary_last_sent_on = today;
            await settings.save();
        }
        return;
    }

    const enriched = rows.map((row: any) => {
        const renewalDate = new Date(row.renewal_date);
        return {
            name: row.name,
            vendor: row.vendor || 'N/A',
            type: row.type,
            renewalDate,
            days: daysUntil(renewalDate, now),
            owner: row.owner || 'N/A',
        };
    });

    const top = enriched.slice(0, 20);
    const summary = [
        'WEEKLY LICENSE/SUBSCRIPTION SUMMARY',
        '',
        `Generated At: ${fmt(now)}`,
        `Total Tracked: ${enriched.length}`,
        `Critical (<=7 days): ${enriched.filter((r) => r.days <= 7).length}`,
        `Expired: ${enriched.filter((r) => r.days < 0).length}`,
        '',
        'Upcoming Renewals:',
        ...top.map((entry, index) => `${index + 1}. ${entry.name} (${entry.type}) - ${entry.days} day(s) - ${fmt(entry.renewalDate)} - owner: ${entry.owner}`),
    ].join('\n');

    await NotificationService.send({
        subject: 'Weekly License Renewal Summary',
        message: summary,
        channels: ['slack'],
        recipients: { slackWebhook: settings?.notification_slack_webhook || settings?.slack_webhooks?.[0]?.url },
    });

    if (!settings) {
        await SystemSettings.create({ license_weekly_summary_last_sent_on: today });
    } else {
        settings.license_weekly_summary_last_sent_on = today;
        await settings.save();
    }
};

const tick = async () => {
    const settings = await SystemSettings.findOne();
    const licenses = await LicenseAsset.find({ enabled: true, status: { $in: ['active', 'expired'] } });
    for (const license of licenses) {
        try {
            await evaluateOne(license, settings);
        } catch (error) {
            console.error('[LICENSE] monitor check failed:', error);
        }
    }
};

export const startLicenseMonitoring = () => {
    if (!licenseTimer) {
        licenseTimer = setInterval(() => {
            tick().catch((error) => console.error('[LICENSE] monitoring tick error:', error));
        }, 15 * 60 * 1000);

        setTimeout(() => {
            tick().catch((error) => console.error('[LICENSE] initial monitoring tick error:', error));
        }, 5000);
    }

    if (!licenseSummaryTimer) {
        licenseSummaryTimer = setInterval(() => {
            sendWeeklySummaryIfDue().catch((error) => console.error('[LICENSE] weekly summary error:', error));
        }, 60 * 60 * 1000);

        setTimeout(() => {
            sendWeeklySummaryIfDue().catch((error) => console.error('[LICENSE] initial weekly summary error:', error));
        }, 30000);
    }
};
