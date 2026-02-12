import axios from 'axios';
import nodemailer from 'nodemailer';
import { IAlertTracking } from '../models/AlertTracking';
import NotificationChannel from '../models/NotificationChannel';

const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata';

const CHECK_LABELS: Record<string, string> = {
    cpu: 'CPU Usage',
    memory: 'Memory Usage',
    disk: 'Disk Usage',
    bandwidth: 'Network Bandwidth',
    utilization: 'Network Utilization',
    sip_rtt: 'SIP RTT',
    sip_registration: 'SIP Registration',
    container_status: 'Container Status',
};

const HIDDEN_DETAIL_KEYS = new Set([
    'offline_duration_minutes',
    'recovery_time',
    'duration_minutes',
    'duration_seconds',
    'rule_id',
    'top_cpu_processes',
]);

const toNumberOrNull = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const formatNumber = (value: unknown, decimals = 2) => {
    const num = toNumberOrNull(value);
    if (num === null) return String(value ?? 'N/A');
    return num.toFixed(decimals);
};

const formatValueWithUnit = (value: unknown, unit?: string) => {
    if (!unit || unit === 'state') return String(value ?? 'N/A');
    const normalizedUnit = unit === 'ms' ? ' ms' : unit === '%' ? '%' : unit === 'Mbps' ? ' Mbps' : ` ${unit}`;
    return `${formatNumber(value, 2)}${normalizedUnit}`;
};

const formatTimestamp = (value: unknown) => {
    if (!value) return 'N/A';
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('en-US', { timeZone: APP_TIMEZONE });
};

const formatDuration = (secondsInput: unknown) => {
    const seconds = toNumberOrNull(secondsInput);
    if (seconds === null || seconds <= 0) return '0s';

    const whole = Math.floor(seconds);
    if (whole < 60) return `${whole}s`;
    if (whole < 3600) return `${Math.floor(whole / 60)}m ${whole % 60}s`;

    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    return `${hours}h ${minutes}m`;
};

const prettyKey = (key: string) => key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

const getAlertTypeDescription = (alert: IAlertTracking) => {
    switch (alert.alert_type) {
        case 'offline':
            return 'Device Offline';
        case 'service_down':
            return `Service Down (${alert.specific_service || 'unknown'})`;
        case 'sip_issue':
            return 'SIP Issue';
        case 'high_latency':
            return 'High Latency';
        case 'threshold':
            return 'Threshold Exceeded';
        case 'rule_violation': {
            const checkType = String(alert.specific_service || 'rule_violation');
            const label = CHECK_LABELS[checkType] || checkType;
            return `${label} Threshold Breach`;
        }
        case 'ip_change':
            return 'IP Address Changed';
        default:
            return alert.alert_type;
    }
};

const getRecoveryDescription = (alert: IAlertTracking) => {
    switch (alert.alert_type) {
        case 'offline':
            return 'Device Back Online';
        case 'service_down':
            return `Service Restored (${alert.specific_service || 'unknown'})`;
        case 'sip_issue':
            return alert.details?.issue_type === 'registration_failed'
                ? 'SIP Registration Restored'
                : 'SIP Contact Reachable';
        case 'high_latency':
            return 'SIP Latency Normal';
        case 'threshold':
            return 'Metric Back To Normal';
        case 'rule_violation': {
            const checkType = String(alert.specific_service || 'rule_violation');
            if (checkType === 'container_status') {
                return 'Container Status Back To Normal';
            }
            const label = CHECK_LABELS[checkType] || checkType;
            return `${label} Back To Normal`;
        }
        default:
            return 'Issue Resolved';
    }
};

