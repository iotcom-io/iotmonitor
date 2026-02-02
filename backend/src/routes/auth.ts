import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import { z } from 'zod';

const router = Router();

const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
    role: z.enum(['admin', 'operator', 'viewer']).optional(),
});

router.post('/register', async (req, res) => {
    try {
        const { email, password, role } = registerSchema.parse(req.body);

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'User already exists' });
        }

        const password_hash = await bcrypt.hash(password, 10);
        const user = new User({ email, password_hash, role });
        await user.save();

        res.status(201).json({ message: 'User created' });
    } catch (err: any) {
        res.status(400).json({ message: err.message });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        console.log(`[AUTH] Login attempt: ${email}`);

        const user = await User.findOne({ email });
        if (!user) {
            console.log(`[AUTH] User not found: ${email}`);
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        console.log(`[AUTH] User found, comparing passwords...`);
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            console.log(`[AUTH] Password mismatch for: ${email}`);
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { id: user._id, role: user.role },
            process.env.JWT_SECRET || 'secret',
            { expiresIn: '1d' }
        );

        console.log(`[AUTH] Login successful: ${email}`);
        res.json({ token, user: { id: user._id, email: user.email, role: user.role } });
    } catch (err: any) {
        console.error(`[AUTH] Login error:`, err);
        res.status(500).json({ message: err.message });
    }
});

export default router;
