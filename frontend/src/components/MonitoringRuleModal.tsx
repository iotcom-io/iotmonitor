import React, { useState } from 'react';
import { X, ShieldCheck, Activity, Phone, Wifi, Cpu, MemoryStick as Memory, Bell, HardDrive, Box, LayoutGrid } from 'lucide-react';
import { clsx } from 'clsx';

interface MonitoringRuleModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (rules: any[]) => void;
    initialData?: any;
    latestMetrics?: {
        extra?: {
            registrations?: { name: string; status: string; serverUri: string; expiresS: number }[];
            contacts?: { aor: string; status: string; rttMs?: number }[];
            interfaces?: { name: string; rx_bps: number; tx_bps: number; rx_bytes: number; tx_bytes: number }[];
            docker?: {
                containers?: { name: string; state: string; status: string }[];
            };
        };
    };
}

export const MonitoringRuleModal = ({ isOpen, onClose, onSave, initialData, latestMetrics }: MonitoringRuleModalProps) => {
    // Default thresholds for each rule type
    const TYPE_DEFAULTS: Record<string, any> = {
        cpu: { thresholds: { warning: 70, critical: 90 }, target: 'System-wide' },
        memory: { thresholds: { warning: 75, critical: 90 }, target: 'System-wide' },
        disk: { thresholds: { warning: 80, critical: 90 }, target: '/' },
        bandwidth: { thresholds: { warning: 50, critical: 100 }, target: '' },
        utilization: { thresholds: { warning: 70, critical: 90 }, target: '' },
        sip_rtt: { thresholds: { warning: 300, critical: 600 }, target: 'System-wide' },
        sip_registration: { thresholds: { warning: 95, critical: 80 }, target: 'System-wide' },
        container_status: { thresholds: { warning: 1, critical: 1 }, target: '' }
    };

    // Convert legacy 'attention' to 'warning' if present
    const prepData = (data: any) => {
        const defaultData = {
            check_type: 'cpu',
            target: 'System-wide',
            thresholds: { warning: 70, critical: 90, consecutive_failures: 1 },
            notification_frequency: 15,
            notify: { channels: ['slack'] },
            enabled: true
        };
        if (!data) return defaultData;
        const thresholds = { ...data.thresholds };
        if (thresholds.attention !== undefined && thresholds.warning === undefined) {
            thresholds.warning = thresholds.attention;
            delete thresholds.attention;
        }
        return { ...data, thresholds };
    };

    const [formData, setFormData] = useState(prepData(initialData));

    // Track which types have been modified in this session
    const [modifiedTypes, setModifiedTypes] = useState<Set<string>>(new Set<string>(initialData ? [initialData.check_type] : []));

    interface SessionConfig {
        thresholds: any;
        targets: string[];
        target?: string;
        notification_frequency: number;
        notify: any;
    }

    // Store customizations per type to prevent loss when switching tabs
    const [sessionConfigs, setSessionConfigs] = useState<Record<string, SessionConfig>>({});

    React.useEffect(() => {
        const prepped = prepData(initialData);
        if (isOpen) {
            setFormData(prepped);
            if (prepped) {
                const initialTargets = Array.isArray(prepped.target) ? prepped.target : (prepped.target ? [prepped.target] : []);
                const config: SessionConfig = {
                    thresholds: prepped.thresholds,
                    targets: initialTargets,
                    notification_frequency: prepped.notification_frequency || 15,
                    notify: prepped.notify || { channels: ['slack'] }
                };
                setSessionConfigs({ [prepped.check_type]: config });
                setModifiedTypes(new Set<string>([prepped.check_type]));

                // Update formData with targets array for the multi-select UI
                setFormData({ ...prepped, targets: initialTargets });
            } else {
                setModifiedTypes(new Set<string>());
                setSessionConfigs({});
            }
        }
    }, [initialData, isOpen]);

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
                    notify: next.notify
                }
            }));
            return next;
        });
    };

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        // Collect all rules from modified types
        const rulesToSave: any[] = [];

        modifiedTypes.forEach(typeId => {
            const config = sessionConfigs[typeId];
            if (!config) return;

            const targets = (config.targets && config.targets.length > 0)
                ? config.targets
                : [config.target || 'System-wide'];

            targets.forEach((target: string) => {
                const rule = {
                    check_type: typeId,
                    target,
                    thresholds: config.thresholds,
                    notification_frequency: config.notification_frequency,
                    notify: config.notify,
                    enabled: true
                };

                // If editing, preserve the ID only for the EXACT matching target
                if (initialData && initialData.check_type === typeId && initialData.target === target) {
                    (rule as any)._id = initialData._id;
                }

                rulesToSave.push(rule);
            });
        });

        if (rulesToSave.length === 0) {
            onClose();
            return;
        }

        onSave(rulesToSave);
    };

    const checkTypes = [
        { id: 'cpu', label: 'CPU Load', icon: Cpu, unit: '%' },
        { id: 'memory', label: 'Memory Usage', icon: Memory, unit: '%' },
        { id: 'disk', label: 'Disk Usage', icon: HardDrive, unit: '%' },
        { id: 'bandwidth', label: 'Network Bandwidth', icon: Wifi, unit: 'Mbps' },
        { id: 'utilization', label: 'Network Util', icon: LayoutGrid, unit: '%' },
        { id: 'sip_rtt', label: 'SIP RTT/Status', icon: Phone, unit: 'ms' },
        { id: 'sip_registration', label: 'SIP Registrations %', icon: Phone, unit: '%' },
        { id: 'container_status', label: 'Container Status', icon: Box, unit: 'status' },
    ];

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
                            {checkTypes.map((type) => (
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
                                            targets: config.targets || (config.target ? [config.target] : [])
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
                            ))}
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
                                        {(() => {
                                            const seen = new Set(['System-wide']);
                                            const buttons: React.ReactNode[] = [];

                                            latestMetrics?.extra?.registrations?.forEach((r: any) => {
                                                if (seen.has(r.name)) return;
                                                seen.add(r.name);
                                                buttons.push(
                                                    <button
                                                        key={r.name}
                                                        type="button"
                                                        onClick={() => {
                                                            const current = formData.targets?.filter((t: string) => t !== 'System-wide') || [];
                                                            const next = current.includes(r.name) ? current.filter((t: string) => t !== r.name) : [...current, r.name];
                                                            updateField({ targets: next });
                                                        }}
                                                        className={clsx(
                                                            "px-3 py-1.5 rounded-lg border text-xs font-bold transition-all",
                                                            formData.targets?.includes(r.name) ? "bg-primary-500/20 border-primary-500 text-primary-400" : "bg-white/5 border-white/10 text-slate-500"
                                                        )}
                                                    >
                                                        {r.name}
                                                    </button>
                                                );
                                            });

                                            latestMetrics?.extra?.contacts?.forEach((c: any) => {
                                                if (seen.has(c.aor)) return;
                                                seen.add(c.aor);
                                                buttons.push(
                                                    <button
                                                        key={c.aor}
                                                        type="button"
                                                        onClick={() => {
                                                            const current = formData.targets?.filter((t: string) => t !== 'System-wide') || [];
                                                            const next = current.includes(c.aor) ? current.filter((t: string) => t !== c.aor) : [...current, c.aor];
                                                            updateField({ targets: next });
                                                        }}
                                                        className={clsx(
                                                            "px-3 py-1.5 rounded-lg border text-xs font-bold transition-all",
                                                            formData.targets?.includes(c.aor) ? "bg-primary-500/20 border-primary-500 text-primary-400" : "bg-white/5 border-white/10 text-slate-500"
                                                        )}
                                                    >
                                                        {c.aor}
                                                    </button>
                                                );
                                            });

                                            return buttons;
                                        })()}
                                    </>
                                ) : formData.check_type === 'bandwidth' || formData.check_type === 'utilization' ? (
                                    latestMetrics?.extra?.interfaces?.map((i: any) => (
                                        <button
                                            key={i.name}
                                            type="button"
                                            onClick={() => {
                                                const current = formData.targets || [];
                                                const next = current.includes(i.name) ? current.filter((t: string) => t !== i.name) : [...current, i.name];
                                                updateField({ targets: next });
                                            }}
                                            className={clsx(
                                                "px-3 py-1.5 rounded-lg border text-xs font-bold transition-all",
                                                formData.targets?.includes(i.name) ? "bg-primary-500/20 border-primary-500 text-primary-400" : "bg-white/5 border-white/10 text-slate-500"
                                            )}
                                        >
                                            {i.name}
                                        </button>
                                    ))
                                ) : formData.check_type === 'container_status' ? (
                                    latestMetrics?.extra?.docker?.containers?.map((c: any) => (
                                        <button
                                            key={c.name}
                                            type="button"
                                            onClick={() => {
                                                const current = formData.targets || [];
                                                const next = current.includes(c.name) ? current.filter((t: string) => t !== c.name) : [...current, c.name];
                                                updateField({ targets: next });
                                            }}
                                            className={clsx(
                                                "px-3 py-1.5 rounded-lg border text-xs font-bold transition-all",
                                                formData.targets?.includes(c.name) ? "bg-primary-500/20 border-primary-500 text-primary-400" : "bg-white/5 border-white/10 text-slate-500"
                                            )}
                                        >
                                            {c.name}
                                        </button>
                                    ))
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
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Notification Channels</label>
                        <div className="grid grid-cols-3 gap-3">
                            {['slack', 'email', 'webhook'].map(channel => (
                                <button
                                    key={channel}
                                    type="button"
                                    onClick={() => {
                                        const channels = formData.notify?.channels || [];
                                        const updated = channels.includes(channel)
                                            ? channels.filter((c: any) => c !== channel)
                                            : [...channels, channel];
                                        updateField({ notify: { ...formData.notify, channels: updated } });
                                    }}
                                    className={clsx(
                                        "flex items-center justify-center gap-2 p-3 rounded-xl border text-xs font-bold transition-all capitalize",
                                        formData.notify?.channels?.includes(channel)
                                            ? "bg-emerald-500/10 border-emerald-500/50 text-emerald-400"
                                            : "bg-white/5 border-white/10 text-slate-500"
                                    )}
                                >
                                    <div className={clsx("w-2 h-2 rounded-full", formData.notify?.channels?.includes(channel) ? "bg-emerald-500 shadow-[0_0_5px_#10b981]" : "bg-slate-700")} />
                                    {channel}
                                </button>
                            ))}
                        </div>
                    </div>
                </form>

                <div className="px-6 py-4 bg-black/20 border-t border-dark-border flex justify-end gap-3">
                    <button onClick={onClose} className="px-6 py-2 rounded-xl text-slate-400 font-bold hover:text-white transition-all">
                        Cancel
                    </button>
                    <button onClick={handleSubmit} className="px-8 py-2 bg-primary-500 text-white font-bold rounded-xl shadow-[0_0_20px_rgba(14,165,233,0.3)] hover:bg-primary-400 transition-all border border-primary-400/20">
                        {initialData ? 'Update Rule' : 'Create Rule'}
                    </button>
                </div>
            </div>
        </div>
    );
};
