import mongoose, { Schema, Document } from 'mongoose';

export interface IMonitoringCheck extends Document {
    device_id: mongoose.Types.ObjectId;
    check_type: 'cpu' | 'memory' | 'docker' | 'asterisk' | 'ping' | 'port' | 'ssl' | 'custom';
    config: Record<string, any>;
    interval: number; // in seconds
    thresholds: {
        critical?: number;
        warning?: number;
    };
    enabled: boolean;
    created_at: Date;
    updated_at: Date;
}

const MonitoringCheckSchema: Schema = new Schema({
    device_id: { type: Schema.Types.ObjectId, ref: 'Device', required: true },
    check_type: {
        type: String,
        enum: ['cpu', 'memory', 'docker', 'asterisk', 'ping', 'port', 'ssl', 'custom'],
        required: true
    },
    config: { type: Schema.Types.Mixed, default: {} },
    interval: { type: Number, default: 60 },
    thresholds: {
        critical: Number,
        warning: Number,
    },
    enabled: { type: Boolean, default: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

export default mongoose.model<IMonitoringCheck>('MonitoringCheck', MonitoringCheckSchema);
