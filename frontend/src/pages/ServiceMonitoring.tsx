import React, { useEffect, useMemo, useState } from 'react';
import api from '../lib/axios';
import { useAuthStore } from '../store/useAuthStore';
import { hasPermission } from '../lib/permissions';
import { Database, Server, Wifi, Search, MessageSquare, ShieldCheck, Activity, AlertTriangle, CheckCircle, XCircle, Loader2, Plus, Zap, X } from 'lucide-react';
import { clsx } from 'clsx';

const SERVICE_ICONS: Record<string, React.ElementType> = {
    mysql: Database,
    postgresql: Database,
    redis: Server,
    nginx: Wifi,
    elasticsearch: Search,
    rabbitmq: MessageSquare,
    mongodb: Database,
};

const SERVICE_LABELS: Record<string, string> = {
    mysql: 'MySQL',
    postgresql: 'PostgreSQL',
    redis: 'Redis',
    nginx: 'Nginx',
    elasticsearch: 'Elasticsearch',
    rabbitmq: 'RabbitMQ',
    mongodb: 'MongoDB',
};

const SERVICE_TYPES = Object.keys(SERVICE_LABELS);

interface ServiceCheck {
    _id: string;
    device_id: string;
    check_type: string;
    target?: string;
    enabled: boolean;
    last_state?: string;
    last_value?: number;
    thresholds?: { warning: number; critical: number };
    updatedAt: string;
}

interface DeviceMap {
    [device_id: string]: { name: string; status: string };
}

