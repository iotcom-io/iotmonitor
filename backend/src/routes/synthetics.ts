import { Router } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import SyntheticCheck from '../models/SyntheticCheck';

const router = Router();
router.use(authenticate);

// list
router.get('/', async (_req, res) => {
    const checks = await SyntheticCheck.find().sort({ updated_at: -1 });
    res.json(checks);
});

// create
router.post('/', async (req: AuthRequest, res) => {
    try {
        const check = new SyntheticCheck(req.body);
        await check.save();
        res.status(201).json(check);
    } catch (err: any) {
        res.status(400).json({ message: err.message });
    }
});

// update
router.put('/:id', async (req, res) => {
    try {
        const check = await SyntheticCheck.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!check) return res.status(404).json({ message: 'Not found' });
        res.json(check);
    } catch (err: any) {
        res.status(400).json({ message: err.message });
    }
});

// delete
router.delete('/:id', async (req, res) => {
    try {
        await SyntheticCheck.findByIdAndDelete(req.params.id);
        res.json({ ok: true });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

export default router;
