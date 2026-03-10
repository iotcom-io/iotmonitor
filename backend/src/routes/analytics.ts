import express from 'express';
import { authenticate, authorizePermission, AuthRequest } from '../middleware/auth';
import { buildAnalyticsOverview, buildDeviceAnalytics } from '../services/analytics';
import Device from '../models/Device';
import { canAccessDevice } from '../lib/rbac';

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

export default router;
