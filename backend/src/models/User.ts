import mongoose, { Schema, Document } from 'mongoose';

export type UserRole = 'admin' | 'operator' | 'viewer';
export type PermissionMap = Record<string, boolean>;

export interface IUser extends Document {
    name?: string;
    email: string;
    password_hash: string;
    role: UserRole;
    is_active: boolean;
    permissions?: PermissionMap;
    assigned_device_ids?: string[];
    assigned_synthetic_ids?: string[];
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
    name: { type: String },
    email: { type: String, required: true, unique: true },
    password_hash: { type: String, required: true },
    role: { type: String, enum: ['admin', 'operator', 'viewer'], default: 'viewer' },
    is_active: { type: Boolean, default: true },
    permissions: { type: Schema.Types.Mixed, default: {} },
    assigned_device_ids: [{ type: String }],
    assigned_synthetic_ids: [{ type: String }],
    notification_preferences: {
        slack: String,
        whatsapp: String,
        email: String,
        sms: String,
    },
    mfa_enabled: { type: Boolean, default: false },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

export default mongoose.model<IUser>('User', UserSchema);
