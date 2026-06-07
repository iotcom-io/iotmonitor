import mongoose, { Schema, Document } from 'mongoose';

export interface ISnmpDevice extends Document {
    name: string;
    host: string;
    port: number;
    community: string;
    version: 'v1' | 'v2c' | 'v3';
    // v3 fields
    v3_username?: string;
    v3_auth_protocol?: 'MD5' | 'SHA' | 'SHA256';
    v3_auth_key?: string;
    v3_priv_protocol?: 'DES' | 'AES' | 'AES256';
    v3_priv_key?: string;
    // device metadata
    device_type: 'switch' | 'router' | 'firewall' | 'ap' | 'printer' | 'ups' | 'storage' | 'other';
    vendor?: string;
    device_model?: string;
    location?: string;
    // monitoring config
    enabled: boolean;
    poll_interval_seconds: number;
    custom_oids?: Array<{ name: string; oid: string; unit?: string }>;
    // computed state
    status: 'online' | 'offline' | 'unknown';
    last_seen?: Date;
    last_metrics?: Record<string, any>;
    tags?: string[];
    assigned_user_ids?: string[];
    created_at: Date;
    updated_at: Date;
}

const SnmpDeviceSchema = new Schema<ISnmpDevice>({
    name: { type: String, required: true },
    host: { type: String, required: true },
    port: { type: Number, default: 161 },
    community: { type: String, default: 'public' },
    version: { type: String, enum: ['v1', 'v2c', 'v3'], default: 'v2c' },
    v3_username: { type: String },
    v3_auth_protocol: { type: String, enum: ['MD5', 'SHA', 'SHA256'] },
    v3_auth_key: { type: String },
    v3_priv_protocol: { type: String, enum: ['DES', 'AES', 'AES256'] },
    v3_priv_key: { type: String },
    device_type: { type: String, enum: ['switch', 'router', 'firewall', 'ap', 'printer', 'ups', 'storage', 'other'], default: 'other' },
    vendor: { type: String },
    device_model: { type: String },
    location: { type: String },
    enabled: { type: Boolean, default: true },
    poll_interval_seconds: { type: Number, default: 300 },
    custom_oids: [{
        name: { type: String, required: true },
        oid: { type: String, required: true },
        unit: { type: String },
    }],
    status: { type: String, enum: ['online', 'offline', 'unknown'], default: 'unknown' },
    last_seen: { type: Date },
    last_metrics: { type: Schema.Types.Mixed },
    tags: [{ type: String }],
    assigned_user_ids: [{ type: String }],
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

SnmpDeviceSchema.index({ host: 1 }, { unique: true });
SnmpDeviceSchema.index({ status: 1 });
SnmpDeviceSchema.index({ device_type: 1 });
SnmpDeviceSchema.index({ enabled: 1 });

export default mongoose.model<ISnmpDevice>('SnmpDevice', SnmpDeviceSchema);
