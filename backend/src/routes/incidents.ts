import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import Incident from '../models/Incident';

const router = Router();
router.use(authenticate);

// list by target
router.get('/', async (req, res) => {
    const { target_id, status } = req.query;
    const query: any = {};
    if (target_id) query.target_id = target_id;
    if (status) query.status = status;
    const incidents = await Incident.find(query).sort({ created_at: -1 }).limit(100);
    res.json(incidents);
});

// resolve
router.post('/:id/resolve', async (req, res) => {
    const incident = await Incident.findById(req.params.id);
    if (!incident) return res.status(404).json({ message: 'Not found' });
    incident.status = 'resolved';
    incident.resolved_at = new Date();
    incident.updates.push({ at: new Date(), message: req.body.message || 'Resolved manually' } as any);
    await incident.save();
    res.json(incident);
});

export default router;
