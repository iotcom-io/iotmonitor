import mongoose, { Document, Schema } from 'mongoose';

export interface IAlertTracking extends Document {
    device_id: string;
    alert_type: 'offline' | 'online' | 'service_down' | 'sip_issue' | 'high_latency' | 'threshold' | 'rule_violation' | 'ip_change';
    specific_service?: string;
    specific_endpoint?: string;
    severity: 'info' | 'warning' | 'critical';
    state: 'new' | 'throttling' | 'hourly_only' | 'resolved';
    first_triggered: Date;
    last_notified: Date;
    notification_count: number;
    throttling_config: {
        repeat_interval_minutes: number;
        throttling_duration_minutes: number;
    };
    notification_channels: string[]; // Array of channel IDs to notify
    resolved_at?: Date;
    details: any;
    created_at: Date;
    updated_at: Date;
}

const AlertTrackingSchema = new Schema<IAlertTracking>({
    device_id: { type: String, required: true, index: true },
    alert_type: {
        type: String,
        required: true,
        enum: ['offline', 'online', 'service_down', 'sip_issue', 'high_latency', 'threshold', 'rule_violation', 'ip_change']
    },
    specific_service: { type: String },
    specific_endpoint: { type: String },
    severity: {
        type: String,
        required: true,
        enum: ['info', 'warning', 'critical'],
        default: 'warning'
    },
    state: {
        type: String,
        required: true,
        enum: ['new', 'throttling', 'hourly_only', 'resolved'],
        default: 'new'
    },
    first_triggered: { type: Date, required: true, default: Date.now },
    last_notified: { type: Date, required: true, default: Date.now },
    notification_count: { type: Number, default: 1 },
    throttling_config: {
        repeat_interval_minutes: { type: Number, default: 5 },
        throttling_duration_minutes: { type: Number, default: 60 }
    },
    notification_channels: [{ type: String }],
    resolved_at: { type: Date },
    details: { type: Schema.Types.Mixed },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
});

// Index for querying active alerts
AlertTrackingSchema.index({ device_id: 1, state: 1 });
AlertTrackingSchema.index({ state: 1, last_notified: 1 });

// Update the updated_at timestamp before saving
AlertTrackingSchema.pre('save', function (this: any) {
    this.updated_at = new Date();
});

export default mongoose.model<IAlertTracking>('AlertTracking', AlertTrackingSchema);
