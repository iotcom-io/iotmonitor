import { Router } from 'express';
import { authenticate, AuthRequest, authorizePermission } from '../middleware/auth';
import Incident from '../models/Incident';
import Device from '../models/Device';
import SyntheticCheck from '../models/SyntheticCheck';
import LicenseAsset from '../models/LicenseAsset';
import { canAccessDevice, canAccessSynthetic } from '../lib/rbac';

const router = Router();
router.use(authenticate);

const parseDate = (value: any): Date | null => {
    if (!value) return null;
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

// list by target
router.get('/', authorizePermission('incidents.view'), async (req: AuthRequest, res) => {
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

        const [total, incidentsRaw] = await Promise.all([
            Incident.countDocuments(query),
            Incident.find(query)
                .sort({ created_at: -1 })
                .skip(parsedSkip)
                .limit(parsedLimit),
        ]);

        let incidents = incidentsRaw;
        if (req.user?.role !== 'admin') {
            const deviceTargetIds = Array.from(new Set(
                incidentsRaw
                    .filter((incident: any) => incident.target_type !== 'synthetic')
                    .map((incident: any) => String(incident.target_id || ''))
                    .filter(Boolean)
            ));
            const syntheticTargetIds = Array.from(new Set(
                incidentsRaw
                    .filter((incident: any) => incident.target_type === 'synthetic')
                    .map((incident: any) => String(incident.target_id || ''))
                    .filter(Boolean)
            ));
            const licenseTargetIds = Array.from(new Set(
                incidentsRaw
                    .filter((incident: any) => incident.target_type === 'license')
                    .map((incident: any) => String(incident.target_id || ''))
                    .filter(Boolean)
            ));

            const [devices, synthetics, licenses] = await Promise.all([
                deviceTargetIds.length > 0
                    ? Device.find({ device_id: { $in: deviceTargetIds } }).select({ device_id: 1, assigned_user_ids: 1 })
                    : Promise.resolve([] as any[]),
                syntheticTargetIds.length > 0
                    ? SyntheticCheck.find({ _id: { $in: syntheticTargetIds } }).select({ _id: 1, assigned_user_ids: 1 })
                    : Promise.resolve([] as any[]),
                licenseTargetIds.length > 0
                    ? LicenseAsset.find({ _id: { $in: licenseTargetIds } }).select({ _id: 1, assigned_user_ids: 1 })
                    : Promise.resolve([] as any[]),
            ]);

            const deviceMap = new Map<string, any>();
            const syntheticMap = new Map<string, any>();
            const licenseMap = new Map<string, any>();
            devices.forEach((device: any) => deviceMap.set(String(device.device_id), device));
            synthetics.forEach((synthetic: any) => syntheticMap.set(String(synthetic._id), synthetic));
            licenses.forEach((license: any) => licenseMap.set(String(license._id), license));

            incidents = incidentsRaw.filter((incident: any) => {
                if (incident.target_type === 'synthetic') {
                    const monitor = syntheticMap.get(String(incident.target_id));
                    if (!monitor) return false;
                    return canAccessSynthetic(req.user, monitor);
                }

                if (incident.target_type === 'license') {
                    const license = licenseMap.get(String(incident.target_id));
                    if (!license) return false;
                    const assigned = Array.isArray(license.assigned_user_ids) ? license.assigned_user_ids : [];
                    if (assigned.length === 0) return true;
                    return assigned.includes(String(req.user?.id || ''));
                }

                const device = deviceMap.get(String(incident.target_id));
                if (!device) return false;
                return canAccessDevice(req.user, device);
            }) as any;
        }

        const incidentRows = incidents as any[];
        const deviceTargetIds = Array.from(new Set(
            incidentRows
                .filter((incident: any) => incident.target_type !== 'synthetic' && incident.target_type !== 'license')
                .map((incident: any) => String(incident.target_id || ''))
                .filter(Boolean)
        ));
        const syntheticTargetIds = Array.from(new Set(
            incidentRows
                .filter((incident: any) => incident.target_type === 'synthetic')
                .map((incident: any) => String(incident.target_id || ''))
                .filter(Boolean)
        ));
        const licenseTargetIds = Array.from(new Set(
            incidentRows
                .filter((incident: any) => incident.target_type === 'license')
                .map((incident: any) => String(incident.target_id || ''))
                .filter(Boolean)
        ));

        const [devices, synthetics, licenses] = await Promise.all([
            deviceTargetIds.length > 0
                ? Device.find({ device_id: { $in: deviceTargetIds } }).select({ device_id: 1, assigned_user_ids: 1 })
                : Promise.resolve([] as any[]),
            syntheticTargetIds.length > 0
                ? SyntheticCheck.find({ _id: { $in: syntheticTargetIds } }).select({ _id: 1, assigned_user_ids: 1 })
                : Promise.resolve([] as any[]),
            licenseTargetIds.length > 0
                ? LicenseAsset.find({ _id: { $in: licenseTargetIds } }).select({ _id: 1, assigned_user_ids: 1 })
                : Promise.resolve([] as any[]),
        ]);

        const deviceMap = new Map<string, any>();
        const syntheticMap = new Map<string, any>();
        const licenseMap = new Map<string, any>();
        devices.forEach((device: any) => deviceMap.set(String(device.device_id), device));
        synthetics.forEach((synthetic: any) => syntheticMap.set(String(synthetic._id), synthetic));
        licenses.forEach((license: any) => licenseMap.set(String(license._id), license));

        const withAssignees = incidentRows.map((incident: any) => {
            const row = typeof incident.toObject === 'function' ? incident.toObject() : incident;
            let assignedUserIds: string[] = [];

            if (row.target_type === 'synthetic') {
                const monitor = syntheticMap.get(String(row.target_id));
                assignedUserIds = Array.isArray(monitor?.assigned_user_ids) ? monitor.assigned_user_ids : [];
            } else if (row.target_type === 'license') {
                const license = licenseMap.get(String(row.target_id));
                assignedUserIds = Array.isArray(license?.assigned_user_ids) ? license.assigned_user_ids : [];
            } else {
                const device = deviceMap.get(String(row.target_id));
                assignedUserIds = Array.isArray(device?.assigned_user_ids) ? device.assigned_user_ids : [];
            }

            return {
                ...row,
                assigned_user_ids: assignedUserIds,
            };
        });

        res.setHeader('X-Total-Count', String(req.user?.role === 'admin' ? total : withAssignees.length));
        res.json(withAssignees);
    } catch (error: any) {
        res.status(500).json({ message: error.message || 'Failed to fetch incidents' });
    }
});

