import axios from 'axios';
import AlertTracking, { IAlertTracking } from '../models/AlertTracking';
import NotificationChannel from '../models/NotificationChannel';

/**
 * Enhanced Notification Service
 * 
 * Supports multiple notification channels:
 * - Slack (multiple groups/webhooks)
 * - Email
 * - Webhooks
 * - SMS
 */

/**
 * Send a notification for an alert
 */
export async function sendNotification(
    alert: IAlertTracking,
    deviceName: string,
    isReminder: boolean = false
) {
    try {
        // Find matching notification channels
        const channels = await NotificationChannel.find({
            enabled: true,
            alert_types: { $in: [alert.alert_type, 'all'] },
            severity_levels: { $in: [alert.severity, 'all'] }
        });

        if (channels.length === 0) {
            console.log(`No notification channels configured for alert type: ${alert.alert_type}`);
            return;
        }

        // Build notification message
        const message = buildAlertMessage(alert, deviceName, isReminder);

        // Send to each channel
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
        const channels = await NotificationChannel.find({
            enabled: true,
            alert_types: { $in: [alert.alert_type, 'all'] }
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
        text: `🔔 *Test Notification*\n\nThis is a test notification from IoT Monitor.\n\n*Channel:* ${channel.name}\n*Type:* ${channel.type}\n*Configured for:* ${channel.alert_types.join(', ')}\n\nIf you're seeing this, your notification channel is working correctly! ✅`,
        severity: 'info'
    };

    await sendToChannel(channel, testMessage, null);
}

/**
 * Send to a specific channel
 */
async function sendToChannel(channel: any, message: any, alert: IAlertTracking | null) {
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
        icon_emoji: ':robot_face:',
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
    const prefix = isReminder ? '🔔 *REMINDER*' : '🚨 *ALERT*';
    const severityEmoji = alert.severity === 'critical' ? '🔴' : alert.severity === 'warning' ? '⚠️' : 'ℹ️';

    let typeDescription = '';
    switch (alert.alert_type) {
        case 'offline':
            typeDescription = 'Device Offline';
            break;
        case 'service_down':
            typeDescription = `Service Down: ${alert.specific_service}`;
            break;
        case 'sip_issue':
            typeDescription = 'SIP Issue';
            break;
        case 'high_latency':
            typeDescription = 'High Latency';
            break;
        case 'threshold':
            typeDescription = 'Threshold Exceeded';
            break;
        default:
            typeDescription = alert.alert_type;
    }

    const duration = alert.details?.offline_duration_minutes
        ? `\n*Duration:* ${alert.details.offline_duration_minutes} minutes`
        : '';

    const notificationInfo = isReminder
        ? `\n*Notifications sent:* ${alert.notification_count}\n*Next check:* ${alert.throttling_config.repeat_interval_minutes} minutes`
        : `\n*Action:* Immediate notification\n*Next update:* ${alert.throttling_config.repeat_interval_minutes} minutes`;

    let text = `${prefix} ${severityEmoji}\n\n`;
    text += `*Device:* ${deviceName}\n`;
    text += `*Alert:* ${typeDescription}\n`;
    text += `*Time:* ${new Date(alert.first_triggered).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })}${duration}`;

    if (alert.specific_endpoint) {
        text += `\n*Endpoint:* ${alert.specific_endpoint}`;
    }

    text += notificationInfo;

    if (alert.details) {
        const detailKeys = Object.keys(alert.details).filter(k =>
            !['offline_duration_minutes', 'recovery_time', 'duration_minutes'].includes(k)
        );

        if (detailKeys.length > 0) {
            text += '\n\n*Details:*\n';
            detailKeys.forEach(key => {
                text += `• ${key}: ${alert.details[key]}\n`;
            });
        }
    }

    return {
        text,
        severity: alert.severity
    };
}

/**
 * Build recovery message
 */
function buildRecoveryMessage(alert: IAlertTracking, deviceName: string): any {
    const duration_minutes = alert.details?.duration_minutes || 0;
    const duration_seconds = alert.details?.duration_seconds || (duration_minutes * 60);

    let durationText = '';
    if (duration_seconds < 60) {
        durationText = `${duration_seconds} seconds`;
    } else if (duration_seconds < 3600) {
        durationText = `${Math.floor(duration_seconds / 60)}m ${duration_seconds % 60}s`;
    } else {
        durationText = `${Math.floor(duration_seconds / 3600)}h ${Math.floor((duration_seconds % 3600) / 60)}m`;
    }

    let typeDescription = '';
    switch (alert.alert_type) {
        case 'offline':
            typeDescription = 'Device Back Online';
            break;
        case 'service_down':
            typeDescription = `Service Restored: ${alert.specific_service}`;
            break;
        case 'sip_issue':
            typeDescription = alert.details?.issue_type === 'registration_failed'
                ? 'SIP Registration Restored'
                : 'SIP Contact Reachable';
            break;
        case 'high_latency':
            typeDescription = 'SIP Latency Normal';
            break;
        case 'threshold':
            typeDescription = 'Back to Normal';
            break;
        default:
            typeDescription = 'Issue Resolved';
    }

    let text = `✅ *RESOLVED*\n\n`;
    text += `*Device:* ${deviceName}\n`;
    text += `*Status:* ${typeDescription}\n`;
    if (alert.specific_endpoint) {
        text += `*Endpoint:* ${alert.specific_endpoint}\n`;
    }
    text += `*Recovery Time:* ${alert.resolved_at ? new Date(alert.resolved_at).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }) : 'Just now'}\n`;
    text += `*Duration:* ${durationText}\n`;

    return {
        text,
        severity: 'info'
    };
}
