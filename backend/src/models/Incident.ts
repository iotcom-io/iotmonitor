import mongoose, { Schema, Document } from 'mongoose';

export interface IIncidentUpdate {
    at: Date;
    message: string;
}

export interface IIncident extends Document {
    target_type: 'device' | 'synthetic' | 'service';
    target_id: string;
    target_name?: string;
    severity: 'critical' | 'warning';
    status: 'open' | 'resolved';
    started_at: Date;
    resolved_at?: Date;
    summary: string;
    updates: IIncidentUpdate[];
    created_at: Date;
    updated_at: Date;
}

const IncidentSchema: Schema = new Schema({
    target_type: { type: String, enum: ['device', 'synthetic', 'service'], required: true },
    target_id: { type: String, required: true },
    target_name: { type: String },
    severity: { type: String, enum: ['critical', 'warning'], default: 'critical' },
    status: { type: String, enum: ['open', 'resolved'], default: 'open' },
    started_at: { type: Date, default: Date.now },
    resolved_at: { type: Date },
    summary: { type: String, required: true },
    updates: [{
        at: { type: Date, default: Date.now },
        message: { type: String }
    }]
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

export default mongoose.model<IIncident>('Incident', IncidentSchema);