// resolve
router.post('/:id/resolve', authorizePermission('incidents.resolve'), async (req: AuthRequest, res) => {
    const incident = await Incident.findById(req.params.id);
    if (!incident) return res.status(404).json({ message: 'Not found' });

    if (req.user?.role !== 'admin') {
        if (incident.target_type === 'synthetic') {
            const monitor = await SyntheticCheck.findById(incident.target_id).select({ _id: 1, assigned_user_ids: 1 });
            if (!monitor || !canAccessSynthetic(req.user, monitor)) {
                return res.status(403).json({ message: 'Access denied for this incident' });
            }
        } else if (incident.target_type === 'license') {
            const license = await LicenseAsset.findById(incident.target_id).select({ _id: 1, assigned_user_ids: 1 });
            if (!license) {
                return res.status(404).json({ message: 'License target not found' });
            }

            const assigned = Array.isArray(license.assigned_user_ids) ? license.assigned_user_ids : [];
            if (assigned.length > 0 && !assigned.includes(String(req.user?.id || ''))) {
                return res.status(403).json({ message: 'Access denied for this incident' });
            }
        } else {
            const device = await Device.findOne({ device_id: incident.target_id }).select({ device_id: 1, assigned_user_ids: 1 });
            if (!device || !canAccessDevice(req.user, device)) {
                return res.status(403).json({ message: 'Access denied for this incident' });
            }
        }
    }

    incident.status = 'resolved';
    incident.resolved_at = new Date();
    const note = (req.body && req.body.message) ? req.body.message : 'Resolved manually';
    incident.updates.push({ at: new Date(), message: note } as any);
    await incident.save();
    res.json(incident);
});

export default router;
