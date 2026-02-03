import React, { useEffect, useState } from 'react';
import api from '../lib/axios';
import { Globe, Plus, RefreshCw, ShieldAlert, CheckCircle2, X } from 'lucide-react';

const typeLabels: any = {
    http: 'HTTP',
    ssl: 'SSL Expiry',
};

const NewCheckModal = ({ isOpen, onClose, onSaved }: any) => {
    const [form, setForm] = useState<any>({
        name: '',
        type: 'http',
        url: '',
        interval: 300,
        timeout: 8000,
        expected_status: 200,
        must_include: '',
        ssl_expiry_days: 14,
    });
    const [saving, setSaving] = useState(false);

    const save = async () => {
        setSaving(true);
        try {
            await api.post('/synthetics', form);
            onSaved();
            onClose();
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur flex items-center justify-center p-4">
            <div className="bg-dark-surface border border-dark-border rounded-2xl w-full max-w-lg p-6 space-y-4">
                <div className="flex justify-between items-center">
                    <h3 className="text-xl font-bold text-white">New Synthetic Check</h3>
                    <button className="text-slate-500 hover:text-white" onClick={onClose}><X size={20} /></button>
                </div>
                <div className="space-y-3">
                    <label className="text-sm text-slate-400">Name</label>
                    <input className="input-field" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                    <label className="text-sm text-slate-400">URL</label>
                    <input className="input-field" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://example.com/health" />
                    <label className="text-sm text-slate-400">Type</label>
                    <select className="input-field" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                        <option value="http">HTTP</option>
                        <option value="ssl">SSL Expiry</option>
                    </select>
                    {form.type === 'http' && (
                        <>
                            <label className="text-sm text-slate-400">Expected Status</label>
                            <input className="input-field" type="number" value={form.expected_status} onChange={e => setForm({ ...form, expected_status: parseInt(e.target.value) })} />
                            <label className="text-sm text-slate-400">Must include (optional)</label>
                            <input className="input-field" value={form.must_include} onChange={e => setForm({ ...form, must_include: e.target.value })} placeholder="e.g. OK" />
                        </>
                    )}
                    {form.type === 'ssl' && (
                        <>
                            <label className="text-sm text-slate-400">Alert when days-to-expiry ≤</label>
                            <input className="input-field" type="number" value={form.ssl_expiry_days} onChange={e => setForm({ ...form, ssl_expiry_days: parseInt(e.target.value) })} />
                        </>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-sm text-slate-400">Interval (s)</label>
                            <input className="input-field" type="number" value={form.interval} onChange={e => setForm({ ...form, interval: parseInt(e.target.value) })} />
                        </div>
                        <div>
                            <label className="text-sm text-slate-400">Timeout (ms)</label>
                            <input className="input-field" type="number" value={form.timeout} onChange={e => setForm({ ...form, timeout: parseInt(e.target.value) })} />
                        </div>
                    </div>
                </div>
                <div className="flex justify-end gap-3">
                    <button className="px-4 py-2 text-slate-400 hover:text-white" onClick={onClose}>Cancel</button>
                    <button disabled={saving} className="btn-primary px-4 py-2" onClick={save}>{saving ? 'Saving...' : 'Save'}</button>
                </div>
            </div>
        </div>
    );
};

export const Synthetics = () => {
    const [checks, setChecks] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);

    const fetchChecks = async () => {
        setLoading(true);
        try {
            const res = await api.get('/synthetics');
            setChecks(res.data);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchChecks(); }, []);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Globe className="text-primary-400" />
                    <div>
                        <h2 className="text-2xl font-bold text-white">Synthetic Checks</h2>
                        <p className="text-slate-500 text-sm">HTTP uptime + SSL expiry</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button className="icon-btn" onClick={fetchChecks}><RefreshCw size={18} /></button>
                    <button className="btn-primary flex items-center gap-2" onClick={() => setModalOpen(true)}>
                        <Plus size={16} /> New Check
                    </button>
                </div>
            </div>
            {loading ? <div className="card">Loading...</div> : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {checks.map((c) => (
                        <div key={c._id} className="card border border-white/10">
                            <div className="flex justify-between items-center mb-2">
                                <h3 className="text-lg font-bold text-white">{c.name}</h3>
                                <span className={`px-2 py-0.5 rounded text-xs font-bold ${c.last_status === 'ok' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}>
                                    {c.last_status || 'new'}
                                </span>
                            </div>
                            <p className="text-slate-400 text-sm break-words">{c.url}</p>
                            <p className="text-slate-500 text-xs mt-1">{typeLabels[c.type] || c.type}</p>
                            <p className="text-slate-500 text-xs mt-2">Interval: {c.interval || 300}s · Timeout: {c.timeout || 8000}ms</p>
                            <p className="text-slate-500 text-xs">Last: {c.last_run ? new Date(c.last_run).toLocaleTimeString() : 'never'} — {c.last_message || ''}</p>
                        </div>
                    ))}
                    {checks.length === 0 && <div className="card text-slate-400">No checks yet. Create one.</div>}
                </div>
            )}
            <NewCheckModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onSaved={fetchChecks} />
        </div>
    );
};
