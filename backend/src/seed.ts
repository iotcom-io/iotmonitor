import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from './models/User';
import dotenv from 'dotenv';

dotenv.config();

const seed = async () => {
    try {
        const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/iotmonitor';
        await mongoose.connect(MONGODB_URI);

        const email = 'admin@iotcom.io';
        const password = 'admin123456';
        const password_hash = await bcrypt.hash(password, 10);

        const result = await User.findOneAndUpdate(
            { email },
            {
                $set: {
                    password_hash,
                    role: 'admin'
                }
            },
            { upsert: true, new: true }
        );

        console.log(`Default admin user ensured: ${email} / ${password}`);
        process.exit(0);
    } catch (err) {
        console.error('Seeding failed:', err);
        process.exit(1);
    }
};

seed();
