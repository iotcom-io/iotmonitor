import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import { z } from 'zod';
import { authenticate, authorizePermission } from '../middleware/auth';
import { sanitizePermissionOverrides, toAuthUserContext } from '../lib/rbac';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is required');
}

const registerSchema = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    email: z.string().email(),
    password: z.string().min(6),
    role: z.enum(['admin', 'operator', 'viewer']).optional(),
    is_active: z.boolean().optional(),
    permissions: z.record(z.boolean()).optional(),
    assigned_device_ids: z.array(z.string().trim().min(1)).optional(),
    assigned_synthetic_ids: z.array(z.string().trim().min(1)).optional(),
});

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
});

router.post('/register', authenticate, authorizePermission('users.manage'), async (req, res) => {
    try {
        const {
            name,
            email,
            password,
            role = 'viewer',
            is_active,
            permissions,
            assigned_device_ids,
            assigned_synthetic_ids,
        } = registerSchema.parse(req.body);

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'User already exists' });
        }

        const password_hash = await bcrypt.hash(password, 10);
        const user = new User({
            name: name?.trim() || undefined,
            email,
            password_hash,
            role,
            is_active: is_active !== undefined ? is_active : true,
            permissions: sanitizePermissionOverrides(permissions),
            assigned_device_ids: assigned_device_ids || [],
            assigned_synthetic_ids: assigned_synthetic_ids || [],
        });
        await user.save();

        res.status(201).json({
            message: 'User created',
            user: toAuthUserContext(user),
        });
    } catch (err: any) {
        res.status(400).json({ message: err.message });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { email, password } = loginSchema.parse(req.body);

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { id: user._id, role: user.role },
            JWT_SECRET,
            { expiresIn: '1d' }
        );

        const authUser = toAuthUserContext(user);
        res.json({
            token,
            user: {
                id: authUser.id,
                email: authUser.email,
                role: authUser.role,
                is_active: authUser.is_active,
                permissions: authUser.permissions,
                assigned_device_ids: authUser.assigned_device_ids,
                assigned_synthetic_ids: authUser.assigned_synthetic_ids,
            },
        });
    } catch (err: any) {
        if (err?.name === 'ZodError') {
            return res.status(400).json({ message: 'Invalid request payload' });
        }
        res.status(500).json({ message: err.message });
    }
});

router.get('/me', authenticate, async (req, res) => {
    if (!req.user) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    res.json({
        user: req.user,
    });
});

export default router;
