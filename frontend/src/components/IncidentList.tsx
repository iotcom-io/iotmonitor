import React from 'react';
import { ShieldAlert, CheckCircle2, Clock, X } from 'lucide-react';

export const IncidentList = ({ incidents, onResolve }: { incidents: any[]; onResolve: (id: string) => void; }) => {
    if (!incidents || incidents.length === 0) return <div className="card text-slate-400">No incidents</div>;
    return (
        <div className="space-y-3">
            {incidents.map((i) => (
                <div key={i._id} className="card flex justify-between items-center">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2">
                            {i.status === 'open' ? <ShieldAlert className="text-amber-400" size={18} /> : <CheckCircle2 className="text-emerald-400" size={18} />}
                            <p className="text-white font-bold">{i.summary}</p>
                        </div>
                        <p className="text-slate-500 text-xs flex items-center gap-1"><Clock size={12} /> Started: {new Date(i.started_at).toLocaleString()}</p>
                        <p className="text-slate-500 text-xs">Target: {i.target_name || i.target_id}</p>
                    </div>
                    {i.status === 'open' && (
                        <button className="text-xs px-3 py-1 bg-emerald-500/20 text-emerald-300 rounded" onClick={() => onResolve(i._id)}>Resolve</button>
                    )}
                </div>
            ))}
        </div>
    );
};
