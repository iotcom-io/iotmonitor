import mongoose, { Schema, Document } from 'mongoose';

export type SyntheticType = 'http' | 'ssl';
export type SyntheticTargetKind = 'website' | 'api';

export interface ISyntheticCheck extends Document {
    name: string;
    target_kind?: SyntheticTargetKind;
    type: SyntheticType;
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    interval: number; // seconds
    timeout: number; // ms
    expected_status?: number;
    expected_status_codes?: number[];
    must_include?: string;
    response_match_type?: 'contains' | 'exact' | 'regex';
    response_match_value?: string;
    max_response_time_ms?: number;
    ssl_expiry_days?: number; // warning when <= this many days
    channels?: string[];
    slack_webhook_name?: string;
    custom_webhook_name?: string;
    enabled: boolean;
    last_run?: Date;
    last_status?: 'ok' | 'fail';
    last_message?: string;
    last_response_status?: number;
    last_response_time_ms?: number;
    ssl_expiry_at?: Date;
    ssl_last_state?: 'ok' | 'warning' | 'critical' | 'expired';
    ssl_last_reminder_bucket?: string;
    ssl_last_renewal_notified_expiry_at?: Date;
    created_at: Date;
    updated_at: Date;
}

const SyntheticCheckSchema: Schema = new Schema({
    name: { type: String, required: true },
    target_kind: { type: String, enum: ['website', 'api'], default: 'website' },
    type: { type: String, enum: ['http', 'ssl'], required: true },
    url: { type: String, required: true },
    method: { type: String, default: 'GET' },
    headers: { type: Schema.Types.Mixed },
    body: { type: String },
    interval: { type: Number, default: 300 },
    timeout: { type: Number, default: 8000 },
    expected_status: { type: Number, default: 200 },
    expected_status_codes: [{ type: Number }],
    must_include: { type: String },
    response_match_type: { type: String, enum: ['contains', 'exact', 'regex'], default: 'contains' },
    response_match_value: { type: String },
    max_response_time_ms: { type: Number },
    ssl_expiry_days: { type: Number, default: 7 },
    channels: [{ type: String }],
    slack_webhook_name: { type: String },
    custom_webhook_name: { type: String },
    enabled: { type: Boolean, default: true },
    last_run: { type: Date },
    last_status: { type: String, enum: ['ok', 'fail'] },
    last_message: { type: String },
    last_response_status: { type: Number },
    last_response_time_ms: { type: Number },
    ssl_expiry_at: { type: Date },
    ssl_last_state: { type: String, enum: ['ok', 'warning', 'critical', 'expired'] },
    ssl_last_reminder_bucket: { type: String },
    ssl_last_renewal_notified_expiry_at: { type: Date },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

export default mongoose.model<ISyntheticCheck>('SyntheticCheck', SyntheticCheckSchema);
