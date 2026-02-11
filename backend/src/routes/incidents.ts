import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import Incident from '../models/Incident';

const router = Router();
router.use(authenticate);

const parseDate = (value: any): Date | null => {
    if (!value) return null;
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

// list by target
router.get('/', async (req, res) => {
    try {
        const {
            target_id,
            status,
            target_type,
            severity,
            q,
            from,
            to,
            limit = '100',
            skip = '0',
        } = req.query as Record<string, string | undefined>;

        const query: any = {};

        if (target_id) query.target_id = target_id;
        if (status) query.status = status;
        if (target_type) query.target_type = target_type;
        if (severity) query.severity = severity;

        const fromDate = parseDate(from);
        const toDate = parseDate(to);
        if (fromDate || toDate) {
            query.started_at = {};
            if (fromDate) query.started_at.$gte = fromDate;
            if (toDate) query.started_at.$lte = toDate;
        }

        if (q && q.trim()) {
            const regex = new RegExp(q.trim(), 'i');
            query.$or = [
                { summary: regex },
                { target_name: regex },
                { target_id: regex },
                { 'updates.message': regex },
            ];
        }

        const parsedLimit = Math.max(1, Math.min(500, Number(limit) || 100));
        const parsedSkip = Math.max(0, Number(skip) || 0);

        const [total, incidents] = await Promise.all([
            Incident.countDocuments(query),
            Incident.find(query)
                .sort({ created_at: -1 })
                .skip(parsedSkip)
                .limit(parsedLimit),
        ]);

        res.setHeader('X-Total-Count', String(total));
        res.json(incidents);
    } catch (error: any) {
        res.status(500).json({ message: error.message || 'Failed to fetch incidents' });
    }
});

// resolve
router.post('/:id/resolve', async (req, res) => {
    const incident = await Incident.findById(req.params.id);
    if (!incident) return res.status(404).json({ message: 'Not found' });
    incident.status = 'resolved';
    incident.resolved_at = new Date();
    const note = (req.body && req.body.message) ? req.body.message : 'Resolved manually';
    incident.updates.push({ at: new Date(), message: note } as any);
    await incident.save();
    res.json(incident);
});

export default router;