const appendRuleViolationSummary = (lines: string[], alert: IAlertTracking) => {
    if (alert.alert_type !== 'rule_violation') return;

    const checkType = String(alert.specific_service || '').trim();
    const details = alert.details || {};

    if (!checkType) return;

    if (checkType === 'container_status') {
        lines.push(`Container: ${details.container_name || alert.specific_endpoint || 'N/A'}`);
        lines.push(`State: ${String(details.container_state || 'unknown')}`);
        lines.push(`Status: ${String(details.container_status || 'unknown')}`);
        if (details.container_health && String(details.container_health).toLowerCase() !== 'unknown') {
            lines.push(`Health: ${details.container_health}`);
        }
        if (details.expected_state) {
            lines.push(`Expected: ${details.expected_state}`);
        }
        return;
    }

    const unit = typeof details.unit === 'string' ? details.unit : undefined;
    const currentValue = details.value;
    const threshold = details.threshold;
    const thresholdComparator = checkType === 'sip_registration' ? '<=' : '>=';

    if (currentValue !== undefined) {
        lines.push(`Current Value: ${formatValueWithUnit(currentValue, unit)}`);
    }
    if (threshold !== undefined) {
        lines.push(`Threshold: ${thresholdComparator} ${formatValueWithUnit(threshold, unit)}`);
    }

    if (checkType === 'cpu' && Array.isArray(details.top_cpu_processes) && details.top_cpu_processes.length > 0) {
        lines.push('Top CPU Processes:');
        details.top_cpu_processes.slice(0, 5).forEach((process: any) => {
            const name = String(process?.name || 'unknown');
            const pid = process?.pid !== undefined ? ` (pid:${process.pid})` : '';
            const cpu = process?.cpu_percent !== undefined ? `${formatNumber(process.cpu_percent, 2)}%` : 'N/A';
            const memory = process?.memory_percent !== undefined ? `${formatNumber(process.memory_percent, 2)}%` : 'N/A';
            lines.push(`- ${name}${pid} | CPU ${cpu} | MEM ${memory}`);
        });
    }
};

const appendGenericDetails = (lines: string[], alert: IAlertTracking) => {
    if (!alert.details || typeof alert.details !== 'object') return;

    const detailLines: string[] = [];
    Object.entries(alert.details).forEach(([key, rawValue]) => {
        if (HIDDEN_DETAIL_KEYS.has(key)) return;
        if (key === 'value' || key === 'threshold' || key === 'unit') return;
        if (key === 'container_name' || key === 'container_state' || key === 'container_status' || key === 'container_health' || key === 'expected_state') return;

        const value = rawValue instanceof Date
            ? formatTimestamp(rawValue)
            : (typeof rawValue === 'object' ? JSON.stringify(rawValue) : String(rawValue));

        detailLines.push(`${prettyKey(key)}: ${value}`);
    });

    if (detailLines.length > 0) {
        lines.push('Details:');
        detailLines.forEach((line) => lines.push(`- ${line}`));
    }
};

/**
 * Send a notification for an alert
 */
export async function sendNotification(
    alert: IAlertTracking,
    deviceName: string,
    isReminder: boolean = false
) {
    try {
        const alertTypeFilters = alert.alert_type === 'rule_violation'
            ? [alert.alert_type, 'threshold', 'all']
            : [alert.alert_type, 'all'];

        const channels = await NotificationChannel.find({
            enabled: true,
            alert_types: { $in: alertTypeFilters },
            severity_levels: { $in: [alert.severity, 'all'] }
        });

        if (channels.length === 0) {
            console.log(`No notification channels configured for alert type: ${alert.alert_type}`);
            return;
        }

        const message = buildAlertMessage(alert, deviceName, isReminder);

        for (const channel of channels) {
            try {
                await sendToChannel(channel, message, alert);
            } catch (error) {
                console.error(`Failed to send to channel ${channel.name}:`, error);
            }
        }
    } catch (error) {
        console.error('Error sending notification:', error);
    }
}

/**
 * Send a recovery notification
 */
export async function sendRecoveryNotification(
    alert: IAlertTracking,
    deviceName: string
) {
    try {
        const alertTypeFilters = alert.alert_type === 'rule_violation'
            ? [alert.alert_type, 'threshold', 'all']
            : [alert.alert_type, 'all'];

        const channels = await NotificationChannel.find({
            enabled: true,
            alert_types: { $in: alertTypeFilters }
        });

        const message = buildRecoveryMessage(alert, deviceName);

        for (const channel of channels) {
            try {
                await sendToChannel(channel, message, alert);
            } catch (error) {
                console.error(`Failed to send recovery to channel ${channel.name}:`, error);
            }
        }
    } catch (error) {
        console.error('Error sending recovery notification:', error);
    }
}

/**
 * Send test notification to a channel
 */
