import Device from '../models/Device';
import Alert from '../models/Alert';
import SystemSettings from '../models/SystemSettings';
import { NotificationService } from './NotificationService';

let timer: NodeJS.Timeout | null = null;

export const startSummaryReporter = async () => {
    if (timer) return;

    const settings = await SystemSettings.findOne();
    const intervalMinutes = settings?.summary_interval_minutes || 60;
    const intervalMs = intervalMinutes * 60 * 1000;

    const tick = async () => {
        try {
            const [devices, openAlerts] = await Promise.all([
                Device.find(),
                Alert.find({ resolved: false }).sort({ created_at: -1 })
            ]);

            const online = devices.filter(d => d.status === 'online').length;
            const offline = devices.filter(d => d.status === 'offline').length;
            const warning = devices.filter(d => d.status === 'warning').length;

            const alertLines = openAlerts.slice(0, 10).map(a =>
                `- ${a.device_id}: ${a.severity?.toUpperCase() || 'WARN'} ${a.message}`
            );

            const body = [
                `Devices: ${online} online, ${offline} offline, ${warning} warning`,
                `Open alerts: ${openAlerts.length}`,
                ...(alertLines.length ? ['Recent alerts:', ...alertLines] : [])
            ].join('\n');

            await NotificationService.send({
                subject: `IoTMonitor status summary`,
                message: body,
                channels: ['email', 'slack'],
                recipients: {}
            });
        } catch (err) {
            console.error('[SummaryReporter] error', err);
        }
    };

    // initial after slight delay
    timer = setInterval(tick, intervalMs);
    setTimeout(tick, 5000);
};
