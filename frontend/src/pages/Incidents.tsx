import React, { useEffect, useMemo, useState } from 'react';
import api from '../lib/axios';
import { ShieldCheck, RefreshCw, Search, Filter, CheckCircle2, Download } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';
import { hasPermission } from '../lib/permissions';
import { AssigneeBadges } from '../components/AssigneeBadges';

const PAGE_SIZE = 25;

const formatDate = (value?: string) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
};

export const Incidents = () => {
    const [searchParams] = useSearchParams();
    const user = useAuthStore(state => state.user);
    const canViewUsers = hasPermission('users.view', user);

    const [activeIncidents, setActiveIncidents] = useState<any[]>([]);
    const [incidents, setIncidents] = useState<any[]>([]);
    const [users, setUsers] = useState<Record<string, { name?: string; email?: string }>>({});
    const [loading, setLoading] = useState(true);
    const [activeLoading, setActiveLoading] = useState(true);
    const [total, setTotal] = useState(0);
    const [exporting, setExporting] = useState(false);

    const [query, setQuery] = useState(searchParams.get('q') || '');
    const [status, setStatus] = useState(searchParams.get('status') || 'all');
    const [targetType, setTargetType] = useState(searchParams.get('target_type') || 'all');
    const [severity, setSeverity] = useState(searchParams.get('severity') || 'all');
    const [targetId, setTargetId] = useState(searchParams.get('target_id') || '');
    const [fromDate, setFromDate] = useState(searchParams.get('from') || '');
    const [toDate, setToDate] = useState(searchParams.get('to') || '');
    const [page, setPage] = useState(1);

    const fetchIncidents = async () => {
        setLoading(true);
        try {
            const params: any = {
                limit: PAGE_SIZE,
                skip: (page - 1) * PAGE_SIZE,
            };

            if (query.trim()) params.q = query.trim();
            if (status !== 'all') params.status = status;
            if (targetType !== 'all') params.target_type = targetType;
            if (severity !== 'all') params.severity = severity;
            if (targetId.trim()) params.target_id = targetId.trim();
            if (fromDate) params.from = fromDate;
            if (toDate) params.to = toDate;

            const res = await api.get('/incidents', { params });
            const totalCount = Number(res.headers['x-total-count'] || res.headers['X-Total-Count'] || res.data?.length || 0);
            setIncidents(Array.isArray(res.data) ? res.data : []);
            setTotal(totalCount);
        } finally {
            setLoading(false);
        }
    };

    const fetchActiveIncidents = async () => {
        setActiveLoading(true);
        try {
            const res = await api.get('/incidents', { params: { status: 'open', limit: 50, skip: 0 } });
            setActiveIncidents(Array.isArray(res.data) ? res.data : []);
        } finally {
            setActiveLoading(false);
        }
    };

    const resolve = async (id: string) => {
        await api.post(`/incidents/${id}/resolve`);
        fetchIncidents();
        fetchActiveIncidents();
    };

    const exportIncidents = async () => {
        try {
            setExporting(true);
            const params: any = { limit: 10000 };
            if (query.trim()) params.q = query.trim();
            if (status !== 'all') params.status = status;
            if (targetType !== 'all') params.target_type = targetType;
            if (severity !== 'all') params.severity = severity;
            if (targetId.trim()) params.target_id = targetId.trim();
            if (fromDate) params.from = fromDate;
            if (toDate) params.to = toDate;

            const response = await api.get('/incidents/export', {
                params,
                responseType: 'blob',
            });
            const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `incidents-${Date.now()}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Failed to export incidents', error);
            window.alert('Failed to export incidents.');
        } finally {
            setExporting(false);
        }
    };

    useEffect(() => {
        fetchIncidents();
        fetchActiveIncidents();
    }, [page]);

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
                console.error('Failed to fetch users for incident assignments', error);
                if (isMounted) setUsers({});
            });

        return () => {
            isMounted = false;
        };
    }, [canViewUsers]);

    const applyFilters = async () => {
        setPage(1);
        await fetchIncidents();
        await fetchActiveIncidents();
    };

    const clearFilters = async () => {
        setQuery('');
        setStatus('all');
        setTargetType('all');
        setSeverity('all');
        setTargetId('');
        setFromDate('');
        setToDate('');
        setPage(1);
        setTimeout(() => {
            fetchIncidents();
            fetchActiveIncidents();
        }, 0);
    };

    const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);
    const showActiveAssignees = useMemo(
        () => activeIncidents.some((inc) => Array.isArray(inc.assigned_user_ids) && inc.assigned_user_ids.length > 0),
        [activeIncidents]
    );
    const showHistoricalAssignees = useMemo(
        () => incidents.some((inc) => Array.isArray(inc.assigned_user_ids) && inc.assigned_user_ids.length > 0),
        [incidents]
    );

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <ShieldCheck className="text-primary-400" />
                    <h2 className="text-2xl font-bold text-white">Incidents</h2>
                </div>
                <div className="flex items-center gap-2">
                    <button className="icon-btn" disabled={exporting} onClick={exportIncidents} title="Export incidents CSV">
                        <Download size={16} />
                    </button>
                    <button className="icon-btn" onClick={() => { fetchIncidents(); fetchActiveIncidents(); }}><RefreshCw size={16} /></button>
                </div>
            </div>

            <div className="card overflow-x-auto">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-semibold text-white">Active Incidents</h3>
                    {!activeLoading && <div className="text-xs text-slate-400">{activeIncidents.length} open</div>}
                </div>
                {activeLoading ? (
                    <div className="text-slate-400">Loading...</div>
                ) : activeIncidents.length === 0 ? (
                    <div className="text-slate-400">No active incidents.</div>
                ) : (
                    <table className="min-w-full text-sm">
                        <thead>
                            <tr className="text-left text-slate-400 border-b border-white/10">
                                <th className="py-3 pr-3">Summary</th>
                                <th className="py-3 pr-3">Target</th>
                                <th className="py-3 pr-3">Severity</th>
                                <th className="py-3 pr-3">Started</th>
                                {showActiveAssignees && <th className="py-3 pr-3">Assigned</th>}
                                <th className="py-3 pr-3">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {activeIncidents.map((inc) => (
                                <tr key={`active-${inc._id}`} className="border-b border-white/5 align-top">
                                    <td className="py-3 pr-3 min-w-[280px]">
                                        <div className="font-semibold text-white">{inc.summary}</div>
                                    </td>
                                    <td className="py-3 pr-3">
                                        <div className="text-slate-200">{inc.target_name || inc.target_id}</div>
                                        <div className="text-xs text-slate-500">{inc.target_type} | {inc.target_id}</div>
                                    </td>
                                    <td className="py-3 pr-3">
                                        <span className={`text-xs px-2 py-0.5 rounded ${inc.severity === 'critical' ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300'}`}>
                                            {String(inc.severity || '').toUpperCase()}
                                        </span>
                                    </td>
                                    <td className="py-3 pr-3 text-xs text-slate-300">{formatDate(inc.started_at)}</td>
                                    {showActiveAssignees && (
                                        <td className="py-3 pr-3 min-w-[180px]">
                                            <AssigneeBadges ids={inc.assigned_user_ids} users={users} />
                                        </td>
                                    )}
                                    <td className="py-3 pr-3">
                                        <button className="text-xs px-3 py-1 bg-emerald-500/20 text-emerald-300 rounded inline-flex items-center gap-1" onClick={() => resolve(inc._id)}>
                                            <CheckCircle2 size={12} /> Resolve
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            <div className="card space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="md:col-span-2 flex items-center gap-2">
                        <Search size={16} className="text-slate-500" />
                        <input className="input-field" placeholder="Search summary, target, updates..." value={query} onChange={(e) => setQuery(e.target.value)} />
                    </div>
                    <input className="input-field" placeholder="Target ID" value={targetId} onChange={(e) => setTargetId(e.target.value)} />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
                    <select className="input-field" value={status} onChange={(e) => setStatus(e.target.value)}>
                        <option value="all">All Status</option>
                        <option value="open">Open</option>
                        <option value="resolved">Resolved</option>
                    </select>

                    <select className="input-field" value={targetType} onChange={(e) => setTargetType(e.target.value)}>
                        <option value="all">All Targets</option>
                        <option value="device">Device</option>
                        <option value="synthetic">Web Monitor</option>
                        <option value="service">Service</option>
                        <option value="license">License</option>
                    </select>

                    <select className="input-field" value={severity} onChange={(e) => setSeverity(e.target.value)}>
                        <option value="all">All Severity</option>
                        <option value="critical">Critical</option>
                        <option value="warning">Warning</option>
                    </select>

                    <input className="input-field" type="datetime-local" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
                    <input className="input-field" type="datetime-local" value={toDate} onChange={(e) => setToDate(e.target.value)} />

                    <div className="flex gap-2">
                        <button className="btn-primary w-full" onClick={applyFilters}><Filter size={14} className="inline mr-1" />Apply</button>
                        <button className="icon-btn" title="Clear" onClick={clearFilters}>×</button>
                    </div>
                </div>
            </div>

            <div className="card overflow-x-auto">
                <div className="mb-3 text-sm text-slate-300 font-semibold">Historical Incidents</div>
                {loading ? (
                    <div className="text-slate-400">Loading...</div>
                ) : (
                    <table className="min-w-full text-sm">
                        <thead>
                            <tr className="text-left text-slate-400 border-b border-white/10">
                                <th className="py-3 pr-3">Summary</th>
                                <th className="py-3 pr-3">Target</th>
                                <th className="py-3 pr-3">Severity</th>
                                <th className="py-3 pr-3">Status</th>
                                <th className="py-3 pr-3">Started</th>
                                <th className="py-3 pr-3">Resolved</th>
                                <th className="py-3 pr-3">Last Update</th>
                                {showHistoricalAssignees && <th className="py-3 pr-3">Assigned</th>}
                                <th className="py-3 pr-3">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {incidents.map((inc) => {
                                const lastUpdate = Array.isArray(inc.updates) && inc.updates.length > 0
                                    ? inc.updates[inc.updates.length - 1]
                                    : null;

                                return (
                                    <tr key={inc._id} className="border-b border-white/5 align-top">
                                        <td className="py-3 pr-3 min-w-[260px]">
                                            <div className="font-semibold text-white">{inc.summary}</div>
                                            {lastUpdate?.message && <div className="text-xs text-slate-500 mt-1">{lastUpdate.message}</div>}
                                        </td>
                                        <td className="py-3 pr-3">
                                            <div className="text-slate-200">{inc.target_name || inc.target_id}</div>
                                            <div className="text-xs text-slate-500">{inc.target_type} | {inc.target_id}</div>
                                        </td>
                                        <td className="py-3 pr-3">
                                            <span className={`text-xs px-2 py-0.5 rounded ${inc.severity === 'critical' ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300'}`}>
                                                {String(inc.severity || '').toUpperCase()}
                                            </span>
                                        </td>
                                        <td className="py-3 pr-3">
                                            <span className={`text-xs px-2 py-0.5 rounded ${inc.status === 'open' ? 'bg-red-500/20 text-red-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
                                                {String(inc.status || '').toUpperCase()}
                                            </span>
                                        </td>
                                        <td className="py-3 pr-3 text-xs text-slate-300">{formatDate(inc.started_at)}</td>
                                        <td className="py-3 pr-3 text-xs text-slate-300">{formatDate(inc.resolved_at)}</td>
                                        <td className="py-3 pr-3 text-xs text-slate-500">{formatDate(lastUpdate?.at)}</td>
                                        {showHistoricalAssignees && (
                                            <td className="py-3 pr-3 min-w-[180px]">
                                                <AssigneeBadges ids={inc.assigned_user_ids} users={users} />
                                            </td>
                                        )}
                                        <td className="py-3 pr-3">
                                            {inc.status === 'open' ? (
                                                <button className="text-xs px-3 py-1 bg-emerald-500/20 text-emerald-300 rounded inline-flex items-center gap-1" onClick={() => resolve(inc._id)}>
                                                    <CheckCircle2 size={12} /> Resolve
                                                </button>
                                            ) : (
                                                <span className="text-xs text-slate-500">—</span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                            {!loading && incidents.length === 0 && (
                                <tr>
                                    <td colSpan={showHistoricalAssignees ? 9 : 8} className="py-6 text-slate-400">No incidents found for current filters.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                )}
            </div>

            <div className="flex items-center justify-between text-sm text-slate-400">
                <div>Total Results: {total}</div>
                <div className="flex items-center gap-2">
                    <button className="icon-btn" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</button>
                    <span>Page {page} / {totalPages}</span>
                    <button className="icon-btn" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>›</button>
                </div>
            </div>
        </div>
    );
};

