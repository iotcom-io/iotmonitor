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
    default_thresholds?: Record<string, { warning?: number; critical?: number }>;
    default_notification_frequency?: number;
    summary_interval_minutes?: number;
    monitoring_check_interval_seconds?: number;
    default_offline_threshold_multiplier?: number;
    default_repeat_interval_minutes?: number;
    default_throttling_duration_minutes?: number;
    ssl_weekly_summary_last_sent_on?: string;
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
    summary_interval_minutes: { type: Number, default: 360 },
    monitoring_check_interval_seconds: { type: Number, default: 30 },
    default_offline_threshold_multiplier: { type: Number, default: 4 },
    default_repeat_interval_minutes: { type: Number, default: 5 },
    default_throttling_duration_minutes: { type: Number, default: 60 },
    ssl_weekly_summary_last_sent_on: { type: String },
}, { timestamps: { updatedAt: 'updated_at' } });

export default mongoose.model<ISystemSettings>('SystemSettings', SystemSettingsSchema);
