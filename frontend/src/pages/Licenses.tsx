import React, { useEffect, useMemo, useState } from 'react';
import { ConfirmationModal } from '../components/ConfirmationModal';
import api from '../lib/axios';
import { KeyRound, Plus, RefreshCw, Edit3, Trash2, X, Download, ChevronDown, ChevronRight } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { hasPermission } from '../lib/permissions';
import { AssigneeBadges } from '../components/AssigneeBadges';

type NotificationChannelOption = {
    _id: string;
    name: string;
    type: 'slack' | 'email' | 'webhook' | 'sms';
    enabled: boolean;
    is_default?: boolean;
};

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
    currency: 'INR',
    seats_total: '',
    seats_used: '',
    auto_renew: false,
    enabled: true,
    status: 'active',
    notification_channel_ids: [] as string[],
};

const stateClass = (state: string) => {
    if (state === 'expired') return 'bg-red-500/20 text-red-300';
    if (state === 'critical') return 'bg-rose-500/20 text-rose-300';
    if (state === 'warning') return 'bg-amber-500/20 text-amber-300';
    if (state === 'paused') return 'bg-slate-500/20 text-slate-300';
    return 'bg-emerald-500/20 text-emerald-300';
};

const renderCurrencyTotals = (totals: Record<string, number> | undefined) => {
    if (!totals || Object.keys(totals).length === 0) return 'INR 0.00';
    return Object.entries(totals)
        .map(([currency, amount]) => `${currency} ${Number(amount || 0).toFixed(2)}`)
        .join(' | ');
};

