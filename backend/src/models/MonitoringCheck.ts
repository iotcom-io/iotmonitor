import mongoose, { Schema, Document } from 'mongoose';

export interface IMonitoringCheck extends Document {
    device_id: string;
    check_type: 'cpu' | 'memory' | 'disk' | 'bandwidth' | 'utilization' | 'sip_rtt' | 'sip_registration' | 'container_status' | 'custom';
    target?: string;
    config: Record<string, any>;
    interval: number; // evaluation interval in seconds
    thresholds: {
        critical: number;
        warning: number;
        consecutive_failures?: number;
    };
    notification_frequency: number; // in minutes (reminders)
    notify: {
        channels: ('slack' | 'email' | 'webhook')[];
    };
    enabled: boolean;
    last_evaluated_at?: Date;
    last_state?: 'ok' | 'warning' | 'critical' | 'unknown';
    last_value?: number;
    last_message?: string;
    assigned_user_ids?: string[];
    created_at: Date;
    updated_at: Date;
}

const MonitoringCheckSchema: Schema = new Schema({
    device_id: { type: String, ref: 'Device', required: true },
    check_type: {
        type: String,
        enum: ['cpu', 'memory', 'disk', 'bandwidth', 'utilization', 'sip_rtt', 'sip_registration', 'container_status', 'custom'],
        required: true
    },
    target: { type: String },
    config: { type: Schema.Types.Mixed, default: {} },
    interval: { type: Number, default: 30 },
    thresholds: {
        critical: { type: Number, required: true },
        warning: { type: Number, required: true },
        consecutive_failures: { type: Number, default: 1 }
    },
    notification_frequency: { type: Number, default: 15 },
    notify: {
        channels: [{ type: String, enum: ['slack', 'email', 'webhook'], default: ['slack'] }]
    },
    enabled: { type: Boolean, default: true },
    last_evaluated_at: { type: Date },
    last_state: { type: String, enum: ['ok', 'warning', 'critical', 'unknown'], default: 'unknown' },
    last_value: { type: Number },
    last_message: { type: String },
    assigned_user_ids: [{ type: String }],
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

export default mongoose.model<IMonitoringCheck>('MonitoringCheck', MonitoringCheckSchema);
