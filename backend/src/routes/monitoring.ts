import { Router } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import MonitoringCheck from '../models/MonitoringCheck';

const router = Router();

router.use(authenticate);

// Get checks for a device
router.get('/metrics/:deviceId', async (req: AuthRequest, res) => {
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
