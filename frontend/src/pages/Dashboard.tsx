import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Clock3, Cpu, Globe, HardDrive, KeyRound, Server, ShieldCheck, WifiOff } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Link } from 'react-router-dom';
import { useDeviceStore } from '../store/useDeviceStore';
import api from '../lib/axios';
import { useAuthStore } from '../store/useAuthStore';
import { hasPermission } from '../lib/permissions';

const StatCard = ({
    icon: Icon,
    label,
    value,
    tone = 'primary',
    subvalue,
}: {
    icon: any;
    label: string;
    value: string;
    tone?: 'primary' | 'red' | 'emerald' | 'amber' | 'cyan' | 'slate';
    subvalue?: string;
}) => {
    const toneMap: Record<string, string> = {
        primary: 'bg-primary-500/10 text-primary-400',
        red: 'bg-red-500/10 text-red-400',
        emerald: 'bg-emerald-500/10 text-emerald-400',
        amber: 'bg-amber-500/10 text-amber-400',
        cyan: 'bg-cyan-500/10 text-cyan-400',
        slate: 'bg-slate-500/10 text-slate-300',
    };

    return (
        <div className="card">
            <div className="flex justify-between items-start mb-4">
                <div className={`p-2 rounded-lg ${toneMap[tone]}`}>
                    <Icon size={24} />
                </div>
                {subvalue && <span className="text-xs text-slate-500 font-medium">{subvalue}</span>}
            </div>
            <h3 className="text-slate-400 text-sm font-medium mb-1">{label}</h3>
            <p className="text-2xl font-bold text-white">{value}</p>
        </div>
    );
};

type TrendPoint = {
    time: string;
    online: number;
    downMonitors: number;
    activeAlerts: number;
    criticalLicenses: number;
};

const formatDuration = (seconds: number) => {
    if (!seconds) return '0m';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
};

const formatDateTime = (value?: string | Date | null) => {
    if (!value) return '--';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '--';
    return date.toLocaleString();
};

const licenseRiskRank = (row: any) => {
    const state = String(row?.status === 'paused' ? 'paused' : row?.computed_state || '').toLowerCase();
    if (state === 'expired') return 4;
    if (state === 'critical') return 3;
    if (state === 'warning') return 2;
    if (state === 'paused') return 1;
    return 0;
};

