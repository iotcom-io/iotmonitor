import React, { useEffect, useMemo, useState } from 'react';
import api from '../lib/axios';
import { Globe, Plus, RefreshCw, X, Pause, Play, Trash2, Edit3, PlayCircle, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { useAuthStore } from '../store/useAuthStore';
import { hasPermission } from '../lib/permissions';
import { AssigneeBadges } from '../components/AssigneeBadges';

const typeLabels: Record<string, string> = {
    http: 'Website/API',
    ssl: 'SSL',
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

const supportsRequestBody = (method: string) => ['POST', 'PUT', 'PATCH'].includes(String(method || '').toUpperCase());
const supportsOptionalRequestBody = (method: string) => ['DELETE'].includes(String(method || '').toUpperCase());

const toHeadersText = (headers: any) => {
    if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return '';
    try {
        return JSON.stringify(headers, null, 2);
    } catch {
        return '';
    }
};

const progressClass = (pct: number) => {
    if (pct >= 99) return 'bg-emerald-500';
    if (pct >= 95) return 'bg-amber-500';
    return 'bg-red-500';
};

const describeHttpState = (check: any) => {
    if (check.type === 'ssl') return null;

    const statusCode = Number(check.last_response_status);
    const responseMs = Number(check.last_response_time_ms);

    if (Number.isFinite(statusCode) && statusCode > 0) {
        if (Number.isFinite(responseMs) && responseMs >= 0) {
            return `Status ${statusCode} in ${Math.round(responseMs)}ms`;
        }
        return `Status ${statusCode}`;
    }

    if (check.last_message) {
        return String(check.last_message);
    }

    return 'Awaiting first check';
};

const describeSslState = (check: any) => {
    if (!(check.type === 'ssl' || check.ssl_enabled)) return null;

    const rawState = String(check.ssl_last_state || '').toLowerCase();
    const expiryDate = check.ssl_expiry_at ? new Date(check.ssl_expiry_at) : null;
    const hasValidExpiry = Boolean(expiryDate && !Number.isNaN(expiryDate.getTime()));
    const daysToExpiry = hasValidExpiry
        ? Math.floor((((expiryDate as Date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
        : null;

    if (rawState === 'expired') {
        return 'Expired';
    }

    if (hasValidExpiry && daysToExpiry !== null) {
        if (daysToExpiry < 0) {
            return `Expired ${Math.abs(daysToExpiry)} day(s) ago`;
        }
        if (rawState === 'critical') {
            return `Critical: expires in ${daysToExpiry} day(s)`;
        }
        if (rawState === 'warning') {
            return `Warning: expires in ${daysToExpiry} day(s)`;
        }
        return `Valid for ${daysToExpiry} day(s)`;
    }

    if (rawState === 'critical') return 'Critical';
    if (rawState === 'warning') return 'Warning';
    if (rawState === 'ok') return 'Healthy';
    return 'Awaiting first SSL check';
};

const NewCheckModal = ({ isOpen, onClose, onSaved, initial }: any) => {
    const blank = {
        name: '',
        target_kind: 'website',
        type: 'http',
        ssl_enabled: false,
        url: '',
        method: 'GET',
        headers_text: '',
        body: '',
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
    const [requestConfigError, setRequestConfigError] = useState('');

    useEffect(() => {
        const source = initial || blank;
        setForm({
            ...source,
            method: String(source.method || 'GET').toUpperCase(),
            headers_text: toHeadersText(source.headers),
            body: source.body || '',
            expected_status_codes: Array.isArray(source.expected_status_codes)
                ? source.expected_status_codes
                : (source.expected_status ? [source.expected_status] : [200]),
            response_match_type: source.response_match_type || 'contains',
            target_kind: source.target_kind || 'website',
            ssl_enabled: Boolean(source.ssl_enabled),
            max_response_time_ms: source.max_response_time_ms ?? '',
            ssl_expiry_days: source.ssl_expiry_days ?? 7,
        });
        setRequestConfigError('');
    }, [initial, isOpen]);

    const expectedStatusInput = useMemo(() => {
        return Array.isArray(form.expected_status_codes) && form.expected_status_codes.length > 0
            ? form.expected_status_codes.join(', ')
            : '200';
    }, [form.expected_status_codes]);

    const save = async () => {
        setSaving(true);
        try {
            const method = String(form.method || 'GET').toUpperCase();
            const headersText = String(form.headers_text || '').trim();
            let headers: Record<string, string> | undefined;

            if (headersText) {
                try {
                    const parsed = JSON.parse(headersText);
                    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                        setRequestConfigError('Headers must be a valid JSON object.');
                        return;
                    }

                    headers = Object.entries(parsed).reduce((acc: Record<string, string>, [key, value]) => {
                        const normalizedKey = String(key || '').trim();
                        if (normalizedKey) acc[normalizedKey] = String(value ?? '');
                        return acc;
                    }, {});
                } catch {
                    setRequestConfigError('Invalid headers JSON. Use object format like {"Authorization":"Bearer ..."}');
                    return;
                }
            }

            setRequestConfigError('');
            const payload: any = {
                ...form,
                method,
                expected_status_codes: normalizeStatusCodes(
                    Array.isArray(form.expected_status_codes)
                        ? form.expected_status_codes.join(',')
                        : String(form.expected_status_codes || '200')
                ),
                response_match_value: String(form.response_match_value || '').trim(),
                ssl_enabled: form.type === 'ssl' ? true : Boolean(form.ssl_enabled),
                max_response_time_ms: String(form.max_response_time_ms || '').trim()
                    ? Number(form.max_response_time_ms)
                    : undefined,
                ssl_expiry_days: Number(form.ssl_expiry_days || 7),
                headers,
            };

            if (payload.expected_status_codes.length === 0) {
                payload.expected_status_codes = [200];
            }

            const bodyText = String(form.body || '').trim();
            if (supportsRequestBody(method) || (supportsOptionalRequestBody(method) && bodyText)) {
                payload.body = bodyText;
            } else {
                delete payload.body;
            }

            if (payload.type === 'ssl') {
                delete payload.method;
                delete payload.headers;
                delete payload.body;
                delete payload.expected_status_codes;
                delete payload.response_match_type;
                delete payload.response_match_value;
                delete payload.max_response_time_ms;
            }

            delete payload.headers_text;

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
                            <label className="text-sm text-slate-400">Primary Check Type</label>
                            <select className="input-field" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                                <option value="http">Website/API Uptime</option>
                                <option value="ssl">SSL Expiry Only</option>
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
                                    <option value="HEAD">HEAD</option>
                                    <option value="OPTIONS">OPTIONS</option>
                                </select>
                            </div>
                        )}
                    </div>

                    {form.type === 'http' && (
                        <label className="flex items-center gap-3 rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
                            <input
                                type="checkbox"
                                checked={Boolean(form.ssl_enabled)}
                                onChange={(e) => setForm({ ...form, ssl_enabled: e.target.checked })}
                            />
                            Enable SSL monitoring in this same monitor
                        </label>
                    )}

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

                            <div className="space-y-2">
                                <label className="text-sm text-slate-400">Request Headers (JSON, optional)</label>
                                <textarea
                                    className="input-field min-h-[100px] font-mono text-xs"
                                    value={form.headers_text || ''}
                                    onChange={(e) => setForm({ ...form, headers_text: e.target.value })}
                                    placeholder='{"Content-Type":"application/json","Authorization":"Bearer ..."}'
                                />
                            </div>

                            {(supportsRequestBody(form.method) || supportsOptionalRequestBody(form.method)) && (
                                <div className="space-y-2">
                                    <label className="text-sm text-slate-400">
                                        {supportsRequestBody(form.method) ? 'Request Payload' : 'Request Payload (optional for DELETE)'}
                                    </label>
                                    <textarea
                                        className="input-field min-h-[120px] font-mono text-xs"
                                        value={form.body || ''}
                                        onChange={(e) => setForm({ ...form, body: e.target.value })}
                                        placeholder='{"ping":"ok"}'
                                    />
                                </div>
                            )}
                        </>
                    ) : null}

                    {requestConfigError && (
                        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                            {requestConfigError}
                        </div>
                    )}

                    {(form.type === 'ssl' || Boolean(form.ssl_enabled)) && (
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
    const navigate = useNavigate();
    const user = useAuthStore(state => state.user);
    const [checks, setChecks] = useState<any[]>([]);
    const [users, setUsers] = useState<Record<string, { name?: string; email?: string }>>({});
    const [stats, setStats] = useState<Record<string, any>>({});
    const [summary, setSummary] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<any>(null);
    const [windowHours, setWindowHours] = useState<number>(24);

    const fetchChecks = async () => {
        setLoading(true);
        try {
            const [checksRes, statsRes] = await Promise.all([
                api.get('/synthetics'),
                api.get('/synthetics/stats', { params: { window_hours: windowHours } }),
            ]);
            setChecks(checksRes.data || []);

            const statMap: Record<string, any> = {};
            (statsRes.data?.monitors || []).forEach((item: any) => {
                statMap[item.check_id] = item;
            });
            setStats(statMap);
            setSummary(statsRes.data?.summary || null);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchChecks(); }, [windowHours]);

    const runNow = async (id: string) => {
        await api.post(`/synthetics/${id}/run`);
        await fetchChecks();
    };

    const canCreate = hasPermission('synthetics.create', user);
    const canUpdate = hasPermission('synthetics.update', user);
    const canDelete = hasPermission('synthetics.delete', user);
    const canRun = hasPermission('synthetics.run', user);
    const canViewUsers = hasPermission('users.view', user);

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
                console.error('Failed to fetch users for monitor assignments', error);
                if (isMounted) setUsers({});
            });

        return () => {
            isMounted = false;
        };
    }, [canViewUsers]);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Globe className="text-primary-400" />
                    <div>
                        <h2 className="text-2xl font-bold text-white">Web Monitoring</h2>
                        <p className="text-slate-500 text-sm">Website/API uptime, response validation, SSL monitoring, and incident tracking</p>
                    </div>
                </div>
                <div className="flex gap-2 items-center">
                    <select
                        className="input-field w-36"
                        value={windowHours}
                        onChange={(e) => setWindowHours(parseInt(e.target.value, 10))}
                    >
                        <option value={24}>Last 24h</option>
                        <option value={72}>Last 72h</option>
                        <option value={168}>Last 7d</option>
                    </select>
                    <button className="icon-btn" onClick={fetchChecks}><RefreshCw size={18} /></button>
                    {canCreate && (
                        <button className="btn-primary flex items-center gap-2" onClick={() => { setEditing(null); setModalOpen(true); }}>
                            <Plus size={16} /> New Monitor
                        </button>
                    )}
                </div>
            </div>

            {summary && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <div className="card"><div className="text-xs text-slate-400">Total</div><div className="text-xl font-bold text-white">{summary.total_monitors || 0}</div></div>
                    <div className="card"><div className="text-xs text-slate-400">Healthy</div><div className="text-xl font-bold text-emerald-400">{summary.healthy || 0}</div></div>
                    <div className="card"><div className="text-xs text-slate-400">Degraded</div><div className="text-xl font-bold text-amber-400">{summary.degraded || 0}</div></div>
                    <div className="card"><div className="text-xs text-slate-400">Down</div><div className="text-xl font-bold text-red-400">{summary.down || 0}</div></div>
                    <div className="card"><div className="text-xs text-slate-400">Avg Uptime</div><div className="text-xl font-bold text-cyan-400">{summary.avg_uptime_pct?.toFixed ? summary.avg_uptime_pct.toFixed(2) : summary.avg_uptime_pct}%</div></div>
                </div>
            )}

            {loading ? (
                <div className="card">Loading...</div>
            ) : (
                <div className="card overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead>
                            <tr className="text-left text-slate-400 border-b border-white/10">
                                <th className="py-3 pr-3">Monitor</th>
                                <th className="py-3 pr-3">Type</th>
                                <th className="py-3 pr-3">Current</th>
                                <th className="py-3 pr-3">Uptime / Outage</th>
                                <th className="py-3 pr-3">Last Check</th>
                                <th className="py-3 pr-3">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {checks.map((c) => {
                                const st = stats[c._id] || {};
                                const uptimePct = Number(st.uptime_pct ?? 100);
                                const state = st.state || (c.last_status === 'fail' ? 'down' : 'healthy');
                                const httpState = describeHttpState(c);
                                const sslState = describeSslState(c);

                                return (
                                    <tr key={c._id} className="border-b border-white/5 align-top">
                                        <td className="py-3 pr-3 min-w-[260px]">
                                            <div className="font-semibold text-white">{c.name}</div>
                                            <div className="text-xs text-slate-400 break-all">{c.url}</div>
                                            <AssigneeBadges ids={c.assigned_user_ids} users={users} className="mt-1" />
                                            {!c.enabled && <div className="text-xs text-amber-300 mt-1">Paused</div>}
                                        </td>
                                        <td className="py-3 pr-3">
                                            <div className="flex flex-col gap-1 text-xs">
                                                <span className="px-2 py-0.5 rounded bg-white/5 inline-block w-fit">{kindLabels[c.target_kind] || 'Website'}</span>
                                                <span className="px-2 py-0.5 rounded bg-white/5 inline-block w-fit">{typeLabels[c.type] || c.type}</span>
                                                {c.type === 'http' && c.ssl_enabled && <span className="px-2 py-0.5 rounded bg-white/5 inline-block w-fit">SSL</span>}
                                            </div>
                                        </td>
                                        <td className="py-3 pr-3">
                                            <span className={clsx(
                                                'px-2 py-0.5 rounded text-xs font-bold',
                                                state === 'healthy' ? 'bg-emerald-500/20 text-emerald-300' : state === 'degraded' ? 'bg-amber-500/20 text-amber-300' : 'bg-red-500/20 text-red-300'
                                            )}>{state.toUpperCase()}</span>
                                            <div className="text-xs text-slate-400 mt-1 space-y-1">
                                                {httpState && <div>HTTP: {httpState}</div>}
                                                {sslState && <div>SSL: {sslState}</div>}
                                                {!httpState && !sslState && <div>{c.last_message || '—'}</div>}
                                            </div>
                                        </td>
                                        <td className="py-3 pr-3 min-w-[280px]">
                                            <div className="text-xs text-slate-300 mb-1">Uptime {uptimePct.toFixed(2)}%</div>
                                            <div className="w-full h-2 bg-slate-700 rounded overflow-hidden">
                                                <div className={`${progressClass(uptimePct)} h-2`} style={{ width: `${Math.max(0, Math.min(100, uptimePct))}%` }} />
                                            </div>
                                            <div className="text-xs text-slate-500 mt-1">
                                                Outage: {st.outage_duration_text || '0s'} | Events: {st.outage_count || 0}
                                            </div>
                                            {st.latest_outage && (
                                                <div className="text-xs text-slate-500">Latest outage: {st.latest_outage.duration_text}{st.latest_outage.ongoing ? ' (ongoing)' : ''}</div>
                                            )}
                                        </td>
                                        <td className="py-3 pr-3">
                                            <div className="text-xs text-slate-300">{c.last_run ? new Date(c.last_run).toLocaleString() : 'never'}</div>
                                            <div className="text-xs text-slate-500">Interval {c.interval || 300}s</div>
                                        </td>
                                        <td className="py-3 pr-3">
                                            <div className="flex flex-wrap gap-2">
                                                {canRun && <button className="icon-btn" title="Run now" onClick={() => runNow(c._id)}><PlayCircle size={14} /></button>}
                                                {canUpdate && <button className="icon-btn" title={c.enabled ? 'Pause' : 'Resume'} onClick={async () => { await api.put(`/synthetics/${c._id}`, { enabled: !c.enabled }); fetchChecks(); }}>{c.enabled ? <Pause size={14} /> : <Play size={14} />}</button>}
                                                {canUpdate && <button className="icon-btn" title="Edit" onClick={() => { setEditing(c); setModalOpen(true); }}><Edit3 size={14} /></button>}
                                                <button className="icon-btn" title="View incidents" onClick={() => navigate(`/incidents?target_id=${encodeURIComponent(c._id)}&target_type=synthetic`)}><ExternalLink size={14} /></button>
                                                {canDelete && <button className="icon-btn text-red-400" title="Delete" onClick={async () => { await api.delete(`/synthetics/${c._id}`); fetchChecks(); }}><Trash2 size={14} /></button>}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                            {checks.length === 0 && (
                                <tr>
                                    <td className="py-6 text-slate-400" colSpan={6}>No monitors found. Create a website/API monitor.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            <NewCheckModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onSaved={fetchChecks} initial={editing} />
        </div>
    );
};

