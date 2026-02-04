import mongoose, { Schema, Document } from 'mongoose';

export interface ISystemSettings extends Document {
    mqtt_public_url: string;
    mqtt_username?: string;
    mqtt_password?: string;
    notification_slack_webhook?: string;
    slack_webhooks?: { name: string; url: string }[];
    custom_webhooks?: { name: string; url: string; method?: string; headers?: Record<string, string>; body?: string }[];
    notification_email_user?: string;
    notification_email_pass?: string;
    default_thresholds?: Record<string, { attention?: number; critical?: number }>;
    default_notification_frequency?: number;
    summary_interval_minutes?: number;
    updated_at: Date;
}

const SystemSettingsSchema: Schema = new Schema({
    mqtt_public_url: { type: String, default: 'localhost' },
    mqtt_username: { type: String },
    mqtt_password: { type: String },
    notification_slack_webhook: { type: String },
    slack_webhooks: [{ name: String, url: String }],
    custom_webhooks: [{
        name: String,
        url: String,
        method: { type: String, default: 'POST' },
        headers: { type: Schema.Types.Mixed },
        body: { type: String }
    }],
    notification_email_user: { type: String },
    notification_email_pass: { type: String },
    default_thresholds: { type: Schema.Types.Mixed },
    default_notification_frequency: { type: Number, default: 15 }, // minutes
    summary_interval_minutes: { type: Number, default: 60 },
}, { timestamps: { updatedAt: 'updated_at' } });

export default mongoose.model<ISystemSettings>('SystemSettings', SystemSettingsSchema);
