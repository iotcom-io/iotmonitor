import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import AlertTracking from '../models/AlertTracking';
import Device from '../models/Device';

const router = Router();
router.use(authenticate);

const severityRank: Record<string, number> = {
    critical: 3,
    warning: 2,
    info: 1,
};

const toDateMs = (value: unknown) => {
    const parsed = new Date(String(value || ''));
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

// Active (unresolved) alert tracking entries
router.get('/active', async (req, res) => {
    try {
        const {
            device_id,
            severity,
            alert_type,
            state,
            limit = '250',
        } = req.query as Record<string, string | undefined>;

        const query: any = {
            state: { $ne: 'resolved' },
        };

        if (device_id) query.device_id = device_id;
        if (severity) query.severity = severity;
        if (alert_type) query.alert_type = alert_type;
        if (state && state !== 'all') query.state = state;

        const parsedLimit = Math.max(1, Math.min(1000, Number(limit) || 250));

        const alerts = await AlertTracking.find(query)
            .sort({ last_notified: -1 })
            .limit(parsedLimit)
            .lean();

        const deviceIds = Array.from(new Set(alerts.map((alert: any) => String(alert.device_id || '')))).filter(Boolean);
        const devices = await Device.find({ device_id: { $in: deviceIds } })
            .select({ device_id: 1, name: 1 })
            .lean();

        const deviceMap = new Map<string, string>();
        devices.forEach((device: any) => {
            if (device?.device_id) deviceMap.set(String(device.device_id), String(device.name || device.device_id));
        });

        const rows = alerts
            .map((alert: any) => {
                const repeatMinutes = alert?.state === 'hourly_only'
                    ? 60
                    : Math.max(1, Number(alert?.throttling_config?.repeat_interval_minutes || 5));

                const lastNotified = alert?.last_notified ? new Date(alert.last_notified) : null;
                const nextNotificationAt = lastNotified && !Number.isNaN(lastNotified.getTime())
                    ? new Date(lastNotified.getTime() + repeatMinutes * 60 * 1000)
                    : null;

                return {
                    ...alert,
                    device_name: deviceMap.get(String(alert.device_id)) || String(alert.device_id || 'Unknown'),
                    next_notification_at: nextNotificationAt ? nextNotificationAt.toISOString() : null,
                };
            })
            .sort((a: any, b: any) => {
                const severityDiff = (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0);
                if (severityDiff !== 0) return severityDiff;
                return toDateMs(b.last_notified) - toDateMs(a.last_notified);
            });

        res.json(rows);
    } catch (error: any) {
        res.status(500).json({ message: error.message || 'Failed to fetch active alerts' });
    }
});

export default router;
