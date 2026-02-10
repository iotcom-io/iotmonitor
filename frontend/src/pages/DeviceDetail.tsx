import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    Activity, Cpu, HardDrive, Wifi, MemoryStick as Memory,
    Globe, Network as NetworkIcon, Phone, CheckCircle2, XCircle, AlertCircle, Bell,
    Terminal as TerminalIcon, ChevronDown, ChevronUp, Copy, RefreshCw, ExternalLink, ShieldCheck, Settings, ArrowLeft, Loader2,
    Box, Pause, Play, Edit2, Trash2
} from 'lucide-react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, AreaChart, Area
} from 'recharts';
import api from '../lib/axios';
import { clsx } from 'clsx';
import { MonitoringRuleModal } from '../components/MonitoringRuleModal';
import { IncidentBanner } from '../components/IncidentBanner';
import { Info, Send, Eraser, SquareTerminal as Terminal } from 'lucide-react';
import { io } from 'socket.io-client';
import { ConfirmationModal } from '../components/ConfirmationModal';
import { useAuthStore } from '../store/useAuthStore';

type ModuleName = 'system' | 'docker' | 'asterisk' | 'network';
const ALL_MODULES: ModuleName[] = ['system', 'docker', 'asterisk', 'network'];
type HistoryPreset = '1h' | '6h' | '24h' | '7d' | 'custom';
type HistoryBucket = 'auto' | 'raw' | '1m' | '5m' | '15m' | '1h' | '6h' | '1d';

const HISTORY_BUCKET_OPTIONS: Array<{ value: HistoryBucket; label: string }> = [
    { value: 'auto', label: 'Auto' },
    { value: 'raw', label: 'Raw' },
    { value: '1m', label: '1 min' },
    { value: '5m', label: '5 min' },
    { value: '15m', label: '15 min' },
    { value: '1h', label: '1 hour' },
    { value: '6h', label: '6 hour' },
    { value: '1d', label: '1 day' },
];

const toDateTimeLocalValue = (value: Date) => {
    const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
};

const presetToRange = (preset: Exclude<HistoryPreset, 'custom'>) => {
    const to = new Date();
    const from = new Date(to);
    if (preset === '1h') from.setHours(from.getHours() - 1);
    if (preset === '6h') from.setHours(from.getHours() - 6);
    if (preset === '24h') from.setHours(from.getHours() - 24);
    if (preset === '7d') from.setDate(from.getDate() - 7);
    return { from, to };
};

const numberOrNull = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

