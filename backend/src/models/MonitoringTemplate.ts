import mongoose, { Document, Schema } from 'mongoose';

export interface IMonitoringTemplate extends Document {
    name: string;
    description: string;
    device_types: string[];
    icon?: string;
    default_rules: Array<{
        check_type: string;
        enabled: boolean;
        interval?: number;
        thresholds?: {
            warning?: number;
            critical?: number;
            latency?: number;
        };
        target_endpoints?: string;
        notification_channels?: string[];
    }>;
    is_system: boolean; // System templates can't be deleted
    created_at: Date;
    updated_at: Date;
}

const MonitoringTemplateSchema = new Schema<IMonitoringTemplate>({
    name: { type: String, required: true, unique: true },
    description: { type: String, required: true },
    device_types: [{ type: String }],
    icon: { type: String },
    default_rules: [{
        check_type: { type: String, required: true },
        enabled: { type: Boolean, default: true },
        interval: { type: Number },
        thresholds: {
            warning: { type: Number },
            critical: { type: Number }
        },
        target_endpoints: { type: String },
        notification_channels: [{ type: String }]
    }],
    is_system: { type: Boolean, default: false },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
});

// Update the updated_at timestamp before saving
MonitoringTemplateSchema.pre('save', function (this: any) {
    this.updated_at = new Date();
});

export default mongoose.model<IMonitoringTemplate>('MonitoringTemplate', MonitoringTemplateSchema);