const LicenseModal = ({ open, onClose, onSaved, initial, availableChannels }: any) => {
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
            notification_channel_ids: Array.isArray(initial.notification_channel_ids) ? initial.notification_channel_ids : [],
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
                notification_channel_ids: Array.from(new Set(
                    (Array.isArray(form.notification_channel_ids) ? form.notification_channel_ids : [])
                        .map((entry: any) => String(entry || '').trim())
                        .filter(Boolean)
                )),
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
                    <h3 className="text-xl font-bold text-white">{form._id ? 'Edit License/Subscription/Bill' : 'New License/Subscription/Bill'}</h3>
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
                            <option value="utility">Utility / Bill</option>
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

                <div className="space-y-2">
                    <label className="text-sm text-slate-400">Notification Destinations</label>
                    <div className="rounded-xl border border-dark-border p-3 space-y-2">
                        <div className="text-xs text-slate-500">
                            Select channel(s) for this license/subscription. Leave empty to use the default channel fallback.
                        </div>
                        {availableChannels.length === 0 ? (
                            <div className="text-xs text-amber-300">No channels configured. Add channels in Notifications settings.</div>
                        ) : availableChannels.map((channel: NotificationChannelOption) => (
                            <label key={channel._id} className="flex items-center justify-between gap-2 text-sm text-slate-200">
                                <span className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={(form.notification_channel_ids || []).includes(channel._id)}
                                        onChange={(e) => {
                                            const set = new Set(form.notification_channel_ids || []);
                                            if (e.target.checked) set.add(channel._id);
                                            else set.delete(channel._id);
                                            setForm({ ...form, notification_channel_ids: Array.from(set) });
                                        }}
                                    />
                                    <span>{channel.name}</span>
                                    <span className="text-xs text-slate-500 uppercase">{channel.type}</span>
                                </span>
                                {channel.is_default && <span className="text-[10px] px-2 py-0.5 rounded bg-primary-500/20 text-primary-300">default</span>}
                            </label>
                        ))}
                    </div>
                </div>

                <div className="grid md:grid-cols-4 gap-3">
                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Renewal Date</label>
                        <input type="date" className="input-field" value={form.renewal_date || ''} onChange={(e) => setForm({ ...form, renewal_date: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Billing Cycle</label>
                        <select className="input-field" value={form.billing_cycle || 'yearly'} onChange={(e) => setForm({ ...form, billing_cycle: e.target.value })}>
                            <option value="none">None (Non-recursive)</option>
                            <option value="weekly">Weekly</option>
                            <option value="monthly">Monthly</option>
                            <option value="quarterly">Quarterly</option>
                            <option value="semi-annual">Semi-Annual</option>
                            <option value="yearly">Yearly</option>
                            <option value="custom">Custom</option>
                        </select>
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
                        <input className="input-field" value={form.currency || 'INR'} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
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
                    <label className="flex items-center gap-2 text-sm text-slate-300 mt-6">
                        <input type="checkbox" checked={Boolean(form.auto_renew)} onChange={(e) => setForm({ ...form, auto_renew: e.target.checked })} />
                        Auto Renew
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-300 mt-6">
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

const RenewPaymentModal = ({ open, onClose, onConfirm, row }: any) => {
    const [amountPaid, setAmountPaid] = useState('');
    const [currency, setCurrency] = useState('INR');
    const [paymentMode, setPaymentMode] = useState('Card');
    const [paymentProof, setPaymentProof] = useState('');
    const [renewalPeriod, setRenewalPeriod] = useState('yearly');
    const [nextRenewalDate, setNextRenewalDate] = useState('');
    const [notes, setNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!open || !row) return;
        setAmountPaid(row.amount ?? '');
        setCurrency(row.currency || 'INR');
        setPaymentMode('Card');
        setPaymentProof('');
        setRenewalPeriod(row.billing_cycle || 'yearly');
        setNextRenewalDate('');
        setNotes('');
    }, [open, row]);

    if (!open) return null;

    const handleConfirm = async () => {
        setSubmitting(true);
        try {
            await onConfirm(row, {
                amount_paid: amountPaid ? Number(amountPaid) : undefined,
                currency,
                payment_mode: paymentMode,
                payment_proof: paymentProof,
                renewal_period: renewalPeriod,
                next_renewal_date: renewalPeriod === 'custom' ? nextRenewalDate : undefined,
                notes,
            });
            onClose();
        } finally {
            setSubmitting(false);
        }
    };

    const isUtility = row?.type === 'utility';

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur flex items-center justify-center p-4">
            <div className="bg-dark-surface border border-dark-border rounded-2xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center">
                    <h3 className="text-xl font-bold text-white">{isUtility ? 'Record Bill Payment' : 'Record Renewal'}</h3>
                    <button className="text-slate-500 hover:text-white" onClick={onClose}><X size={20} /></button>
                </div>
                <p className="text-sm text-slate-400">
                    Recording payment details for <strong>{row?.name}</strong>.
                </p>

                <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <label className="text-xs text-slate-400">Amount Paid (Dynamic)</label>
                            <input type="number" className="input-field" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} placeholder="0.00" />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs text-slate-400">Currency</label>
                            <input type="text" className="input-field" value={currency} onChange={(e) => setCurrency(e.target.value)} />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs text-slate-400">Payment Mode</label>
                        <select className="input-field" value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
                            <option value="Card">Card</option>
                            <option value="UPI">UPI</option>
                            <option value="Bank Transfer">Bank Transfer</option>
                            <option value="Cash">Cash</option>
                            <option value="Net Banking">Net Banking</option>
                            <option value="Other">Other</option>
                        </select>
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs text-slate-400">Payment Proof (Reference/Txn ID)</label>
                        <input type="text" className="input-field" value={paymentProof} onChange={(e) => setPaymentProof(e.target.value)} placeholder="e.g. TXN10293847" />
                    </div>

                    {!isUtility && (
                        <div className="space-y-1">
                            <label className="text-xs text-slate-400">Renewal Period</label>
                            <select className="input-field" value={renewalPeriod} onChange={(e) => setRenewalPeriod(e.target.value)}>
                                <option value="none">None (Non-recursive)</option>
                                <option value="weekly">1 Week</option>
                                <option value="monthly">1 Month</option>
                                <option value="quarterly">3 Months (Quarterly)</option>
                                <option value="semi-annual">6 Months (Semi-Annual)</option>
                                <option value="yearly">1 Year (Yearly)</option>
                                <option value="custom">Custom Date</option>
                            </select>
                        </div>
                    )}

                    {renewalPeriod === 'custom' && !isUtility && (
                        <div className="space-y-1">
                            <label className="text-xs text-slate-400">Next Renewal Date</label>
                            <input type="date" className="input-field" value={nextRenewalDate} onChange={(e) => setNextRenewalDate(e.target.value)} />
                        </div>
                    )}

                    <div className="space-y-1">
                        <label className="text-xs text-slate-400">Notes / Remarks</label>
                        <textarea className="input-field h-20 resize-none" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes..." />
                    </div>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                    <button className="px-4 py-2 text-slate-400 hover:text-white" onClick={onClose}>Cancel</button>
                    <button disabled={submitting} className="btn-primary px-4 py-2" onClick={handleConfirm}>
                        {submitting ? 'Processing...' : (isUtility ? 'Confirm Payment' : 'Confirm Renewal')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export const Licenses = () => {
    const user = useAuthStore(state => state.user);
    const canViewUsers = hasPermission('users.view', user);
    const [items, setItems] = useState<any[]>([]);
    const [users, setUsers] = useState<Record<string, { name?: string; email?: string }>>({});
    const [stats, setStats] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<any>(null);
    const [notificationChannels, setNotificationChannels] = useState<NotificationChannelOption[]>([]);
    const [renewModal, setRenewModal] = useState<{ open: boolean, row?: any }>({ open: false });
    const [renewing, setRenewing] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

    const toggleRow = (id: string) => {
        const next = new Set(expandedRows);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setExpandedRows(next);
    };

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

    useEffect(() => {
        api.get('/notification-channels')
            .then((res) => {
                const rows = Array.isArray(res.data) ? res.data : [];
                setNotificationChannels(rows.filter((row: NotificationChannelOption) => row.enabled));
            })
            .catch((error) => {
                console.error('Failed to fetch notification channels for licenses', error);
                setNotificationChannels([]);
            });
    }, []);

    useEffect(() => {
        if (!canViewUsers) {
            setUsers({});
            return;
        }

        let isMounted = true;
        api.get('/users')
            .then((res) => {
                if (!isMounted) return;
                const rows = Array.isArray(res.data) ? res.data : [];
                const map = rows.reduce((acc: Record<string, { name?: string; email?: string }>, row: any) => {
                    const id = String(row.id || row._id || '').trim();
                    if (!id) return acc;
                    acc[id] = { name: row.name, email: row.email };
                    return acc;
                }, {});
                setUsers(map);
            })
            .catch((error) => {
                console.error('Failed to fetch users for license assignments', error);
                if (isMounted) setUsers({});
            });

        return () => {
            isMounted = false;
        };
    }, [canViewUsers]);

    const sorted = useMemo(() => {
        return [...items].sort((a, b) => Number(a.days_left || 0) - Number(b.days_left || 0));
    }, [items]);

    const remove = async (id: string) => {
        const confirmed = window.confirm('Delete this license/subscription item?');
        if (!confirmed) return;
        await api.delete(`/licenses/${id}`);
        fetchData();
    };

    const exportLicenses = async () => {
        try {
            setExporting(true);
            const response = await api.get('/licenses/export', { responseType: 'blob' });
            const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `licenses-${Date.now()}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Failed to export licenses', error);
            window.alert('Failed to export licenses.');
        } finally {
            setExporting(false);
        }
    };

    const handleMarkRenewed = async (row: any, paymentDetails: any) => {
        setRenewing(true);
        try {
            await api.post(`/licenses/${row._id}/mark-renewed`, paymentDetails);
            fetchData();
        } finally {
            setRenewing(false);
            setRenewModal({ open: false });
        }
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
                    <button className="icon-btn" disabled={exporting} onClick={exportLicenses} title="Export licenses CSV"><Download size={16} /></button>
                    <button className="icon-btn" onClick={fetchData}><RefreshCw size={16} /></button>
                    <button className="btn-primary flex items-center gap-2" onClick={() => { setEditing(null); setModalOpen(true); }}>
                        <Plus size={16} /> New Entry
                    </button>
                </div>
            </div>

            {stats && (
                <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
                    <div className="card"><div className="text-xs text-slate-400">Total</div><div className="text-xl font-bold text-white">{stats.total || 0}</div></div>
                    <div className="card"><div className="text-xs text-slate-400">OK</div><div className="text-xl font-bold text-emerald-400">{stats.ok || 0}</div></div>
                    <div className="card"><div className="text-xs text-slate-400">Warning</div><div className="text-xl font-bold text-amber-400">{stats.warning || 0}</div></div>
                    <div className="card"><div className="text-xs text-slate-400">Critical</div><div className="text-xl font-bold text-rose-400">{stats.critical || 0}</div></div>
                    <div className="card"><div className="text-xs text-slate-400">Expired</div><div className="text-xl font-bold text-red-400">{stats.expired || 0}</div></div>
                    <div className="card"><div className="text-xs text-slate-400">Paused</div><div className="text-xl font-bold text-slate-300">{stats.paused || 0}</div></div>
                    <div className="card">
                        <div className="text-xs text-slate-400">Renewal Amount (30d)</div>
                        <div className="text-sm font-bold text-cyan-300">{renderCurrencyTotals(stats.renewal_spend_30d?.totals_by_currency)}</div>
                        <div className="text-xs text-slate-500 mt-1">{stats.renewal_spend_30d?.count || 0} item(s)</div>
                    </div>
                    <div className="card">
                        <div className="text-xs text-slate-400">Renewal Amount (90d)</div>
                        <div className="text-sm font-bold text-cyan-300">{renderCurrencyTotals(stats.renewal_spend_90d?.totals_by_currency)}</div>
                        <div className="text-xs text-slate-500 mt-1">{stats.renewal_spend_90d?.count || 0} item(s)</div>
                    </div>
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
                            {sorted.map((row) => {
                                const isExpanded = expandedRows.has(row._id);
                                return (
                                    <React.Fragment key={row._id}>
                                        <tr className="border-b border-white/5">
                                            <td className="py-3 pr-3">
                                                <div className="flex items-center">
                                                    <button
                                                        onClick={() => toggleRow(row._id)}
                                                        className="mr-2 text-slate-500 hover:text-white transition-colors"
                                                    >
                                                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                                    </button>
                                                    <div>
                                                        <div className="text-white font-semibold">{row.name}</div>
                                                        <div className="text-xs text-slate-500">{row.vendor || 'N/A'} / {row.product || 'N/A'}</div>
                                                        <AssigneeBadges ids={row.assigned_user_ids} users={users} className="mt-1" />
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="py-3 pr-3 text-slate-300">
                                                <span className="uppercase text-xs font-semibold px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                                                    {String(row.type || 'subscription').toUpperCase()}
                                                </span>
                                            </td>
                                            <td className="py-3 pr-3 text-slate-300">{row.owner || 'N/A'}</td>
                                            <td className="py-3 pr-3 text-slate-300">
                                                {row.billing_cycle === 'none' ? 'Non-recursive' : (row.renewal_date ? new Date(row.renewal_date).toLocaleDateString() : 'N/A')}
                                            </td>
                                            <td className="py-3 pr-3 text-slate-300">{row.billing_cycle === 'none' ? 'N/A' : (row.days_left ?? 'N/A')}</td>
                                            <td className="py-3 pr-3">
                                                <span className={`text-xs px-2 py-0.5 rounded ${stateClass(row.status === 'paused' ? 'paused' : (row.billing_cycle === 'none' ? 'ok' : row.computed_state))}`}>
                                                    {String(row.status === 'paused' ? 'paused' : (row.billing_cycle === 'none' ? 'ok' : row.computed_state || 'unknown')).toUpperCase()}
                                                </span>
                                            </td>
                                            <td className="py-3 pr-3">
                                                <div className="flex gap-2">
                                                    <button className="icon-btn" onClick={() => { setEditing(row); setModalOpen(true); }}><Edit3 size={14} /></button>
                                                    <button className="icon-btn text-red-400" onClick={() => remove(row._id)}><Trash2 size={14} /></button>
                                                    {row.status !== 'paused' && (row.billing_cycle !== 'none' || row.type === 'utility') && (
                                                        <button
                                                            className="icon-btn text-emerald-400"
                                                            title={row.type === 'utility' ? "Mark as Paid" : "Mark as Renewed"}
                                                            onClick={() => setRenewModal({ open: true, row })}
                                                            disabled={renewing}
                                                        >
                                                            <RefreshCw size={14} />
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                        {isExpanded && (
                                            <tr className="bg-white/[0.01]">
                                                <td colSpan={7} className="px-6 py-4 border-b border-white/5">
                                                    <div className="space-y-4 text-xs text-slate-300">
                                                        {row.type === 'license' && (
                                                            <div className="grid grid-cols-3 gap-4 border-b border-white/5 pb-3">
                                                                <div>
                                                                    <span className="text-slate-500 font-semibold block uppercase text-[9px] tracking-wider">Total Seats</span>
                                                                    <span className="text-sm font-bold text-white">{row.seats_total ?? 0}</span>
                                                                </div>
                                                                <div>
                                                                    <span className="text-slate-500 font-semibold block uppercase text-[9px] tracking-wider">Used Seats</span>
                                                                    <span className="text-sm font-bold text-amber-400">{row.seats_used ?? 0}</span>
                                                                </div>
                                                                <div>
                                                                    <span className="text-slate-500 font-semibold block uppercase text-[9px] tracking-wider">Free Seats</span>
                                                                    <span className="text-sm font-bold text-emerald-400">
                                                                        {Math.max(0, (row.seats_total ?? 0) - (row.seats_used ?? 0))}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        )}
                                                        <div>
                                                            <div className="flex justify-between items-center mb-2">
                                                                <span className="text-xs font-bold text-white uppercase tracking-wider">Payment & Transaction History</span>
                                                                <span className="text-[10px] text-slate-500">Plan Amount: {row.amount ? `${row.currency || 'INR'} ${row.amount}` : 'N/A'} | Cycle: <strong className="uppercase">{row.billing_cycle || 'N/A'}</strong></span>
                                                            </div>
                                                            {Array.isArray(row.payment_history) && row.payment_history.length > 0 ? (
                                                                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                                                                    {row.payment_history.map((payment: any, index: number) => (
                                                                        <div key={index} className="flex justify-between items-center bg-black/20 p-3 rounded-xl border border-white/5">
                                                                            <div>
                                                                                <div className="font-semibold text-white">
                                                                                    {payment.payment_mode} Payment — {payment.amount_paid} {payment.currency}
                                                                                </div>
                                                                                {payment.payment_proof && (
                                                                                    <div className="text-[10px] text-slate-500 font-mono mt-0.5">Reference/Proof: {payment.payment_proof}</div>
                                                                                )}
                                                                                {payment.notes && (
                                                                                    <div className="text-[10px] text-slate-400 mt-1">{payment.notes}</div>
                                                                                )}
                                                                            </div>
                                                                            <div className="text-right text-[10px] text-slate-500">
                                                                                <div>Paid on: {new Date(payment.paid_at).toLocaleDateString()}</div>
                                                                                {payment.next_renewal_date && (
                                                                                    <div className="text-slate-400 mt-0.5">Extended to: {new Date(payment.next_renewal_date).toLocaleDateString()}</div>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            ) : (
                                                                <p className="text-slate-500 italic">No payments logged yet.</p>
                                                            )}
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                            {!loading && sorted.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="py-6 text-slate-400">No license/subscription/bill items found.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                )}
            </div>

            <LicenseModal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                onSaved={fetchData}
                initial={editing}
                availableChannels={notificationChannels}
            />

            <RenewPaymentModal
                open={renewModal.open}
                onClose={() => setRenewModal({ open: false })}
                onConfirm={handleMarkRenewed}
                row={renewModal.row}
            />
        </div>
    );
};
