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
    notification_channel_ids: z.array(z.string().trim().min(1)).optional(),
    enabled: z.boolean().optional(),
    status: z.enum(['active', 'paused', 'expired']).optional(),
    assigned_user_ids: z.array(z.string().trim().min(1)).optional(),
});

const normalizeAssigned = (value: unknown) => {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.map((entry) => String(entry || '').trim()).filter(Boolean)));
};

const normalizeChannelIds = (value: unknown) => {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.map((entry) => String(entry || '').trim()).filter(Boolean)));
};

const csvEscape = (value: unknown) => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    if (/[",\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
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

const buildRenewalAmountSummary = (rows: any[], horizonDays: number) => {
    const now = Date.now();
    const end = now + horizonDays * 24 * 60 * 60 * 1000;
    const totals: Record<string, number> = {};
    let count = 0;

    rows.forEach((row: any) => {
        if (row.status === 'paused') return;
        const renewal = new Date(row.renewal_date);
        const renewalMs = renewal.getTime();
        if (!Number.isFinite(renewalMs)) return;
        if (renewalMs < now || renewalMs > end) return;

        const amount = Number(row.amount);
        if (!Number.isFinite(amount) || amount <= 0) return;

        const currency = String(row.currency || 'INR').toUpperCase();
        totals[currency] = Number((totals[currency] || 0)) + amount;
        count += 1;
    });

    Object.keys(totals).forEach((key) => {
        totals[key] = Number(totals[key].toFixed(2));
    });

    return {
        count,
        totals_by_currency: totals,
    };
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

        const renewalSpend30d = buildRenewalAmountSummary(rows, 30);
        const renewalSpend90d = buildRenewalAmountSummary(rows, 90);

        res.json({
            ...stats,
            renewal_spend_30d: renewalSpend30d,
            renewal_spend_90d: renewalSpend90d,
        });
    } catch (error: any) {
        res.status(500).json({ message: error.message || 'Failed to fetch license stats' });
    }
});

router.get('/export', authorizePermission('licenses.view'), async (req: AuthRequest, res) => {
    try {
        const rows = await LicenseAsset.find(getAccessQuery(req.user)).sort({ renewal_date: 1, name: 1 });

        const csvRows = rows.map((row: any) => {
            const computed = computeState(row);
            return [
                String(row._id || ''),
                String(row.name || ''),
                String(row.type || ''),
                String(row.vendor || ''),
                String(row.product || ''),
                String(row.owner || ''),
                String(row.reference_key || ''),
                row.renewal_date ? new Date(row.renewal_date).toISOString() : '',
                String(computed.days_left ?? ''),
                String(computed.state || ''),
                String(row.status || ''),
                String(row.amount ?? ''),
                String(row.currency || ''),
                String(row.billing_cycle || ''),
                String(row.seats_total ?? ''),
                String(row.seats_used ?? ''),
                String(Boolean(row.auto_renew)),
                String(Boolean(row.enabled)),
                String(req.user?.email || ''),
                new Date().toISOString(),
            ].map(csvEscape).join(',');
        });

        const csvBody = [
            [
                'license_id',
                'name',
                'type',
                'vendor',
                'product',
                'owner',
                'reference_key',
                'renewal_date',
                'days_left',
                'computed_state',
                'status',
                'amount',
                'currency',
                'billing_cycle',
                'seats_total',
                'seats_used',
                'auto_renew',
                'enabled',
                'exported_by',
                'exported_at',
            ].join(','),
            ...csvRows,
        ].join('\n');

        const fileName = `licenses-${Date.now()}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        return res.send(csvBody);
    } catch (error: any) {
        return res.status(500).json({ message: error.message || 'Failed to export licenses' });
    }
});

router.post('/', authorizePermission('licenses.manage'), async (req: AuthRequest, res) => {
    try {
        const payload = schema.parse(req.body);
        const license = await LicenseAsset.create({
            ...payload,
            renewal_date: new Date(payload.renewal_date),
            notification_channel_ids: normalizeChannelIds(payload.notification_channel_ids),
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
        if (payload.notification_channel_ids !== undefined) {
            updateDoc.notification_channel_ids = normalizeChannelIds(payload.notification_channel_ids);
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
