import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
    email: string;
    password_hash: string;
    role: 'admin' | 'operator' | 'viewer';
    notification_preferences: {
        slack?: string;
        whatsapp?: string;
        email?: string;
        sms?: string;
    };
    mfa_enabled: boolean;
    created_at: Date;
    updated_at: Date;
}

const UserSchema: Schema = new Schema({
    email: { type: String, required: true, unique: true },
    password_hash: { type: String, required: true },
    role: { type: String, enum: ['admin', 'operator', 'viewer'], default: 'viewer' },
    notification_preferences: {
        slack: String,
        whatsapp: String,
        email: String,
        sms: String,
    },
    mfa_enabled: { type: Boolean, default: false },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

export default mongoose.model<IUser>('User', UserSchema);
