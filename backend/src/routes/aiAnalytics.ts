import { Router } from 'express';
import { authenticate, authorizePermission, AuthRequest } from '../middleware/auth';
import { getIncidentInsights, getDeviceForecast, getMetricCorrelation, getAIOverview } from '../services/aiAnalytics';
import { canAccessDevice } from '../lib/rbac';
import Device from '../models/Device';

const router = Router();
router.use(authenticate);

router.get('/overview', authorizePermission('monitoring.view'), async (req: AuthRequest, res) => {
    try {
        const windowDays = Math.max(1, Math.min(30, Number(req.query.window_days || 7)));
        const data = await getAIOverview(windowDays);
        res.json(data);
    } catch (err: any) {
        console.error('[AI Analytics] overview error:', err);
        res.status(500).json({ message: err.message || 'Failed to compute AI overview' });
    }
});

router.get('/incidents', authorizePermission('incidents.view'), async (req: AuthRequest, res) => {
    try {
        const windowDays = Math.max(1, Math.min(30, Number(req.query.window_days || 7)));
        const deviceId = String(req.query.device_id || '').trim() || undefined;
        const data = await getIncidentInsights(windowDays, deviceId);
        res.json(data);
    } catch (err: any) {
        console.error('[AI Analytics] incidents error:', err);
        res.status(500).json({ message: err.message || 'Failed to compute incident insights' });
    }
});

router.get('/forecast/:deviceId', authorizePermission('monitoring.view'), async (req: AuthRequest, res) => {
    try {
        const deviceId = String(req.params.deviceId);
        const device = await Device.findOne({ device_id: deviceId }).select({ device_id: 1, assigned_user_ids: 1 });
        if (!device) return res.status(404).json({ message: 'Device not found' });
        if (!canAccessDevice(req.user, device)) return res.status(403).json({ message: 'Access denied' });

        const rawMetric = typeof req.query.metric === 'string' ? req.query.metric : 'cpu_usage';
        const metric = (rawMetric as 'cpu_usage' | 'memory_usage' | 'disk_usage');
        const windowDays = Math.max(1, Math.min(30, Number(req.query.window_days || 7)));
        const data = await getDeviceForecast(deviceId, metric, windowDays);
        res.json(data);
    } catch (err: any) {
        console.error('[AI Analytics] forecast error:', err);
        res.status(500).json({ message: err.message || 'Failed to compute forecast' });
    }
});

router.get('/correlation/:deviceId', authorizePermission('monitoring.view'), async (req: AuthRequest, res) => {
    try {
        const deviceId = String(req.params.deviceId);
        const device = await Device.findOne({ device_id: deviceId }).select({ device_id: 1, assigned_user_ids: 1 });
        if (!device) return res.status(404).json({ message: 'Device not found' });
        if (!canAccessDevice(req.user, device)) return res.status(403).json({ message: 'Access denied' });

        const metricA = typeof req.query.metric_a === 'string' ? req.query.metric_a : 'cpu_usage';
        const metricB = typeof req.query.metric_b === 'string' ? req.query.metric_b : 'memory_usage';
        const windowDays = Math.max(1, Math.min(30, Number(req.query.window_days || 7)));
        const data = await getMetricCorrelation(deviceId, metricA, metricB, windowDays);
        res.json(data);
    } catch (err: any) {
        console.error('[AI Analytics] correlation error:', err);
        res.status(500).json({ message: err.message || 'Failed to compute correlation' });
    }
});

export default router;
