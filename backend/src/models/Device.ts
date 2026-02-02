import mongoose, { Schema, Document } from 'mongoose';

export interface IDevice extends Document {
    device_id: string; // Unique identifier (e.g., serial or HW ID)
    name: string;
    hostname: string;
    type: 'server' | 'network_device' | 'website';
    memory_total?: number;
    disk_total?: number;
    agent_token: string;
    mqtt_topic: string;
    config: Record<string, any>;
    last_seen: Date;
    status: 'online' | 'offline' | 'warning';
    monitoring_enabled: boolean;
    created_at: Date;
    updated_at: Date;
}

const DeviceSchema: Schema = new Schema({
    device_id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    hostname: { type: String },
    type: { type: String, enum: ['server', 'network_device', 'website'], default: 'server' },
    memory_total: { type: Number },
    disk_total: { type: Number },
    agent_token: { type: String, required: true },
    mqtt_topic: { type: String, required: true },
    config: { type: Schema.Types.Mixed, default: {} },
    last_seen: { type: Date, default: Date.now },
    status: { type: String, enum: ['online', 'offline', 'warning'], default: 'offline' },
    monitoring_enabled: { type: Boolean, default: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

export default mongoose.model<IDevice>('Device', DeviceSchema);
