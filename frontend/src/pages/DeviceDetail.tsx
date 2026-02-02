import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    Activity, Cpu, HardDrive, Wifi, MemoryStick as Memory,
    Terminal as TerminalIcon, ShieldCheck, Settings, ArrowLeft, Loader2
} from 'lucide-react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, AreaChart, Area
} from 'recharts';
import api from '../lib/axios';
import { clsx } from 'clsx';

export const DeviceDetail = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('metrics');
    const [device, setDevice] = useState<any>(null);
    const [metrics, setMetrics] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [deviceRes, metricsRes] = await Promise.all([
                    api.get(`/devices/${id}`),
                    api.get(`/monitoring/metrics/${id}`)
                ]);
                setDevice(deviceRes.data);
                setMetrics(metricsRes.data);
            } catch (error) {
                console.error('Failed to fetch device data', error);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
        const interval = setInterval(fetchData, 10000); // 10s refresh
        return () => clearInterval(interval);
    }, [id]);

    if (loading) {
        return (
            <div className="h-[60vh] flex items-center justify-center">
                <Loader2 size={40} className="text-primary-500 animate-spin" />
            </div>
        );
    }

    if (!device) {
        return (
            <div className="card text-center py-12">
                <p className="text-slate-400 mb-4">Device not found or error loading data</p>
                <button onClick={() => navigate('/devices')} className="btn-primary">Back to Devices</button>
            </div>
        );
    }

    const formatGB = (bytes?: number) => bytes ? (bytes / (1024 ** 3)).toFixed(1) : '0.0';

    return (
        <div className="space-y-8">
            <div className="flex items-center gap-4">
                <button
                    onClick={() => navigate('/devices')}
                    className="p-2 bg-dark-surface border border-dark-border rounded-xl text-slate-400 hover:text-white transition-colors"
                >
                    <ArrowLeft size={20} />
                </button>
                <div>
                    <div className="flex items-center gap-3">
                        <h2 className="text-2xl font-bold text-white">{device.name}</h2>
                        <span className={clsx(
                            "px-2 py-0.5 rounded-full text-xs font-bold border uppercase tracking-wider",
                            device.status === 'online' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                                device.status === 'warning' ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"
                        )}>
                            {device.status}
                        </span>
                        {device.monitoring_enabled === false && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase tracking-wider">
                                Monitoring Paused
                            </span>
                        )}
                    </div>
                    <p className="text-slate-400 text-sm font-mono flex items-center gap-2">
                        ID: {id}
                        {device.hostname && <span className="text-slate-600">| Hostname: {device.hostname}</span>}
                    </p>
                </div>
            </div>

            <div className="flex gap-2 p-1 bg-dark-surface border border-dark-border rounded-xl w-fit">
                {[
                    { id: 'metrics', label: 'Real-time Metrics', icon: Activity },
                    { id: 'terminal', label: 'Remote Terminal', icon: TerminalIcon },
                    { id: 'checks', label: 'Monitor Checks', icon: ShieldCheck },
                    { id: 'settings', label: 'Configuration', icon: Settings },
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${activeTab === tab.id
                            ? "bg-primary-600 text-white shadow-lg shadow-primary-500/20"
                            : "text-slate-400 hover:text-slate-100 hover:bg-white/5"
                            }`}
                    >
                        <tab.icon size={18} />
                        {tab.label}
                    </button>
                ))}
            </div>

            {activeTab === 'metrics' && (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        <div className="card">
                            <div className="flex justify-between items-center mb-4">
                                <Cpu size={24} className="text-primary-400" />
                                <span className="text-xs text-primary-400 font-bold bg-primary-400/10 px-2 py-0.5 rounded">
                                    Load: {metrics[metrics.length - 1]?.cpu_load?.toFixed(2) || '0.00'}
                                </span>
                            </div>
                            <h4 className="text-slate-400 text-sm font-medium mb-1">CPU Load</h4>
                            <p className="text-2xl font-bold text-white">{metrics[metrics.length - 1]?.cpu_usage.toFixed(1) || '0.0'}%</p>
                        </div>
                        <div className="card">
                            <div className="flex justify-between items-center mb-4">
                                <Memory size={24} className="text-emerald-400" />
                                <span className="text-xs text-emerald-400 font-bold bg-emerald-400/10 px-2 py-0.5 rounded">
                                    {formatGB(metrics[metrics.length - 1]?.memory_used)} / {formatGB(metrics[metrics.length - 1]?.memory_total || device.memory_total)} GB
                                </span>
                            </div>
                            <h4 className="text-slate-400 text-sm font-medium mb-1">RAM Usage</h4>
                            <p className="text-2xl font-bold text-white">{metrics[metrics.length - 1]?.memory_usage.toFixed(1) || '0.0'}%</p>
                        </div>
                        <div className="card">
                            <div className="flex justify-between items-center mb-4">
                                <HardDrive size={24} className="text-amber-400" />
                                <span className="text-xs text-amber-400 font-bold bg-amber-400/10 px-2 py-0.5 rounded">
                                    {formatGB(metrics[metrics.length - 1]?.disk_used)} / {formatGB(metrics[metrics.length - 1]?.disk_total || device.disk_total)} GB
                                </span>
                            </div>
                            <h4 className="text-slate-400 text-sm font-medium mb-1">Storage</h4>
                            <p className="text-2xl font-bold text-white">{metrics[metrics.length - 1]?.disk_usage.toFixed(1) || '0.0'}%</p>
                        </div>
                        <div className="card">
                            <div className="flex justify-between items-center mb-4">
                                <Wifi size={24} className="text-blue-400" />
                                <span className="text-xs text-blue-400 font-bold bg-blue-400/10 px-2 py-0.5 rounded">Ping</span>
                            </div>
                            <h4 className="text-slate-400 text-sm font-medium mb-1">Latency</h4>
                            <p className="text-2xl font-bold text-white">42ms</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        <div className="card h-80">
                            <h3 className="text-lg font-bold text-white mb-6">CPU Performance (%)</h3>
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={metrics}>
                                    <defs>
                                        <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                                    <XAxis
                                        dataKey="timestamp"
                                        stroke="#64748b"
                                        fontSize={10}
                                        tickLine={false}
                                        axisLine={false}
                                        tickFormatter={(val) => new Date(val).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    />
                                    <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                                        itemStyle={{ color: '#0ea5e9' }}
                                    />
                                    <Area type="monotone" dataKey="cpu_usage" stroke="#0ea5e9" fillOpacity={1} fill="url(#colorCpu)" strokeWidth={3} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="card h-80">
                            <h3 className="text-lg font-bold text-white mb-6">Memory Usage (%)</h3>
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={metrics}>
                                    <defs>
                                        <linearGradient id="colorMem" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                                    <XAxis
                                        dataKey="timestamp"
                                        stroke="#64748b"
                                        fontSize={10}
                                        tickLine={false}
                                        axisLine={false}
                                        tickFormatter={(val) => new Date(val).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    />
                                    <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                                        itemStyle={{ color: '#10b981' }}
                                    />
                                    <Area type="monotone" dataKey="memory_usage" stroke="#10b981" fillOpacity={1} fill="url(#colorMem)" strokeWidth={3} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </>
            )}

            {activeTab === 'terminal' && (
                <div className="card bg-black/50 border-dark-border min-h-[500px] font-mono text-emerald-400 p-4 relative flex flex-col">
                    <div className="flex-1 overflow-y-auto mb-4 p-2 space-y-1">
                        <p className="text-slate-500"># IoTMonitor Remote Shell v1.0.0</p>
                        <p className="text-slate-500"># Authenticated as Admin on {id}</p>
                        <div className="flex gap-2">
                            <span className="text-slate-500">$</span>
                            <span>ls -la</span>
                        </div>
                        <p className="text-slate-400 ml-4">total 42</p>
                        <p className="text-slate-400 ml-4">drwxr-xr-x 2 root root 4096 Jan 30 16:00 .</p>
                        <p className="text-slate-400 ml-4">drwxr-xr-x 4 root root 4096 Jan 30 15:30 ..</p>
                        <div className="flex gap-2 animate-pulse">
                            <span className="text-slate-500">$</span>
                            <span className="w-2 h-5 bg-emerald-500"></span>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl px-4 py-3">
                        <TerminalIcon size={18} className="text-slate-500" />
                        <input
                            type="text"
                            className="flex-1 bg-transparent border-none outline-none text-emerald-400 placeholder:text-slate-600 font-mono"
                            placeholder="Enter command to execute..."
                        />
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-widest px-2 py-1 border border-white/10 rounded">Enter Submit</span>
                    </div>
                </div>
            )}
        </div>
    );
};
