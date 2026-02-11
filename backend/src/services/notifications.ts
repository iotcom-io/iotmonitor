import axios from 'axios';
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
    // TODO: Implement email sending
    console.log(`Email notification to ${channel.config.email_addresses?.join(', ')}: ${message.text}`);
}

/**
 * Send to Webhook
 */
async function sendToWebhook(channel: any, message: any) {
    if (!channel.config.webhook_url) {
        console.error('Webhook URL not configured');
        return;
    }

    await axios.post(channel.config.webhook_url, {
        channel: channel.name,
        message: message.text,
        severity: message.severity,
        timestamp: new Date().toISOString()
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

/**
 * Build alert message
 */
function buildAlertMessage(alert: IAlertTracking, deviceName: string, isReminder: boolean): any {
    const heading = isReminder ? 'REMINDER' : 'ALERT';
    const severityLabel = String(alert.severity || 'warning').toUpperCase();
    const eventTime = formatTimestamp(alert.first_triggered);

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

    return {
        text: lines.join('\n'),
        severity: 'info'
    };
}

