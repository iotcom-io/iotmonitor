import mongoose, { Schema, Document } from 'mongoose';

export interface ITelemetry extends Document {
    device_id: string;
    timestamp: Date;
    cpu_usage: number;
    cpu_load?: number;
    cpu_per_core?: number[];
    memory_usage: number;
    memory_total?: number;
    memory_used?: number;
    memory_available?: number;
    memory_cached?: number;
    memory_buffers?: number;
    disk_usage: number;
    disk_total?: number;
    disk_used?: number;
    network_in?: number;
    network_out?: number;
    public_ip?: string;
    local_ips?: string[];
    extra?: Record<string, any>;
}

const TelemetrySchema: Schema = new Schema({
    device_id: { type: String, required: true, index: true },
    timestamp: { type: Date, default: Date.now },
    cpu_usage: { type: Number, default: 0 },
    cpu_load: { type: Number },
    cpu_per_core: [{ type: Number }],
    memory_usage: { type: Number, default: 0 },
    memory_total: { type: Number },
    memory_used: { type: Number },
    memory_available: { type: Number },
    memory_cached: { type: Number },
    memory_buffers: { type: Number },
    disk_usage: { type: Number, default: 0 },
    disk_total: { type: Number },
    disk_used: { type: Number },
    network_in: { type: Number },
    network_out: { type: Number },
    public_ip: { type: String },
    local_ips: [{ type: String }],
    extra: { type: Schema.Types.Mixed },
});

// TTL Index: Keep logs for 30 days
TelemetrySchema.index({ timestamp: 1 }, { expireAfterSeconds: 2592000 });

export default mongoose.model<ITelemetry>('Telemetry', TelemetrySchema);
