import { Router } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import MonitoringCheck from '../models/MonitoringCheck';

const router = Router();

router.use(authenticate);

// Get metrics (telemetry history) for a device
router.get('/metrics/:deviceId', async (req: AuthRequest, res) => {
    try {
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
        const check = await MonitoringCheck.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!check) return res.status(404).json({ message: 'Check not found' });
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
