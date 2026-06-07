import React, { useEffect, useMemo, useState } from 'react';
import api from '../lib/axios';
import { useAuthStore } from '../store/useAuthStore';
import { hasPermission } from '../lib/permissions';
import { Database, Server, Wifi, Search, MessageSquare, ShieldCheck, Activity, AlertTriangle, CheckCircle, XCircle, Loader2 } from 'lucide-react';
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
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};
