import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import User from '../models/User';
import { authenticate, AuthRequest, authorizePermission } from '../middleware/auth';
import { ALL_PERMISSIONS, sanitizePermissionOverrides, toAuthUserContext } from '../lib/rbac';

const router = Router();
router.use(authenticate);

const createUserSchema = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    email: z.string().email(),
    password: z.string().min(6),
    role: z.enum(['admin', 'operator', 'viewer']),
    is_active: z.boolean().optional(),
    permissions: z.record(z.boolean()).optional(),
    assigned_device_ids: z.array(z.string().trim().min(1)).optional(),
    assigned_synthetic_ids: z.array(z.string().trim().min(1)).optional(),
});

const updateUserSchema = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    email: z.string().email().optional(),
    password: z.string().min(6).optional(),
    role: z.enum(['admin', 'operator', 'viewer']).optional(),
    is_active: z.boolean().optional(),
    permissions: z.record(z.boolean()).optional(),
    assigned_device_ids: z.array(z.string().trim().min(1)).optional(),
    assigned_synthetic_ids: z.array(z.string().trim().min(1)).optional(),
}).refine((payload) => Object.keys(payload).length > 0, { message: 'No update fields provided' });

router.get('/permissions', authorizePermission('users.view'), (_req, res) => {
    res.json({ permissions: ALL_PERMISSIONS });
});

router.get('/', authorizePermission('users.view'), async (_req, res) => {
    try {
        const users = await User.find().sort({ created_at: -1 });
        res.json(users.map((user) => toAuthUserContext(user)));
    } catch (error: any) {
        res.status(500).json({ message: error.message || 'Failed to fetch users' });
    }
});

router.post('/', authorizePermission('users.manage'), async (req: AuthRequest, res) => {
    try {
        const payload = createUserSchema.parse(req.body);
        const exists = await User.findOne({ email: payload.email });
        if (exists) return res.status(400).json({ message: 'User already exists' });

        const password_hash = await bcrypt.hash(payload.password, 10);
        const user = await User.create({
            name: payload.name,
            email: payload.email,
            password_hash,
            role: payload.role,
            is_active: payload.is_active !== undefined ? payload.is_active : true,
            permissions: sanitizePermissionOverrides(payload.permissions),
            assigned_device_ids: payload.assigned_device_ids || [],
            assigned_synthetic_ids: payload.assigned_synthetic_ids || [],
        });

        res.status(201).json(toAuthUserContext(user));
    } catch (error: any) {
        res.status(400).json({ message: error.message || 'Failed to create user' });
    }
});

router.put('/:id', authorizePermission('users.manage'), async (req: AuthRequest, res) => {
    try {
        const payload = updateUserSchema.parse(req.body);
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        if (payload.email && payload.email !== user.email) {
            const exists = await User.findOne({ email: payload.email });
            if (exists) return res.status(400).json({ message: 'Email already in use' });
            user.email = payload.email;
        }
        if (payload.name !== undefined) user.name = payload.name;
        if (payload.role) user.role = payload.role;
        if (payload.is_active !== undefined) user.is_active = payload.is_active;
        if (payload.permissions !== undefined) {
            user.permissions = sanitizePermissionOverrides(payload.permissions);
        }
        if (payload.assigned_device_ids !== undefined) user.assigned_device_ids = payload.assigned_device_ids;
        if (payload.assigned_synthetic_ids !== undefined) user.assigned_synthetic_ids = payload.assigned_synthetic_ids;
        if (payload.password) {
            user.password_hash = await bcrypt.hash(payload.password, 10);
        }

        // Safety: keep at least one active admin.
        if (user.role !== 'admin' || user.is_active === false) {
            const activeAdminCount = await User.countDocuments({
                _id: { $ne: user._id },
                role: 'admin',
                is_active: true,
            });
            if (activeAdminCount === 0) {
                return res.status(400).json({ message: 'At least one active admin user is required' });
            }
        }

        await user.save();
        res.json(toAuthUserContext(user));
    } catch (error: any) {
        res.status(400).json({ message: error.message || 'Failed to update user' });
    }
});

router.delete('/:id', authorizePermission('users.manage'), async (req: AuthRequest, res) => {
    try {
        const currentUserId = String(req.user?.id || '');
        if (currentUserId && currentUserId === req.params.id) {
            return res.status(400).json({ message: 'You cannot delete your own account' });
        }

        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        if (user.role === 'admin') {
            const activeAdminCount = await User.countDocuments({
                _id: { $ne: user._id },
                role: 'admin',
                is_active: true,
            });
            if (activeAdminCount === 0) {
                return res.status(400).json({ message: 'At least one active admin user is required' });
            }
        }

        await User.deleteOne({ _id: req.params.id });
        res.json({ ok: true });
    } catch (error: any) {
        res.status(500).json({ message: error.message || 'Failed to delete user' });
    }
});

export default router;
