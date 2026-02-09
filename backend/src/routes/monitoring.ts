import { Router } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import MonitoringCheck from '../models/MonitoringCheck';
import Device from '../models/Device';
import { resolveAlert } from '../services/notificationThrottling';

const router = Router();

router.use(authenticate);

// Get metrics (telemetry history) for a device
router.get('/metrics/:deviceId', async (req: AuthRequest, res) => {
    try {
        const device = await Device.findOne({ device_id: req.params.deviceId });
        if (device?.monitoring_paused) {
            return res.json([]);
        }

        const Telemetry = (await import('../models/Telemetry')).default;
        const metrics = await Telemetry.find({ device_id: req.params.deviceId })
            .sort({ timestamp: -1 })
            .limit(50);

        // Return in chronological order for charts
        res.json(metrics.reverse());
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// List checks for a device
router.get('/checks/:deviceId', async (req: AuthRequest, res) => {
    try {
        const checks = await MonitoringCheck.find({ device_id: req.params.deviceId });
        res.json(checks);
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// Add a check to a device
router.post('/', async (req: AuthRequest, res) => {
    try {
        const { device_id, check_type, target, config, interval, thresholds, notification_frequency, notification_recipients } = req.body;
        const check = new MonitoringCheck({
            device_id,
            check_type,
            target,
            config,
            interval,
            thresholds,
            notification_frequency,
            notification_recipients
        });
        await check.save();
        res.status(201).json(check);
    } catch (err: any) {
        res.status(400).json({ message: err.message });
    }
});

// Update a check
router.put('/:id', async (req: AuthRequest, res) => {
    try {
        const previous = await MonitoringCheck.findById(req.params.id);
        if (!previous) return res.status(404).json({ message: 'Check not found' });

        const check = await MonitoringCheck.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!check) return res.status(404).json({ message: 'Check not found' });

        if (previous.enabled !== check.enabled) {
            const device = await Device.findOne({ device_id: check.device_id });
            const { NotificationService } = await import('../services/NotificationService');
            const SystemSettings = (await import('../models/SystemSettings')).default;
            const settings = await SystemSettings.findOne();

            const stateLabel = check.enabled ? 'resumed' : 'paused';
            if (!check.enabled) {
                await resolveAlert({
                    device_id: check.device_id,
                    device_name: device?.name || check.device_id,
                    alert_type: 'rule_violation',
                    specific_service: check.check_type,
                    specific_endpoint: check.target,
                    details: { resolution_reason: 'Service monitoring paused' },
                });
            }

            await NotificationService.send({
                subject: `Service Monitoring ${check.enabled ? 'Resumed' : 'Paused'}: ${device?.name || check.device_id}`,
                message: `Monitoring for ${check.check_type}${check.target ? ` (${check.target})` : ''} is ${stateLabel} on ${device?.name || check.device_id}.`,
                channels: ['slack'],
                recipients: { slackWebhook: settings?.notification_slack_webhook || device?.notification_slack_webhook },
            });
        }

        res.json(check);
    } catch (err: any) {
        res.status(400).json({ message: err.message });
    }
});

// Delete a check
router.delete('/:id', async (req: AuthRequest, res) => {
    try {
        const check = await MonitoringCheck.findByIdAndDelete(req.params.id);
        if (!check) return res.status(404).json({ message: 'Check not found' });
        res.json({ message: 'Check deleted' });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

export default router;
