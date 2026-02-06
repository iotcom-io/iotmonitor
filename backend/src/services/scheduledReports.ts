import Device from '../models/Device';
import AlertTracking from '../models/AlertTracking';
import NotificationChannel from '../models/NotificationChannel';
import axios from 'axios';

/**
 * Scheduled Reports Service
 * 
 * Generates and sends hourly status updates for ALL devices
 */

export async function sendHourlyStatusUpdate() {
    try {
        console.log('Generating hourly status update...');

        // Fetch all devices
        const devices = await Device.find();
        const activeAlerts = await AlertTracking.find({ state: { $ne: 'resolved' } }).populate('device_id');

        // Calculate stats
        const totalDevices = devices.length;
        const onlineDevices = devices.filter(d => d.status === 'online');
        const offlineDevices = devices.filter(d => d.status === 'offline');
        const warningDevices = devices.filter(d => d.status === 'warning');

        // Build hourly digest message
        const message = buildHourlyDigest(
            totalDevices,
            onlineDevices,
            offlineDevices,
            warningDevices,
            activeAlerts
        );

        // Send to all enabled notification channels that accept hourly reports
        const channels = await NotificationChannel.find({ enabled: true });

        for (const channel of channels) {
            try {
                await sendDigestToChannel(channel, message);
            } catch (error) {
                console.error(`Failed to send hourly digest to ${channel.name}:`, error);
            }
        }

        console.log(`Hourly status update sent to ${channels.length} channels`);
    } catch (error) {
        console.error('Error sending hourly status update:', error);
    }
}

/**
 * Build hourly digest message
 */
function buildHourlyDigest(
    total: number,
    online: any[],
    offline: any[],
    warning: any[],
    alerts: any[]
): string {
    const now = new Date();
    const timestamp = now.toLocaleString('en-US', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'medium',
        timeStyle: 'short'
    });

    let message = `═══════════════════════════════════════\n`;
    message += `  📊 IoT Monitor - Hourly Status Update\n`;
    message += `  Time: ${timestamp}\n`;
    message += `═══════════════════════════════════════\n\n`;

    // Summary
    message += `*SUMMARY*\n`;
    message += `─────────\n`;
    message += `Total Devices: ${total}\n`;
    message += `  ✓ Online: ${online.length}\n`;
    message += `  ✗ Offline: ${offline.length}\n`;
    message += `  ⚠ Issues: ${warning.length}\n\n`;

    // Active Alerts
    if (alerts.length > 0) {
        message += `*ACTIVE ALERTS (${alerts.length})*\n`;
        message += `─────────────────\n`;
        alerts.forEach((alert, index) => {
            const device = online.find(d => d._id.toString() === alert.device_id) ||
                offline.find(d => d._id.toString() === alert.device_id) ||
                warning.find(d => d._id.toString() === alert.device_id);

            const deviceName = device ? device.name : 'Unknown Device';
            const severityIcon = alert.severity === 'critical' ? '🔴' : alert.severity === 'warning' ? '⚠️' : 'ℹ️';
            const duration = Math.floor((now.getTime() - new Date(alert.first_triggered).getTime()) / 60000);

            let alertDesc = alert.alert_type.toUpperCase();
            if (alert.specific_service) {
                alertDesc += ` - ${alert.specific_service}`;
            }

            message += `${index + 1}. ${severityIcon} ${deviceName} - ${alertDesc}\n`;
            message += `   Since: ${new Date(alert.first_triggered).toLocaleTimeString()} (${duration} min ago)\n\n`;
        });
    } else {
        message += `*ACTIVE ALERTS*\n`;
        message += `─────────────────\n`;
        message += `✅ No active alerts - all systems operational!\n\n`;
    }

    // Device Status
    message += `*DEVICE STATUS*\n`;
    message += `─────────────────\n`;

    if (online.length > 0) {
        message += `[ONLINE - ${online.length} devices]\n`;
        online.slice(0, 10).forEach(device => {
            const cpu = device.config?.cpu_usage ? `${device.config.cpu_usage}%` : 'N/A';
            const mem = device.config?.mem_usage ? `${device.config.mem_usage}%` : 'N/A';
            const disk = device.config?.disk_usage ? `${device.config.disk_usage}%` : 'N/A';

            message += `✓ ${device.name} | CPU: ${cpu}, Mem: ${mem}, Disk: ${disk}\n`;
        });

        if (online.length > 10) {
            message += `... and ${online.length - 10} more\n`;
        }
        message += `\n`;
    }

    if (offline.length > 0) {
        message += `[OFFLINE - ${offline.length} devices]\n`;
        offline.forEach(device => {
            const lastSeen = new Date(device.last_seen);
            const minAgo = Math.floor((now.getTime() - lastSeen.getTime()) / 60000);
            message += `✗ ${device.name} | Last Seen: ${lastSeen.toLocaleTimeString()} (${minAgo} min ago)\n`;
        });
        message += `\n`;
    }

    if (warning.length > 0) {
        message += `[WARNING - ${warning.length} devices]\n`;
        warning.forEach(device => {
            message += `⚠ ${device.name} | Status: ${device.status}\n`;
        });
    }

    return message;
}

/**
 * Send digest to a channel
 */
async function sendDigestToChannel(channel: any, message: string) {
    if (channel.type === 'slack' && channel.config.slack_webhook_url) {
        await axios.post(channel.config.slack_webhook_url, {
            username: 'IoT Monitor',
            icon_emoji: ':chart_with_upwards_trend:',
            text: message
        });
    }
    // Add other channel types as needed
}

/**
 * Start hourly reports service
 * Runs at the top of every hour
 */
export function startHourlyReports() {
    console.log('Starting hourly reports service...');

    // Calculate milliseconds until next hour
    const now = new Date();
    const msUntilNextHour = (60 - now.getMinutes()) * 60000 - now.getSeconds() * 1000;

    // Send first report at the top of the next hour
    setTimeout(() => {
        sendHourlyStatusUpdate();

        // Then send every hour
        setInterval(sendHourlyStatusUpdate, 3600000); // 1 hour
    }, msUntilNextHour);

    console.log(`Next hourly report in ${Math.floor(msUntilNextHour / 60000)} minutes`);
}
