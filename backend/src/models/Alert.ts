import mongoose, { Schema, Document } from 'mongoose';

export interface IAlert extends Document {
    device_id: mongoose.Types.ObjectId;
    check_id?: mongoose.Types.ObjectId;
    severity: 'critical' | 'warning' | 'info';
    message: string;
    acknowledged: boolean;
    resolved: boolean;
    created_at: Date;
    updated_at: Date;
}

const AlertSchema: Schema = new Schema({
    device_id: { type: Schema.Types.ObjectId, ref: 'Device', required: true },
    check_id: { type: Schema.Types.ObjectId, ref: 'MonitoringCheck' },
    severity: { type: String, enum: ['critical', 'warning', 'info'], required: true },
    message: { type: String, required: true },
    acknowledged: { type: Boolean, default: false },
    resolved: { type: Boolean, default: false },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

export default mongoose.model<IAlert>('Alert', AlertSchema);