export async function sendTestNotification(channel: any) {
    const testMessage = {
        text: [
            'TEST NOTIFICATION',
            '',
            'This is a test notification from IoT Monitor.',
            `Channel: ${channel.name}`,
            `Type: ${channel.type}`,
            `Configured For: ${channel.alert_types.join(', ')}`,
            '',
            'If you can see this message, notification delivery is working.',
        ].join('\n'),
        severity: 'info'
    };

    await sendToChannel(channel, testMessage, null);
}

/**
 * Send to a specific channel
 */
async function sendToChannel(channel: any, message: any, _alert: IAlertTracking | null) {
    switch (channel.type) {
        case 'slack':
            await sendToSlack(channel, message);
            break;
        case 'email':
            await sendToEmail(channel, message);
            break;
        case 'webhook':
            await sendToWebhook(channel, message);
            break;
        case 'sms':
            await sendToSMS(channel, message);
            break;
        case 'whatsapp':
            await sendToWhatsApp(channel, message);
            break;
        case 'call_api':
            await sendToCallApi(channel, message);
            break;
        default:
            console.log(`Unknown channel type: ${channel.type}`);
    }
}

/**
 * Send to Slack
 */
async function sendToSlack(channel: any, message: any) {
    if (!channel.config.slack_webhook_url) {
        console.error('Slack webhook URL not configured');
        return;
    }

    const color = message.severity === 'critical' ? 'danger' : message.severity === 'warning' ? 'warning' : 'good';

    const slackPayload = {
        username: 'IoT Monitor',
        icon_emoji: ':satellite:',
        attachments: [
            {
                color,
                text: message.text,
                footer: channel.config.slack_group_name || 'IoT Monitor',
                ts: Math.floor(Date.now() / 1000)
            }
        ]
    };

    await axios.post(channel.config.slack_webhook_url, slackPayload);
    console.log(`Sent notification to Slack channel: ${channel.name}`);
}

/**
 * Send to Email
 */
async function sendToEmail(channel: any, message: any) {
    const recipients = Array.isArray(channel.config?.email_addresses) ? channel.config.email_addresses : [];
    if (recipients.length === 0) {
        console.error('Email recipients are not configured');
        return;
    }

    const host = channel.config?.smtp_host || process.env.SMTP_HOST;
    const port = Number(channel.config?.smtp_port || process.env.SMTP_PORT || 587);
    const secure = Boolean(channel.config?.smtp_secure) || port === 465;
    const user = channel.config?.smtp_user || process.env.SMTP_USER;
    const pass = channel.config?.smtp_pass || process.env.SMTP_PASS;
    const from = channel.config?.email_from || user;

    if (!host || !from) {
        console.error('SMTP host/from is not configured for email channel');
        return;
    }

    const transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: user ? { user, pass } : undefined,
    });

    const subjectPrefix = channel.config?.email_subject_prefix || '[IoTMonitor]';
    const subject = `${subjectPrefix} ${(message.severity || 'info').toUpperCase()} Notification`;

    await transporter.sendMail({
        from,
        to: recipients.join(', '),
        subject,
        text: String(message.text || ''),
    });

    console.log(`Sent email notification to ${recipients.join(', ')}`);
}

/**
 * Send to Webhook
 */
async function sendToWebhook(channel: any, message: any) {
    if (!channel.config.webhook_url) {
        console.error('Webhook URL not configured');
        return;
    }

    const payload = {
        channel: channel.name,
        message: message.text,
        severity: message.severity,
        timestamp: new Date().toISOString(),
        template: channel.config?.webhook_payload_template || undefined,
    };

    const method = String(channel.config?.webhook_method || 'POST').toUpperCase();
    const headers = channel.config?.webhook_headers && typeof channel.config.webhook_headers === 'object'
        ? channel.config.webhook_headers
        : undefined;

    await axios({
        method: method as any,
        url: channel.config.webhook_url,
        headers,
        data: method === 'GET' ? undefined : payload,
        params: method === 'GET' ? payload : undefined,
    });

    console.log(`Sent notification to webhook: ${channel.name}`);
}

/**
 * Send to SMS
 */
async function sendToSMS(channel: any, message: any) {
    // TODO: Implement SMS sending
    console.log(`SMS notification to ${channel.config.phone_numbers?.join(', ')}: ${message.text}`);
}

