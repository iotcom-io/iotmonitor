import mongoose, { Schema, Document } from 'mongoose';

export interface ITelemetry extends Document {
    device_id: string;
    timestamp: Date;
    cpu_usage: number;
    memory_usage: number;
    disk_usage: number;
    network_in?: number;
    network_out?: number;
    extra?: Record<string, any>;
}

const TelemetrySchema: Schema = new Schema({
    device_id: { type: String, required: true, index: true },
    timestamp: { type: Date, default: Date.now, index: true },
    cpu_usage: { type: Number, required: true },
    memory_usage: { type: Number, required: true },
    disk_usage: { type: Number, required: true },
    network_in: { type: Number },
    network_out: { type: Number },
    extra: { type: Schema.Types.Mixed },
});

// TTL Index: Keep logs for 30 days
TelemetrySchema.index({ timestamp: 1 }, { expireAfterSeconds: 2592000 });

export default mongoose.model<ITelemetry>('Telemetry', TelemetrySchema);
