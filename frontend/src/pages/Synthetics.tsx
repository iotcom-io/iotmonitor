import React, { useEffect, useMemo, useState } from 'react';
import api from '../lib/axios';
import { Globe, Plus, RefreshCw, X, Pause, Play, Trash2, Edit3 } from 'lucide-react';

const typeLabels: Record<string, string> = {
    http: 'Website/API Uptime',
    ssl: 'SSL Certificate',
};

const kindLabels: Record<string, string> = {
    website: 'Website',
    api: 'API',
};

const normalizeStatusCodes = (raw: string) => {
    const values = raw
        .split(',')
        .map((part) => Number(part.trim()))
        .filter((num) => Number.isFinite(num) && num > 0);
    return Array.from(new Set(values));
};

const NewCheckModal = ({ isOpen, onClose, onSaved, initial }: any) => {
    const blank = {
        name: '',
        target_kind: 'website',
        type: 'http',
        url: '',
        method: 'GET',
        interval: 300,
        timeout: 8000,
        expected_status_codes: [200],
        response_match_type: 'contains',
        response_match_value: '',
        max_response_time_ms: '',
        ssl_expiry_days: 7,
        channels: ['slack'],
        slack_webhook_name: '',
        custom_webhook_name: '',
    };

    const [form, setForm] = useState<any>(initial || blank);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const source = initial || blank;
        setForm({
            ...source,
            expected_status_codes: Array.isArray(source.expected_status_codes)
                ? source.expected_status_codes
                : (source.expected_status ? [source.expected_status] : [200]),
            response_match_type: source.response_match_type || 'contains',
            target_kind: source.target_kind || 'website',
            max_response_time_ms: source.max_response_time_ms ?? '',
            ssl_expiry_days: source.ssl_expiry_days ?? 7,
        });
    }, [initial, isOpen]);

    const expectedStatusInput = useMemo(() => {
        return Array.isArray(form.expected_status_codes) && form.expected_status_codes.length > 0
            ? form.expected_status_codes.join(', ')
            : '200';
    }, [form.expected_status_codes]);

    const save = async () => {
        setSaving(true);
        try {
            const payload: any = {
                ...form,
                expected_status_codes: normalizeStatusCodes(
                    Array.isArray(form.expected_status_codes)
                        ? form.expected_status_codes.join(',')
                        : String(form.expected_status_codes || '200')
                ),
                response_match_value: String(form.response_match_value || '').trim(),
                max_response_time_ms: String(form.max_response_time_ms || '').trim()
                    ? Number(form.max_response_time_ms)
                    : undefined,
                ssl_expiry_days: Number(form.ssl_expiry_days || 7),
            };

            if (payload.expected_status_codes.length === 0) {
                payload.expected_status_codes = [200];
            }

            if (payload.type === 'ssl') {
                delete payload.method;
                delete payload.expected_status_codes;
                delete payload.response_match_type;
                delete payload.response_match_value;
                delete payload.max_response_time_ms;
            }

            if (form._id) {
                await api.put(`/synthetics/${form._id}`, payload);
            } else {
                await api.post('/synthetics', payload);
            }

            onSaved();
            onClose();
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur flex items-center justify-center p-4">
            <div className="bg-dark-surface border border-dark-border rounded-2xl w-full max-w-3xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center">
                    <h3 className="text-xl font-bold text-white">{form._id ? 'Edit Web Monitor' : 'New Web Monitor'}</h3>
                    <button className="text-slate-500 hover:text-white" onClick={onClose}><X size={20} /></button>
                </div>

                <div className="space-y-4">
                    <div className="grid md:grid-cols-2 gap-3">
                        <div className="space-y-2">
                            <label className="text-sm text-slate-400">Monitor Name</label>
                            <input className="input-field" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm text-slate-400">URL</label>
                            <input className="input-field" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://example.com/health" />
                        </div>
                    </div>

                    <div className="grid md:grid-cols-3 gap-3">
                        <div className="space-y-2">
                            <label className="text-sm text-slate-400">Target Type</label>
                            <select className="input-field" value={form.target_kind} onChange={e => setForm({ ...form, target_kind: e.target.value })}>
                                <option value="website">Website</option>
                                <option value="api">API</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm text-slate-400">Check Type</label>
                            <select className="input-field" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                                <option value="http">Website/API Uptime</option>
                                <option value="ssl">SSL Expiry</option>
                            </select>
                        </div>
                        {form.type === 'http' && (
                            <div className="space-y-2">
                                <label className="text-sm text-slate-400">HTTP Method</label>
                                <select className="input-field" value={form.method} onChange={e => setForm({ ...form, method: e.target.value })}>
                                    <option value="GET">GET</option>
                                    <option value="POST">POST</option>
                                    <option value="PUT">PUT</option>
                                    <option value="PATCH">PATCH</option>
                                    <option value="DELETE">DELETE</option>
                                </select>
                            </div>
                        )}
                    </div>

                    {form.type === 'http' ? (
                        <>
                            <div className="grid md:grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <label className="text-sm text-slate-400">Expected Status Codes (comma-separated)</label>
                                    <input
                                        className="input-field"
                                        value={expectedStatusInput}
                                        onChange={e => setForm({ ...form, expected_status_codes: normalizeStatusCodes(e.target.value) })}
                                        placeholder="200, 204"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm text-slate-400">Max Response Time (ms, optional)</label>
                                    <input
                                        className="input-field"
                                        type="number"
                                        value={form.max_response_time_ms}
                                        onChange={e => setForm({ ...form, max_response_time_ms: e.target.value })}
                                        placeholder="1500"
                                    />
                                </div>
                            </div>

                            <div className="grid md:grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <label className="text-sm text-slate-400">Response Match Type</label>
                                    <select
                                        className="input-field"
                                        value={form.response_match_type}
                                        onChange={e => setForm({ ...form, response_match_type: e.target.value })}
                                    >
                                        <option value="contains">Contains</option>
                                        <option value="exact">Exact</option>
                                        <option value="regex">Regex</option>
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm text-slate-400">Expected Response Snippet (optional)</label>
                                    <input
                                        className="input-field"
                                        value={form.response_match_value || ''}
                                        onChange={e => setForm({ ...form, response_match_value: e.target.value })}
                                        placeholder="e.g. status:ok"
                                    />
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="grid md:grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <label className="text-sm text-slate-400">SSL Warning Threshold (days)</label>
                                <input
                                    className="input-field"
                                    type="number"
                                    min="1"
                                    value={form.ssl_expiry_days}
                                    onChange={e => setForm({ ...form, ssl_expiry_days: parseInt(e.target.value || '7', 10) })}
                                />
                            </div>
                            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-200">
                                SSL policy:
                                <div>- Daily reminders when expiry is within 7 days</div>
                                <div>- Hourly reminders when expiry is within 1 day</div>
                                <div>- Weekly SSL summary every Friday</div>
                            </div>
                        </div>
                    )}

                    <div className="grid md:grid-cols-2 gap-3">
                        <div>
                            <label className="text-sm text-slate-400">Interval (seconds)</label>
                            <input className="input-field" type="number" value={form.interval} onChange={e => setForm({ ...form, interval: parseInt(e.target.value || '300', 10) })} />
                        </div>
                        <div>
                            <label className="text-sm text-slate-400">Timeout (ms)</label>
                            <input className="input-field" type="number" value={form.timeout} onChange={e => setForm({ ...form, timeout: parseInt(e.target.value || '8000', 10) })} />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Notification Channels</label>
                        <div className="flex gap-3 text-sm text-white">
                            {['slack', 'email', 'custom'].map(ch => (
                                <label key={ch} className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={(form.channels || []).includes(ch)}
                                        onChange={e => {
                                            const set = new Set(form.channels || []);
                                            e.target.checked ? set.add(ch) : set.delete(ch);
                                            setForm({ ...form, channels: Array.from(set) });
                                        }}
                                    />
                                    {ch.toUpperCase()}
                                </label>
                            ))}
                        </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-3">
                        <div className="space-y-2">
                            <label className="text-sm text-slate-400">Slack Webhook Group (optional)</label>
                            <input className="input-field" value={form.slack_webhook_name || ''} onChange={e => setForm({ ...form, slack_webhook_name: e.target.value })} placeholder="matches Settings group name" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm text-slate-400">Custom Webhook Name (optional)</label>
                            <input className="input-field" value={form.custom_webhook_name || ''} onChange={e => setForm({ ...form, custom_webhook_name: e.target.value })} placeholder="matches Settings custom webhook name" />
                        </div>
                    </div>
                </div>

                <div className="flex justify-end gap-3">
                    <button className="px-4 py-2 text-slate-400 hover:text-white" onClick={onClose}>Cancel</button>
                    <button disabled={saving} className="btn-primary px-4 py-2" onClick={save}>{saving ? 'Saving...' : 'Save Monitor'}</button>
                </div>
            </div>
        </div>
    );
};

