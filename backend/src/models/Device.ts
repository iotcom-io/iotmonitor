import mongoose, { Schema, Document } from 'mongoose';

export interface IDevice extends Document {
    device_id: string; // Unique identifier (e.g., serial or HW ID)
    name: string;
    hostname: string;
    type: 'server' | 'network_device' | 'website';
    memory_total?: number;
    disk_total?: number;
    public_ip?: string;
    local_ips?: string[];
    agent_token: string;
    mqtt_topic: string;
    config: Record<string, any>;
    last_seen: Date;
    status: 'online' | 'offline' | 'warning';
    monitoring_enabled: boolean;
    notification_slack_webhook?: string;
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
    public_ip: { type: String },
    local_ips: [{ type: String }],
    agent_token: { type: String, required: true },
    mqtt_topic: { type: String, required: true },
    config: { type: Schema.Types.Mixed, default: {} },
    last_seen: { type: Date, default: Date.now },
    status: { type: String, enum: ['online', 'offline', 'warning'], default: 'offline' },
    monitoring_enabled: { type: Boolean, default: true },
    notification_slack_webhook: { type: String },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

export default mongoose.model<IDevice>('Device', DeviceSchema);
