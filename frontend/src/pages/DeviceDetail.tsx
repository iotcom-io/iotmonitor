import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    Activity, Cpu, HardDrive, Wifi, MemoryStick as Memory,
    Terminal as TerminalIcon, ShieldCheck, Settings, ArrowLeft, Loader2,
    Globe, Network as NetworkIcon, Phone, CheckCircle2, XCircle, AlertCircle, Bell
} from 'lucide-react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, AreaChart, Area
} from 'recharts';
import api from '../lib/axios';
import { clsx } from 'clsx';
import { MonitoringRuleModal } from '../components/MonitoringRuleModal';

export const DeviceDetail = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('metrics');
    const [device, setDevice] = useState<any>(null);
    const [metrics, setMetrics] = useState<any[]>([]);
    const [checks, setChecks] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingCheck, setEditingCheck] = useState<any>(null);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [deviceRes, metricsRes, checksRes] = await Promise.all([
                    api.get(`/devices/${id}`),
                    api.get(`/monitoring/metrics/${id}`),
                    api.get(`/monitoring/checks/${id}`)
                ]);
                setDevice(deviceRes.data);
                setMetrics(metricsRes.data);
                setChecks(checksRes.data);
            } catch (error) {
                console.error('Failed to fetch device data', error);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
        const interval = setInterval(fetchData, 5000); // 5s refresh
        return () => clearInterval(interval);
    }, [id]);

    const handleSaveCheck = async (ruleData: any) => {
        try {
            if (ruleData._id) {
                await api.put(`/monitoring/${ruleData._id}`, ruleData);
            } else {
                await api.post('/monitoring', { ...ruleData, device_id: id });
            }
            // Refresh checks
            const checksRes = await api.get(`/monitoring/checks/${id}`);
            setChecks(checksRes.data);
            setIsModalOpen(false);
            setEditingCheck(null);
        } catch (error) {
            console.error('Failed to save monitor check', error);
        }
    };

    const handleDeleteCheck = async (checkId: string) => {
        if (!confirm('Are you sure you want to delete this monitoring rule?')) return;
        try {
            await api.delete(`/monitoring/${checkId}`);
            setChecks(checks.filter(c => c._id !== checkId));
        } catch (error) {
            console.error('Failed to delete monitor check', error);
        }
    };

    const handleToggleCheck = async (check: any) => {
        try {
            const updated = await api.put(`/monitoring/${check._id}`, { enabled: !check.enabled });
            setChecks(checks.map(c => c._id === check._id ? updated.data : c));
        } catch (error) {
            console.error('Failed to toggle monitor check', error);
        }
    };

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
    const formatBps = (bps?: number) => {
        if (!bps) return '0 bps';
        if (bps > 1000000) return (bps / 1000000).toFixed(1) + ' Mbps';
        if (bps > 1000) return (bps / 1000).toFixed(1) + ' Kbps';
        return bps.toFixed(0) + ' bps';
    };

    const latest = metrics[metrics.length - 1];
    const memPct = latest?.memory_used && latest?.memory_total
        ? (latest.memory_used / latest.memory_total) * 100
        : latest?.memory_usage;
    const diskPct = latest?.disk_used && latest?.disk_total
        ? (latest.disk_used / latest.disk_total) * 100
        : latest?.disk_usage;
    const pingSamples: any[] = latest?.extra?.ping_results || [];
    const successfulPings = pingSamples.filter(p => p.success);
    const avgLatency = successfulPings.length
        ? (successfulPings.reduce((sum, p) => sum + (p.latency_ms || 0), 0) / successfulPings.length)
        : null;

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
                    { id: 'network', label: 'Network & IPs', icon: Globe },
                    { id: 'sip', label: 'SIP (Asterisk)', icon: Phone },
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
                                    {formatGB(latest?.memory_used)} / {formatGB(latest?.memory_total || device.memory_total)} GB
                                </span>
                            </div>
                            <h4 className="text-slate-400 text-sm font-medium mb-1">RAM Usage</h4>
                            <p className="text-2xl font-bold text-white">{memPct ? memPct.toFixed(1) : '0.0'}%</p>
                        </div>
                        <div className="card">
                            <div className="flex justify-between items-center mb-4">
                                <HardDrive size={24} className="text-amber-400" />
                                <span className="text-xs text-amber-400 font-bold bg-amber-400/10 px-2 py-0.5 rounded">
                                    {formatGB(latest?.disk_used)} / {formatGB(latest?.disk_total || device.disk_total)} GB
                                </span>
                            </div>
                            <h4 className="text-slate-400 text-sm font-medium mb-1">Storage</h4>
                            <p className="text-2xl font-bold text-white">{diskPct ? diskPct.toFixed(1) : '0.0'}%</p>
                        </div>
                        <div className="card">
                            <div className="flex justify-between items-center mb-4">
                                <Wifi size={24} className="text-blue-400" />
                                <span className="text-xs text-blue-400 font-bold bg-blue-400/10 px-2 py-0.5 rounded">
                                    Ping
                                    {successfulPings[0]?.host && (
                                        <span className="ml-2 text-[10px] text-slate-400">({successfulPings[0].host})</span>
                                    )}
                                </span>
                            </div>
                            <h4 className="text-slate-400 text-sm font-medium mb-1">Latency</h4>
                            <p className="text-2xl font-bold text-white">
                                {avgLatency !== null ? `${avgLatency.toFixed(1)}ms` : '—'}
                            </p>
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

            {activeTab === 'network' && (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="card">
                            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                <Globe size={20} className="text-primary-400" />
                                Public Identity
                            </h3>
                            <div className="space-y-4">
                                <div>
                                    <p className="text-slate-400 text-sm">IPv4 Address</p>
                                    <p className="text-xl font-mono text-white tracking-wide">{device.public_ip || 'Fetching...'}</p>
                                </div>
                                <div className="p-3 bg-white/5 rounded-lg border border-white/10">
                                    <p className="text-slate-500 text-xs mb-1 uppercase font-bold">Network Location</p>
                                    <p className="text-slate-300 text-sm">Auto-detected via ident.me</p>
                                </div>
                            </div>
                        </div>
                        <div className="card">
                            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                <NetworkIcon size={20} className="text-emerald-400" />
                                Local Interfaces
                            </h3>
                            <div className="flex flex-wrap gap-2">
                                {device.local_ips?.map((ip: string) => (
                                    <span key={ip} className="px-3 py-1 bg-emerald-500/10 text-emerald-400 rounded-lg font-mono text-sm border border-emerald-500/20">
                                        {ip}
                                    </span>
                                )) || <p className="text-slate-500 text-sm">No local IPs detected</p>}
                            </div>
                        </div>
                    </div>

                    <div className="card overflow-hidden">
                        <h3 className="text-lg font-bold text-white mb-4">Traffic & Throughput</h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="border-b border-dark-border">
                                        <th className="px-4 py-3 text-slate-400 font-medium">Interface</th>
                                        <th className="px-4 py-3 text-slate-400 font-medium">Download (RX)</th>
                                        <th className="px-4 py-3 text-slate-400 font-medium">Upload (TX)</th>
                                        <th className="px-4 py-3 text-slate-400 font-medium text-right">Total Data</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {metrics[metrics.length - 1]?.extra?.interfaces?.map((iface: any) => (
                                        <tr key={iface.name} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                            <td className="px-4 py-3 font-mono text-white">{iface.name}</td>
                                            <td className="px-4 py-3 text-emerald-400 font-medium">{formatBps(iface.rx_bps)}</td>
                                            <td className="px-4 py-3 text-blue-400 font-medium">{formatBps(iface.tx_bps)}</td>
                                            <td className="px-4 py-3 text-slate-400 text-right text-sm">
                                                {((iface.rx_bytes + iface.tx_bytes) / (1024 ** 3)).toFixed(2)} GB
                                            </td>
                                        </tr>
                                    )) || (
                                            <tr>
                                                <td colSpan={4} className="px-4 py-8 text-center text-slate-500">No interface data available</td>
                                            </tr>
                                        )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'sip' && (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="card h-fit">
                            <h3 className="text-lg font-bold text-white mb-4 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Phone size={20} className="text-primary-400" />
                                    PJSIP Registrations
                                </div>
                                <span className="text-xs bg-primary-500/20 text-primary-400 px-2 py-0.5 rounded-full">
                                    {metrics[metrics.length - 1]?.extra?.summary?.registrationsRegistered || 0} / {metrics[metrics.length - 1]?.extra?.summary?.registrationsTotal || 0} OK
                                </span>
                            </h3>
                            <div className="space-y-3">
                                {metrics[metrics.length - 1]?.extra?.registrations?.map((reg: any) => (
                                    <div key={reg.name} className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/10">
                                        <div>
                                            <p className="font-bold text-white">{reg.name}</p>
                                            <p className="text-xs text-slate-500 font-mono truncate max-w-[200px]">{reg.serverUri}</p>
                                        </div>
                                        <div className="text-right">
                                            <span className={clsx(
                                                "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase",
                                                reg.status === 'Registered' ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                                            )}>
                                                {reg.status}
                                            </span>
                                            <p className="text-[10px] text-slate-500 mt-1">Exp: {reg.expiresS}s</p>
                                        </div>
                                    </div>
                                )) || <p className="text-center py-8 text-slate-500">No registrations found</p>}
                            </div>
                        </div>

                        <div className="card h-fit">
                            <h3 className="text-lg font-bold text-white mb-4 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Activity size={20} className="text-emerald-400" />
                                    Trunk Contacts & RTT
                                </div>
                                <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">
                                    {metrics[metrics.length - 1]?.extra?.summary?.contactsAvail || 0} Available
                                </span>
                            </h3>
                            <div className="space-y-2">
                                {metrics[metrics.length - 1]?.extra?.contacts?.map((contact: any) => (
                                    <div key={contact.aor} className="grid grid-cols-12 items-center p-3 bg-white/5 rounded-xl border border-white/10 hover:bg-white/10 transition-colors">
                                        <div className="col-span-4">
                                            <p className="font-bold text-white text-sm">{contact.aor}</p>
                                        </div>
                                        <div className="col-span-5 text-center">
                                            <div className="flex items-center justify-center gap-2">
                                                <div className={`w-2 h-2 rounded-full ${contact.status === 'Avail' ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : 'bg-red-500'}`} />
                                                <span className={`text-xs font-medium ${contact.status === 'Avail' ? 'text-emerald-400' : 'text-red-400'}`}>
                                                    {contact.status}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="col-span-3 text-right">
                                            <p className={clsx(
                                                "text-xs font-mono font-bold",
                                                !contact.rttMs ? "text-slate-600" :
                                                    contact.rttMs > 200 ? "text-amber-400" : "text-emerald-400"
                                            )}>
                                                {contact.rttMs ? `${contact.rttMs.toFixed(1)}ms` : '--'}
                                            </p>
                                        </div>
                                    </div>
                                )) || <p className="text-center py-8 text-slate-500">No contact stats available</p>}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'checks' && (
                <div className="space-y-6">
                    <div className="flex justify-between items-center">
                        <h3 className="text-xl font-bold text-white">Monitoring Rules</h3>
                        <button className="btn-primary flex items-center gap-2">
                            <CheckCircle2 size={18} />
                            Add New Rule
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {checks.length === 0 ? (
                            <div className="col-span-full card py-12 text-center">
                                <ShieldCheck size={48} className="mx-auto text-slate-700 mb-4" />
                                <p className="text-slate-400">No monitoring rules configured for this device.</p>
                                <button
                                    onClick={() => setIsModalOpen(true)}
                                    className="mt-4 text-primary-400 font-bold hover:underline"
                                >
                                    Create your first rule
                                </button>
                            </div>
                        ) : (
                            checks.map((check) => {
                                const unit = check.check_type === 'sip' ? 'ms' : check.check_type === 'bandwidth' ? 'Mbps' : '%';
                                return (
                                    <div key={check._id} className={clsx(
                                        "card group hover:border-primary-500/30 transition-all",
                                        !check.enabled && "opacity-60 grayscale-[0.5]"
                                    )}>
                                        <div className="flex justify-between items-start mb-4">
                                            <div className="p-2 bg-primary-500/10 rounded-lg text-primary-400 group-hover:bg-primary-500 group-hover:text-white transition-all">
                                                {check.check_type === 'cpu' ? <Cpu size={20} /> :
                                                    check.check_type === 'memory' ? <Memory size={20} /> :
                                                        check.check_type === 'sip' ? <Phone size={20} /> : <Wifi size={20} />}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => handleToggleCheck(check)}
                                                    className={clsx(
                                                        "w-10 h-5 rounded-full relative transition-all border",
                                                        check.enabled ? "bg-emerald-500/20 border-emerald-500/30" : "bg-slate-700 border-slate-600"
                                                    )}
                                                >
                                                    <div className={clsx(
                                                        "absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all shadow-lg",
                                                        check.enabled ? "right-1 bg-emerald-500" : "left-1 bg-slate-400"
                                                    )} />
                                                </button>
                                            </div>
                                        </div>
                                        <h4 className="font-bold text-white mb-1 uppercase text-sm">
                                            {check.check_type} {check.target ? `(${check.target})` : ''}
                                        </h4>
                                        <p className="text-[10px] text-slate-500 mb-4 tracking-widest font-bold">INTERVAL: {check.interval}S</p>

                                        <div className="grid grid-cols-2 gap-4 mb-4">
                                            <div className="p-2 bg-amber-500/5 rounded-lg border border-amber-500/10">
                                                <p className="text-[10px] text-amber-500 uppercase font-bold mb-1">Attention</p>
                                                <p className="text-lg font-bold text-white">{">"}{check.thresholds?.attention || 0}{unit}</p>
                                            </div>
                                            <div className="p-2 bg-red-500/5 rounded-lg border border-red-500/10">
                                                <p className="text-[10px] text-red-500 uppercase font-bold mb-1">Critical</p>
                                                <p className="text-lg font-bold text-white">{">"}{check.thresholds?.critical || 0}{unit}</p>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between pt-4 border-t border-white/5">
                                            <div className="flex items-center gap-2 text-slate-500 text-[10px] font-bold uppercase">
                                                <Bell size={12} />
                                                <span>{check.notification_frequency}m cooldown</span>
                                            </div>
                                            <div className="flex gap-3">
                                                <button
                                                    onClick={() => handleDeleteCheck(check._id)}
                                                    className="text-[10px] font-bold text-red-400/50 hover:text-red-400 transition-colors uppercase"
                                                >
                                                    Delete
                                                </button>
                                                <button
                                                    onClick={() => { setEditingCheck(check); setIsModalOpen(true); }}
                                                    className="text-[10px] font-bold text-primary-400 hover:text-white transition-colors uppercase"
                                                >
                                                    Adjust
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
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

            <MonitoringRuleModal
                isOpen={isModalOpen}
                onClose={() => { setIsModalOpen(false); setEditingCheck(null); }}
                onSave={handleSaveCheck}
                initialData={editingCheck}
                device={device}
            />
        </div>
    );
};
