import { Router } from 'express';
import { z } from 'zod';
import LicenseAsset from '../models/LicenseAsset';
import { authenticate, AuthRequest, authorizePermission } from '../middleware/auth';
import { hasPermission } from '../lib/rbac';

const router = Router();
router.use(authenticate);

const schema = z.object({
    name: z.string().trim().min(1),
    vendor: z.string().trim().optional(),
    product: z.string().trim().optional(),
    type: z.enum(['license', 'subscription']).default('subscription'),
    owner: z.string().trim().optional(),
    reference_key: z.string().trim().optional(),
    renewal_date: z.union([z.string(), z.date()]),
    warning_days: z.number().int().min(1).max(365).optional(),
    critical_days: z.number().int().min(1).max(365).optional(),
    billing_cycle: z.enum(['monthly', 'quarterly', 'yearly', 'custom']).optional(),
    amount: z.number().nonnegative().optional(),
    currency: z.string().trim().min(1).max(8).optional(),
    seats_total: z.number().int().nonnegative().optional(),
    seats_used: z.number().int().nonnegative().optional(),
    auto_renew: z.boolean().optional(),
    channels: z.array(z.enum(['slack', 'email', 'custom'])).optional(),
    enabled: z.boolean().optional(),
    status: z.enum(['active', 'paused', 'expired']).optional(),
    assigned_user_ids: z.array(z.string().trim().min(1)).optional(),
});

const normalizeAssigned = (value: unknown) => {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.map((entry) => String(entry || '').trim()).filter(Boolean)));
};

const getAccessQuery = (user: AuthRequest['user']) => {
    if (!user || user.role === 'admin') return {};
    return {
        $or: [
            { assigned_user_ids: user.id },
            { assigned_user_ids: { $exists: false } },
            { assigned_user_ids: { $size: 0 } },
        ],
    };
};

const computeState = (license: any) => {
    const now = new Date();
    const renewal = new Date(license.renewal_date);
    if (Number.isNaN(renewal.getTime())) {
        return { days_left: null, state: 'unknown' };
    }

    const days = Math.floor((renewal.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    let state = 'ok';
    if (days < 0) state = 'expired';
    else if (days <= Number(license.critical_days || 7)) state = 'critical';
    else if (days <= Number(license.warning_days || 30)) state = 'warning';

    return { days_left: days, state };
};

router.get('/', authorizePermission('licenses.view'), async (req: AuthRequest, res) => {
    try {
        const rows = await LicenseAsset.find(getAccessQuery(req.user)).sort({ renewal_date: 1, name: 1 });
        const withState = rows.map((row: any) => {
            const computed = computeState(row);
            return {
                ...row.toObject(),
                days_left: computed.days_left,
                computed_state: computed.state,
            };
        });
        res.json(withState);
    } catch (error: any) {
        res.status(500).json({ message: error.message || 'Failed to fetch licenses' });
    }
});

router.get('/stats', authorizePermission('licenses.view'), async (req: AuthRequest, res) => {
    try {
        const rows = await LicenseAsset.find(getAccessQuery(req.user));
        const stats = {
            total: rows.length,
            ok: 0,
            warning: 0,
            critical: 0,
            expired: 0,
            paused: 0,
        };

        rows.forEach((row: any) => {
            if (row.status === 'paused') {
                stats.paused += 1;
                return;
            }

            const computed = computeState(row);
            if (computed.state === 'expired') stats.expired += 1;
            else if (computed.state === 'critical') stats.critical += 1;
            else if (computed.state === 'warning') stats.warning += 1;
            else stats.ok += 1;
        });

        res.json(stats);
    } catch (error: any) {
        res.status(500).json({ message: error.message || 'Failed to fetch license stats' });
    }
});

router.post('/', authorizePermission('licenses.manage'), async (req: AuthRequest, res) => {
    try {
        const payload = schema.parse(req.body);
        const license = await LicenseAsset.create({
            ...payload,
            renewal_date: new Date(payload.renewal_date),
            assigned_user_ids: hasPermission(req.user, 'devices.assign')
                ? normalizeAssigned(payload.assigned_user_ids)
                : [],
        });
        res.status(201).json(license);
    } catch (error: any) {
        res.status(400).json({ message: error.message || 'Failed to create license' });
    }
});

router.put('/:id', authorizePermission('licenses.manage'), async (req: AuthRequest, res) => {
    try {
        const existing = await LicenseAsset.findOne({ _id: req.params.id, ...getAccessQuery(req.user) });
        if (!existing) return res.status(404).json({ message: 'License not found' });

        const payload = schema.partial().parse(req.body);
        const updateDoc: any = { ...payload };
        if (payload.renewal_date !== undefined) {
            updateDoc.renewal_date = new Date(payload.renewal_date);
        }
        if (payload.assigned_user_ids !== undefined) {
            if (!hasPermission(req.user, 'devices.assign')) {
                delete updateDoc.assigned_user_ids;
            } else {
                updateDoc.assigned_user_ids = normalizeAssigned(payload.assigned_user_ids);
            }
        }

        const row = await LicenseAsset.findByIdAndUpdate(req.params.id, updateDoc, { new: true });
        res.json(row);
    } catch (error: any) {
        res.status(400).json({ message: error.message || 'Failed to update license' });
    }
});

router.delete('/:id', authorizePermission('licenses.manage'), async (req: AuthRequest, res) => {
    try {
        const existing = await LicenseAsset.findOne({ _id: req.params.id, ...getAccessQuery(req.user) });
        if (!existing) return res.status(404).json({ message: 'License not found' });
        await LicenseAsset.deleteOne({ _id: req.params.id });
        res.json({ ok: true });
    } catch (error: any) {
        res.status(500).json({ message: error.message || 'Failed to delete license' });
    }
});

export default router;