export const Synthetics = () => {
    const [checks, setChecks] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<any>(null);

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
                        <h2 className="text-2xl font-bold text-white">Web Monitoring</h2>
                        <p className="text-slate-500 text-sm">Website/API uptime, response validation, and SSL expiry monitoring</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button className="icon-btn" onClick={fetchChecks}><RefreshCw size={18} /></button>
                    <button className="btn-primary flex items-center gap-2" onClick={() => { setEditing(null); setModalOpen(true); }}>
                        <Plus size={16} /> New Monitor
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="card">Loading...</div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {checks.map((c) => {
                        const statusClass = c.last_status === 'ok'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : c.last_status === 'fail'
                                ? 'bg-red-500/20 text-red-300'
                                : 'bg-slate-500/20 text-slate-300';

                        return (
                            <div key={c._id} className="card border border-white/10 space-y-2">
                                <div className="flex justify-between items-center mb-2">
                                    <h3 className="text-lg font-bold text-white">{c.name}</h3>
                                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${statusClass}`}>
                                        {c.last_status || 'new'}
                                    </span>
                                </div>
                                <p className="text-slate-400 text-sm break-words">{c.url}</p>
                                <div className="flex items-center gap-2 text-xs text-slate-400">
                                    <span className="px-2 py-0.5 rounded bg-white/5">{kindLabels[c.target_kind] || 'Website'}</span>
                                    <span className="px-2 py-0.5 rounded bg-white/5">{typeLabels[c.type] || c.type}</span>
                                    {!c.enabled && <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">Paused</span>}
                                </div>

                                {c.type === 'http' ? (
                                    <div className="text-xs text-slate-500">
                                        <div>Expected Status: {(c.expected_status_codes || [c.expected_status || 200]).join(', ')}</div>
                                        {c.response_match_value && (
                                            <div>Response Rule: {c.response_match_type || 'contains'} "{c.response_match_value}"</div>
                                        )}
                                        {c.max_response_time_ms && <div>Max Latency: {c.max_response_time_ms}ms</div>}
                                        {c.last_response_status !== undefined && <div>Last HTTP Status: {c.last_response_status}</div>}
                                        {c.last_response_time_ms !== undefined && <div>Last Response Time: {c.last_response_time_ms}ms</div>}
                                    </div>
                                ) : (
                                    <div className="text-xs text-slate-500">
                                        <div>Warning Threshold: {c.ssl_expiry_days || 7} day(s)</div>
                                        {c.ssl_expiry_at && <div>Certificate Expiry: {new Date(c.ssl_expiry_at).toLocaleString()}</div>}
                                        {c.ssl_last_state && <div>Current SSL State: {c.ssl_last_state}</div>}
                                    </div>
                                )}

                                <p className="text-slate-500 text-xs">Interval: {c.interval || 300}s | Timeout: {c.timeout || 8000}ms</p>
                                <p className="text-slate-500 text-xs">Last: {c.last_run ? new Date(c.last_run).toLocaleTimeString() : 'never'} | {c.last_message || ''}</p>

                                <div className="flex gap-2 pt-2">
                                    <button className="icon-btn" onClick={async () => {
                                        await api.put(`/synthetics/${c._id}`, { enabled: !c.enabled });
                                        fetchChecks();
                                    }}>{c.enabled ? <Pause size={14} /> : <Play size={14} />}</button>
                                    <button className="icon-btn" onClick={() => { setEditing(c); setModalOpen(true); }}><Edit3 size={14} /></button>
                                    <button className="icon-btn text-red-400" onClick={async () => {
                                        await api.delete(`/synthetics/${c._id}`);
                                        fetchChecks();
                                    }}><Trash2 size={14} /></button>
                                </div>
                            </div>
                        );
                    })}
                    {checks.length === 0 && (
                        <div className="card text-slate-400">
                            No monitors found. Create a website/API or SSL monitor.
                        </div>
                    )}
                </div>
            )}

            <NewCheckModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onSaved={fetchChecks} initial={editing} />
        </div>
    );
};