async function sendToWhatsApp(channel: any, message: any) {
    const url = channel.config?.whatsapp_api_url;
    const recipients = Array.isArray(channel.config?.whatsapp_to_numbers) ? channel.config.whatsapp_to_numbers : [];
    if (!url || recipients.length === 0) {
        console.error('WhatsApp API URL or recipients not configured');
        return;
    }

    const token = channel.config?.whatsapp_api_token;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    await axios.post(url, {
        to: recipients,
        message: String(message.text || ''),
        template: channel.config?.whatsapp_payload_template || undefined,
        severity: message.severity,
        channel: channel.name,
        timestamp: new Date().toISOString(),
    }, { headers });

    console.log(`Sent notification to WhatsApp channel: ${channel.name}`);
}

async function sendToCallApi(channel: any, message: any) {
    const url = channel.config?.call_api_url;
    const recipients = Array.isArray(channel.config?.call_to_numbers) ? channel.config.call_to_numbers : [];
    if (!url || recipients.length === 0) {
        console.error('Call API URL or recipients not configured');
        return;
    }

    const token = channel.config?.call_api_token;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    await axios.post(url, {
        to: recipients,
        message: String(message.text || ''),
        template: channel.config?.call_payload_template || undefined,
        severity: message.severity,
        channel: channel.name,
        timestamp: new Date().toISOString(),
    }, { headers });

    console.log(`Sent notification to Call API channel: ${channel.name}`);
}

/**
 * Build alert message
 */
function buildAlertMessage(alert: IAlertTracking, deviceName: string, isReminder: boolean): any {
    const heading = isReminder ? 'REMINDER' : 'ALERT';
    const severityLabel = String(alert.severity || 'warning').toUpperCase();
    const eventTime = formatTimestamp(alert.first_triggered);
    const elapsedSeconds = alert.first_triggered
        ? Math.max(0, Math.floor((Date.now() - new Date(alert.first_triggered).getTime()) / 1000))
        : 0;

    const lines: string[] = [
        `${heading} [${severityLabel}]`,
        '',
        `Device: ${deviceName}`,
        `Alert: ${getAlertTypeDescription(alert)}`,
        `Time: ${eventTime}`,
    ];

    if (alert.specific_endpoint) {
        lines.push(`Endpoint: ${alert.specific_endpoint}`);
    }
    if (elapsedSeconds > 0) {
        lines.push(`Elapsed: ${formatDuration(elapsedSeconds)}`);
    }

    appendRuleViolationSummary(lines, alert);

    if (isReminder) {
        lines.push(`Notifications Sent: ${alert.notification_count}`);
        lines.push(`Next Update: ${alert.throttling_config.repeat_interval_minutes} minutes`);
    } else {
        lines.push('Action: Immediate notification');
        lines.push(`Next Update: ${alert.throttling_config.repeat_interval_minutes} minutes`);
    }

    appendGenericDetails(lines, alert);

    return {
        text: lines.join('\n'),
        severity: alert.severity
    };
}

/**
 * Build recovery message
 */
function buildRecoveryMessage(alert: IAlertTracking, deviceName: string): any {
    const duration_seconds = alert.details?.duration_seconds
        ?? (toNumberOrNull(alert.details?.duration_minutes) || 0) * 60;

    const lines: string[] = [
        'RESOLVED',
        '',
        `Device: ${deviceName}`,
        `Status: ${getRecoveryDescription(alert)}`,
    ];

    if (alert.specific_endpoint) {
        lines.push(`Endpoint: ${alert.specific_endpoint}`);
    }

    lines.push(`Recovery Time: ${formatTimestamp(alert.resolved_at || new Date())}`);
    lines.push(`Duration: ${formatDuration(duration_seconds)}`);

    if (alert.alert_type === 'rule_violation') {
        appendRuleViolationSummary(lines, alert);
    }

    if (alert.details?.resolution_reason) {
        lines.push(`Resolution Reason: ${alert.details.resolution_reason}`);
    }
    if (alert.details?.resolution_note) {
        lines.push(`Resolution Note: ${alert.details.resolution_note}`);
    }
    if (alert.details?.rca) {
        lines.push(`RCA: ${alert.details.rca}`);
    }
    if (alert.details?.resolved_by_email) {
        lines.push(`Resolved By: ${alert.details.resolved_by_email}`);
    }

    return {
        text: lines.join('\n'),
        severity: 'info'
    };
}

