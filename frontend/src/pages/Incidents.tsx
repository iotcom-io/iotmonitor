import React, { useEffect, useState } from 'react';
import api from '../lib/axios';
import { IncidentList } from '../components/IncidentList';
import { ShieldCheck, RefreshCw } from 'lucide-react';

export const Incidents = () => {
    const [incidents, setIncidents] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchIncidents = async () => {
        setLoading(true);
        try {
            const res = await api.get('/incidents');
            setIncidents(res.data);
        } finally {
            setLoading(false);
        }
    };

    const resolve = async (id: string) => {
        await api.post(`/incidents/${id}/resolve`);
        fetchIncidents();
    };

    useEffect(() => { fetchIncidents(); }, []);

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <ShieldCheck className="text-primary-400" />
                    <h2 className="text-2xl font-bold text-white">Incidents</h2>
                </div>
                <button className="icon-btn" onClick={fetchIncidents}><RefreshCw size={16} /></button>
            </div>
            {loading ? <div className="card">Loading...</div> : <IncidentList incidents={incidents} onResolve={resolve} />}
        </div>
    );
};
