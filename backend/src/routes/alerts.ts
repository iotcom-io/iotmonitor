import { Router } from 'express';
import { authenticate, AuthRequest, authorizePermission } from '../middleware/auth';
import AlertTracking from '../models/AlertTracking';
import Device from '../models/Device';
import { canAccessDevice } from '../lib/rbac';

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

const csvEscape = (value: unknown) => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    if (/[",\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
};

const fetchActiveAlertRows = async (req: AuthRequest, maxLimit: number) => {
    const {
        device_id,
        severity,
        alert_type,
        state,
        limit = String(maxLimit),
    } = req.query as Record<string, string | undefined>;

    const query: any = {
        state: { $ne: 'resolved' },
    };

    if (device_id) query.device_id = device_id;
    if (severity) query.severity = severity;
    if (alert_type) query.alert_type = alert_type;
    if (state && state !== 'all') query.state = state;

    const parsedLimit = Math.max(1, Math.min(maxLimit, Number(limit) || maxLimit));

    const alerts = await AlertTracking.find(query)
        .sort({ last_notified: -1 })
        .limit(parsedLimit)
        .lean();

    const deviceIds = Array.from(new Set(alerts.map((alert: any) => String(alert.device_id || '')))).filter(Boolean);
    const devices = await Device.find({ device_id: { $in: deviceIds } })
        .select({ device_id: 1, name: 1, assigned_user_ids: 1 })
        .lean();

    const deviceMap = new Map<string, string>();
    const deviceMeta = new Map<string, any>();
    devices.forEach((device: any) => {
        if (!device?.device_id) return;
        const key = String(device.device_id);
        deviceMap.set(key, String(device.name || device.device_id));
        deviceMeta.set(key, device);
    });

    return alerts
        .filter((alert: any) => {
            const device = deviceMeta.get(String(alert.device_id));
            if (!device) return req.user?.role === 'admin';
            return canAccessDevice(req.user, device);
        })
        .map((alert: any) => {
            const repeatMinutes = alert?.state === 'hourly_only'
                ? 60
                : Math.max(1, Number(alert?.throttling_config?.repeat_interval_minutes || 5));

            const lastNotified = alert?.last_notified ? new Date(alert.last_notified) : null;
            const nextNotificationAt = lastNotified && !Number.isNaN(lastNotified.getTime())
                ? new Date(lastNotified.getTime() + repeatMinutes * 60 * 1000)
                : null;

            const assignedUserIds = Array.isArray(deviceMeta.get(String(alert.device_id))?.assigned_user_ids)
                ? deviceMeta.get(String(alert.device_id)).assigned_user_ids
                : [];

            return {
                ...alert,
                device_name: deviceMap.get(String(alert.device_id)) || String(alert.device_id || 'Unknown'),
                next_notification_at: nextNotificationAt ? nextNotificationAt.toISOString() : null,
                assigned_user_ids: assignedUserIds,
            };
        })
        .sort((a: any, b: any) => {
            const severityDiff = (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0);
            if (severityDiff !== 0) return severityDiff;
            return toDateMs(b.last_notified) - toDateMs(a.last_notified);
        });
};

// Active (unresolved) alert tracking entries
router.get('/active', authorizePermission('alerts.view'), async (req: AuthRequest, res) => {
    try {
        const rows = await fetchActiveAlertRows(req, 1000);

        res.json(rows);
    } catch (error: any) {
        res.status(500).json({ message: error.message || 'Failed to fetch active alerts' });
    }
});

router.get('/active/export', authorizePermission('alerts.view'), async (req: AuthRequest, res) => {
    try {
        const rows = await fetchActiveAlertRows(req, 10000);

        const csvRows = rows.map((alert: any) => {
            const details = alert?.details && typeof alert.details === 'object'
                ? JSON.stringify(alert.details)
                : '';
            return [
                String(alert._id || ''),
                String(alert.device_id || ''),
                String(alert.device_name || ''),
                String(alert.alert_type || ''),
                String(alert.specific_service || ''),
                String(alert.specific_endpoint || ''),
                String(alert.severity || ''),
                String(alert.state || ''),
                alert.first_triggered ? new Date(alert.first_triggered).toISOString() : '',
                alert.last_notified ? new Date(alert.last_notified).toISOString() : '',
                alert.next_notification_at ? new Date(alert.next_notification_at).toISOString() : '',
                String(alert.notification_count ?? ''),
                details,
                String(req.user?.email || ''),
                new Date().toISOString(),
            ].map(csvEscape).join(',');
        });

        const csvBody = [
            [
                'alert_id',
                'device_id',
                'device_name',
                'alert_type',
                'specific_service',
                'specific_endpoint',
                'severity',
                'state',
                'first_triggered',
                'last_notified',
                'next_notification_at',
                'notification_count',
                'details_json',
                'exported_by',
                'exported_at',
            ].join(','),
            ...csvRows,
        ].join('\n');

        const fileName = `active-alerts-${Date.now()}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        return res.send(csvBody);
    } catch (error: any) {
        return res.status(500).json({ message: error.message || 'Failed to export active alerts' });
    }
});

export default router;
