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
    status: 'online' | 'offline' | 'warning' | 'not_monitored';
    monitoring_enabled: boolean;
    monitoring_paused: boolean;
    enabled_modules?: ('system' | 'docker' | 'asterisk' | 'network')[];
    probe_config?: {
        target_ip?: string;
        target_port?: number;
        ping_host?: string;
    };
    network_interfaces?: {
        name: string;
        ip_address: string;
        mac_address?: string;
    }[];
    // Offline detection fields
    last_message_timestamps: Date[]; // Last 4 message timestamps
    consecutive_missed_messages: number;
    expected_message_interval_seconds: number; // Default: 15 seconds
    last_successful_metrics?: {
        system?: Date;
        docker?: Date;
        asterisk?: Date;
        network?: Date;
        [key: string]: Date | undefined;
    };
    notification_slack_webhook?: string;
    notification_channels?: {
        critical?: string;
        warning?: string;
        recovery?: string;
    };
    notify_on_recovery?: boolean;
    // Monitoring overrides
    offline_threshold_multiplier?: number; // legacy/global
    offline_critical_threshold?: number;
    offline_warning_threshold?: number;
    repeat_interval_minutes?: number;
    throttling_duration_minutes?: number;
    monitored_sip_endpoints?: string[]; // Specific SIP endpoints to monitor
    sip_rtt_threshold_ms?: number; // Custom RTT threshold for SIP
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
    status: { type: String, enum: ['online', 'offline', 'warning', 'not_monitored'], default: 'not_monitored' },
    monitoring_enabled: { type: Boolean, default: true },
    monitoring_paused: { type: Boolean, default: false },
    enabled_modules: [{ type: String, enum: ['system', 'docker', 'asterisk', 'network'] }],
    probe_config: {
        target_ip: { type: String },
        target_port: { type: Number },
        ping_host: { type: String }
    },
    network_interfaces: [{
        name: { type: String },
        ip_address: { type: String },
        mac_address: { type: String }
    }],
    // Offline detection fields
    last_message_timestamps: [{ type: Date }],
    consecutive_missed_messages: { type: Number, default: 0 },
    expected_message_interval_seconds: { type: Number, default: 15 },
    last_successful_metrics: {
        system: { type: Date },
        docker: { type: Date },
        asterisk: { type: Date },
        network: { type: Date }
    },
    notification_slack_webhook: { type: String },
    notification_channels: {
        critical: { type: String },
        warning: { type: String },
        recovery: { type: String }
    },
    notify_on_recovery: { type: Boolean, default: true },
    offline_threshold_multiplier: { type: Number },
    offline_critical_threshold: { type: Number, default: 4 },
    offline_warning_threshold: { type: Number, default: 2 },
    repeat_interval_minutes: { type: Number, default: 10 },
    throttling_duration_minutes: { type: Number, default: 60 },
    monitored_sip_endpoints: [{ type: String }],
    sip_rtt_threshold_ms: { type: Number, default: 200 },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

export default mongoose.model<IDevice>('Device', DeviceSchema);
