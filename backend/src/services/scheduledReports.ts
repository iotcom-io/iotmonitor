import Device from '../models/Device';
import AlertTracking from '../models/AlertTracking';
import NotificationChannel from '../models/NotificationChannel';
import SystemSettings from '../models/SystemSettings';
import axios from 'axios';

const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata';
const DEFAULT_SUMMARY_INTERVAL_MINUTES = 360; // 4 summaries/day

export async function sendHourlyStatusUpdate() {
    try {
        console.log('Generating status summary...');

        const devices = await Device.find();
        const activeAlerts = await AlertTracking.find({ state: { $ne: 'resolved' } });

        const totalDevices = devices.length;
        const onlineDevices = devices.filter((d) => d.status === 'online');
        const offlineDevices = devices.filter((d) => d.status === 'offline');
        const warningDevices = devices.filter((d) => d.status === 'warning');

        const message = buildDigest(
            totalDevices,
            onlineDevices,
            offlineDevices,
            warningDevices,
            activeAlerts,
            devices
        );

        const channels = await NotificationChannel.find({ enabled: true });

        for (const channel of channels) {
            try {
                await sendDigestToChannel(channel, message);
            } catch (error) {
                console.error(`Failed to send summary to ${channel.name}:`, error);
            }
        }

        console.log(`Status summary sent to ${channels.length} channels`);
    } catch (error) {
        console.error('Error sending status summary:', error);
    }
}

function buildDigest(
    total: number,
    online: any[],
    offline: any[],
    warning: any[],
    alerts: any[],
    devices: any[]
): string {
    const now = new Date();
    const timestamp = now.toLocaleString('en-US', {
        timeZone: APP_TIMEZONE,
        dateStyle: 'medium',
        timeStyle: 'short',
    });

    const deviceMap = new Map<string, any>();
    for (const d of devices) {
        deviceMap.set(String(d.device_id), d);
        if (d._id) {
            deviceMap.set(String(d._id), d);
        }
    }

    let message = `IoT Monitor Status Summary\n`;
    message += `Time: ${timestamp}\n\n`;
    message += `Summary\n`;
    message += `Total Devices: ${total}\n`;
    message += `Online: ${online.length}\n`;
    message += `Offline: ${offline.length}\n`;
    message += `Warning: ${warning.length}\n\n`;

    if (alerts.length > 0) {
        const visibleAlerts = alerts.filter((alert) => deviceMap.has(String(alert.device_id)));
        message += `Active Alerts (${visibleAlerts.length})\n`;
        visibleAlerts.forEach((alert, index) => {
            const device = deviceMap.get(String(alert.device_id));
            const deviceName = device ? device.name : String(alert.device_id);
            const duration = Math.floor((now.getTime() - new Date(alert.first_triggered).getTime()) / 60000);
            const servicePart = alert.specific_service ? `/${alert.specific_service}` : '';

            message += `${index + 1}. [${alert.severity}] ${deviceName} ${alert.alert_type}${servicePart} (${duration}m)\n`;
        });
        message += `\n`;
    } else {
        message += `Active Alerts: none\n\n`;
    }

    if (offline.length > 0) {
        message += `Offline Devices\n`;
        offline.forEach((device) => {
            const lastSeen = new Date(device.last_seen);
            const minAgo = Math.floor((now.getTime() - lastSeen.getTime()) / 60000);
            message += `- ${device.name} (last seen ${minAgo}m ago)\n`;
        });
        message += `\n`;
    }

    return message;
}

async function sendDigestToChannel(channel: any, message: string) {
    if (channel.type === 'slack' && channel.config.slack_webhook_url) {
        await axios.post(channel.config.slack_webhook_url, {
            username: 'IoT Monitor',
            icon_emoji: ':chart_with_upwards_trend:',
            text: message,
        });
    }
}

export function startHourlyReports() {
    console.log('Starting scheduled summary service...');

    const run = async () => {
        try {
            await sendHourlyStatusUpdate();
        } finally {
            const settings = await SystemSettings.findOne().catch(() => null);
            const intervalMinutes = Math.max(
                DEFAULT_SUMMARY_INTERVAL_MINUTES,
                settings?.summary_interval_minutes || DEFAULT_SUMMARY_INTERVAL_MINUTES
            );
            const intervalMs = intervalMinutes * 60000;
            setTimeout(run, intervalMs);
            console.log(`Next summary in ${Math.floor(intervalMs / 60000)} minutes`);
        }
    };

    // Start shortly after boot
    setTimeout(run, 10000);
}
