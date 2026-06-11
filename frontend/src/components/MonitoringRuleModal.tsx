import React, { useState } from 'react';
import { X, ShieldCheck, Activity, Phone, Wifi, Cpu, MemoryStick as Memory, Bell, HardDrive, Box, LayoutGrid, Users, Database, Server, Search, MessageSquare } from 'lucide-react';
import { clsx } from 'clsx';
import api from '../lib/axios';

type ModuleName = 'system' | 'docker' | 'asterisk' | 'network';
const CHECK_MODULE_MAP: Record<string, ModuleName | null> = {
    cpu: 'system',
    memory: 'system',
    disk: 'system',
    bandwidth: 'network',
    utilization: 'network',
    sip_rtt: 'asterisk',
    sip_registration: 'asterisk',
    container_status: 'docker',
    mysql: null,
    postgresql: null,
    redis: null,
    nginx: null,
    elasticsearch: null,
    rabbitmq: null,
    mongodb: null,
};
const BASE_CHECK_TYPES = [
    { id: 'cpu', label: 'CPU Load', icon: Cpu, unit: '%' },
    { id: 'memory', label: 'Memory Usage', icon: Memory, unit: '%' },
    { id: 'disk', label: 'Disk Usage', icon: HardDrive, unit: '%' },
    { id: 'bandwidth', label: 'Network Bandwidth', icon: Wifi, unit: 'Mbps' },
    { id: 'utilization', label: 'Network Util', icon: LayoutGrid, unit: '%' },
    { id: 'sip_rtt', label: 'SIP RTT/Status', icon: Phone, unit: 'ms' },
    { id: 'sip_registration', label: 'SIP Registrations %', icon: Phone, unit: '%' },
    { id: 'container_status', label: 'Container Status', icon: Box, unit: 'status' },
    { id: 'mysql', label: 'MySQL', icon: Database, unit: 'ms' },
    { id: 'postgresql', label: 'PostgreSQL', icon: Database, unit: 'ms' },
    { id: 'redis', label: 'Redis', icon: Server, unit: 'ms' },
    { id: 'nginx', label: 'Nginx', icon: Wifi, unit: 'ms' },
    { id: 'elasticsearch', label: 'Elasticsearch', icon: Search, unit: 'ms' },
    { id: 'rabbitmq', label: 'RabbitMQ', icon: MessageSquare, unit: 'ms' },
    { id: 'mongodb', label: 'MongoDB', icon: Database, unit: 'ms' },
];

interface MonitoringRuleModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (rules: any[]) => void;
    initialData?: any;
    enabledModules?: ModuleName[];
    availableDockerTargets?: string[];
    existingChecks?: any[];
    assignableUsers?: { id: string; name?: string; email?: string; is_active?: boolean }[];
    canAssignUsers?: boolean;
    latestMetrics?: {
        extra?: {
            registrations?: { name: string; status: string; serverUri: string; expiresS: number }[];
            contacts?: { aor: string; status: string; rttMs?: number }[];
            interfaces?: { name: string; rx_bps: number; tx_bps: number; rx_bytes: number; tx_bytes: number }[];
            docker?: { containers?: { name?: string; names?: string[]; Names?: string[]; state: string; status: string }[] } |
            { name?: string; names?: string[]; Names?: string[]; state: string; status: string }[];
        };
    };
}