export const Dashboard = () => {
    const { devices, fetchDevices, initSocket } = useDeviceStore();
    const user = useAuthStore(state => state.user);

    const canViewIncidents = hasPermission('incidents.view', user);
    const canViewSynthetics = hasPermission('synthetics.view', user);
    const canViewLicenses = hasPermission('licenses.view', user);
    const canViewAlerts = hasPermission('alerts.view', user);

    const [history, setHistory] = useState<TrendPoint[]>([]);
    const [activeIncidents, setActiveIncidents] = useState<any[]>([]);
    const [activeAlerts, setActiveAlerts] = useState<any[]>([]);
    const [webStats, setWebStats] = useState<any>(null);
    const [licenseStats, setLicenseStats] = useState<any>(null);
    const [licenses, setLicenses] = useState<any[]>([]);
    const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

    const refresh = useCallback(async () => {
        await fetchDevices();

        const incidentPromise = canViewIncidents
            ? api.get('/incidents', { params: { status: 'open', limit: 20 } })
            : Promise.resolve({ data: [] } as any);
        const syntheticPromise = canViewSynthetics
            ? api.get('/synthetics/stats', { params: { window_hours: 24 } })
            : Promise.resolve({ data: null } as any);
        const licenseStatsPromise = canViewLicenses
            ? api.get('/licenses/stats')
            : Promise.resolve({ data: null } as any);
        const licenseRowsPromise = canViewLicenses
            ? api.get('/licenses')
            : Promise.resolve({ data: [] } as any);
        const alertsPromise = canViewAlerts
            ? api.get('/alerts/active', { params: { limit: 200 } })
            : Promise.resolve({ data: [] } as any);

        const [incidentsRes, webStatsRes, licenseStatsRes, licensesRes, alertsRes] = await Promise.allSettled([
            incidentPromise,
            syntheticPromise,
            licenseStatsPromise,
            licenseRowsPromise,
            alertsPromise,
        ]);

        setActiveIncidents(incidentsRes.status === 'fulfilled' ? (incidentsRes.value.data || []) : []);
        setWebStats(webStatsRes.status === 'fulfilled' ? (webStatsRes.value.data || null) : null);
        setLicenseStats(licenseStatsRes.status === 'fulfilled' ? (licenseStatsRes.value.data || null) : null);
        setLicenses(licensesRes.status === 'fulfilled' && Array.isArray(licensesRes.value.data) ? licensesRes.value.data : []);
        setActiveAlerts(alertsRes.status === 'fulfilled' && Array.isArray(alertsRes.value.data) ? alertsRes.value.data : []);
        setLastUpdatedAt(new Date());
    }, [canViewAlerts, canViewIncidents, canViewLicenses, canViewSynthetics, fetchDevices]);

    useEffect(() => {
        initSocket();
        refresh();
        const interval = setInterval(() => {
            refresh();
        }, 30000);
        return () => clearInterval(interval);
    }, [initSocket, refresh]);

    const downMonitors = Number(webStats?.summary?.down || 0);
    const criticalLicenses = Number(licenseStats?.critical || 0) + Number(licenseStats?.expired || 0);

    useEffect(() => {
        const sample = () => {
            const now = new Date();
            const timeStr = now.toLocaleTimeString('en-US', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            });
            const online = devices.filter((d) => d.status === 'online').length;

            setHistory((prev) => {
                const next = [...prev, {
                    time: timeStr,
                    online,
                    downMonitors,
                    activeAlerts: activeAlerts.length,
                    criticalLicenses,
                }];
                if (next.length > 36) return next.slice(next.length - 36);
                return next;
            });
        };

        sample();
        const interval = setInterval(sample, 10000);
        return () => clearInterval(interval);
    }, [activeAlerts.length, criticalLicenses, devices, downMonitors]);

    const totalDevices = devices.length;
    const onlineCount = devices.filter((d) => d.status === 'online').length;

    const statusCounts = useMemo(() => {
        const base = { online: 0, offline: 0, warning: 0, not_monitored: 0 } as Record<string, number>;
        devices.forEach((device) => {
            const key = String(device.status || 'offline');
            if (base[key] === undefined) base[key] = 0;
            base[key] += 1;
        });
        return base;
    }, [devices]);

    const typeCounts = useMemo(() => {
        const map: Record<string, number> = {};
        devices.forEach((device) => {
            const type = String(device.type || 'unknown').toLowerCase();
            map[type] = (map[type] || 0) + 1;
        });
        return map;
    }, [devices]);

    const avgUptimeSeconds = useMemo(() => {
        const values = devices
            .map((device) => Number(device.uptime_seconds || 0))
            .filter((value) => Number.isFinite(value) && value > 0);
        if (values.length === 0) return 0;
        return Math.floor(values.reduce((sum, value) => sum + value, 0) / values.length);
    }, [devices]);

    const alertSeverityCounts = useMemo(() => {
        const counts = { critical: 0, warning: 0, info: 0 };
        activeAlerts.forEach((alert: any) => {
            const key = String(alert?.severity || 'info').toLowerCase() as keyof typeof counts;
            if (counts[key] !== undefined) counts[key] += 1;
        });
        return counts;
    }, [activeAlerts]);

    const priorityAlerts = useMemo(() => {
        const rank: Record<string, number> = { critical: 3, warning: 2, info: 1 };
        return [...activeAlerts]
            .sort((a, b) => {
                const severityDiff = (rank[String(b?.severity || '').toLowerCase()] || 0) - (rank[String(a?.severity || '').toLowerCase()] || 0);
                if (severityDiff !== 0) return severityDiff;
                return new Date(String(b?.last_notified || b?.first_triggered || 0)).getTime()
                    - new Date(String(a?.last_notified || a?.first_triggered || 0)).getTime();
            })
            .slice(0, 6);
    }, [activeAlerts]);

    const monitorRows = useMemo(() => Array.isArray(webStats?.monitors) ? webStats.monitors : [], [webStats]);
    const worstMonitors = useMemo(() => {
        const stateRank: Record<string, number> = { down: 3, degraded: 2, healthy: 1 };
        return [...monitorRows]
            .sort((a: any, b: any) => {
                const rankDiff = (stateRank[String(b?.state || '').toLowerCase()] || 0) - (stateRank[String(a?.state || '').toLowerCase()] || 0);
                if (rankDiff !== 0) return rankDiff;
                return Number(a?.uptime_pct || 100) - Number(b?.uptime_pct || 100);
            })
            .slice(0, 6);
    }, [monitorRows]);

    const urgentLicenses = useMemo(() => {
        return [...licenses]
            .sort((a: any, b: any) => {
                const rankDiff = licenseRiskRank(b) - licenseRiskRank(a);
                if (rankDiff !== 0) return rankDiff;
                const aDays = Number.isFinite(Number(a?.days_left)) ? Number(a.days_left) : 999999;
                const bDays = Number.isFinite(Number(b?.days_left)) ? Number(b.days_left) : 999999;
                return aDays - bDays;
            })
            .slice(0, 6);
    }, [licenses]);

    const atRiskLicenses = Number(licenseStats?.critical || 0)
        + Number(licenseStats?.warning || 0)
        + Number(licenseStats?.expired || 0);

    const recentIncidents = activeIncidents.slice(0, 8);

    return (
        <div className="space-y-8">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold text-white mb-2">Operations Overview</h2>
                    <p className="text-slate-400">Unified health for devices, web monitors, alerts, incidents, and subscriptions</p>
                </div>
                <div className="flex items-center gap-3">
                    {lastUpdatedAt && (
                        <div className="text-xs text-slate-500 flex items-center gap-1">
                            <Clock3 size={13} />
                            Last refresh: {formatDateTime(lastUpdatedAt)}
                        </div>
                    )}
                    <button className="btn-primary flex items-center gap-2" onClick={refresh}>
                        <Activity size={18} />
                        Refresh
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <StatCard icon={Server} label="Total Devices" value={String(totalDevices)} tone="primary" subvalue={`${onlineCount} online`} />
                <StatCard icon={WifiOff} label="Offline Devices" value={String(statusCounts.offline || 0)} tone={(statusCounts.offline || 0) > 0 ? 'red' : 'emerald'} subvalue={`${statusCounts.warning || 0} warning`} />
                <StatCard icon={ShieldCheck} label="Active Alerts" value={String(activeAlerts.length)} tone={activeAlerts.length > 0 ? 'red' : 'emerald'} subvalue={canViewAlerts ? `${alertSeverityCounts.critical} critical` : 'No access'} />
                <StatCard icon={AlertTriangle} label="Active Incidents" value={String(activeIncidents.length)} tone={activeIncidents.length > 0 ? 'red' : 'emerald'} subvalue={canViewIncidents ? 'Open incidents' : 'No access'} />
                <StatCard icon={Globe} label="Web Monitors" value={String(webStats?.summary?.total_monitors || 0)} tone="cyan" subvalue={canViewSynthetics ? `${downMonitors} down` : 'No access'} />
                <StatCard icon={HardDrive} label="Monitor Avg Uptime" value={`${Number(webStats?.summary?.avg_uptime_pct || 0).toFixed(2)}%`} tone="amber" subvalue={canViewSynthetics ? 'Last 24h' : 'No access'} />
                <StatCard icon={KeyRound} label="License Items" value={String(licenseStats?.total || 0)} tone="slate" subvalue={canViewLicenses ? `${atRiskLicenses} at risk` : 'No access'} />
                <StatCard icon={Cpu} label="Avg Device Uptime" value={formatDuration(avgUptimeSeconds)} tone="emerald" subvalue="Across online fleet" />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                <div className="xl:col-span-2 card h-[26rem] flex flex-col">
                    <h3 className="text-lg font-bold text-white mb-6">Operational Trend</h3>
                    <div className="flex-1 w-full min-h-0">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={history}>
                                <defs>
                                    <linearGradient id="colorOnline" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorDown" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorAlerts" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2} />
                                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} vertical={false} />
                                <XAxis dataKey="time" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                                <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '8px' }} itemStyle={{ color: '#fff' }} />
                                <Legend wrapperStyle={{ color: '#cbd5e1' }} />
                                <Area type="monotone" dataKey="online" name="Online Devices" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorOnline)" />
                                <Area type="monotone" dataKey="downMonitors" name="Down Monitors" stroke="#ef4444" strokeWidth={2} fillOpacity={1} fill="url(#colorDown)" />
                                <Area type="monotone" dataKey="activeAlerts" name="Active Alerts" stroke="#f59e0b" strokeWidth={2} fillOpacity={1} fill="url(#colorAlerts)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="card h-[26rem] overflow-hidden flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold text-white">Fleet Footprint</h3>
                        <Link to="/devices" className="text-xs text-primary-400 hover:text-primary-300">View devices</Link>
                    </div>
                    <div className="space-y-4 overflow-y-auto pr-1">
                        <div>
                            <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">Status</p>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                                <div className="rounded-lg bg-white/5 p-3"><span className="text-slate-400">Online</span><div className="text-white font-bold">{statusCounts.online || 0}</div></div>
                                <div className="rounded-lg bg-white/5 p-3"><span className="text-slate-400">Offline</span><div className="text-white font-bold">{statusCounts.offline || 0}</div></div>
                                <div className="rounded-lg bg-white/5 p-3"><span className="text-slate-400">Warning</span><div className="text-white font-bold">{statusCounts.warning || 0}</div></div>
                                <div className="rounded-lg bg-white/5 p-3"><span className="text-slate-400">Paused</span><div className="text-white font-bold">{statusCounts.not_monitored || 0}</div></div>
                            </div>
                        </div>

                        <div>
                            <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">Device Types</p>
                            <div className="space-y-2">
                                {Object.entries(typeCounts).length === 0 && <div className="text-sm text-slate-500">No devices registered.</div>}
                                {Object.entries(typeCounts)
                                    .sort((a, b) => b[1] - a[1])
                                    .map(([type, count]) => (
                                        <div key={type} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 text-sm">
                                            <span className="text-slate-300 uppercase">{type.replace(/_/g, ' ')}</span>
                                            <span className="text-white font-semibold">{count}</span>
                                        </div>
                                    ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                <div className="card">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold text-white">Web Monitor Health</h3>
                        <Link to="/web-monitoring" className="text-xs text-primary-400 hover:text-primary-300">View monitors</Link>
                    </div>
                    <div className="space-y-3">
                        {!canViewSynthetics && <div className="text-sm text-slate-500">No permission to view web monitors.</div>}
                        {canViewSynthetics && worstMonitors.length === 0 && <div className="text-sm text-slate-500">No web monitor data.</div>}
                        {canViewSynthetics && worstMonitors.map((monitor: any) => (
                            <div key={monitor.check_id} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-sm text-white font-semibold truncate">{monitor.name}</p>
                                    <span className={`text-[10px] px-2 py-0.5 rounded ${String(monitor.state) === 'down' ? 'bg-red-500/20 text-red-300' : String(monitor.state) === 'degraded' ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
                                        {String(monitor.state || 'healthy').toUpperCase()}
                                    </span>
                                </div>
                                <div className="text-xs text-slate-400 mt-1">Uptime: {Number(monitor.uptime_pct || 0).toFixed(2)}% | Outage: {monitor.outage_duration_text || '0s'}</div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="card">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold text-white">License Renewal Risk</h3>
                        <Link to="/licenses" className="text-xs text-primary-400 hover:text-primary-300">View licenses</Link>
                    </div>
                    <div className="space-y-3">
                        {!canViewLicenses && <div className="text-sm text-slate-500">No permission to view licenses.</div>}
                        {canViewLicenses && urgentLicenses.length === 0 && <div className="text-sm text-slate-500">No license records found.</div>}
                        {canViewLicenses && urgentLicenses.map((row: any) => {
                            const state = String(row.status === 'paused' ? 'paused' : row.computed_state || 'ok').toLowerCase();
                            return (
                                <div key={row._id} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="text-sm text-white font-semibold truncate">{row.name}</p>
                                        <span className={`text-[10px] px-2 py-0.5 rounded ${state === 'expired' ? 'bg-red-500/20 text-red-300' : state === 'critical' ? 'bg-rose-500/20 text-rose-300' : state === 'warning' ? 'bg-amber-500/20 text-amber-300' : state === 'paused' ? 'bg-slate-500/20 text-slate-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
                                            {state.toUpperCase()}
                                        </span>
                                    </div>
                                    <div className="text-xs text-slate-400 mt-1">Owner: {row.owner || 'N/A'} | Days left: {row.days_left ?? '--'}</div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="card">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold text-white">Priority Alerts</h3>
                        <Link to="/alerts" className="text-xs text-primary-400 hover:text-primary-300">View alerts</Link>
                    </div>
                    <div className="space-y-3">
                        {!canViewAlerts && <div className="text-sm text-slate-500">No permission to view alerts.</div>}
                        {canViewAlerts && priorityAlerts.length === 0 && <div className="text-sm text-slate-500">No active alerts.</div>}
                        {canViewAlerts && priorityAlerts.map((alert: any) => (
                            <div key={alert._id} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-sm text-white font-semibold truncate">{alert.device_name || alert.device_id}</p>
                                    <span className={`text-[10px] px-2 py-0.5 rounded ${String(alert.severity) === 'critical' ? 'bg-red-500/20 text-red-300' : String(alert.severity) === 'warning' ? 'bg-amber-500/20 text-amber-300' : 'bg-cyan-500/20 text-cyan-300'}`}>
                                        {String(alert.severity || 'info').toUpperCase()}
                                    </span>
                                </div>
                                <div className="text-xs text-slate-400 mt-1">
                                    {String(alert.alert_type || 'alert').replace(/_/g, ' ')}
                                    {alert.specific_service ? ` / ${alert.specific_service}` : ''}
                                    {alert.specific_endpoint ? ` / ${alert.specific_endpoint}` : ''}
                                </div>
                                <div className="text-xs text-slate-500 mt-1">Last notified: {formatDateTime(alert.last_notified)}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="card">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-white">Recent Active Incidents</h3>
                    <Link to="/incidents" className="text-xs text-primary-400 hover:text-primary-300">View incidents</Link>
                </div>
                <div className="space-y-3">
                    {!canViewIncidents && <div className="text-sm text-slate-500">No permission to view incidents.</div>}
                    {canViewIncidents && recentIncidents.length === 0 && <div className="text-sm text-slate-500">No active incidents.</div>}
                    {canViewIncidents && recentIncidents.map((incident: any) => (
                        <div key={incident._id} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-sm text-white font-semibold truncate">{incident.summary}</p>
                                <span className={`text-[10px] px-2 py-0.5 rounded ${String(incident.severity) === 'critical' ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300'}`}>
                                    {String(incident.severity || 'warning').toUpperCase()}
                                </span>
                            </div>
                            <div className="text-xs text-slate-400 mt-1">Target: {incident.target_name || incident.target_id}</div>
                            <div className="text-xs text-slate-500 mt-1">Started: {formatDateTime(incident.started_at)}</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
