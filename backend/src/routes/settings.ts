import { Router } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import SystemSettings from '../models/SystemSettings';

const router = Router();

router.use(authenticate);

// Get current settings
router.get('/', async (req: AuthRequest, res) => {
    try {
        let settings = await SystemSettings.findOne();
        if (!settings) {
            settings = await SystemSettings.create({ mqtt_public_url: req.get('host')?.split(':')[0] || 'localhost' });
        }
        res.json(settings);
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// Update settings
router.post('/', async (req: AuthRequest, res) => {
    try {
        let settings = await SystemSettings.findOne();
        if (!settings) {
            settings = new SystemSettings(req.body);
        } else {
            Object.assign(settings, req.body);
        }
        await settings.save();
        res.json(settings);
    } catch (err: any) {
        res.status(400).json({ message: err.message });
    }
});

export default router;
