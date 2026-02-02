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

// Add a check to a device
router.post('/', async (req: AuthRequest, res) => {
    try {
        const { device_id, check_type, config, interval, thresholds } = req.body;
        const check = new MonitoringCheck({
            device_id,
            check_type,
            config,
            interval,
            thresholds,
        });
        await check.save();
        res.status(201).json(check);
    } catch (err: any) {
        res.status(400).json({ message: err.message });
    }
});

export default router;
