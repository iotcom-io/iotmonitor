import mongoose, { Document, Schema } from 'mongoose';

export interface INotificationChannel extends Document {
    name: string;
    description?: string;
    type: 'slack' | 'email' | 'webhook' | 'sms';
    enabled: boolean;
    is_default?: boolean;
    config: {
        slack_webhook_url?: string;
        slack_channel?: string;
        slack_group_name?: string; // e.g., "Production Alerts", "Network Team"
        email_addresses?: string[];
        webhook_url?: string;
        phone_numbers?: string[];
    };
    alert_types: string[]; // Which alert types to send to this channel
    severity_levels: string[]; // Which severity levels (info, warning, critical)
    device_filters?: {
        device_ids?: string[];
        device_types?: string[];
        tags?: string[];
    };
    created_at: Date;
    updated_at: Date;
}

const NotificationChannelSchema = new Schema<INotificationChannel>({
    name: { type: String, required: true, unique: true },
    description: { type: String },
    type: {
        type: String,
        required: true,
        enum: ['slack', 'email', 'webhook', 'sms']
    },
    enabled: { type: Boolean, default: true },
    is_default: { type: Boolean, default: false },
    config: {
        slack_webhook_url: { type: String },
        slack_channel: { type: String },
        slack_group_name: { type: String },
        email_addresses: [{ type: String }],
        webhook_url: { type: String },
        phone_numbers: [{ type: String }]
    },
    alert_types: [{ type: String }], // e.g., ['offline', 'service_down', 'sip_issue']
    severity_levels: [{ type: String }], // e.g., ['warning', 'critical']
    device_filters: {
        device_ids: [{ type: String }],
        device_types: [{ type: String }],
        tags: [{ type: String }]
    },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
});

// Update the updated_at timestamp before saving
NotificationChannelSchema.pre('save', function (this: any) {
    this.updated_at = new Date();
});

NotificationChannelSchema.index({ is_default: 1, enabled: 1 });

export default mongoose.model<INotificationChannel>('NotificationChannel', NotificationChannelSchema);
