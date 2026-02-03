import React from 'react';
import { ShieldAlert, CheckCircle2 } from 'lucide-react';

export const IncidentBanner = ({ incidents }: { incidents: any[] }) => {
    if (!incidents || incidents.length === 0) return null;
    return (
        <div className="p-4 border border-amber-500/40 bg-amber-500/10 rounded-xl text-amber-100 text-sm flex items-start gap-3">
            <ShieldAlert size={18} className="mt-0.5" />
            <div>
                <p className="font-bold text-amber-100">{incidents.length} open incident(s)</p>
                <ul className="list-disc pl-5 space-y-1">
                    {incidents.map((i) => (
                        <li key={i._id}>
                            <span className="font-semibold">{i.target_name || i.target_id}</span>: {i.summary}
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};
