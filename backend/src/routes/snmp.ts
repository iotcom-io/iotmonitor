import { Router } from 'express';
import { authenticate, authorizePermission, AuthRequest } from '../middleware/auth';
import SnmpDevice from '../models/SnmpDevice';
import { pollSnmpDevice, startSnmpPolling, stopSnmpPolling, testSnmpConnection } from '../services/snmpMonitoring';
import { hasPermission } from '../lib/rbac';

const router = Router();
router.use(authenticate);

/* ─── CRUD ─── */
router.get('/devices', authorizePermission('devices.view'), async (req: AuthRequest, res) => {
    try {
        const devices = await SnmpDevice.find(req.user?.role === 'admin' ? {} : { assigned_user_ids: req.user?.id })
            .sort({ name: 1 });
        res.json(devices);
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

router.post('/devices', authorizePermission('devices.manage'), async (req: AuthRequest, res) => {
    try {
        const data = req.body;
        // Prevent duplicate host
        const existing = await SnmpDevice.findOne({ host: data.host });
        if (existing) return res.status(409).json({ message: 'SNMP device with this host already exists' });

        const device = await SnmpDevice.create({
            ...data,
            assigned_user_ids: data.assigned_user_ids || [req.user?.id],
        });
        res.status(201).json(device);
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

router.get('/devices/:id', authorizePermission('devices.view'), async (req: AuthRequest, res) => {
    try {
        const device = await SnmpDevice.findById(req.params.id);
        if (!device) return res.status(404).json({ message: 'Not found' });
        if (!hasPermission(req.user, 'devices.manage') && !device.assigned_user_ids?.includes(req.user?.id || '')) {
            return res.status(403).json({ message: 'Access denied' });
        }
        res.json(device);
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

router.patch('/devices/:id', authorizePermission('devices.manage'), async (req: AuthRequest, res) => {
    try {
        const device = await SnmpDevice.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });
        res.json(device);
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

router.delete('/devices/:id', authorizePermission('devices.manage'), async (req: AuthRequest, res) => {
    try {
        await SnmpDevice.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

/* ─── Actions ─── */
router.post('/devices/:id/poll', authorizePermission('devices.view'), async (req: AuthRequest, res) => {
    try {
        const result = await pollSnmpDevice(String(req.params.id));
        if (result.success) {
            await SnmpDevice.updateOne(
                { _id: req.params.id },
                { $set: { status: 'online', last_seen: new Date(), last_metrics: result.metrics } }
            );
        } else {
            await SnmpDevice.updateOne(
                { _id: req.params.id },
                { $set: { status: 'offline', last_seen: new Date() } }
            );
        }
        res.json(result);
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

/* ─── Test Connection ─── */
router.post('/test', authorizePermission('devices.view'), async (req: AuthRequest, res) => {
    try {
        const { host, port, community, version } = req.body || {};
        const result = await testSnmpConnection({ host, port, community, version });
        res.json(result);
    } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/* ─── Discovery Scan (simple subnet sweep) ─── */
router.post('/discovery', authorizePermission('devices.manage'), async (req: AuthRequest, res) => {
    try {
        const subnet = String((req.body?.subnet as string) || '').trim();
        const community = String((req.body?.community as string) || 'public');
        if (!subnet) return res.status(400).json({ message: 'subnet is required (e.g. 192.168.1)' });

        // We can't do real SNMP discovery without net-snmp, so return a stub
        // that the frontend can use to guide manual entry
        const candidates = Array.from({ length: 254 }, (_, i) => ({
            ip: `${subnet}.${i + 1}`,
            status: 'pending',
        }));

        res.json({ subnet, candidates: candidates.slice(0, 50), message: 'Discovery stub — install net-snmp for active scanning' });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

/* ─── Control ─── */
router.post('/control/start', authorizePermission('settings.view'), async (_req, res) => {
    startSnmpPolling();
    res.json({ message: 'SNMP polling started' });
});

router.post('/control/stop', authorizePermission('settings.view'), async (_req, res) => {
    stopSnmpPolling();
    res.json({ message: 'SNMP polling stopped' });
});

export default router;
