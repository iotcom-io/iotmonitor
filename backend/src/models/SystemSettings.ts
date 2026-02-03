import mongoose, { Schema, Document } from 'mongoose';

export interface ISystemSettings extends Document {
    mqtt_public_url: string;
    notification_slack_webhook?: string;
    notification_email_user?: string;
    notification_email_pass?: string;
    default_thresholds?: Record<string, { attention?: number; critical?: number }>;
    default_notification_frequency?: number;
    summary_interval_minutes?: number;
    updated_at: Date;
}

const SystemSettingsSchema: Schema = new Schema({
    mqtt_public_url: { type: String, default: 'localhost' },
    notification_slack_webhook: { type: String },
    notification_email_user: { type: String },
    notification_email_pass: { type: String },
    default_thresholds: { type: Schema.Types.Mixed },
    default_notification_frequency: { type: Number, default: 15 }, // minutes
    summary_interval_minutes: { type: Number, default: 60 },
}, { timestamps: { updatedAt: 'updated_at' } });

export default mongoose.model<ISystemSettings>('SystemSettings', SystemSettingsSchema);
