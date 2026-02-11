import React, { useEffect, useMemo, useState } from 'react';
import { Activity, Server, AlertTriangle, Cpu, HardDrive, Globe } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useDeviceStore } from '../store/useDeviceStore';
import api from '../lib/axios';

const StatCard = ({ icon: Icon, label, value, tone = 'primary', subvalue }: { icon: any; label: string; value: string; tone?: 'primary' | 'red' | 'emerald' | 'amber' | 'cyan'; subvalue?: string }) => {
    const toneMap: Record<string, string> = {
        primary: 'bg-primary-500/10 text-primary-400',
        red: 'bg-red-500/10 text-red-400',
        emerald: 'bg-emerald-500/10 text-emerald-400',
        amber: 'bg-amber-500/10 text-amber-400',
        cyan: 'bg-cyan-500/10 text-cyan-400',
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

export const Dashboard = () => {
    const { devices, fetchDevices, initSocket } = useDeviceStore();
    const [history, setHistory] = useState<{ time: string; online: number; downMonitors: number }[]>([]);
    const [activeIncidents, setActiveIncidents] = useState<any[]>([]);
    const [webStats, setWebStats] = useState<any>(null);

    const refresh = async () => {
        await fetchDevices();
        const [incidentsRes, webStatsRes] = await Promise.all([
            api.get('/incidents', { params: { status: 'open', limit: 20 } }),
            api.get('/synthetics/stats', { params: { window_hours: 24 } }),
        ]);
        setActiveIncidents(incidentsRes.data || []);
        setWebStats(webStatsRes.data || null);
    };

    useEffect(() => {
        initSocket();
        refresh();
        const interval = setInterval(() => {
            refresh();
        }, 30000);
        return () => clearInterval(interval);
    }, []);

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
            const downMonitors = Number(webStats?.summary?.down || 0);

            setHistory((prev) => {
                const next = [...prev, { time: timeStr, online, downMonitors }];
                if (next.length > 30) return next.slice(next.length - 30);
                return next;
            });
        };

        sample();
        const interval = setInterval(sample, 10000);
        return () => clearInterval(interval);
    }, [devices, webStats?.summary?.down]);

    const onlineCount = devices.filter((d) => d.status === 'online').length;
    const totalDevices = devices.length;

    const avgUptimeSeconds = useMemo(() => {
        const vals = devices
            .map((d) => Number(d.uptime_seconds || 0))
            .filter((v) => Number.isFinite(v) && v > 0);
        if (vals.length === 0) return 0;
        return Math.floor(vals.reduce((a, b) => a + b, 0) / vals.length);
    }, [devices]);

    const formatDuration = (seconds: number) => {
        if (!seconds) return '0m';
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (days > 0) return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    };

    const recentIncidents = activeIncidents.slice(0, 8);

    return (
        <div className="space-y-8">
            <div className="flex justify-between items-end">
                <div>
                    <h2 className="text-3xl font-bold text-white mb-2">Operations Overview</h2>
                    <p className="text-slate-400">Live device, web monitor, and incident health from real system data</p>
                </div>
                <button className="btn-primary flex items-center gap-2" onClick={refresh}>
                    <Activity size={18} />
                    Refresh
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
                <StatCard icon={Server} label="Total Devices" value={String(totalDevices)} tone="primary" subvalue={`${onlineCount} online`} />
                <StatCard icon={AlertTriangle} label="Active Incidents" value={String(activeIncidents.length)} tone={activeIncidents.length > 0 ? 'red' : 'emerald'} />
                <StatCard icon={Cpu} label="Avg Device Uptime" value={formatDuration(avgUptimeSeconds)} tone="emerald" />
                <StatCard icon={Globe} label="Web Monitors" value={String(webStats?.summary?.total_monitors || 0)} tone="cyan" />
                <StatCard icon={HardDrive} label="Monitor Avg Uptime" value={`${Number(webStats?.summary?.avg_uptime_pct || 0).toFixed(2)}%`} tone="amber" />
                <StatCard icon={AlertTriangle} label="Down Monitors" value={String(webStats?.summary?.down || 0)} tone={(webStats?.summary?.down || 0) > 0 ? 'red' : 'emerald'} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 card h-96 flex flex-col">
                    <h3 className="text-lg font-bold text-white mb-6">Online Devices & Down Monitors Trend</h3>
                    <div className="flex-1 w-full min-h-0">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={history}>
                                <defs>
                                    <linearGradient id="colorOnline" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorDown" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.25} />
                                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} vertical={false} />
                                <XAxis dataKey="time" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                                <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '8px' }} itemStyle={{ color: '#fff' }} />
                                <Area type="monotone" dataKey="online" name="Online Devices" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorOnline)" />
                                <Area type="monotone" dataKey="downMonitors" name="Down Monitors" stroke="#ef4444" strokeWidth={2} fillOpacity={1} fill="url(#colorDown)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="card h-96 overflow-hidden flex flex-col">
                    <h3 className="text-lg font-bold text-white mb-6">Recent Incidents</h3>
                    <div className="flex-1 space-y-3 overflow-y-auto pr-1">
                        {recentIncidents.length === 0 && <div className="text-sm text-slate-400">No active incidents.</div>}
                        {recentIncidents.map((inc) => (
                            <div key={inc._id} className="p-3 rounded-lg bg-white/5 border border-white/10">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="text-sm font-semibold text-white truncate">{inc.summary}</div>
                                    <span className={`text-[10px] px-2 py-0.5 rounded ${inc.severity === 'critical' ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300'}`}>{String(inc.severity || 'warning').toUpperCase()}</span>
                                </div>
                                <div className="text-xs text-slate-400 mt-1">{inc.target_name || inc.target_id}</div>
                                <div className="text-xs text-slate-500 mt-1">Started: {new Date(inc.started_at).toLocaleString()}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

