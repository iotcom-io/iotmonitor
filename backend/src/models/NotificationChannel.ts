import mongoose, { Document, Schema } from 'mongoose';

export interface INotificationChannel extends Document {
    name: string;
    description?: string;
    type: 'slack' | 'email' | 'webhook' | 'sms' | 'whatsapp' | 'call_api';
    enabled: boolean;
    is_default?: boolean;
    config: {
        slack_webhook_url?: string;
        slack_channel?: string;
        slack_group_name?: string; // e.g., "Production Alerts", "Network Team"
        email_addresses?: string[];
        smtp_host?: string;
        smtp_port?: number;
        smtp_secure?: boolean;
        smtp_user?: string;
        smtp_pass?: string;
        email_from?: string;
        email_subject_prefix?: string;
        webhook_url?: string;
        webhook_method?: 'POST' | 'PUT' | 'PATCH' | 'GET';
        webhook_headers?: Record<string, string>;
        webhook_payload_template?: string;
        phone_numbers?: string[];
        whatsapp_api_url?: string;
        whatsapp_api_token?: string;
        whatsapp_to_numbers?: string[];
        whatsapp_payload_template?: string;
        call_api_url?: string;
        call_api_token?: string;
        call_to_numbers?: string[];
        call_payload_template?: string;
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
        enum: ['slack', 'email', 'webhook', 'sms', 'whatsapp', 'call_api']
    },
    enabled: { type: Boolean, default: true },
    is_default: { type: Boolean, default: false },
    config: {
        slack_webhook_url: { type: String },
        slack_channel: { type: String },
        slack_group_name: { type: String },
        email_addresses: [{ type: String }],
        smtp_host: { type: String },
        smtp_port: { type: Number },
        smtp_secure: { type: Boolean, default: false },
        smtp_user: { type: String },
        smtp_pass: { type: String },
        email_from: { type: String },
        email_subject_prefix: { type: String },
        webhook_url: { type: String },
        webhook_method: { type: String, enum: ['POST', 'PUT', 'PATCH', 'GET'], default: 'POST' },
        webhook_headers: { type: Schema.Types.Mixed },
        webhook_payload_template: { type: String },
        phone_numbers: [{ type: String }],
        whatsapp_api_url: { type: String },
        whatsapp_api_token: { type: String },
        whatsapp_to_numbers: [{ type: String }],
        whatsapp_payload_template: { type: String },
        call_api_url: { type: String },
        call_api_token: { type: String },
        call_to_numbers: [{ type: String }],
        call_payload_template: { type: String },
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