const normalizeContainerName = (container: any): string | null => {
    const raw = container?.name
        || (Array.isArray(container?.names) ? container.names[0] : container?.names)
        || (Array.isArray(container?.Names) ? container.Names[0] : container?.Names)
        || container?.id;
    if (!raw) return null;
    const normalized = String(raw).replace(/^\//, '').trim();
    return normalized || null;
};

export const MonitoringRuleModal = ({
    isOpen,
    onClose,
    onSave,
    initialData,
    latestMetrics,
    enabledModules,
    availableDockerTargets,
    existingChecks = [],
    assignableUsers = [],
    canAssignUsers = false,
}: MonitoringRuleModalProps) => {
    // Default thresholds for each rule type
    const TYPE_DEFAULTS: Record<string, any> = {
        cpu: { thresholds: { warning: 70, critical: 90 }, target: 'System-wide' },
        memory: { thresholds: { warning: 75, critical: 90 }, target: 'System-wide' },
        disk: { thresholds: { warning: 80, critical: 90 }, target: '/' },
        bandwidth: { thresholds: { warning: 50, critical: 100 }, target: '' },
        utilization: { thresholds: { warning: 70, critical: 90 }, target: '' },
        sip_rtt: { thresholds: { warning: 300, critical: 600 }, target: 'System-wide' },
        sip_registration: { thresholds: { warning: 95, critical: 80 }, target: 'System-wide' },
        container_status: { thresholds: { warning: 1, critical: 1 }, target: '' },
        mysql: { thresholds: { warning: 500, critical: 2000 }, target: 'localhost:3306' },
        postgresql: { thresholds: { warning: 500, critical: 2000 }, target: 'localhost:5432' },
        redis: { thresholds: { warning: 50, critical: 200 }, target: 'localhost:6379' },
        nginx: { thresholds: { warning: 500, critical: 2000 }, target: 'localhost:80' },
        elasticsearch: { thresholds: { warning: 500, critical: 2000 }, target: 'localhost:9200' },
        rabbitmq: { thresholds: { warning: 500, critical: 2000 }, target: 'localhost:5672' },
        mongodb: { thresholds: { warning: 500, critical: 2000 }, target: 'localhost:27017' },
    };

    // Convert legacy 'attention' to 'warning' if present
    const prepData = (data: any) => {
        const defaultData = {
            check_type: 'cpu',
            target: 'System-wide',
            thresholds: { warning: 70, critical: 90, consecutive_failures: 1 },
            notification_frequency: 15,
            notify: { channels: ['slack'] },
            notification_channel_ids: [],
            assigned_user_ids: [],
            enabled: true
        };
        if (!data) return defaultData;
        const thresholds = { ...data.thresholds };
        if (thresholds.attention !== undefined && thresholds.warning === undefined) {
            thresholds.warning = thresholds.attention;
            delete thresholds.attention;
        }
        const assigned_user_ids = Array.isArray(data.assigned_user_ids)
            ? data.assigned_user_ids.filter(Boolean)
            : [];
        const notification_channel_ids = Array.isArray(data.notification_channel_ids)
            ? data.notification_channel_ids.filter(Boolean)
            : [];
        return { ...defaultData, ...data, thresholds, assigned_user_ids, notification_channel_ids };
    };

    const [availableChannels, setAvailableChannels] = useState<any[]>([]);

    React.useEffect(() => {
        if (isOpen) {
            api.get('/notification-channels')
                .then((res) => {
                    setAvailableChannels(res.data || []);
                })
                .catch((err) => {
                    console.error('Failed to fetch notification channels:', err);
                });
        }
    }, [isOpen]);

    const [formData, setFormData] = useState(prepData(initialData));
    const [customDockerTarget, setCustomDockerTarget] = useState('');

    // Track which types have been modified in this session
    const [modifiedTypes, setModifiedTypes] = useState<Set<string>>(new Set<string>([prepData(initialData).check_type]));

    interface SessionConfig {
        thresholds: any;
        targets: string[];
        target?: string;
        notification_frequency: number;
        notify: any;
        notification_channel_ids?: string[];
        assigned_user_ids: string[];
    }

    // Store customizations per type to prevent loss when switching tabs
    const [sessionConfigs, setSessionConfigs] = useState<Record<string, SessionConfig>>({});

    const sipEndpointTargets = React.useMemo(() => {
        const names = new Set<string>();
        names.add('System-wide');

        latestMetrics?.extra?.registrations?.forEach((entry: any) => {
            const target = String(entry?.name || '').trim();
            if (target) names.add(target);
        });
        latestMetrics?.extra?.contacts?.forEach((entry: any) => {
            const target = String(entry?.aor || '').trim();
            if (target) names.add(target);
        });
        existingChecks
            .filter((check) => ['sip_rtt', 'sip_registration'].includes(check?.check_type))
            .forEach((check) => {
                const target = String(check?.target || '').trim();
                if (target) names.add(target);
            });
        (formData?.targets || []).forEach((target: string) => {
            const normalized = String(target || '').trim();
            if (normalized) names.add(normalized);
        });

        return Array.from(names).sort((a, b) => {
            if (a === 'System-wide') return -1;
            if (b === 'System-wide') return 1;
            return a.localeCompare(b);
        });
    }, [existingChecks, formData?.targets, latestMetrics]);

    const interfaceTargets = React.useMemo(() => {
        const names = new Set<string>();
        latestMetrics?.extra?.interfaces?.forEach((entry: any) => {
            const target = String(entry?.name || '').trim();
            if (target) names.add(target);
        });
        existingChecks
            .filter((check) => ['bandwidth', 'utilization'].includes(check?.check_type))
            .forEach((check) => {
                const target = String(check?.target || '').trim();
                if (target) names.add(target);
            });
        (formData?.targets || []).forEach((target: string) => {
            const normalized = String(target || '').trim();
            if (normalized) names.add(normalized);
        });
        return Array.from(names).sort((a, b) => a.localeCompare(b));
    }, [existingChecks, formData?.targets, latestMetrics]);

    const dockerContainerTargets = React.useMemo(() => {
        const rawDocker = latestMetrics?.extra?.docker as any;
        const telemetryContainers = Array.isArray(rawDocker) ? rawDocker : (rawDocker?.containers || []);
        const names = new Set<string>();

        telemetryContainers.forEach((container: any) => {
            const normalized = normalizeContainerName(container);
            if (normalized) names.add(normalized);
        });

        if (Array.isArray(availableDockerTargets)) {
            availableDockerTargets.forEach((name) => {
                const normalized = String(name || '').replace(/^\//, '').trim();
                if (normalized) names.add(normalized);
            });
        }

        const selectedTargets = Array.isArray(formData?.targets) ? formData.targets : [];
        selectedTargets.forEach((name: string) => {
            const normalized = String(name || '').replace(/^\//, '').trim();
            if (normalized) names.add(normalized);
        });

        return Array.from(names).sort((a, b) => a.localeCompare(b));
    }, [availableDockerTargets, formData?.targets, latestMetrics]);

    const checkTypes = React.useMemo(() => {
        if (!enabledModules || enabledModules.length === 0) {
            return BASE_CHECK_TYPES;
        }

        const enabled = new Set(enabledModules);
        return BASE_CHECK_TYPES.filter((checkType) => {
            const requiredModule = CHECK_MODULE_MAP[checkType.id] ?? null;
            return !requiredModule || enabled.has(requiredModule);
        });
    }, [enabledModules]);

    React.useEffect(() => {
        const prepped = prepData(initialData);
        if (isOpen) {
            const initialTargets = Array.isArray(prepped.target) ? prepped.target : (prepped.target ? [prepped.target] : []);
            const config: SessionConfig = {
                thresholds: prepped.thresholds,
                targets: initialTargets,
                notification_frequency: prepped.notification_frequency || 15,
                notify: prepped.notify || { channels: ['slack'] },
                notification_channel_ids: Array.isArray(prepped.notification_channel_ids) ? prepped.notification_channel_ids : [],
                assigned_user_ids: Array.isArray(prepped.assigned_user_ids) ? prepped.assigned_user_ids : [],
            };
            setSessionConfigs({ [prepped.check_type]: config });
            setModifiedTypes(new Set<string>([prepped.check_type]));
            setFormData({
                ...prepped,
                targets: initialTargets,
                assigned_user_ids: config.assigned_user_ids,
            });
        }
    }, [initialData, isOpen]);

    React.useEffect(() => {
        if (!isOpen || checkTypes.length === 0) return;
        if (checkTypes.some((type) => type.id === formData.check_type)) return;

        const fallback = checkTypes[0];
        const config = (sessionConfigs[fallback.id] as any) || TYPE_DEFAULTS[fallback.id];
        setFormData((prev: any) => ({
            ...prev,
            check_type: fallback.id,
            thresholds: config.thresholds,
            target: config.target || (config.targets?.[0] || ''),
            targets: config.targets || (config.target ? [config.target] : []),
            assigned_user_ids: config.assigned_user_ids || [],
        }));
    }, [checkTypes, formData.check_type, isOpen, sessionConfigs]);

    // Helper to update both formData and sessionConfigs
    const updateField = (updates: any) => {
        setFormData((prev: any) => {
            const next = { ...prev, ...updates };
            // Mark this type as modified
            setModifiedTypes(prevSet => {
                const nextSet = new Set(prevSet);
                nextSet.add(next.check_type);
                return nextSet;
            });

            // Update the session memory for this specific check_type
            setSessionConfigs(s => ({
                ...s,
                [next.check_type]: {
                    thresholds: next.thresholds,
                    targets: next.targets || (next.target ? [next.target] : []),
                    notification_frequency: next.notification_frequency,
                    notify: next.notify,
                    notification_channel_ids: next.notification_channel_ids || [],
                    assigned_user_ids: next.assigned_user_ids || [],
                }
            }));
            return next;
        });
    };

    const addCustomDockerTarget = () => {
        const normalized = customDockerTarget.replace(/^\//, '').trim();
        if (!normalized) return;
        const currentTargets: string[] = Array.isArray(formData.targets) ? formData.targets : [];
        if (!currentTargets.includes(normalized)) {
            updateField({ targets: [...currentTargets, normalized] });
        }
        setCustomDockerTarget('');
    };

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        // Save only the active rule type from this form session.
        const rulesToSave: any[] = [];
        const typeId = formData.check_type;
        const config = sessionConfigs[typeId] || {
            thresholds: formData.thresholds,
            targets: Array.isArray(formData.targets) ? formData.targets : [],
            notification_frequency: formData.notification_frequency,
            notify: formData.notify,
            notification_channel_ids: formData.notification_channel_ids || [],
            assigned_user_ids: formData.assigned_user_ids || [],
        };

        const targets = (config.targets && config.targets.length > 0)
            ? config.targets
            : [formData.target || 'System-wide'];

        targets.forEach((target: string, index: number) => {
            const rule = {
                check_type: typeId,
                target,
                thresholds: config.thresholds,
                notification_frequency: config.notification_frequency,
                notify: config.notify,
                notification_channel_ids: config.notification_channel_ids || [],
                assigned_user_ids: config.assigned_user_ids || [],
                enabled: initialData?.enabled ?? true,
            };

            // In edit mode, always update the currently edited rule with the first selected target.
            if (initialData && index === 0) {
                (rule as any)._id = initialData._id;
            }

            rulesToSave.push(rule);
        });

        if (rulesToSave.length === 0) {
            onClose();
            return;
        }

        onSave(rulesToSave);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-dark-surface border border-dark-border rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200">
                <div className="px-6 py-4 border-b border-dark-border flex justify-between items-center bg-white/5">
                    <div className="flex items-center gap-2">
                        <ShieldCheck className="text-primary-400" size={20} />
                        <h2 className="text-xl font-bold text-white">
                            {initialData ? 'Edit Monitoring Rule' : 'Add New Monitoring Rule'}
                        </h2>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-all">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-6 max-h-[75vh] overflow-y-auto custom-scrollbar">
                    {/* Rule Type Tiles */}
                    <div className="space-y-3">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Select Rule Type</label>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {checkTypes.length === 0 ? (
                                <div className="col-span-2 md:col-span-4 p-4 rounded-xl border border-white/10 bg-white/5 text-xs text-slate-400">
                                    No rule types available for the selected modules on this device.
                                </div>
                            ) : (
                                checkTypes.map((type) => (
                                    <button
                                        key={type.id}
                                        type="button"
                                        onClick={() => {
                                            const config = (sessionConfigs[type.id] as any) || TYPE_DEFAULTS[type.id];
                                            setFormData({
                                                ...formData,
                                                check_type: type.id as any,
                                                thresholds: config.thresholds,
                                                target: config.target || (config.targets?.[0] || ''),
                                                targets: config.targets || (config.target ? [config.target] : []),
                                                assigned_user_ids: config.assigned_user_ids || [],
                                            });
                                        }}
                                        className={clsx(
                                            "flex flex-col items-center gap-2 p-3 rounded-xl border transition-all text-center group relative",
                                            formData.check_type === type.id
                                                ? "bg-primary-500/20 border-primary-500 text-primary-400"
                                                : "bg-white/5 border-white/10 text-slate-400 hover:border-white/20 hover:bg-white/10"
                                        )}
                                    >
                                        {modifiedTypes.has(type.id) && (
                                            <div className="absolute top-2 right-2 w-2 h-2 bg-primary-500 rounded-full shadow-[0_0_8px_#0ea5e9]" />
                                        )}
                                        <type.icon size={22} className={clsx("transition-transform", formData.check_type === type.id && "scale-110")} />
                                        <span className="text-[10px] uppercase font-black leading-tight">{type.label}</span>
                                    </button>
                                ))
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Target Selection */}
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-400 flex items-center gap-2">
                                <Activity size={14} />
                                Target Endpoint / Component
                            </label>
                            <div className="flex flex-wrap gap-2">
                                {formData.check_type === 'sip_rtt' || formData.check_type === 'sip_registration' ? (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => updateField({ targets: ['System-wide'] })}
                                            className={clsx(
                                                "px-3 py-1.5 rounded-lg border text-xs font-bold transition-all",
                                                formData.targets?.includes('System-wide') ? "bg-primary-500/20 border-primary-500 text-primary-400" : "bg-white/5 border-white/10 text-slate-500"
                                            )}
                                        >
                                            System-wide
                                        </button>
                                        {sipEndpointTargets
                                            .filter((target) => target !== 'System-wide')
                                            .map((target) => (
                                                <button
                                                    key={target}
                                                    type="button"
                                                    onClick={() => {
                                                        const current = formData.targets?.filter((t: string) => t !== 'System-wide') || [];
                                                        const next = current.includes(target) ? current.filter((t: string) => t !== target) : [...current, target];
                                                        updateField({ targets: next });
                                                    }}
                                                    className={clsx(
                                                        "px-3 py-1.5 rounded-lg border text-xs font-bold transition-all",
                                                        formData.targets?.includes(target) ? "bg-primary-500/20 border-primary-500 text-primary-400" : "bg-white/5 border-white/10 text-slate-500"
                                                    )}
                                                >
                                                    {target}
                                                </button>
                                            ))}
                                    </>
                                ) : formData.check_type === 'bandwidth' || formData.check_type === 'utilization' ? (
                                    interfaceTargets.length > 0 ? (
                                        interfaceTargets.map((target: string) => (
                                            <button
                                                key={target}
                                                type="button"
                                                onClick={() => {
                                                    const current = formData.targets || [];
                                                    const next = current.includes(target) ? current.filter((t: string) => t !== target) : [...current, target];
                                                    updateField({ targets: next });
                                                }}
                                                className={clsx(
                                                    "px-3 py-1.5 rounded-lg border text-xs font-bold transition-all",
                                                    formData.targets?.includes(target) ? "bg-primary-500/20 border-primary-500 text-primary-400" : "bg-white/5 border-white/10 text-slate-500"
                                                )}
                                            >
                                                {target}
                                            </button>
                                        ))
                                    ) : (
                                        <span className="text-xs text-slate-500 italic">No interfaces discovered yet from telemetry.</span>
                                    )
                                ) : formData.check_type === 'container_status' ? (
                                    <>
                                        {dockerContainerTargets.length > 0 ? (
                                            dockerContainerTargets.map((containerName: string) => (
                                                <button
                                                    key={containerName}
                                                    type="button"
                                                    onClick={() => {
                                                        const current = formData.targets || [];
                                                        const next = current.includes(containerName)
                                                            ? current.filter((t: string) => t !== containerName)
                                                            : [...current, containerName];
                                                        updateField({ targets: next });
                                                    }}
                                                    className={clsx(
                                                        "px-3 py-1.5 rounded-lg border text-xs font-bold transition-all",
                                                        formData.targets?.includes(containerName) ? "bg-primary-500/20 border-primary-500 text-primary-400" : "bg-white/5 border-white/10 text-slate-500"
                                                    )}
                                                >
                                                    {containerName}
                                                </button>
                                            ))
                                        ) : (
                                            <span className="text-xs text-slate-500 italic">No containers discovered yet from agent telemetry.</span>
                                        )}
                                        <div className="w-full flex items-center gap-2 mt-2">
                                            <input
                                                type="text"
                                                value={customDockerTarget}
                                                onChange={(e) => setCustomDockerTarget(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        addCustomDockerTarget();
                                                    }
                                                }}
                                                placeholder="Add container name manually"
                                                className="flex-1 input-field"
                                            />
                                            <button
                                                type="button"
                                                onClick={addCustomDockerTarget}
                                                className="px-3 py-2 rounded-lg border border-primary-500/30 text-primary-400 text-xs font-bold hover:bg-primary-500/10 transition-all"
                                            >
                                                Add
                                            </button>
                                        </div>
                                    </>
                                ) : formData.check_type === 'disk' ? (
                                    ['/', '/var', '/boot'].map(path => (
                                        <button
                                            key={path}
                                            type="button"
                                            onClick={() => {
                                                const current = formData.targets || [];
                                                const next = current.includes(path) ? current.filter((t: string) => t !== path) : [...current, path];
                                                updateField({ targets: next });
                                            }}
                                            className={clsx(
                                                "px-3 py-1.5 rounded-lg border text-xs font-bold transition-all",
                                                formData.targets?.includes(path) ? "bg-primary-500/20 border-primary-500 text-primary-400" : "bg-white/5 border-white/10 text-slate-500"
                                            )}
                                        >
                                            {path}
                                        </button>
                                    ))
                                ) : ['mysql', 'postgresql', 'redis', 'nginx', 'elasticsearch', 'rabbitmq', 'mongodb'].includes(formData.check_type) ? (
                                    <div className="w-full flex items-center gap-2">
                                        <input
                                            type="text"
                                            value={(formData.targets && formData.targets[0]) || ''}
                                            onChange={(e) => updateField({ targets: [e.target.value] })}
                                            placeholder="Host:port or connection string"
                                            className="flex-1 input-field"
                                        />
                                    </div>
                                ) : (
                                    <span className="text-xs text-slate-500 italic">System-wide monitoring enabled for this type.</span>
                                )}
                            </div>
                        </div>

                        {/* Frequency */}
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-400 flex items-center gap-2">
                                <Bell size={14} />
                                Notification Reminder (mins)
                            </label>
                            <input
                                type="number"
                                className="input-field"
                                value={formData.notification_frequency}
                                min="1"
                                max="1440"
                                onChange={e => updateField({ notification_frequency: parseInt(e.target.value) })}
                            />
                        </div>
                    </div>

                    {/* Thresholds */}
                    <div className="p-5 bg-white/5 rounded-2xl border border-white/10 space-y-6">
                        <div className="flex justify-between items-center">
                            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                                Evaluation Thresholds ({checkTypes.find(t => t.id === formData.check_type)?.unit})
                            </h4>
                            {formData.check_type === 'container_status' && (
                                <span className="text-[10px] bg-red-500/10 text-red-400 px-2 py-0.5 rounded border border-red-500/20 font-bold uppercase">Binary Status</span>
                            )}
                        </div>

                        {formData.check_type !== 'container_status' && formData.check_type !== 'sip_registration' ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="space-y-4">
                                    <div className="flex justify-between items-center">
                                        <label className="text-sm font-bold text-amber-400">Warning Level</label>
                                        <span className="text-xl font-bold text-white">{formData.thresholds.warning}{checkTypes.find(t => t.id === formData.check_type)?.unit}</span>
                                    </div>
                                    <input
                                        type="range"
                                        className="w-full accent-amber-500"
                                        min="0"
                                        max={formData.check_type === 'sip_rtt' ? 2000 : 100}
                                        value={formData.thresholds.warning}
                                        onChange={e => updateField({
                                            thresholds: { ...formData.thresholds, warning: parseInt(e.target.value) }
                                        })}
                                    />
                                </div>

                                <div className="space-y-4">
                                    <div className="flex justify-between items-center">
                                        <label className="text-sm font-bold text-red-500">Critical Level</label>
                                        <span className="text-xl font-bold text-white">{formData.thresholds.critical}{checkTypes.find(t => t.id === formData.check_type)?.unit}</span>
                                    </div>
                                    <input
                                        type="range"
                                        className="w-full accent-red-500"
                                        min="0"
                                        max={formData.check_type === 'sip_rtt' ? 2000 : 100}
                                        value={formData.thresholds.critical}
                                        onChange={e => updateField({
                                            thresholds: { ...formData.thresholds, critical: parseInt(e.target.value) }
                                        })}
                                    />
                                </div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 gap-4">
                                <p className="text-xs text-slate-400 italic">
                                    {formData.check_type === 'sip_registration'
                                        ? "This rule triggers a Critical alert if the SIP registration status becomes 'Unregistered'."
                                        : "This rule triggers a Critical alert if the container status is anything other than 'running' or 'healthy'."}
                                </p>
                                <div className="flex gap-4">
                                    <div className="flex-1 p-3 bg-red-500/5 border border-red-500/10 rounded-xl">
                                        <p className="text-[10px] font-black text-red-500 uppercase mb-1">Critical Events</p>
                                        <p className="text-xs text-slate-300">
                                            {formData.check_type === 'sip_registration' ? 'Unregistered, Timeout, Rejected' : 'Stopped, Dead, Unhealthy, Exited'}
                                        </p>
                                    </div>
                                    <div className="flex-1 p-3 bg-amber-500/5 border border-amber-500/10 rounded-xl">
                                        <p className="text-[10px] font-black text-amber-500 uppercase mb-1">Warning Events</p>
                                        <p className="text-xs text-slate-300">
                                            {formData.check_type === 'sip_registration' ? 'Auth Required, Retrying' : 'Restarting, Paused, Created'}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Notification Channels */}
                    <div className="space-y-3">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center justify-between">
                            <span>Notification Destinations</span>
                            <span className="text-[10px] text-slate-500 font-normal lowercase">Overrides global defaults</span>
                        </label>
                        {availableChannels.length === 0 ? (
                            <div className="text-xs text-amber-300 bg-amber-500/5 border border-amber-500/10 rounded-xl p-3">
                                No notification channels configured. Default fallback channels will be used. Configure channels in Notification settings.
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-40 overflow-y-auto border border-white/10 rounded-2xl p-3 bg-white/5 custom-scrollbar">
                                {availableChannels.map((channel: any) => {
                                    const selected = (formData.notification_channel_ids || []).includes(channel._id);
                                    return (
                                        <button
                                            key={channel._id}
                                            type="button"
                                            onClick={() => {
                                                const ids = formData.notification_channel_ids || [];
                                                const updated = ids.includes(channel._id)
                                                    ? ids.filter((id: any) => id !== channel._id)
                                                    : [...ids, channel._id];
                                                updateField({ notification_channel_ids: updated });
                                            }}
                                            className={clsx(
                                                "flex items-center justify-between p-2.5 rounded-xl border text-xs font-bold transition-all",
                                                selected
                                                    ? "bg-emerald-500/10 border-emerald-500/50 text-emerald-400"
                                                    : "bg-white/5 border-white/10 text-slate-400 hover:bg-white/10"
                                            )}
                                        >
                                            <span className="flex items-center gap-2">
                                                <div className={clsx("w-2 h-2 rounded-full", selected ? "bg-emerald-500 shadow-[0_0_5px_#10b981]" : "bg-slate-700")} />
                                                <span className="truncate max-w-[120px]" title={channel.name}>{channel.name}</span>
                                            </span>
                                            <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-white/5 text-slate-500">{channel.type}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {canAssignUsers && (
                        <div className="space-y-3">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                                <Users size={14} />
                                Rule Assignees
                            </label>
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
                                <p className="text-xs text-slate-400">
                                    Restrict this monitoring rule to selected users. Leave empty to keep rule visible to all users with device access.
                                </p>
                                <div className="max-h-44 overflow-y-auto custom-scrollbar space-y-2 pr-1">
                                    {assignableUsers
                                        .filter((user) => user.is_active !== false)
                                        .map((user) => {
                                            const checked = formData.assigned_user_ids?.includes(user.id);
                                            const displayName = (user.name || '').trim() || user.email || user.id;
                                            return (
                                                <label
                                                    key={user.id}
                                                    className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/10 px-3 py-2 cursor-pointer hover:bg-white/5 transition-colors"
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={checked}
                                                        onChange={() => {
                                                            const current: string[] = Array.isArray(formData.assigned_user_ids) ? formData.assigned_user_ids : [];
                                                            const next = checked
                                                                ? current.filter((id) => id !== user.id)
                                                                : [...current, user.id];
                                                            updateField({ assigned_user_ids: next });
                                                        }}
                                                        className="w-4 h-4 rounded border-dark-border bg-dark-bg text-primary-600 focus:ring-primary-500"
                                                    />
                                                    <span className="text-sm text-slate-200">{displayName}</span>
                                                    {user.email && user.name && (
                                                        <span className="text-xs text-slate-500">{user.email}</span>
                                                    )}
                                                </label>
                                            );
                                        })}
                                    {assignableUsers.filter((user) => user.is_active !== false).length === 0 && (
                                        <p className="text-xs text-slate-500">No active users available for assignment.</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </form>

                <div className="px-6 py-4 bg-black/20 border-t border-dark-border flex justify-end gap-3">
                    <button onClick={onClose} className="px-6 py-2 rounded-xl text-slate-400 font-bold hover:text-white transition-all">
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={checkTypes.length === 0}
                        className="px-8 py-2 bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl shadow-[0_0_20px_rgba(14,165,233,0.3)] hover:bg-primary-400 transition-all border border-primary-400/20"
                    >
                        {initialData ? 'Update Rule' : 'Create Rule'}
                    </button>
                </div>
            </div>
        </div>
    );
};
