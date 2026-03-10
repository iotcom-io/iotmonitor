import express from 'express';
import { authenticate, authorizePermission, AuthRequest } from '../middleware/auth';
import { buildAnalyticsOverview, buildDeviceAnalytics, classifyIncident, buildForecastExplorer, buildIssueDetail } from '../services/analytics';
import Device from '../models/Device';
import { canAccessDevice } from '../lib/rbac';
import Incident from '../models/Incident';

const router = express.Router();

router.use(authenticate);

router.get('/overview', authorizePermission('monitoring.view'), async (req: AuthRequest, res) => {
    try {
        const windowDays = Math.max(1, Math.min(30, Number(req.query.window_days || 7)));
        const data = await buildAnalyticsOverview(windowDays);
        res.json(data);
    } catch (error) {
        console.error('Failed to build analytics overview:', error);
        res.status(500).json({ message: 'Failed to build analytics overview' });
    }
});

router.get('/devices/:id', authorizePermission('monitoring.view'), async (req: AuthRequest, res) => {
    try {
        const deviceId = String(req.params.id || '').trim();
        if (!deviceId) {
            return res.status(400).json({ message: 'Device id is required' });
        }

        const device = await Device.findOne({ device_id: deviceId }).select({ device_id: 1, assigned_user_ids: 1 });
        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }
        if (!canAccessDevice(req.user, device)) {
            return res.status(403).json({ message: 'Access denied for target device' });
        }

        const windowDays = Math.max(1, Math.min(30, Number(req.query.window_days || 7)));
        const data = await buildDeviceAnalytics(deviceId, windowDays);
        res.json(data);
    } catch (error) {
        console.error('Failed to build device analytics:', error);
        res.status(500).json({ message: 'Failed to build device analytics' });
    }
});

router.get('/issues', authorizePermission('incidents.view'), async (req: AuthRequest, res) => {
    try {
        const windowDays = Math.max(1, Math.min(30, Number(req.query.window_days || 7)));
        const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
        const deviceId = String(req.query.device_id || '').trim();
        const issueKey = String(req.query.issue_key || '').trim().toLowerCase();
        const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

        const query: any = {
            target_type: 'device',
            started_at: { $gte: since },
        };
        if (deviceId) query.target_id = deviceId;

        const incidents = await Incident.find(query)
            .sort({ started_at: -1 })
            .limit(limit);

        let rows = incidents.map((incident: any) => {
            const issue = classifyIncident(incident);
            return {
                id: String(incident._id),
                target_id: incident.target_id,
                target_name: incident.target_name,
                summary: incident.summary,
                severity: incident.severity,
                status: incident.status,
                started_at: incident.started_at,
                resolved_at: incident.resolved_at,
                issue,
            };
        });

        if (issueKey) {
            rows = rows.filter((row) => row.issue.key === issueKey);
        }

        if (req.user?.role !== 'admin') {
            const deviceIds = Array.from(new Set(rows.map((row) => String(row.target_id || '')).filter(Boolean)));
            const devices = await Device.find({ device_id: { $in: deviceIds } }).select({ device_id: 1, assigned_user_ids: 1 });
            const map = new Map<string, any>();
            devices.forEach((device: any) => map.set(String(device.device_id), device));
            rows = rows.filter((row) => canAccessDevice(req.user, map.get(String(row.target_id))));
        }

        res.json({
            window_days: windowDays,
            total: rows.length,
            incidents: rows,
        });
    } catch (error) {
        console.error('Failed to fetch analytics issues:', error);
        res.status(500).json({ message: 'Failed to fetch analytics issues' });
    }
});

router.get('/forecast', authorizePermission('monitoring.view'), async (req: AuthRequest, res) => {
    try {
        const windowDays = Math.max(1, Math.min(30, Number(req.query.window_days || 7)));
        const deviceId = String(req.query.device_id || '').trim();
        const rawService = String(req.query.service || 'all').trim().toLowerCase();
        const service = (['cpu', 'memory', 'disk', 'all'].includes(rawService) ? rawService : 'all') as 'cpu' | 'memory' | 'disk' | 'all';

        if (deviceId) {
            const device = await Device.findOne({ device_id: deviceId }).select({ device_id: 1, assigned_user_ids: 1 });
            if (!device) return res.status(404).json({ message: 'Device not found' });
            if (!canAccessDevice(req.user, device)) return res.status(403).json({ message: 'Access denied for target device' });
        }

        const payload = await buildForecastExplorer({ windowDays, deviceId: deviceId || undefined, service });
        if (!deviceId && req.user?.role !== 'admin') {
            const allowedIds = new Set(
                (await Device.find({}).select({ device_id: 1, assigned_user_ids: 1 }))
                    .filter((device: any) => canAccessDevice(req.user, device))
                    .map((device: any) => String(device.device_id))
            );
            payload.rows = payload.rows.filter((row: any) => allowedIds.has(String(row.device_id)));
        }
        res.json(payload);
    } catch (error) {
        console.error('Failed to fetch analytics forecast:', error);
        res.status(500).json({ message: 'Failed to fetch analytics forecast' });
    }
});

router.get('/issues/:issueKey', authorizePermission('incidents.view'), async (req: AuthRequest, res) => {
    try {
        const issueKey = String(req.params.issueKey || '').trim().toLowerCase();
        if (!issueKey) return res.status(400).json({ message: 'Issue key is required' });
        const windowDays = Math.max(1, Math.min(30, Number(req.query.window_days || 7)));
        const deviceId = String(req.query.device_id || '').trim();

        if (deviceId) {
            const device = await Device.findOne({ device_id: deviceId }).select({ device_id: 1, assigned_user_ids: 1 });
            if (!device) return res.status(404).json({ message: 'Device not found' });
            if (!canAccessDevice(req.user, device)) return res.status(403).json({ message: 'Access denied for target device' });
        }

        const detail = await buildIssueDetail({
            issueKey,
            windowDays,
            deviceId: deviceId || undefined,
        });
        if (!detail) return res.status(404).json({ message: 'Issue detail not found' });

        if (req.user?.role !== 'admin') {
            const allowedIds = new Set(
                (await Device.find({}).select({ device_id: 1, assigned_user_ids: 1 }))
                    .filter((device: any) => canAccessDevice(req.user, device))
                    .map((device: any) => String(device.device_id))
            );
            detail.affected_devices = detail.affected_devices.filter((row: any) => allowedIds.has(String(row.device_id)));
            detail.recent_incidents = detail.recent_incidents.filter((row: any) => allowedIds.has(String(row.target_id)));
        }

        res.json(detail);
    } catch (error) {
        console.error('Failed to fetch issue detail analytics:', error);
        res.status(500).json({ message: 'Failed to fetch issue detail analytics' });
    }
});

export default router;