export const ServiceMonitoring = () => {
    const user = useAuthStore((state) => state.user);
    const canViewMonitoring = hasPermission('monitoring.view', user);

    const [checks, setChecks] = useState<ServiceCheck[]>([]);
    const [devices, setDevices] = useState<DeviceMap>({});
    const [loading, setLoading] = useState(true);
    const [selectedType, setSelectedType] = useState<string>('all');
    const [testingId, setTestingId] = useState<string | null>(null);
    const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string }>>({});
    const [showAddModal, setShowAddModal] = useState(false);
    const [addForm, setAddForm] = useState({
        device_id: '',
        check_type: 'mysql',
        target: '',
        interval: 60,
        warning_threshold: 500,
        critical_threshold: 1000,
    });
    const [adding, setAdding] = useState(false);

    useEffect(() => {
        if (!canViewMonitoring) return;
        let isMounted = true;

        const fetchData = async () => {
            setLoading(true);
            try {
                const [checksRes, devicesRes] = await Promise.all([
                    api.get('/monitoring/checks'),
                    api.get('/devices'),
                ]);
                if (!isMounted) return;

                const allChecks: ServiceCheck[] = (checksRes.data || []).filter(
                    (c: ServiceCheck) => SERVICE_TYPES.includes(c.check_type)
                );
                setChecks(allChecks);

                const deviceMap: DeviceMap = {};
                (devicesRes.data || []).forEach((d: any) => {
                    deviceMap[d.device_id] = { name: d.name || d.device_id, status: d.status || 'unknown' };
                });
                setDevices(deviceMap);
            } catch (err) {
                console.error('Failed to load service checks', err);
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        fetchData();
        return () => { isMounted = false; };
    }, [canViewMonitoring]);

    const handleAddCheck = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!addForm.device_id) { alert('Select a device'); return; }
        setAdding(true);
        try {
            await api.post('/monitoring', {
                device_id: addForm.device_id,
                check_type: addForm.check_type,
                target: addForm.target,
                interval: addForm.interval,
                thresholds: { warning: addForm.warning_threshold, critical: addForm.critical_threshold },
            });
            setShowAddModal(false);
            setAddForm({ device_id: '', check_type: 'mysql', target: '', interval: 60, warning_threshold: 500, critical_threshold: 1000 });
            // Refresh checks
            const checksRes = await api.get('/monitoring/checks');
            const allChecks: ServiceCheck[] = (checksRes.data || []).filter(
                (c: ServiceCheck) => SERVICE_TYPES.includes(c.check_type)
            );
            setChecks(allChecks);
        } catch (err: any) {
            alert(err.response?.data?.message || 'Failed to add service check');
        } finally {
            setAdding(false);
        }
    };

    const handleTestConnection = async (check: ServiceCheck) => {
        const id = check._id;
        setTestingId(id);
        try {
            const res = await api.post('/monitoring/test-connection', {
                target: check.target,
                check_type: check.check_type,
            });
            setTestResults((prev) => ({ ...prev, [id]: { success: res.data?.success ?? false, message: res.data?.message || 'No response' } }));
        } catch (e: any) {
            setTestResults((prev) => ({ ...prev, [id]: { success: false, message: e.response?.data?.message || 'Connection failed' } }));
        } finally {
            setTestingId(null);
        }
    };

    const filteredChecks = useMemo(() => {
        if (selectedType === 'all') return checks;
        return checks.filter((c) => c.check_type === selectedType);
    }, [checks, selectedType]);

    const groupedByType = useMemo(() => {
        const groups: Record<string, ServiceCheck[]> = {};
        SERVICE_TYPES.forEach((t) => { groups[t] = []; });
        checks.forEach((c) => {
            if (!groups[c.check_type]) groups[c.check_type] = [];
            groups[c.check_type].push(c);
        });
        return groups;
    }, [checks]);

    const summaryCards = useMemo(() => {
        return SERVICE_TYPES.map((type) => {
            const typeChecks = groupedByType[type] || [];
            const enabled = typeChecks.filter((c) => c.enabled);
            const critical = enabled.filter((c) => c.last_state === 'critical').length;
            const warning = enabled.filter((c) => c.last_state === 'warning').length;
            const ok = enabled.filter((c) => c.last_state === 'ok' || c.last_state === 'normal').length;
            const offline = enabled.filter((c) => c.last_state === 'offline' || !c.last_state).length;
            return { type, label: SERVICE_LABELS[type], count: typeChecks.length, critical, warning, ok, offline, Icon: SERVICE_ICONS[type] || Activity };
        });
    }, [groupedByType]);

    if (!canViewMonitoring) {
        return (
            <div className="p-8 text-center text-slate-400">
                <ShieldCheck size={48} className="mx-auto mb-4 text-slate-600" />
                <h2 className="text-lg font-bold">Access Denied</h2>
                <p>You do not have permission to view service monitoring.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                        <Activity size={28} className="text-primary-400" />
                        Service Monitoring
                    </h1>
                    <p className="text-sm text-slate-400 mt-1">
                        Overview of SQL, Redis, Nginx, and other service checks across your fleet.
                    </p>
                </div>
                <button onClick={() => setShowAddModal(true)} className="btn-primary flex items-center gap-2">
                    <Plus size={18} />
                    Add Service Check
                </button>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {summaryCards.map((card) => (
                    <button
                        key={card.type}
                        onClick={() => setSelectedType(selectedType === card.type ? 'all' : card.type)}
                        className={clsx(
                            "p-4 rounded-xl border text-left transition-all",
                            selectedType === card.type
                                ? "bg-primary-500/10 border-primary-500/30"
                                : "bg-white/5 border-white/10 hover:border-white/20"
                        )}
                    >
                        <div className="flex items-center justify-between mb-3">
                            <card.Icon size={20} className="text-slate-300" />
                            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{card.label}</span>
                        </div>
                        <div className="text-2xl font-black text-white">{card.count}</div>
                        <div className="flex items-center gap-3 mt-2 text-[10px] font-bold uppercase tracking-wider">
                            {card.ok > 0 && <span className="text-emerald-400 flex items-center gap-1"><CheckCircle size={10} /> {card.ok}</span>}
                            {card.warning > 0 && <span className="text-amber-400 flex items-center gap-1"><AlertTriangle size={10} /> {card.warning}</span>}
                            {card.critical > 0 && <span className="text-red-400 flex items-center gap-1"><XCircle size={10} /> {card.critical}</span>}
                            {card.offline > 0 && <span className="text-slate-500 flex items-center gap-1"><XCircle size={10} /> {card.offline}</span>}
                        </div>
                    </button>
                ))}
            </div>

            {/* Filter pills */}
            <div className="flex flex-wrap items-center gap-2">
                <button
                    onClick={() => setSelectedType('all')}
                    className={clsx(
                        "px-3 py-1.5 rounded-lg border text-xs font-bold transition-all",
                        selectedType === 'all' ? "bg-primary-500/20 border-primary-500 text-primary-400" : "bg-white/5 border-white/10 text-slate-400 hover:border-white/20"
                    )}
                >
                    All Services
                </button>
                {SERVICE_TYPES.map((type) => (
                    <button
                        key={type}
                        onClick={() => setSelectedType(type)}
                        className={clsx(
                            "px-3 py-1.5 rounded-lg border text-xs font-bold transition-all",
                            selectedType === type ? "bg-primary-500/20 border-primary-500 text-primary-400" : "bg-white/5 border-white/10 text-slate-400 hover:border-white/20"
                        )}
                    >
                        {SERVICE_LABELS[type]}
                    </button>
                ))}
            </div>

            {/* Table */}
            <div className="card overflow-hidden">
                {loading ? (
                    <div className="p-12 text-center text-slate-400">
                        <Loader2 size={32} className="mx-auto mb-3 animate-spin text-primary-400" />
                        Loading service checks...
                    </div>
                ) : filteredChecks.length === 0 ? (
                    <div className="p-12 text-center text-slate-400">
                        <Database size={48} className="mx-auto mb-4 text-slate-700" />
                        <h3 className="text-lg font-bold text-slate-300">No service checks found</h3>
                        <p className="text-sm text-slate-500 mt-1">
                            {selectedType === 'all'
                                ? 'Add service monitoring rules from a device detail page.'
                                : `No ${SERVICE_LABELS[selectedType]} checks configured.`}
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-white/10 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                                    <th className="px-4 py-3">Service</th>
                                    <th className="px-4 py-3">Target</th>
                                    <th className="px-4 py-3">Device</th>
                                    <th className="px-4 py-3">Status</th>
                                    <th className="px-4 py-3">Last Value</th>
                                    <th className="px-4 py-3">Thresholds</th>
                                    <th className="px-4 py-3">Updated</th>
                                    <th className="px-4 py-3">Test</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {filteredChecks.map((check) => {
                                    const device = devices[check.device_id];
                                    const Icon = SERVICE_ICONS[check.check_type] || Activity;
                                    const state = check.last_state || 'unknown';
                                    const stateClass =
                                        state === 'critical' ? 'text-red-400 bg-red-400/10 border-red-400/20' :
                                        state === 'warning' ? 'text-amber-400 bg-amber-400/10 border-amber-400/20' :
                                        state === 'ok' || state === 'normal' ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' :
                                        'text-slate-400 bg-white/5 border-white/10';
                                    return (
                                        <tr key={check._id} className="hover:bg-white/5 transition-colors">
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    <Icon size={16} className="text-slate-400" />
                                                    <span className="font-medium text-slate-200">{SERVICE_LABELS[check.check_type] || check.check_type}</span>
                                                    {!check.enabled && (
                                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-700 text-slate-400">PAUSED</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-slate-300 font-mono text-xs">{check.target || '-'}</td>
                                            <td className="px-4 py-3">
                                                <div className="flex flex-col">
                                                    <span className="text-slate-200">{device?.name || check.device_id}</span>
                                                    <span className={clsx("text-[10px] font-bold uppercase", device?.status === 'online' ? 'text-emerald-400' : 'text-slate-500')}>
                                                        {device?.status || 'unknown'}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={clsx("px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-wider border", stateClass)}>
                                                    {state}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-slate-300">
                                                {check.last_value != null ? `${check.last_value} ms` : '-'}
                                            </td>
                                            <td className="px-4 py-3 text-xs text-slate-400">
                                                W:{check.thresholds?.warning ?? '-'} / C:{check.thresholds?.critical ?? '-'}
                                            </td>
                                            <td className="px-4 py-3 text-xs text-slate-500">
                                                {check.updatedAt ? new Date(check.updatedAt).toLocaleString() : '-'}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex flex-col gap-1">
                                                    <button
                                                        onClick={() => handleTestConnection(check)}
                                                        disabled={testingId === check._id || !check.target}
                                                        className="flex items-center gap-1 text-xs font-bold text-slate-400 hover:text-amber-400 transition-colors disabled:opacity-40"
                                                        title="Test connection to target"
                                                    >
                                                        <Zap size={12} className={testingId === check._id ? 'animate-pulse' : ''} />
                                                        {testingId === check._id ? 'Testing' : 'Test'}
                                                    </button>
                                                    {testResults[check._id] && (
                                                        <span className={clsx("text-[10px]", testResults[check._id].success ? 'text-emerald-400' : 'text-red-400')}>
                                                            {testResults[check._id].message}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {showAddModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="bg-[#0a0e1a] border border-white/10 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
                        <div className="flex items-center justify-between p-6 border-b border-white/10">
                            <h3 className="text-lg font-bold text-white">Add Service Check</h3>
                            <button onClick={() => setShowAddModal(false)} className="p-2 rounded-lg hover:bg-white/10 text-slate-400 transition-colors">
                                <X size={18} />
                            </button>
                        </div>
                        <form onSubmit={handleAddCheck} className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1 md:col-span-2">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Device *</label>
                                <select className="input-field" value={addForm.device_id} onChange={(e) => setAddForm({ ...addForm, device_id: e.target.value })} required>
                                    <option value="">Select a device...</option>
                                    {Object.entries(devices).map(([id, d]) => (
                                        <option key={id} value={id}>{d.name} ({id.slice(0, 8)})</option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Service Type *</label>
                                <select className="input-field" value={addForm.check_type} onChange={(e) => setAddForm({ ...addForm, check_type: e.target.value })} required>
                                    {SERVICE_TYPES.map((t) => (
                                        <option key={t} value={t}>{SERVICE_LABELS[t]}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Target Host:Port *</label>
                                <input className="input-field" placeholder="192.168.1.10:3306" value={addForm.target} onChange={(e) => setAddForm({ ...addForm, target: e.target.value })} required />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Interval (seconds)</label>
                                <input className="input-field" type="number" min={10} value={addForm.interval} onChange={(e) => setAddForm({ ...addForm, interval: Number(e.target.value) })} />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Warning Threshold (ms)</label>
                                <input className="input-field" type="number" min={1} value={addForm.warning_threshold} onChange={(e) => setAddForm({ ...addForm, warning_threshold: Number(e.target.value) })} />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Critical Threshold (ms)</label>
                                <input className="input-field" type="number" min={1} value={addForm.critical_threshold} onChange={(e) => setAddForm({ ...addForm, critical_threshold: Number(e.target.value) })} />
                            </div>
                            <div className="md:col-span-2 flex gap-2 pt-2">
                                <button type="submit" disabled={adding} className="btn-primary">
                                    {adding ? <Loader2 size={16} className="animate-spin inline mr-1" /> : null}
                                    Save Check
                                </button>
                                <button type="button" onClick={() => setShowAddModal(false)} className="btn-secondary">Cancel</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};