export const DeviceDetail = () => {
    const { id } = useParams();
    const token = useAuthStore(state => state.token);
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('metrics');
    const [device, setDevice] = useState<any>(null);
    const [metrics, setMetrics] = useState<any[]>([]);
    const [historicalMetrics, setHistoricalMetrics] = useState<any[]>([]);
    const [checks, setChecks] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyExporting, setHistoryExporting] = useState(false);
    const [historyPreset, setHistoryPreset] = useState<HistoryPreset>('24h');
    const [historyBucket, setHistoryBucket] = useState<HistoryBucket>('auto');
    const [historyFrom, setHistoryFrom] = useState('');
    const [historyTo, setHistoryTo] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingCheck, setEditingCheck] = useState<any>(null);
    const [incidents, setIncidents] = useState<any[]>([]);
    const [ruleFilter, setRuleFilter] = useState<'all' | 'issues' | 'nodata' | 'disabled'>('all');
    const [hideNoData, setHideNoData] = useState(false);
    const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');
    const [selectedRule, setSelectedRule] = useState<any>(null);
    const [isAgentInstallOpen, setIsAgentInstallOpen] = useState(false);

    // Terminal State
    const [terminalInput, setTerminalInput] = useState('');
    const [terminalOutputs, setTerminalOutputs] = useState<any[]>([]);
    const [isTerminalLoading, setIsTerminalLoading] = useState(false);
    const [socket, setSocket] = useState<any>(null);

    // Confirmation Modal State
    const [confirmModal, setConfirmModal] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        onConfirm?: () => void;
        type?: 'info' | 'warning' | 'danger' | 'success';
    }>({
        isOpen: false,
        title: '',
        message: ''
    });

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 5000); // 5s refresh
        return () => clearInterval(interval);
    }, [id]);

    const fetchData = async () => {
        try {
            const [deviceRes, metricsRes, checksRes] = await Promise.all([
                api.get(`/devices/${id}`),
                api.get(`/monitoring/metrics/${id}`),
                api.get(`/monitoring/checks/${id}`),
            ]);
            setDevice(deviceRes.data);
            setMetrics(metricsRes.data);
            setChecks(checksRes.data);
            const incRes = await api.get(`/incidents`, { params: { target_id: id, status: 'open' } });
            setIncidents(incRes.data);
        } catch (error) {
            console.error('Failed to fetch device data', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchHistoricalData = async (fromValue: string, toValue: string, bucketValue: HistoryBucket = historyBucket) => {
        if (!id) return;
        const fromDate = new Date(fromValue);
        const toDate = new Date(toValue);

        if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
            return;
        }

        setHistoryLoading(true);
        try {
            const response = await api.get(`/monitoring/metrics/${id}`, {
                params: {
                    from: fromDate.toISOString(),
                    to: toDate.toISOString(),
                    bucket: bucketValue,
                    limit: 60000,
                    max_points: 1200,
                }
            });
            setHistoricalMetrics(Array.isArray(response.data) ? response.data : []);
        } catch (error) {
            console.error('Failed to fetch historical metrics', error);
            setHistoricalMetrics([]);
        } finally {
            setHistoryLoading(false);
        }
    };

    const applyHistoryPreset = (preset: Exclude<HistoryPreset, 'custom'>) => {
        const range = presetToRange(preset);
        const nextFrom = toDateTimeLocalValue(range.from);
        const nextTo = toDateTimeLocalValue(range.to);
        setHistoryPreset(preset);
        setHistoryFrom(nextFrom);
        setHistoryTo(nextTo);
        fetchHistoricalData(nextFrom, nextTo, historyBucket);
    };

    const handleApplyCustomHistory = () => {
        if (!historyFrom || !historyTo) return;
        const fromDate = new Date(historyFrom);
        const toDate = new Date(historyTo);
        if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) return;

        setHistoryPreset('custom');
        fetchHistoricalData(historyFrom, historyTo, historyBucket);
    };

    useEffect(() => {
        const range = presetToRange('24h');
        const nextFrom = toDateTimeLocalValue(range.from);
        const nextTo = toDateTimeLocalValue(range.to);
        setHistoryPreset('24h');
        setHistoryBucket('auto');
        setHistoryFrom(nextFrom);
        setHistoryTo(nextTo);
        fetchHistoricalData(nextFrom, nextTo, 'auto');
    }, [id]);

    useEffect(() => {
        if (!historyFrom || !historyTo) return;
        const fromDate = new Date(historyFrom);
        const toDate = new Date(historyTo);
        if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) return;
        fetchHistoricalData(historyFrom, historyTo, historyBucket);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [historyBucket]);

    const handleExportHistoricalCsv = async () => {
        if (!id || !historyFrom || !historyTo) return;
        const fromDate = new Date(historyFrom);
        const toDate = new Date(historyTo);
        if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) return;

        setHistoryExporting(true);
        try {
            const response = await api.get(`/monitoring/metrics/${id}/export`, {
                params: {
                    from: fromDate.toISOString(),
                    to: toDate.toISOString(),
                    bucket: historyBucket,
                    max_points: 5000,
                    limit: 250000,
                },
                responseType: 'blob',
            });

            const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `telemetry-${id}-${historyBucket}.csv`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Failed to export telemetry CSV', error);
        } finally {
            setHistoryExporting(false);
        }
    };

    const handleExecuteCommand = (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!terminalInput.trim() || !socket) return;

        setIsTerminalLoading(true);
        socket.emit('terminal:command', {
            device_id: id,
            command: terminalInput
        });

        setTerminalOutputs(prev => [...prev.slice(-49), {
            type: 'command',
            payload: terminalInput,
            timestamp: new Date()
        }]);
        setTerminalInput('');
    };

    useEffect(() => {
        const socketInstance = io(import.meta.env.VITE_API_URL || undefined, {
            transports: ['websocket'],
            auth: { token }
        });
        setSocket(socketInstance);

        socketInstance.on('connect', () => {
            console.log('[TERMINAL] Connected to backend');
        });

        socketInstance.on(`terminal:output:${id}`, (response: any) => {
            setTerminalOutputs(prev => [...prev.slice(-49), {
                ...response,
                timestamp: new Date()
            }]);
            setIsTerminalLoading(false);
        });

        return () => {
            socketInstance.disconnect();
        };
    }, [id, token]);

    const handleSaveCheck = async (ruleData: any | any[]) => {
        try {
            const rules = Array.isArray(ruleData) ? ruleData : [ruleData];

            await Promise.all(rules.map(rule => {
                if (rule._id) {
                    return api.put(`/monitoring/${rule._id}`, rule);
                } else {
                    return api.post('/monitoring', { ...rule, device_id: id });
                }
            }));

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
        setConfirmModal({
            isOpen: true,
            title: 'Delete Rule',
            message: 'Are you sure you want to delete this monitoring rule? This action cannot be undone.',
            type: 'danger',
            onConfirm: async () => {
                try {
                    await api.delete(`/monitoring/${checkId}`);
                    setChecks(checks.filter((c: any) => c._id !== checkId));
                } catch (error) {
                    console.error('Failed to delete monitor check', error);
                }
            }
        });
    };

    const handleToggleCheck = async (check: any) => {
        try {
            const updated = await api.put(`/monitoring/${check._id}`, { enabled: !check.enabled });
            setChecks(checks.map((c: any) => c._id === check._id ? updated.data : c));
        } catch (error) {
            console.error('Failed to toggle monitor check', error);
        }
    };

    const enabledModules = useMemo<ModuleName[]>(() => {
        if (!device) return ['system'];

        const modulesFromConfig = device?.config?.modules;
        if (modulesFromConfig && typeof modulesFromConfig === 'object') {
            const selected = ALL_MODULES.filter((module) => modulesFromConfig[module] === true);
            if (selected.length > 0) {
                return selected;
            }
        }

        if (Array.isArray(device?.enabled_modules)) {
            const selected = device.enabled_modules.filter((module: string) => ALL_MODULES.includes(module as ModuleName));
            if (selected.length > 0) {
                return selected as ModuleName[];
            }
        }

        return ['system'];
    }, [device]);

    const tabs = useMemo(() => ([
        { id: 'metrics', label: 'Real-time Metrics', icon: Activity, requiredModule: 'system' as ModuleName | null },
        { id: 'network', label: 'Network & IPs', icon: Globe, requiredModule: 'network' as ModuleName | null },
        { id: 'sip', label: 'SIP (Asterisk)', icon: Phone, requiredModule: 'asterisk' as ModuleName | null },
        { id: 'docker', label: 'Docker Containers', icon: Box, requiredModule: 'docker' as ModuleName | null },
        { id: 'terminal', label: 'Remote Terminal', icon: TerminalIcon, requiredModule: null },
        { id: 'checks', label: 'Monitor Checks', icon: ShieldCheck, requiredModule: null },
        { id: 'settings', label: 'Configuration', icon: Settings, requiredModule: null },
    ]), []);

    const visibleTabs = useMemo(
        () => tabs.filter((tab) => !tab.requiredModule || enabledModules.includes(tab.requiredModule)),
        [tabs, enabledModules]
    );

    useEffect(() => {
        if (visibleTabs.length === 0) return;
        if (!visibleTabs.some((tab) => tab.id === activeTab)) {
            setActiveTab(visibleTabs[0].id);
        }
    }, [activeTab, visibleTabs]);

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
    // Memory: agent already reports used = total - available (includes cache/buffers). Use that directly.
    const memPct = latest?.memory_usage ?? (latest?.memory_used !== undefined && latest?.memory_total
        ? (latest.memory_used / latest.memory_total) * 100
        : undefined);
    const cacheBuffers = (latest?.memory_cached || 0) + (latest?.memory_buffers || 0);
    const diskPct = latest?.disk_usage !== undefined
        ? latest.disk_usage
        : (latest?.disk_used !== undefined && latest?.disk_total ? (latest.disk_used / latest.disk_total) * 100 : undefined);
    const pingSamples: any[] = latest?.extra?.ping_results || [];
    const dockerContainers: any[] = Array.isArray(latest?.extra?.docker)
        ? latest.extra.docker
        : (latest?.extra?.docker?.containers || []);
    const successfulPings = pingSamples.filter(p => p.success);
    const avgLatency = successfulPings.length
        ? (successfulPings.reduce((sum, p) => sum + (p.latency_ms || 0), 0) / successfulPings.length)
        : null;
    const historyWindowMs = useMemo(() => {
        if (!historyFrom || !historyTo) return 0;
        const fromDate = new Date(historyFrom);
        const toDate = new Date(historyTo);
        if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return 0;
        return Math.max(0, toDate.getTime() - fromDate.getTime());
    }, [historyFrom, historyTo]);
    const historyRangeInvalid = useMemo(() => {
        if (!historyFrom || !historyTo) return false;
        const fromDate = new Date(historyFrom);
        const toDate = new Date(historyTo);
        if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return true;
        return fromDate > toDate;
    }, [historyFrom, historyTo]);

    const historyTickFormatter = (value: string) => {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '--';
        if (historyWindowMs > 48 * 60 * 60 * 1000) {
            return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        }
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const historicalSeries = useMemo(() => {
        return historicalMetrics.map((sample: any) => {
            const precomputedBandwidth = numberOrNull(sample?.bandwidth_mbps);
            const interfaces = Array.isArray(sample?.extra?.interfaces) ? sample.extra.interfaces : [];
            let totalBandwidthBps = 0;
            for (const iface of interfaces) {
                const ifaceName = String(iface?.name || '').toLowerCase();
                if (ifaceName === 'lo' || ifaceName.startsWith('loopback')) continue;
                totalBandwidthBps += (numberOrNull(iface?.rx_bps) || 0) + (numberOrNull(iface?.tx_bps) || 0);
            }
            if (totalBandwidthBps === 0) {
                totalBandwidthBps = (numberOrNull(sample?.network_in) || 0) + (numberOrNull(sample?.network_out) || 0);
            }
            const computedBandwidth = totalBandwidthBps > 0 ? totalBandwidthBps / 1000000 : null;
            const bandwidthMbps = precomputedBandwidth !== null ? precomputedBandwidth : computedBandwidth;

            const precomputedSipRtt = numberOrNull(sample?.sip_rtt_avg_ms);
            const contacts = Array.isArray(sample?.extra?.contacts) ? sample.extra.contacts : [];
            const rttValues = contacts
                .map((contact: any) => numberOrNull(contact?.rttMs))
                .filter((value: number | null): value is number => value !== null && value >= 0);
            const sipRttAvg = rttValues.length > 0
                ? rttValues.reduce((sum: number, value: number) => sum + value, 0) / rttValues.length
                : null;
            const sipRttValue = precomputedSipRtt !== null ? precomputedSipRtt : sipRttAvg;

            const precomputedSipRegistration = numberOrNull(sample?.sip_registration_percent);
            const registrations = Array.isArray(sample?.extra?.registrations) ? sample.extra.registrations : [];
            const summary = sample?.extra?.summary || {};
            const totalRegs = numberOrNull(summary?.registrationsTotal);
            const okRegs = numberOrNull(summary?.registrationsRegistered);
            let sipRegistrationPercent: number | null = null;
            if (totalRegs && totalRegs > 0 && okRegs !== null) {
                sipRegistrationPercent = (okRegs / totalRegs) * 100;
            } else if (registrations.length > 0) {
                const registeredCount = registrations.filter((registration: any) => {
                    const status = String(registration?.status || '').toLowerCase();
                    return status === 'registered' || status === 'ok';
                }).length;
                sipRegistrationPercent = (registeredCount / registrations.length) * 100;
            }
            const sipRegistrationValue = precomputedSipRegistration !== null ? precomputedSipRegistration : sipRegistrationPercent;

            return {
                ...sample,
                bandwidth_mbps: bandwidthMbps,
                sip_rtt_avg_ms: sipRttValue,
                sip_registration_percent: sipRegistrationValue,
            };
        });
    }, [historicalMetrics]);

    const isOffline = device?.status === 'offline';

    const getTabAlerts = (tabId: string) => {
        const categoryMap: Record<string, string[]> = {
            metrics: ['cpu', 'memory', 'disk'],
            network: ['bandwidth', 'utilization'],
            sip: ['sip_rtt', 'sip_registration'],
            docker: ['container_status']
        };

        const relevantTypes = categoryMap[tabId] || [];
        const relevantChecks = checks.filter(c => relevantTypes.includes(c.check_type) && c.enabled);

        const criticalCount = relevantChecks.filter(c => c.last_state === 'critical').length;
        const warningCount = relevantChecks.filter(c => c.last_state === 'warning').length;

        return { criticalCount, warningCount };
    };

    return (
        <div className="space-y-8">
            {/* Sticky Header & Navigation Section */}
            <div className="sticky top-0 z-30 -mt-8 pt-8 pb-4 bg-[#0a0f18]/80 backdrop-blur-xl border-b border-white/5 -mx-8 px-8 space-y-6">
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                    <div className="flex items-center gap-5">
                        <button
                            onClick={() => navigate('/devices')}
                            className="p-2.5 bg-white/5 border border-white/10 rounded-2xl text-slate-400 hover:text-white hover:bg-white/10 transition-all group"
                        >
                            <ArrowLeft size={20} className="group-hover:-translate-x-1 transition-transform" />
                        </button>
                        <div className="space-y-1.5">
                            <div className="flex items-center gap-4">
                                <h2 className="text-3xl font-black text-white tracking-tighter uppercase leading-none">{device.name}</h2>
                                <div className="flex items-center gap-2">
                                    <span className={clsx(
                                        "px-2.5 py-1 rounded-lg text-[10px] font-black border uppercase tracking-[0.1em] leading-none",
                                        device.status === 'online' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                                            device.status === 'warning' ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"
                                    )}>
                                        {device.status}
                                    </span>
                                    {device.monitoring_paused && (
                                        <span className="px-2.5 py-1 rounded-lg text-[10px] font-black bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase tracking-[0.1em] leading-none animate-pulse">
                                            Paused
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-3 text-slate-500 text-xs font-mono">
                                <span className="flex items-center gap-1.5">
                                    <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">ID:</span>
                                    {id}
                                </span>
                                <span className="w-1 h-1 bg-slate-800 rounded-full" />
                                <span className="flex items-center gap-1.5">
                                    <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Host:</span>
                                    {device.hostname || '—'}
                                </span>
                            </div>
                        </div>
                    </div>

                    {latest && (
                        <div className="flex items-center gap-2 px-4 py-2 bg-white/[0.03] border border-white/5 rounded-2xl">
                            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                Live updates active • {new Date(latest.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                        </div>
                    )}
                </div>

                <div className="flex gap-2 p-1 bg-dark-surface/50 border border-dark-border rounded-xl w-full">
                    {visibleTabs.map(tab => {
                        const { criticalCount, warningCount } = getTabAlerts(tab.id);
                        const hasAlert = (criticalCount > 0 || warningCount > 0) && tab.id !== 'checks';
                        const alertColor = criticalCount > 0 ? 'bg-red-500' : 'bg-amber-500';

                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium transition-all relative ${activeTab === tab.id
                                    ? "bg-primary-600 text-white shadow-lg shadow-primary-500/20"
                                    : "text-slate-400 hover:text-slate-100 hover:bg-white/5"
                                    }`}
                            >
                                <tab.icon size={18} />
                                <span className="relative">
                                    <span className="hidden xl:inline">{tab.label}</span>
                                    <span className="xl:hidden">{tab.label.split(' ')[0]}</span>
                                    {hasAlert && (
                                        <span className={clsx(
                                            "absolute -top-1 -right-4 flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full text-[8px] font-black text-white",
                                            alertColor,
                                            criticalCount > 0 && "animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.5)]",
                                            warningCount > 0 && criticalCount === 0 && "shadow-[0_0_8px_rgba(245,158,11,0.5)]"
                                        )}>
                                            {criticalCount + warningCount}
                                        </span>
                                    )}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {activeTab === 'metrics' && (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 relative">
                        {isOffline && (
                            <div className="absolute inset-x-0 inset-y-0 z-10 bg-slate-950/60 backdrop-blur-[2px] rounded-3xl flex items-center justify-center border border-white/5 animate-in fade-in duration-500">
                                <div className="flex flex-col items-center gap-3 p-6 bg-slate-900/80 border border-white/10 rounded-2xl shadow-2xl">
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                                        <span className="text-xs font-black text-white uppercase tracking-widest">Device Offline</span>
                                    </div>
                                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tight text-center">No realtime data receiving</p>
                                </div>
                            </div>
                        )}
                        <div className="card">
                            <div className="flex justify-between items-center mb-4">
                                <div className="flex items-center gap-2">
                                    <Cpu size={24} className="text-primary-400" />
                                    <Info size={16} className="text-slate-500" data-tooltip="Hover to see per-core usage" />
                                </div>
                                <span className="text-xs text-primary-400 font-bold bg-primary-400/10 px-2 py-0.5 rounded" title="1 minute load average">
                                    Load: {metrics[metrics.length - 1]?.cpu_load?.toFixed(2) || '0.00'}
                                </span>
                            </div>
                            <h4 className="text-slate-400 text-sm font-medium mb-1">CPU Usage</h4>
                            <p className="text-2xl font-bold text-white">{latest?.cpu_usage !== undefined ? latest.cpu_usage.toFixed(1) : '0.0'}%</p>
                            {latest?.cpu_per_core && latest.cpu_per_core.length > 0 && !isOffline && (
                                <div className="mt-3">
                                    <p className="text-[10px] uppercase text-slate-500 font-bold mb-1">Per-core</p>
                                    <div className="flex flex-wrap gap-2 text-xs text-slate-400">
                                        {latest.cpu_per_core.map((val: number, idx: number) => (
                                            <span key={idx} className="px-2 py-1 bg-white/5 rounded border border-white/10" title={`Core ${idx}: ${val.toFixed(1)}%`}>
                                                C{idx}: {val.toFixed(0)}%
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="card">
                            <div className="flex justify-between items-center mb-4">
                                <Memory size={24} className="text-emerald-400" />
                                <span className="text-xs text-emerald-400 font-bold bg-emerald-400/10 px-2 py-0.5 rounded">
                                    {formatGB(latest?.memory_used)} / {formatGB(latest?.memory_total || device.memory_total)} GB
                                </span>
                            </div>
                            <h4 className="text-slate-400 text-sm font-medium mb-1">RAM Usage</h4>
                            <p className="text-2xl font-bold text-white">{memPct !== undefined ? Math.min(memPct, 100).toFixed(1) : '0.0'}%</p>
                            <p className="text-[10px] text-slate-500 mt-1">
                                cache+buffers: {cacheBuffers ? `${cacheBuffers / (1024 ** 3) < 0.01 ? '<0.01' : (cacheBuffers / (1024 ** 3)).toFixed(2)} GB` : '0 GB'}
                            </p>
                        </div>
                        <div className="card">
                            <div className="flex justify-between items-center mb-4">
                                <HardDrive size={24} className="text-amber-400" />
                                <span className="text-xs text-amber-400 font-bold bg-amber-400/10 px-2 py-0.5 rounded">
                                    {formatGB(latest?.disk_used)} / {formatGB(latest?.disk_total || device.disk_total)} GB
                                </span>
                            </div>
                            <h4 className="text-slate-400 text-sm font-medium mb-1">Storage</h4>
                            <p className="text-2xl font-bold text-white">{diskPct !== undefined ? diskPct.toFixed(1) : '0.0'}%</p>
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

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 relative">
                        {isOffline && (
                            <div className="absolute inset-x-0 inset-y-0 z-10 bg-slate-950/40 backdrop-blur-[1px] rounded-[32px] pointer-events-none" />
                        )}
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

                    <div className="card space-y-6">
                        <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-6">
                            <div>
                                <h3 className="text-lg font-bold text-white">Historical Trends</h3>
                                <p className="text-sm text-slate-500">Select a date range to review archival telemetry for enabled modules.</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {(['1h', '6h', '24h', '7d'] as const).map((preset) => (
                                    <button
                                        key={preset}
                                        onClick={() => applyHistoryPreset(preset)}
                                        className={clsx(
                                            "px-3 py-1.5 rounded-lg text-xs font-bold transition-all border",
                                            historyPreset === preset
                                                ? "bg-primary-500/20 border-primary-500 text-primary-400"
                                                : "bg-white/5 border-white/10 text-slate-400 hover:text-white"
                                        )}
                                    >
                                        Last {preset}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 xl:grid-cols-[1fr_1fr_180px_auto_auto] gap-3">
                            <input
                                type="datetime-local"
                                value={historyFrom}
                                onChange={(e) => setHistoryFrom(e.target.value)}
                                className="input-field"
                            />
                            <input
                                type="datetime-local"
                                value={historyTo}
                                onChange={(e) => setHistoryTo(e.target.value)}
                                className="input-field"
                            />
                            <select
                                value={historyBucket}
                                onChange={(e) => setHistoryBucket(e.target.value as HistoryBucket)}
                                className="input-field"
                            >
                                {HISTORY_BUCKET_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                            <button
                                onClick={handleApplyCustomHistory}
                                className="btn-primary px-5 py-2.5 whitespace-nowrap disabled:opacity-50"
                                disabled={!historyFrom || !historyTo || historyLoading || historyRangeInvalid}
                            >
                                {historyLoading ? 'Loading...' : 'Apply Range'}
                            </button>
                            <button
                                onClick={handleExportHistoricalCsv}
                                className="px-5 py-2.5 rounded-xl border border-primary-500/40 text-primary-300 hover:bg-primary-500/10 transition-all whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                                disabled={!historyFrom || !historyTo || historyLoading || historyExporting || historyRangeInvalid}
                            >
                                {historyExporting ? 'Exporting...' : 'Export CSV'}
                            </button>
                        </div>

                        {historyRangeInvalid && (
                            <div className="text-xs text-red-400">
                                Invalid range: `From` must be earlier than `To`.
                            </div>
                        )}
                        {historyBucket === 'raw' && historyWindowMs > (48 * 60 * 60 * 1000) && (
                            <div className="text-xs text-amber-400">
                                `Raw` bucket supports up to 48 hours. Use `Auto` or an aggregated bucket for longer ranges.
                            </div>
                        )}

                        {historyLoading ? (
                            <div className="h-44 flex items-center justify-center">
                                <Loader2 size={24} className="animate-spin text-primary-500" />
                            </div>
                        ) : historicalSeries.length === 0 ? (
                            <div className="h-44 flex items-center justify-center text-sm text-slate-500 border border-white/10 rounded-2xl bg-white/[0.02]">
                                No archival telemetry found for the selected range.
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                                {enabledModules.includes('system') && (
                                    <div className="space-y-6">
                                        <div className="h-72 border border-white/10 rounded-2xl p-4 bg-white/[0.02]">
                                            <h4 className="text-sm font-bold text-white mb-3">CPU Usage (%)</h4>
                                            <ResponsiveContainer width="100%" height="90%">
                                                <LineChart data={historicalSeries}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                                                    <XAxis dataKey="timestamp" stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} tickFormatter={historyTickFormatter} />
                                                    <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                                                    <Tooltip
                                                        contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                                                        labelFormatter={(value) => new Date(String(value)).toLocaleString()}
                                                        formatter={(value: any) => [value !== null && value !== undefined ? `${Number(value).toFixed(1)}%` : '--', 'CPU']}
                                                    />
                                                    <Line type="monotone" dataKey="cpu_usage" stroke="#0ea5e9" strokeWidth={2} dot={false} />
                                                </LineChart>
                                            </ResponsiveContainer>
                                        </div>
                                        <div className="h-72 border border-white/10 rounded-2xl p-4 bg-white/[0.02]">
                                            <h4 className="text-sm font-bold text-white mb-3">Memory Usage (%)</h4>
                                            <ResponsiveContainer width="100%" height="90%">
                                                <LineChart data={historicalSeries}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                                                    <XAxis dataKey="timestamp" stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} tickFormatter={historyTickFormatter} />
                                                    <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                                                    <Tooltip
                                                        contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                                                        labelFormatter={(value) => new Date(String(value)).toLocaleString()}
                                                        formatter={(value: any) => [value !== null && value !== undefined ? `${Number(value).toFixed(1)}%` : '--', 'Memory']}
                                                    />
                                                    <Line type="monotone" dataKey="memory_usage" stroke="#10b981" strokeWidth={2} dot={false} />
                                                </LineChart>
                                            </ResponsiveContainer>
                                        </div>
                                    </div>
                                )}

                                {enabledModules.includes('network') && (
                                    <div className="h-72 border border-white/10 rounded-2xl p-4 bg-white/[0.02]">
                                        <h4 className="text-sm font-bold text-white mb-3">Bandwidth (Mbps)</h4>
                                        <ResponsiveContainer width="100%" height="90%">
                                            <LineChart data={historicalSeries}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                                                <XAxis dataKey="timestamp" stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} tickFormatter={historyTickFormatter} />
                                                <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                                                <Tooltip
                                                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                                                    labelFormatter={(value) => new Date(String(value)).toLocaleString()}
                                                    formatter={(value: any) => [value !== null && value !== undefined ? `${Number(value).toFixed(2)} Mbps` : '--', 'Bandwidth']}
                                                />
                                                <Line type="monotone" dataKey="bandwidth_mbps" stroke="#3b82f6" strokeWidth={2} dot={false} />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </div>
                                )}

                                {enabledModules.includes('asterisk') && (
                                    <div className="space-y-6">
                                        <div className="h-72 border border-white/10 rounded-2xl p-4 bg-white/[0.02]">
                                            <h4 className="text-sm font-bold text-white mb-3">SIP RTT Average (ms)</h4>
                                            <ResponsiveContainer width="100%" height="90%">
                                                <LineChart data={historicalSeries}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                                                    <XAxis dataKey="timestamp" stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} tickFormatter={historyTickFormatter} />
                                                    <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                                                    <Tooltip
                                                        contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                                                        labelFormatter={(value) => new Date(String(value)).toLocaleString()}
                                                        formatter={(value: any) => [value !== null && value !== undefined ? `${Number(value).toFixed(1)} ms` : '--', 'SIP RTT']}
                                                    />
                                                    <Line type="monotone" dataKey="sip_rtt_avg_ms" stroke="#f59e0b" strokeWidth={2} dot={false} />
                                                </LineChart>
                                            </ResponsiveContainer>
                                        </div>
                                        <div className="h-72 border border-white/10 rounded-2xl p-4 bg-white/[0.02]">
                                            <h4 className="text-sm font-bold text-white mb-3">SIP Registration (%)</h4>
                                            <ResponsiveContainer width="100%" height="90%">
                                                <LineChart data={historicalSeries}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                                                    <XAxis dataKey="timestamp" stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} tickFormatter={historyTickFormatter} />
                                                    <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} domain={[0, 100]} />
                                                    <Tooltip
                                                        contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                                                        labelFormatter={(value) => new Date(String(value)).toLocaleString()}
                                                        formatter={(value: any) => [value !== null && value !== undefined ? `${Number(value).toFixed(1)}%` : '--', 'Registration']}
                                                    />
                                                    <Line type="monotone" dataKey="sip_registration_percent" stroke="#22c55e" strokeWidth={2} dot={false} />
                                                </LineChart>
                                            </ResponsiveContainer>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
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
                            <div className="flex flex-wrap gap-3">
                                {(() => {
                                    const ifaceMetrics = metrics[metrics.length - 1]?.extra?.interfaces?.filter((iface: any) =>
                                        (iface.ips?.length > 0 || iface.ip) && iface.name !== 'lo'
                                    );

                                    if (ifaceMetrics && ifaceMetrics.length > 0) {
                                        return ifaceMetrics.map((iface: any) => (
                                            <div key={iface.name} className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                                                <span className="text-[10px] font-black text-emerald-500/60 uppercase tracking-widest">{iface.name}</span>
                                                <span className="text-sm font-mono font-bold text-emerald-400">
                                                    {iface.ips?.[0] || iface.ip}
                                                </span>
                                            </div>
                                        ));
                                    }

                                    if (device.local_ips && device.local_ips.length > 0) {
                                        return device.local_ips.map((ip: string) => (
                                            <span key={ip} className="px-3 py-1 bg-emerald-500/10 text-emerald-400 rounded-lg font-mono text-sm border border-emerald-500/20">
                                                {ip}
                                            </span>
                                        ));
                                    }

                                    return <p className="text-slate-500 text-sm">No local IPs detected</p>;
                                })()}
                            </div>
                        </div>
                    </div>

                    <div className="card overflow-hidden relative">
                        {isOffline && (
                            <div className="absolute inset-x-0 inset-y-0 z-10 bg-slate-950/60 backdrop-blur-[2px] flex flex-col items-center justify-center p-8 animate-in fade-in duration-500">
                                <Activity size={32} className="text-red-500 mb-4 animate-pulse" />
                                <h4 className="text-sm font-black text-white uppercase tracking-widest mb-1">Throughput Monitor Suspended</h4>
                                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">No interface traffic data available while device is offline</p>
                            </div>
                        )}
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
                        <div className="card h-fit relative">
                            {isOffline && (
                                <div className="absolute inset-0 z-10 bg-slate-950/60 backdrop-blur-[2px] rounded-3xl flex flex-col items-center justify-center p-8 animate-in fade-in duration-500">
                                    <Phone size={32} className="text-red-500 mb-4 animate-pulse" />
                                    <h4 className="text-sm font-black text-white uppercase tracking-widest mb-1 text-center">SIP Status Unavailable</h4>
                                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tight text-center">Device is currently offline</p>
                                </div>
                            )}
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

            {activeTab === 'docker' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="card overflow-hidden relative">
                        {isOffline && (
                            <div className="absolute inset-0 z-10 bg-slate-950/60 backdrop-blur-[2px] rounded-3xl flex flex-col items-center justify-center p-8 animate-in fade-in duration-500">
                                <Box size={32} className="text-red-500 mb-4 animate-pulse" />
                                <h4 className="text-sm font-black text-white uppercase tracking-widest mb-1 text-center">Container Stats Frozen</h4>
                                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tight text-center">Realtime status updates require an active heartbeat</p>
                            </div>
                        )}
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-xl font-black text-white uppercase tracking-tight flex items-center gap-3">
                                <Box size={24} className="text-primary-400" />
                                Docker Containers
                            </h3>
                            <div className="flex gap-4">
                                <div className="text-right">
                                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Total</p>
                                    <p className="text-lg font-black text-white">{dockerContainers.length}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-[10px] text-emerald-500 font-bold uppercase tracking-widest">Running</p>
                                    <p className="text-lg font-black text-emerald-400">
                                        {dockerContainers.filter((c: any) => c.state === 'running').length}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="border-b border-white/5 text-[10px] font-black uppercase text-slate-500 tracking-widest">
                                        <th className="px-4 py-4">Status</th>
                                        <th className="px-4 py-4">Container Name</th>
                                        <th className="px-4 py-4">Image</th>
                                        <th className="px-4 py-4">Health</th>
                                        <th className="px-4 py-4 text-right">Uptime</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {dockerContainers.map((container: any) => (
                                        <tr key={container.id} className="hover:bg-white/[0.02] transition-colors group">
                                            <td className="px-4 py-4">
                                                <div className="flex items-center gap-2">
                                                    <div className={clsx(
                                                        "w-2 h-2 rounded-full",
                                                        container.state === 'running' ? "bg-emerald-500 shadow-[0_0_8px_#10b981]" : "bg-red-500"
                                                    )} />
                                                    <span className={clsx(
                                                        "text-[10px] font-bold uppercase px-2 py-0.5 rounded",
                                                        container.state === 'running' ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
                                                    )}>
                                                        {container.state}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-4">
                                                <p className="text-sm font-bold text-white group-hover:text-primary-400 transition-colors">
                                                    {(container.name || (Array.isArray(container.names) ? container.names[0] : undefined) || (Array.isArray(container.Names) ? container.Names[0] : '')).replace(/^\//, '')}
                                                </p>
                                                <p className="text-[10px] font-mono text-slate-500">{container.id.substring(0, 12)}</p>
                                            </td>
                                            <td className="px-4 py-4">
                                                <span className="text-xs font-medium text-slate-400 px-2 py-1 bg-white/5 rounded-lg border border-white/10">
                                                    {container.image}
                                                </span>
                                            </td>
                                            <td className="px-4 py-4">
                                                {container.health ? (
                                                    <span className={clsx(
                                                        "text-[10px] font-bold uppercase",
                                                        container.health === 'healthy' ? "text-emerald-400" : "text-amber-400"
                                                    )}>
                                                        {container.health}
                                                    </span>
                                                ) : (
                                                    <span className="text-[10px] text-slate-600 font-bold uppercase">—</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-4 text-right">
                                                <span className="text-xs font-mono text-slate-400">{container.status}</span>
                                            </td>
                                        </tr>
                                    ))}
                                    {dockerContainers.length === 0 && (
                                        <tr>
                                            <td colSpan={5} className="px-4 py-12 text-center text-slate-500">
                                                No Docker containers found
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'terminal' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300 h-full flex flex-col">
                    <div className="card h-[calc(100vh-280px)] min-h-[500px] flex flex-col p-0 overflow-hidden border-primary-500/20 bg-slate-950/50">
                        {/* Terminal Header */}
                        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/[0.02]">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-primary-500/10 rounded-lg">
                                    <Terminal size={18} className="text-primary-400" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-black text-white uppercase tracking-wider leading-none">Remote Shell</h3>
                                    <p className="text-[10px] text-slate-500 font-bold uppercase mt-1 tracking-widest whitespace-nowrap">
                                        Active Session • {device.name}@{device.hostname || 'remote'}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setTerminalOutputs([])}
                                    className="p-2 text-slate-500 hover:text-white hover:bg-white/5 rounded-lg transition-colors group relative"
                                    title="Clear Terminal"
                                >
                                    <Eraser size={16} />
                                </button>
                                <div className="h-4 w-px bg-white/10 mx-1" />
                                <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                    <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Secure MQTT-TLS Bridge</span>
                                </div>
                            </div>
                        </div>

                        {/* Terminal Output Area */}
                        <div className="flex-1 overflow-y-auto p-6 font-mono text-sm space-y-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent bg-black/20">
                            {terminalOutputs.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center opacity-20 pointer-events-none">
                                    <Terminal size={48} className="text-slate-500 mb-4" />
                                    <p className="text-xs uppercase tracking-[0.2em] font-black">Waiting for command...</p>
                                </div>
                            ) : (
                                terminalOutputs.map((out, i) => (
                                    <div key={i} className="animate-in fade-in duration-200">
                                        {out.type === 'command' ? (
                                            <div className="flex items-start gap-3 text-primary-400 mt-4 mb-2 first:mt-0">
                                                <span className="text-primary-500/60 font-black mt-0.5">❯</span>
                                                <span className="font-bold break-all">{out.payload}</span>
                                            </div>
                                        ) : (
                                            <div className="pl-6 space-y-1">
                                                {out.output && (
                                                    <pre className="whitespace-pre-wrap text-slate-300 break-all leading-relaxed">{out.output}</pre>
                                                )}
                                                {out.error && (
                                                    <pre className="whitespace-pre-wrap text-red-400 font-bold break-all leading-relaxed">Error: {out.error}</pre>
                                                )}
                                                {out.exit_code !== undefined && (
                                                    <div className="text-[10px] text-slate-600 font-bold uppercase tracking-widest mt-1">
                                                        Process exited with code {out.exit_code}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ))
                            )}
                            {isTerminalLoading && (
                                <div className="flex items-center gap-2 text-slate-500 pl-6 py-2">
                                    <Loader2 size={14} className="animate-spin" />
                                    <span className="text-[10px] font-bold uppercase tracking-widest animate-pulse">Running...</span>
                                </div>
                            )}
                            <div id="terminal-end" />
                        </div>

                        {/* Terminal Input Area */}
                        <div className="p-4 border-t border-white/5 bg-white/[0.01]">
                            <form
                                onSubmit={handleExecuteCommand}
                                className="relative flex items-center gap-3 bg-black/40 border border-white/10 rounded-xl px-4 py-3 focus-within:border-primary-500/50 transition-all shadow-inner"
                            >
                                <span className="text-primary-500/60 font-black select-none text-lg">❯</span>
                                <input
                                    type="text"
                                    value={terminalInput}
                                    onChange={(e) => setTerminalInput(e.target.value)}
                                    placeholder="Execute command (e.g. docker ps, ls -la, top -n 1)..."
                                    className="flex-1 bg-transparent border-none outline-none text-white font-mono text-sm placeholder:text-slate-600 w-full"
                                    disabled={isTerminalLoading}
                                />
                                <button
                                    type="submit"
                                    disabled={isTerminalLoading || !terminalInput.trim()}
                                    className="p-2 bg-primary-600 hover:bg-primary-500 disabled:opacity-30 disabled:hover:bg-primary-600 text-white rounded-lg transition-all shadow-lg shadow-primary-500/20"
                                >
                                    <Send size={16} />
                                </button>
                            </form>
                            <div className="mt-3 flex items-center gap-4 px-2">
                                <p className="text-[9px] text-slate-600 font-bold uppercase tracking-[0.15em] flex items-center gap-1.5">
                                    <Info size={10} />
                                    Commands are executed via /bin/sh -c
                                </p>
                                <div className="h-1 w-1 rounded-full bg-slate-800" />
                                <p className="text-[9px] text-slate-600 font-bold uppercase tracking-[0.15em]">
                                    Press Enter to run
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'checks' && (
                <div className="space-y-6 relative">
                    {/* Top Bar Filters */}
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex flex-wrap items-center gap-2">
                            {[
                                { id: 'all', label: `All (${checks.length})` },
                                { id: 'issues', label: `Issues (${checks.filter(c => c.last_state === 'warning' || c.last_state === 'critical').length})` },
                                { id: 'nodata', label: `No Data (${checks.filter(c => !c.last_state).length})` },
                                { id: 'disabled', label: `Disabled (${checks.filter(c => !c.enabled).length})` },
                            ].map(f => (
                                <button
                                    key={f.id}
                                    onClick={() => setRuleFilter(f.id as any)}
                                    className={clsx(
                                        "px-3 py-1.5 rounded-lg text-xs font-bold transition-all border",
                                        ruleFilter === f.id
                                            ? "bg-primary-500/20 border-primary-500 text-primary-400"
                                            : "bg-white/5 border-white/10 text-slate-500 hover:text-slate-300"
                                    )}
                                >
                                    {f.label}
                                </button>
                            ))}

                            <div className="h-6 w-px bg-white/10 mx-2 hidden md:block" />

                            <label className="flex items-center gap-2 cursor-pointer group">
                                <input
                                    type="checkbox"
                                    checked={hideNoData}
                                    onChange={(e) => setHideNoData(e.target.checked)}
                                    className="w-4 h-4 rounded border-dark-border bg-dark-bg text-primary-600 focus:ring-primary-500"
                                />
                                <span className="text-xs text-slate-500 group-hover:text-slate-300 transition-colors">Hide No-Data Rules</span>
                            </label>
                        </div>

                        <div className="flex items-center gap-3">
                            <div className="flex p-0.5 bg-white/5 border border-white/10 rounded-lg">
                                <button
                                    onClick={() => setDensity('comfortable')}
                                    className={clsx("px-2 py-1 text-[10px] font-bold uppercase rounded", density === 'comfortable' ? "bg-white/10 text-white" : "text-slate-500")}
                                >
                                    Comfortable
                                </button>
                                <button
                                    onClick={() => setDensity('compact')}
                                    className={clsx("px-2 py-1 text-[10px] font-bold uppercase rounded", density === 'compact' ? "bg-white/10 text-white" : "text-slate-500")}
                                >
                                    Compact
                                </button>
                            </div>
                            <button onClick={() => { setEditingCheck(null); setIsModalOpen(true); }} className="btn-primary flex items-center gap-2 text-sm px-4 py-2">
                                <CheckCircle2 size={16} />
                                Add Rule
                            </button>
                        </div>
                    </div>

                    {/* Grouped Rules List */}
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        {(() => {
                            let filtered = checks;
                            if (ruleFilter === 'issues') filtered = checks.filter(c => c.last_state === 'warning' || c.last_state === 'critical');
                            if (ruleFilter === 'nodata') filtered = checks.filter(c => !c.last_state);
                            if (ruleFilter === 'disabled') filtered = checks.filter(c => !c.enabled);
                            if (hideNoData) filtered = filtered.filter(c => c.last_state);

                            if (filtered.length === 0) {
                                return (
                                    <div className="card py-20 text-center border-dashed border-2 border-white/5">
                                        <ShieldCheck size={48} className="mx-auto text-slate-800 mb-4" />
                                        <h4 className="text-slate-400 font-bold">No matching rules found</h4>
                                        <p className="text-slate-600 text-sm">Try adjusting your filters or add a new monitoring rule.</p>
                                    </div>
                                );
                            }

                            // Grouping Logic
                            const groups: Record<string, any[]> = {};
                            filtered.forEach(check => {
                                let groupName = 'System';
                                if (check.check_type.startsWith('sip')) {
                                    const targetParts = (check.target || '').split('@');
                                    groupName = targetParts.length > 1 ? `SIP – ${targetParts[1]}` : (check.target && check.target !== 'System-wide' ? `SIP – ${check.target}` : 'SIP – Global');
                                } else if (check.check_type === 'container_status') {
                                    groupName = 'Docker Containers';
                                } else if (['bandwidth', 'utilization'].includes(check.check_type)) {
                                    groupName = 'Network Interfaces';
                                }
                                if (!groups[groupName]) groups[groupName] = [];
                                groups[groupName].push(check);
                            });

                            return Object.entries(groups).map(([group, groupChecks]) => (
                                <div key={group} className="space-y-3">
                                    <div className="flex items-center gap-3 px-1">
                                        <div className="h-px flex-1 bg-white/5" />
                                        <h4 className="text-[10px] font-black uppercase text-slate-500 tracking-[0.2em]">{group}</h4>
                                        <div className="h-px w-8 bg-white/5" />
                                    </div>
                                    <div className="bg-dark-surface/40 border border-white/5 rounded-2xl overflow-hidden divide-y divide-white/5">
                                        {groupChecks.map(check => {
                                            const statusColor = !check.enabled ? "text-slate-600" :
                                                !check.last_state ? "text-slate-500" :
                                                    check.last_state === 'ok' ? "text-emerald-500" :
                                                        check.last_state === 'warning' ? "text-amber-500" : "text-red-500";

                                            const statusIcon = !check.enabled ? "⏸" :
                                                !check.last_state || check.last_state === 'unknown' ? "⚪" :
                                                    check.last_state === 'ok' ? "🟢" :
                                                        check.last_state === 'warning' ? "🟡" : "🔴";

                                            const unit = ['sip_rtt', 'latency'].includes(check.check_type) ? 'ms' : check.check_type === 'bandwidth' ? 'Mbps' : '%';

                                            // Icon mapping
                                            const Icon = check.check_type === 'cpu' ? Cpu :
                                                check.check_type === 'memory' ? Memory :
                                                    check.check_type === 'disk' ? HardDrive :
                                                        check.check_type.startsWith('sip') ? Phone : NetworkIcon;

                                            return (
                                                <div
                                                    key={check._id}
                                                    onClick={() => setSelectedRule(check)}
                                                    className={clsx(
                                                        "flex items-center gap-4 px-6 hover:bg-white/5 transition-all cursor-pointer group",
                                                        density === 'comfortable' ? "py-4" : "py-2",
                                                        !check.enabled && "opacity-60 bg-black/10"
                                                    )}
                                                >
                                                    <span className={clsx("text-lg w-6 text-center", statusColor)} title={check.last_state?.toUpperCase() || 'NO DATA'}>
                                                        {statusIcon}
                                                    </span>

                                                    <div className="flex-1 min-w-0 flex items-center gap-3">
                                                        <Icon size={density === 'comfortable' ? 18 : 14} className="text-slate-600 group-hover:text-primary-400 transition-colors hidden sm:block" />
                                                        <div className="flex flex-col">
                                                            <span className={clsx("font-bold text-slate-200 truncate group-hover:text-primary-400 transition-colors uppercase tracking-tight", density === 'comfortable' ? "text-sm" : "text-xs")}>
                                                                {check.check_type.replace(/_/g, ' ')}
                                                            </span>
                                                            {density === 'comfortable' && (
                                                                <span className="text-[10px] font-mono text-slate-500 uppercase">
                                                                    {check.target || 'GLOBAL'}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-4 sm:gap-8 sm:translate-x-4 flex-1 justify-end">
                                                        <div className="w-20 sm:w-28 hidden md:block">
                                                            <p className="text-[9px] text-slate-500 uppercase font-black tracking-tighter mb-0.5 opacity-50">Current</p>
                                                            <p className={clsx("font-mono font-bold leading-none", density === 'comfortable' ? "text-sm" : "text-xs", statusColor)}>
                                                                {check.last_value !== undefined ? `${check.last_value}${unit}` : '—'}
                                                            </p>
                                                        </div>
                                                        <div className="hidden lg:block w-32 text-right pr-4">
                                                            <p className="text-[9px] text-slate-600 uppercase font-black tracking-tighter mb-0.5 opacity-50">Thresholds</p>
                                                            <div className="flex items-center justify-end gap-1.5 text-[10px] font-bold">
                                                                <span className="text-amber-500/40">W{">"}{check.thresholds?.warning}</span>
                                                                <span className="text-white/10">|</span>
                                                                <span className="text-red-500/40">C{">"}{check.thresholds?.critical}</span>
                                                            </div>
                                                        </div>

                                                        {/* Inline Actions */}
                                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity pr-2">
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleToggleCheck(check); }}
                                                                className={clsx(
                                                                    "p-2 rounded-lg transition-all",
                                                                    check.enabled ? "text-slate-500 hover:text-amber-400 hover:bg-amber-400/10" : "text-emerald-500 hover:bg-emerald-500/10"
                                                                )}
                                                                title={check.enabled ? "Pause Rule" : "Resume Rule"}
                                                            >
                                                                {check.enabled ? <Pause size={14} /> : <Play size={14} />}
                                                            </button>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); setEditingCheck(check); setIsModalOpen(true); }}
                                                                className="p-2 text-slate-500 hover:text-white hover:bg-white/10 rounded-lg transition-all"
                                                                title="Edit Rule"
                                                            >
                                                                <Edit2 size={14} />
                                                            </button>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleDeleteCheck(check._id); }}
                                                                className="p-2 text-slate-500 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                                                                title="Delete Rule"
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ));
                        })()}
                    </div>

                    {/* Right Side Drawer */}
                    {selectedRule && (
                        <div className="fixed inset-0 z-[60] flex justify-end">
                            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300" onClick={() => setSelectedRule(null)} />
                            <div className="relative w-full max-w-sm h-full bg-dark-bg border-l border-white/10 shadow-2xl animate-in slide-in-from-right duration-500 flex flex-col">
                                <div className="p-8 space-y-10 flex-1 overflow-y-auto custom-scrollbar">
                                    <div className="flex justify-between items-start">
                                        <div className="space-y-1">
                                            <h3 className="text-xl font-black text-white uppercase tracking-tighter leading-tight">
                                                {selectedRule.check_type.replace(/_/g, ' ')}
                                            </h3>
                                            <div className="flex items-center gap-2">
                                                <span className="px-1.5 py-0.5 bg-primary-500/20 text-primary-400 text-[10px] font-black uppercase rounded border border-primary-500/20">
                                                    {selectedRule.target || 'Global'}
                                                </span>
                                                <span className="text-slate-600 text-[10px] font-mono">ID: {selectedRule._id.slice(-6)}</span>
                                            </div>
                                        </div>
                                        <button onClick={() => setSelectedRule(null)} className="p-2 hover:bg-white/5 rounded-full transition-colors text-slate-500 hover:text-white">
                                            <XCircle size={24} strokeWidth={1.5} />
                                        </button>
                                    </div>

                                    <div className="space-y-6">
                                        <div className="p-6 bg-white/[0.02] rounded-3xl border border-white/5 space-y-4">
                                            <div className="flex justify-between items-center">
                                                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Status</span>
                                                <div className={clsx(
                                                    "px-3 py-1 rounded-full text-[10px] font-black uppercase border",
                                                    selectedRule.last_state === 'ok' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                                                        selectedRule.last_state === 'warning' ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                                                            selectedRule.last_state === 'critical' ? "bg-red-500/10 text-red-400 border-red-500/20" : "bg-slate-500/10 text-slate-500 border-slate-500/20"
                                                )}>
                                                    {selectedRule.last_state || 'No Data'}
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                <div className="flex justify-between items-end">
                                                    <span className="text-[10px] font-bold text-slate-500">Latest Value</span>
                                                    <span className="text-2xl font-black text-white font-mono">
                                                        {selectedRule.last_value ?? '—'}
                                                        <span className="text-xs text-slate-600 ml-1 font-sans">
                                                            {['sip_rtt', 'latency'].includes(selectedRule.check_type) ? 'ms' : selectedRule.check_type === 'bandwidth' ? 'Mbps' : '%'}
                                                        </span>
                                                    </span>
                                                </div>
                                                <div className="flex justify-between text-[10px]">
                                                    <span className="text-slate-600 uppercase font-black">Last Sample</span>
                                                    <span className="text-slate-400">
                                                        {selectedRule.last_evaluated_at
                                                            ? new Date(selectedRule.last_evaluated_at).toLocaleTimeString()
                                                            : 'Awaiting data...'}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-3">
                                            <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.2em] px-2">Threshold Config</p>
                                            <div className="grid grid-cols-2 gap-px bg-white/5 rounded-3xl overflow-hidden border border-white/5">
                                                <div className="bg-dark-bg p-5 space-y-1">
                                                    <p className="text-[9px] font-black text-amber-500/50 uppercase">Warning</p>
                                                    <p className="text-xl font-black text-white font-mono">{">"}{selectedRule.thresholds.warning}</p>
                                                </div>
                                                <div className="bg-dark-bg p-5 space-y-1">
                                                    <p className="text-xl font-black text-white font-mono">{">"}{selectedRule.thresholds.critical}</p>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="p-5 bg-white/[0.02] rounded-3xl border border-white/5 space-y-3">
                                            <div className="flex items-center gap-2 text-slate-500">
                                                <Bell size={12} />
                                                <span className="text-[10px] font-black uppercase tracking-widest">Notifications</span>
                                            </div>
                                            <div className="space-y-1">
                                                <p className="text-sm text-slate-300">Cooldown: <strong>{selectedRule.notification_frequency || 15} min</strong></p>
                                                <div className="flex flex-wrap gap-1 mt-2">
                                                    {selectedRule.notify?.channels?.map((ch: string) => (
                                                        <span key={ch} className="px-2 py-0.5 bg-white/5 text-slate-500 rounded text-[9px] font-black uppercase border border-white/5">{ch}</span>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-3 pt-6">
                                        <div className="grid grid-cols-2 gap-3">
                                            <button
                                                onClick={() => handleToggleCheck(selectedRule)}
                                                className={clsx(
                                                    "py-3 rounded-2xl font-black text-xs uppercase transition-all border",
                                                    selectedRule.enabled
                                                        ? "bg-slate-900 text-slate-500 border-white/5 hover:text-white"
                                                        : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                                )}
                                            >
                                                {selectedRule.enabled ? 'Pause Rule' : 'Resume Rule'}
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setEditingCheck(selectedRule);
                                                    setIsModalOpen(true);
                                                    setSelectedRule(null);
                                                }}
                                                className="py-3 bg-white text-black font-black text-xs uppercase rounded-2xl hover:bg-slate-200 transition-all shadow-xl shadow-white/5"
                                            >
                                                Edit Rules
                                            </button>
                                        </div>
                                        <button
                                            onClick={() => {
                                                handleDeleteCheck(selectedRule._id);
                                                setSelectedRule(null);
                                            }}
                                            className="w-full py-3 text-red-500/30 hover:text-red-500 font-black text-[10px] uppercase transition-colors tracking-widest"
                                        >
                                            Delete Permanently
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'settings' && (
                <div className="w-full space-y-10 pb-20">

                    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-8">
                        {/* Column 1: General Information */}
                        <div className="space-y-6">
                            <div className="space-y-1">
                                <h3 className="text-sm font-black text-slate-600 uppercase tracking-widest leading-none">General Information</h3>
                                <div className="h-px bg-white/5 w-full mt-2" />
                            </div>

                            <div className="space-y-5">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Device Name</label>
                                    <input
                                        type="text"
                                        className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3.5 text-white focus:border-primary-500/50 outline-none transition-all placeholder:text-slate-700"
                                        defaultValue={device.name}
                                        onBlur={(e) => api.patch(`/devices/${id}`, { name: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Hostname / IP</label>
                                    <input
                                        type="text"
                                        className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3.5 text-white focus:border-primary-500/50 outline-none transition-all placeholder:text-slate-700"
                                        defaultValue={device.hostname}
                                        onBlur={(e) => api.patch(`/devices/${id}`, { hostname: e.target.value })}
                                    />
                                </div>
                                <div className="flex items-center justify-between p-5 bg-white/[0.02] rounded-3xl border border-white/5">
                                    <div className="space-y-0.5">
                                        <p className="text-sm font-bold text-slate-200">Monitoring Active</p>
                                        <p className="text-[10px] text-slate-500">Global kill switch for all rules.</p>
                                    </div>
                                    <button
                                        onClick={async () => {
                                            const newVal = !device.monitoring_paused;
                                            setConfirmModal({
                                                isOpen: true,
                                                title: newVal ? 'Pause Monitoring' : 'Resume Monitoring',
                                                message: newVal
                                                    ? 'Are you sure you want to pause all monitoring for this device? No more notifications will be sent until resumed.'
                                                    : 'Resume monitoring and alerts for this device?',
                                                type: newVal ? 'warning' : 'success',
                                                onConfirm: async () => {
                                                    await api.patch(`/devices/${id}`, { monitoring_paused: newVal });
                                                    setDevice({ ...device, monitoring_paused: newVal });
                                                }
                                            });
                                        }}
                                        className={clsx(
                                            "w-12 h-6 rounded-full relative transition-all",
                                            !device.monitoring_paused ? "bg-emerald-500 shadow-lg shadow-emerald-500/20" : "bg-slate-700"
                                        )}
                                    >
                                        <div className={clsx(
                                            "absolute top-1 w-4 h-4 rounded-full bg-white transition-all shadow-sm",
                                            !device.monitoring_paused ? "right-1" : "left-1"
                                        )} />
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Column 2: Offline Monitoring */}
                        <div className="space-y-6">
                            <div className="space-y-1">
                                <h3 className="text-sm font-black text-slate-600 uppercase tracking-widest leading-none">Offline Monitoring</h3>
                                <div className="h-px bg-white/5 w-full mt-2" />
                            </div>

                            <div className="space-y-6">
                                <div className="p-5 bg-white/[0.02] rounded-3xl border border-white/5 space-y-4">
                                    <p className="text-xs text-slate-400 leading-relaxed font-medium">
                                        Trigger critical alert when device misses
                                        <input
                                            type="number"
                                            className="mx-2 w-14 bg-white/10 border border-white/10 rounded-xl py-1 text-center font-black text-primary-400 outline-none focus:border-primary-500/50"
                                            defaultValue={device.offline_critical_threshold || 4}
                                            onBlur={(e) => api.patch(`/devices/${id}`, { offline_critical_threshold: parseInt(e.target.value) })}
                                        />
                                        heartbeats.
                                    </p>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="p-4 bg-black/20 rounded-2xl border border-white/5 space-y-1.5">
                                            <p className="text-[10px] font-black text-amber-500/40 uppercase tracking-widest">Warning</p>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="number"
                                                    className="w-12 bg-transparent border-b border-white/10 text-lg font-black text-white focus:border-amber-500 outline-none pb-0.5"
                                                    defaultValue={device.offline_warning_threshold || 2}
                                                    onBlur={(e) => api.patch(`/devices/${id}`, { offline_warning_threshold: parseInt(e.target.value) })}
                                                />
                                                <span className="text-[10px] text-slate-600 font-bold uppercase">Misses</span>
                                            </div>
                                        </div>
                                        <div className="p-4 bg-black/20 rounded-2xl border border-white/5 space-y-1.5">
                                            <p className="text-[10px] font-black text-red-500/40 uppercase tracking-widest">Critical</p>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="number"
                                                    className="w-12 bg-transparent border-b border-white/10 text-lg font-black text-white focus:border-red-500 outline-none pb-0.5"
                                                    defaultValue={device.offline_critical_threshold || 4}
                                                    onBlur={(e) => api.patch(`/devices/${id}`, { offline_critical_threshold: parseInt(e.target.value) })}
                                                />
                                                <span className="text-[10px] text-slate-600 font-bold uppercase">Misses</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Repeat Every</label>
                                        <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
                                            <input
                                                type="number"
                                                className="w-full bg-transparent text-white font-black outline-none"
                                                defaultValue={device.repeat_interval_minutes || 10}
                                                onBlur={(e) => api.patch(`/devices/${id}`, { repeat_interval_minutes: parseInt(e.target.value) })}
                                            />
                                            <span className="text-[10px] text-slate-600 font-black uppercase tracking-widest">Min</span>
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Throttle After</label>
                                        <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
                                            <input
                                                type="number"
                                                className="w-full bg-transparent text-white font-black outline-none"
                                                defaultValue={device.throttling_duration_minutes || 60}
                                                onBlur={(e) => api.patch(`/devices/${id}`, { throttling_duration_minutes: parseInt(e.target.value) })}
                                            />
                                            <span className="text-[10px] text-slate-600 font-black uppercase tracking-widest">Min</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Column 3: Notifications & Agent */}
                        <div className="space-y-8 lg:col-span-2 xl:col-span-1 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 gap-8">
                            <div className="space-y-6">
                                <div className="space-y-1">
                                    <h3 className="text-sm font-black text-slate-600 uppercase tracking-widest leading-none">Notification Channels</h3>
                                    <div className="h-px bg-white/5 w-full mt-2" />
                                </div>

                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Alert Channels (Slack)</label>
                                        <div className="space-y-3">
                                            <input
                                                type="text"
                                                className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3 text-sm text-slate-300 placeholder:text-slate-700 outline-none focus:border-red-500/30"
                                                placeholder="Critical: #noc-critical"
                                                defaultValue={device.notification_channels?.critical}
                                                onBlur={(e) => api.patch(`/devices/${id}`, { 'notification_channels.critical': e.target.value })}
                                            />
                                            <input
                                                type="text"
                                                className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3 text-sm text-slate-300 placeholder:text-slate-700 outline-none focus:border-amber-500/30"
                                                placeholder="Warning: #infra-warnings"
                                                defaultValue={device.notification_channels?.warning}
                                                onBlur={(e) => api.patch(`/devices/${id}`, { 'notification_channels.warning': e.target.value })}
                                            />
                                        </div>
                                    </div>

                                    <label className="flex items-center gap-3 cursor-pointer group p-4 bg-white/[0.02] border border-white/5 rounded-2xl hover:bg-white/[0.04] transition-all">
                                        <input
                                            type="checkbox"
                                            className="w-5 h-5 rounded-lg border-white/10 bg-white/5 text-primary-500 focus:ring-0 checked:bg-primary-500"
                                            defaultChecked={device.notify_on_recovery}
                                            onChange={(e) => api.patch(`/devices/${id}`, { notify_on_recovery: e.target.checked })}
                                        />
                                        <div className="space-y-0.5">
                                            <p className="text-sm font-bold text-slate-300 group-hover:text-white transition-colors">Notify on Recovery</p>
                                            <p className="text-[10px] text-slate-500">Send alerts when devices come back online.</p>
                                        </div>
                                    </label>
                                </div>
                            </div>

                            <div className="space-y-6">
                                <div className="space-y-1">
                                    <h3 className="text-sm font-black text-slate-600 uppercase tracking-widest leading-none">Agent Operational</h3>
                                    <div className="h-px bg-white/5 w-full mt-2" />
                                </div>

                                <div className="space-y-5">
                                    {enabledModules.includes('asterisk') && (
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Asterisk Container Name</label>
                                            <input
                                                type="text"
                                                className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3 text-sm text-slate-300 placeholder:text-slate-700 outline-none focus:border-primary-500/30"
                                                placeholder="asterisk"
                                                defaultValue={device.asterisk_container_name || device.config?.asterisk_container || 'asterisk'}
                                                onBlur={async (e) => {
                                                    const nextValue = e.target.value.trim() || 'asterisk';
                                                    await api.patch(`/devices/${id}`, { asterisk_container_name: nextValue });
                                                    setDevice({ ...device, asterisk_container_name: nextValue, config: { ...(device.config || {}), asterisk_container: nextValue } });
                                                }}
                                            />
                                            <p className="text-[10px] text-slate-500">Used when agent runs `docker exec &lt;container&gt; asterisk -rx ...`.</p>
                                        </div>
                                    )}

                                    <div className="flex flex-wrap gap-2">
                                        {ALL_MODULES.map(mod => (
                                            <div key={mod} className={clsx(
                                                "px-3 py-1.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all",
                                                enabledModules.includes(mod)
                                                    ? "bg-primary-500/10 border-primary-500/30 text-primary-400"
                                                    : "bg-white/[0.02] border-white/5 text-slate-700"
                                            )}>
                                                {mod}
                                            </div>
                                        ))}
                                    </div>
                                    <div className="flex items-center justify-between p-4 bg-amber-500/5 rounded-2xl border border-amber-500/10">
                                        <div className="flex items-center gap-3">
                                            <RefreshCw size={16} className="text-amber-500/50" />
                                            <p className="text-[10px] text-amber-500/80 font-bold uppercase tracking-tight">Rebuild Required</p>
                                        </div>
                                        <button
                                            onClick={async () => {
                                                setConfirmModal({
                                                    isOpen: true,
                                                    title: 'Rebuild Agent',
                                                    message: 'Are you sure you want to trigger a manual agent rebuild? This will compile a new binary for the current configuration.',
                                                    type: 'info',
                                                    onConfirm: async () => {
                                                        try {
                                                            await api.post(`/devices/${id}/generate-agent`, { os: 'linux', arch: 'amd64' });
                                                            setConfirmModal({
                                                                isOpen: true,
                                                                title: 'Success',
                                                                message: 'Agent rebuild triggered successfully.',
                                                                type: 'success',
                                                                onClose: () => setConfirmModal(prev => ({ ...prev, isOpen: false }))
                                                            } as any);
                                                        } catch (e) {
                                                            setConfirmModal({
                                                                isOpen: true,
                                                                title: 'Error',
                                                                message: 'Failed to rebuild agent.',
                                                                type: 'danger',
                                                                onClose: () => setConfirmModal(prev => ({ ...prev, isOpen: false }))
                                                            } as any);
                                                        }
                                                    }
                                                });
                                            }}
                                            className="px-4 py-2 bg-amber-500 text-black font-black text-[10px] uppercase rounded-xl hover:bg-amber-400 transition-all shadow-lg shadow-amber-500/10"
                                        >
                                            Rebuild
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Agent Installation Dropdown (Spans full width or 2nd/3rd col) */}
                    <div>
                        <div className="border border-white/5 rounded-[32px] overflow-hidden bg-black/20">
                            <button
                                onClick={() => setIsAgentInstallOpen(!isAgentInstallOpen)}
                                className="w-full flex items-center justify-between p-6 hover:bg-white/[0.02] transition-all"
                            >
                                <div className="flex items-center gap-4">
                                    <div className="p-3 bg-white/5 rounded-2xl">
                                        <TerminalIcon size={20} className="text-slate-400" />
                                    </div>
                                    <div className="text-left">
                                        <span className="block text-sm font-black text-white uppercase tracking-widest">Agent Installation</span>
                                        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">Manual setup command for the target server</span>
                                    </div>
                                </div>
                                {isAgentInstallOpen ? <ChevronUp size={20} className="text-slate-600" /> : <ChevronDown size={20} className="text-slate-600" />}
                            </button>

                            {isAgentInstallOpen && (
                                <div className="p-8 bg-black/40 border-t border-white/5 space-y-6 animate-in slide-in-from-top-4 duration-300">
                                    <p className="text-xs text-slate-500 font-medium">Run this command as root on the target server:</p>
                                    <div className="bg-black/60 p-6 rounded-[24px] border border-white/10 font-mono text-[12px] text-primary-400/90 leading-relaxed overflow-x-auto relative group">
                                        <code className="whitespace-pre">
                                            curl -fsSL {window.location.origin}/install.sh | sudo bash -s -- \{'\n'}
                                            {'  '}--token {device.agent_token.slice(0, 8)}************************ \{'\n'}
                                            {'  '}--modules {enabledModules.join(',')}
                                        </code>
                                        <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => navigator.clipboard.writeText(`curl -fsSL ${window.location.origin}/install.sh | sudo bash -s -- --token ${device.agent_token} --modules ${enabledModules.join(',')}`)}
                                                className="p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-white transition-all"
                                                title="Copy Command"
                                            >
                                                <Copy size={16} />
                                            </button>
                                            <button
                                                onClick={async () => {
                                                    setConfirmModal({
                                                        isOpen: true,
                                                        title: 'Regenerate Token',
                                                        message: 'Are you sure you want to regenerate the agent token? The current agent will disconnect immediately and will need to be reinstalled with the new token.',
                                                        type: 'danger',
                                                        onConfirm: async () => {
                                                            try {
                                                                const res = await api.post(`/devices/${id}/regenerate-token`);
                                                                setDevice({ ...device, agent_token: res.data.agent_token });
                                                            } catch (e) {
                                                                setConfirmModal({
                                                                    isOpen: true,
                                                                    title: 'Error',
                                                                    message: 'Failed to regenerate token.',
                                                                    type: 'danger',
                                                                    onClose: () => setConfirmModal(prev => ({ ...prev, isOpen: false }))
                                                                } as any);
                                                            }
                                                        }
                                                    });
                                                }}
                                                className="p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-white transition-all"
                                                title="Regenerate Token"
                                            >
                                                <RefreshCw size={16} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Section 5: Monitoring Rules Pointer */}
                    <div className="p-10 bg-primary-500/[0.03] rounded-[48px] border border-primary-500/10 flex flex-col lg:flex-row lg:items-center justify-between gap-8">
                        <div className="space-y-2">
                            <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Advanced Monitoring Rules</h3>
                            <p className="text-sm text-slate-500 font-medium">Configure deep-packet SIP inspection, network thresholds, and custom alert routing.</p>
                        </div>
                        <button
                            onClick={() => setActiveTab('checks')}
                            className="px-10 py-5 bg-white text-black font-black text-xs uppercase rounded-[24px] hover:bg-slate-200 transition-all flex items-center justify-center gap-3 group shadow-2xl shadow-white/5"
                        >
                            Configure Rules
                            <ExternalLink size={18} className="group-hover:translate-x-1 transition-transform" />
                        </button>
                    </div>
                </div>
            )}
            <MonitoringRuleModal
                isOpen={isModalOpen}
                onClose={() => { setIsModalOpen(false); setEditingCheck(null); }}
                onSave={handleSaveCheck}
                initialData={editingCheck}
                latestMetrics={latest}
                enabledModules={enabledModules}
            />

            <ConfirmationModal
                {...confirmModal}
                onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
            />
        </div>
    );
};
