import React, { useEffect, useMemo, useState } from 'react';
import api from '../lib/axios';
import { KeyRound, Plus, RefreshCw, Edit3, Trash2, X } from 'lucide-react';

const blankForm = {
    name: '',
    vendor: '',
    product: '',
    type: 'subscription',
    owner: '',
    reference_key: '',
    renewal_date: '',
    warning_days: 30,
    critical_days: 7,
    billing_cycle: 'yearly',
    amount: '',
    currency: 'USD',
    seats_total: '',
    seats_used: '',
    auto_renew: false,
    enabled: true,
    status: 'active',
};

const stateClass = (state: string) => {
    if (state === 'expired') return 'bg-red-500/20 text-red-300';
    if (state === 'critical') return 'bg-rose-500/20 text-rose-300';
    if (state === 'warning') return 'bg-amber-500/20 text-amber-300';
    if (state === 'paused') return 'bg-slate-500/20 text-slate-300';
    return 'bg-emerald-500/20 text-emerald-300';
};

const LicenseModal = ({ open, onClose, onSaved, initial }: any) => {
    const [form, setForm] = useState<any>(blankForm);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        if (!initial) {
            setForm(blankForm);
            return;
        }
        const renewalDate = initial.renewal_date ? new Date(initial.renewal_date) : null;
        setForm({
            ...blankForm,
            ...initial,
            renewal_date: renewalDate && !Number.isNaN(renewalDate.getTime())
                ? renewalDate.toISOString().slice(0, 10)
                : '',
            amount: initial.amount ?? '',
            seats_total: initial.seats_total ?? '',
            seats_used: initial.seats_used ?? '',
        });
    }, [open, initial]);

    if (!open) return null;

    const save = async () => {
        setSaving(true);
        try {
            const payload: any = {
                ...form,
                renewal_date: form.renewal_date ? new Date(form.renewal_date).toISOString() : undefined,
                amount: String(form.amount).trim() ? Number(form.amount) : undefined,
                seats_total: String(form.seats_total).trim() ? Number(form.seats_total) : undefined,
                seats_used: String(form.seats_used).trim() ? Number(form.seats_used) : undefined,
                warning_days: Number(form.warning_days || 30),
                critical_days: Number(form.critical_days || 7),
            };

            if (form._id) {
                await api.put(`/licenses/${form._id}`, payload);
            } else {
                await api.post('/licenses', payload);
            }

            onSaved();
            onClose();
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur flex items-center justify-center p-4">
            <div className="bg-dark-surface border border-dark-border rounded-2xl w-full max-w-3xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center">
                    <h3 className="text-xl font-bold text-white">{form._id ? 'Edit License/Subscription' : 'New License/Subscription'}</h3>
                    <button className="text-slate-500 hover:text-white" onClick={onClose}><X size={20} /></button>
                </div>

                <div className="grid md:grid-cols-2 gap-3">
                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Name</label>
                        <input className="input-field" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Type</label>
                        <select className="input-field" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                            <option value="subscription">Subscription</option>
                            <option value="license">License</option>
                        </select>
                    </div>
                </div>

                <div className="grid md:grid-cols-3 gap-3">
                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Vendor</label>
                        <input className="input-field" value={form.vendor || ''} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Product</label>
                        <input className="input-field" value={form.product || ''} onChange={(e) => setForm({ ...form, product: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Owner</label>
                        <input className="input-field" value={form.owner || ''} onChange={(e) => setForm({ ...form, owner: e.target.value })} />
                    </div>
                </div>

                <div className="grid md:grid-cols-3 gap-3">
                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Renewal Date</label>
                        <input type="date" className="input-field" value={form.renewal_date || ''} onChange={(e) => setForm({ ...form, renewal_date: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Warning Days</label>
                        <input type="number" className="input-field" value={form.warning_days} onChange={(e) => setForm({ ...form, warning_days: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Critical Days</label>
                        <input type="number" className="input-field" value={form.critical_days} onChange={(e) => setForm({ ...form, critical_days: e.target.value })} />
                    </div>
                </div>

                <div className="grid md:grid-cols-4 gap-3">
                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Amount</label>
                        <input type="number" className="input-field" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Currency</label>
                        <input className="input-field" value={form.currency || 'USD'} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Seats Total</label>
                        <input type="number" className="input-field" value={form.seats_total} onChange={(e) => setForm({ ...form, seats_total: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Seats Used</label>
                        <input type="number" className="input-field" value={form.seats_used} onChange={(e) => setForm({ ...form, seats_used: e.target.value })} />
                    </div>
                </div>

                <div className="grid md:grid-cols-3 gap-3">
                    <label className="flex items-center gap-2 text-sm text-slate-300">
                        <input type="checkbox" checked={Boolean(form.auto_renew)} onChange={(e) => setForm({ ...form, auto_renew: e.target.checked })} />
                        Auto Renew
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-300">
                        <input type="checkbox" checked={Boolean(form.enabled)} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
                        Monitoring Enabled
                    </label>
                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Status</label>
                        <select className="input-field" value={form.status || 'active'} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                            <option value="active">Active</option>
                            <option value="paused">Paused</option>
                            <option value="expired">Expired</option>
                        </select>
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

export const Licenses = () => {
    const [items, setItems] = useState<any[]>([]);
    const [stats, setStats] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<any>(null);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [rowsRes, statsRes] = await Promise.all([
                api.get('/licenses'),
                api.get('/licenses/stats'),
            ]);
            setItems(rowsRes.data || []);
            setStats(statsRes.data || null);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const sorted = useMemo(() => {
        return [...items].sort((a, b) => Number(a.days_left || 0) - Number(b.days_left || 0));
    }, [items]);

    const remove = async (id: string) => {
        const confirmed = window.confirm('Delete this license/subscription item?');
        if (!confirmed) return;
        await api.delete(`/licenses/${id}`);
        fetchData();
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <KeyRound className="text-primary-400" />
                    <div>
                        <h2 className="text-2xl font-bold text-white">License & Subscription Monitoring</h2>
                        <p className="text-slate-500 text-sm">Track renewals, expiries, seats, and ownership</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button className="icon-btn" onClick={fetchData}><RefreshCw size={16} /></button>
                    <button className="btn-primary flex items-center gap-2" onClick={() => { setEditing(null); setModalOpen(true); }}>
                        <Plus size={16} /> New Entry
                    </button>
                </div>
            </div>

            {stats && (
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                    <div className="card"><div className="text-xs text-slate-400">Total</div><div className="text-xl font-bold text-white">{stats.total || 0}</div></div>
                    <div className="card"><div className="text-xs text-slate-400">OK</div><div className="text-xl font-bold text-emerald-400">{stats.ok || 0}</div></div>
                    <div className="card"><div className="text-xs text-slate-400">Warning</div><div className="text-xl font-bold text-amber-400">{stats.warning || 0}</div></div>
                    <div className="card"><div className="text-xs text-slate-400">Critical</div><div className="text-xl font-bold text-rose-400">{stats.critical || 0}</div></div>
                    <div className="card"><div className="text-xs text-slate-400">Expired</div><div className="text-xl font-bold text-red-400">{stats.expired || 0}</div></div>
                    <div className="card"><div className="text-xs text-slate-400">Paused</div><div className="text-xl font-bold text-slate-300">{stats.paused || 0}</div></div>
                </div>
            )}

            <div className="card overflow-x-auto">
                {loading ? (
                    <div className="text-slate-400">Loading...</div>
                ) : (
                    <table className="min-w-full text-sm">
                        <thead>
                            <tr className="text-left text-slate-400 border-b border-white/10">
                                <th className="py-3 pr-3">Name</th>
                                <th className="py-3 pr-3">Type</th>
                                <th className="py-3 pr-3">Owner</th>
                                <th className="py-3 pr-3">Renewal</th>
                                <th className="py-3 pr-3">Days Left</th>
                                <th className="py-3 pr-3">State</th>
                                <th className="py-3 pr-3">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sorted.map((row) => (
                                <tr key={row._id} className="border-b border-white/5">
                                    <td className="py-3 pr-3">
                                        <div className="text-white font-semibold">{row.name}</div>
                                        <div className="text-xs text-slate-500">{row.vendor || 'N/A'} / {row.product || 'N/A'}</div>
                                    </td>
                                    <td className="py-3 pr-3 text-slate-300">{String(row.type || '').toUpperCase()}</td>
                                    <td className="py-3 pr-3 text-slate-300">{row.owner || 'N/A'}</td>
                                    <td className="py-3 pr-3 text-slate-300">{row.renewal_date ? new Date(row.renewal_date).toLocaleDateString() : 'N/A'}</td>
                                    <td className="py-3 pr-3 text-slate-300">{row.days_left ?? 'N/A'}</td>
                                    <td className="py-3 pr-3">
                                        <span className={`text-xs px-2 py-0.5 rounded ${stateClass(row.status === 'paused' ? 'paused' : row.computed_state)}`}>
                                            {String(row.status === 'paused' ? 'paused' : row.computed_state || 'unknown').toUpperCase()}
                                        </span>
                                    </td>
                                    <td className="py-3 pr-3">
                                        <div className="flex gap-2">
                                            <button className="icon-btn" onClick={() => { setEditing(row); setModalOpen(true); }}><Edit3 size={14} /></button>
                                            <button className="icon-btn text-red-400" onClick={() => remove(row._id)}><Trash2 size={14} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {!loading && sorted.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="py-6 text-slate-400">No license/subscription items found.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                )}
            </div>

            <LicenseModal open={modalOpen} onClose={() => setModalOpen(false)} onSaved={fetchData} initial={editing} />
        </div>
    );
};

