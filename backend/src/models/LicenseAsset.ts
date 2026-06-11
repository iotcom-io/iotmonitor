import mongoose, { Schema, Document } from 'mongoose';

export type LicenseType = 'license' | 'subscription' | 'utility';
export type LicenseStatus = 'active' | 'paused' | 'expired';
export type LicenseState = 'ok' | 'warning' | 'critical' | 'expired';

export interface IPaymentHistoryEntry {
    paid_at: Date;
    amount_paid: number;
    currency: string;
    payment_mode: string;
    payment_proof?: string;
    renewal_period: string;
    next_renewal_date?: Date;
    notes?: string;
}

export interface ILicenseAsset extends Document {
    name: string;
    vendor?: string;
    product?: string;
    type: LicenseType;
    owner?: string;
    reference_key?: string;
    renewal_date: Date;
    warning_days: number;
    critical_days: number;
    billing_cycle?: 'none' | 'weekly' | 'monthly' | 'quarterly' | 'semi-annual' | 'yearly' | 'custom';
    amount?: number;
    currency?: string;
    seats_total?: number;
    seats_used?: number;
    auto_renew?: boolean;
    channels?: ('slack' | 'email' | 'custom')[];
    notification_channel_ids?: string[];
    enabled: boolean;
    status: LicenseStatus;
    assigned_user_ids?: string[];
    last_state?: LicenseState;
    last_notified_bucket?: string;
    last_checked_at?: Date;
    last_message?: string;
    payment_history?: IPaymentHistoryEntry[];
    created_at: Date;
    updated_at: Date;
}

const LicenseAssetSchema: Schema = new Schema({
    name: { type: String, required: true },
    vendor: { type: String },
    product: { type: String },
    type: { type: String, enum: ['license', 'subscription', 'utility'], default: 'subscription' },
    owner: { type: String },
    reference_key: { type: String },
    renewal_date: { type: Date, required: true },
    warning_days: { type: Number, default: 30 },
    critical_days: { type: Number, default: 7 },
    billing_cycle: { type: String, enum: ['none', 'weekly', 'monthly', 'quarterly', 'semi-annual', 'yearly', 'custom'], default: 'yearly' },
    amount: { type: Number },
    currency: { type: String, default: 'INR' },
    seats_total: { type: Number },
    seats_used: { type: Number },
    auto_renew: { type: Boolean, default: false },
    channels: [{ type: String, enum: ['slack', 'email', 'custom'] }],
    notification_channel_ids: [{ type: String }],
    enabled: { type: Boolean, default: true },
    status: { type: String, enum: ['active', 'paused', 'expired'], default: 'active' },
    assigned_user_ids: [{ type: String }],
    last_state: { type: String, enum: ['ok', 'warning', 'critical', 'expired'] },
    last_notified_bucket: { type: String },
    last_checked_at: { type: Date },
    last_message: { type: String },
    payment_history: [{
        paid_at: { type: Date, default: Date.now },
        amount_paid: { type: Number, required: true },
        currency: { type: String, required: true },
        payment_mode: { type: String, required: true },
        payment_proof: { type: String },
        renewal_period: { type: String, required: true },
        next_renewal_date: { type: Date },
        notes: { type: String },
    }],
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

LicenseAssetSchema.index({ renewal_date: 1 });
LicenseAssetSchema.index({ enabled: 1, status: 1 });

export default mongoose.model<ILicenseAsset>('LicenseAsset', LicenseAssetSchema);
