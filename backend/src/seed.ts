import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from './models/User';
import dotenv from 'dotenv';

dotenv.config();

const seed = async () => {
    try {
        const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/iotmonitor';
        await mongoose.connect(MONGODB_URI);

        const existingAdmin = await User.findOne({ email: 'admin@iotmonitor.io' });
        if (existingAdmin) {
            console.log('Admin user already exists');
            process.exit(0);
        }

        const password_hash = await bcrypt.hash('admin123456', 10);
        const admin = new User({
            email: 'admin@iotmonitor.io',
            password_hash,
            role: 'admin'
        });

        await admin.save();
        console.log('Default admin user created: admin@iotmonitor.io / admin123456');
        process.exit(0);
    } catch (err) {
        console.error('Seeding failed:', err);
        process.exit(1);
    }
};

seed();
