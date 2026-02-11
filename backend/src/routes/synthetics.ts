import { Router } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import SyntheticCheck from '../models/SyntheticCheck';

const router = Router();
router.use(authenticate);

const normalizeStatusCodes = (value: any) => {
    if (!Array.isArray(value)) return [];
    const normalized = value
        .map((entry) => Number(entry))
        .filter((num) => Number.isFinite(num) && num > 0);
    return Array.from(new Set(normalized));
};

const normalizePayload = (payload: any) => {
    const next: any = { ...payload };

    const checkType = String(next.type || '').toLowerCase();
    if (next.target_kind !== undefined) {
        const normalizedKind = String(next.target_kind || '').toLowerCase();
        next.target_kind = ['website', 'api'].includes(normalizedKind) ? normalizedKind : 'website';
    }

    if (next.channels !== undefined) {
        next.channels = Array.isArray(next.channels)
            ? next.channels.map((ch: string) => String(ch).toLowerCase())
            : ['slack'];
    }

    if (next.expected_status_codes !== undefined) {
        const codes = normalizeStatusCodes(next.expected_status_codes);
        next.expected_status_codes = codes.length > 0 ? codes : [200];
    }

    if (next.max_response_time_ms !== undefined) {
        const maxResponse = Number(next.max_response_time_ms);
        next.max_response_time_ms = Number.isFinite(maxResponse) && maxResponse > 0 ? maxResponse : undefined;
    }

    if (next.ssl_expiry_days !== undefined) {
        const expiryDays = Number(next.ssl_expiry_days);
        next.ssl_expiry_days = Number.isFinite(expiryDays) && expiryDays > 0 ? expiryDays : 7;
    }

    if (checkType === 'ssl') {
        delete next.expected_status;
        delete next.expected_status_codes;
        delete next.response_match_type;
        delete next.response_match_value;
        delete next.must_include;
        delete next.max_response_time_ms;
        if (!next.target_kind) {
            next.target_kind = 'website';
        }
    } else if (checkType === 'http') {
        if (!next.expected_status_codes && next.expected_status) {
            next.expected_status_codes = [Number(next.expected_status)];
        }
    }

    return next;
};

// list
router.get('/', async (_req, res) => {
    const checks = await SyntheticCheck.find().sort({ updated_at: -1 });
    res.json(checks);
});

// create
router.post('/', async (req: AuthRequest, res) => {
    try {
        const check = new SyntheticCheck(normalizePayload(req.body));
        await check.save();
        res.status(201).json(check);
    } catch (err: any) {
        res.status(400).json({ message: err.message });
    }
});

// update
router.put('/:id', async (req, res) => {
    try {
        const check = await SyntheticCheck.findByIdAndUpdate(req.params.id, normalizePayload(req.body), { new: true });
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
