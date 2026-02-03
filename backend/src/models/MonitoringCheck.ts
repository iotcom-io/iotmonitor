import mongoose, { Schema, Document } from 'mongoose';

export interface IMonitoringCheck extends Document {
    device_id: string;
    check_type: 'cpu' | 'memory' | 'docker' | 'sip' | 'sip_registration' | 'ping' | 'port' | 'bandwidth' | 'ssl' | 'custom';
    target?: string; // e.g. "callapptrunk" or "eth0"
    config: Record<string, any>;
    interval: number; // in seconds
    thresholds: {
        critical?: number;
        attention?: number;
    };
    notification_frequency: number; // in minutes
    notification_recipients: string[]; // groups or member IDs
    enabled: boolean;
    created_at: Date;
    updated_at: Date;
}

const MonitoringCheckSchema: Schema = new Schema({
    device_id: { type: String, ref: 'Device', required: true },
    check_type: {
        type: String,
        enum: ['cpu', 'memory', 'docker', 'sip', 'sip_registration', 'ping', 'port', 'bandwidth', 'ssl', 'custom'],
        required: true
    },
    target: { type: String },
    config: { type: Schema.Types.Mixed, default: {} },
    interval: { type: Number, default: 60 },
    thresholds: {
        critical: Number,
        attention: Number,
    },
    notification_frequency: { type: Number, default: 60 }, // default 60 mins
    notification_recipients: [{ type: String }],
    enabled: { type: Boolean, default: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

export default mongoose.model<IMonitoringCheck>('MonitoringCheck', MonitoringCheckSchema);
