import mongoose, { Schema, Document } from 'mongoose';

export type SyntheticType = 'http' | 'ssl';

export interface ISyntheticCheck extends Document {
    name: string;
    type: SyntheticType;
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    interval: number; // seconds
    timeout: number; // ms
    expected_status?: number;
    must_include?: string;
    ssl_expiry_days?: number; // alert when <= this many days
    channels?: string[];
    slack_webhook_name?: string;
    custom_webhook_name?: string;
    enabled: boolean;
    last_run?: Date;
    last_status?: 'ok' | 'fail';
    last_message?: string;
    created_at: Date;
    updated_at: Date;
}

const SyntheticCheckSchema: Schema = new Schema({
    name: { type: String, required: true },
    type: { type: String, enum: ['http', 'ssl'], required: true },
    url: { type: String, required: true },
    method: { type: String, default: 'GET' },
    headers: { type: Schema.Types.Mixed },
    body: { type: String },
    interval: { type: Number, default: 300 },
    timeout: { type: Number, default: 8000 },
    expected_status: { type: Number, default: 200 },
    must_include: { type: String },
    ssl_expiry_days: { type: Number, default: 14 },
    channels: [{ type: String }],
    slack_webhook_name: { type: String },
    custom_webhook_name: { type: String },
    enabled: { type: Boolean, default: true },
    last_run: { type: Date },
    last_status: { type: String, enum: ['ok', 'fail'] },
    last_message: { type: String },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

export default mongoose.model<ISyntheticCheck>('SyntheticCheck', SyntheticCheckSchema);
