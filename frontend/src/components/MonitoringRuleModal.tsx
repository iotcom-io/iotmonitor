import React, { useState } from 'react';
import { X, ShieldCheck, Activity, Phone, Wifi, Cpu, MemoryStick as Memory, Bell } from 'lucide-react';
import { clsx } from 'clsx';

interface MonitoringRuleModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (rule: any) => void;
    initialData?: any;
    latestMetrics?: any;
}

export const MonitoringRuleModal = ({ isOpen, onClose, onSave, initialData, latestMetrics }: MonitoringRuleModalProps) => {
    const [formData, setFormData] = useState(initialData || {
        check_type: 'cpu',
        target: '',
        thresholds: {
            attention: 70,
            critical: 90
        },
        notification_frequency: 15,
        notification_recipients: [],
        enabled: true
    });

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(formData);
    };

    const checkTypes = [
        { id: 'cpu', label: 'CPU Load', icon: Cpu, unit: '%' },
        { id: 'memory', label: 'Memory Usage', icon: Memory, unit: '%' },
        { id: 'sip', label: 'SIP RTT/Status', icon: Phone, unit: 'ms' },
        { id: 'sip_registration', label: 'SIP Registrations %', icon: Phone, unit: '%' },
        { id: 'bandwidth', label: 'Network Bandwidth', icon: Wifi, unit: 'Mbps' },
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-dark-surface border border-dark-border rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200">
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

                <form onSubmit={handleSubmit} className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                    {/* Check Type Selection */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {checkTypes.map((type) => (
                            <button
                                key={type.id}
                                type="button"
                                onClick={() => {
                                    const defaults: any = {
                                        cpu: { attention: 70, critical: 90 },
                                        memory: { attention: 75, critical: 90 },
                                        sip: { attention: 400, critical: 800 },
                                        sip_registration: { attention: 95, critical: 80 },
                                        bandwidth: { attention: 70, critical: 90 }
                                    };
                                    setFormData({
                                        ...formData,
                                        check_type: type.id as any,
                                        thresholds: defaults[type.id] || formData.thresholds
                                    });
                                }}
                                className={clsx(
                                    "flex flex-col items-center gap-2 p-4 rounded-xl border transition-all",
                                    formData.check_type === type.id
                                        ? "bg-primary-500/20 border-primary-500 text-primary-400 shadow-[0_0_15px_rgba(14,165,233,0.1)]"
                                        : "bg-white/5 border-white/10 text-slate-400 hover:border-white/20 hover:bg-white/10"
                                )}
                            >
                                <type.icon size={24} />
                                <span className="text-xs font-bold">{type.label}</span>
                            </button>
                        ))}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Target Selection */}
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-400 flex items-center gap-2">
                                <Activity size={14} />
                                Target Endpoint / Interface
                            </label>
            {formData.check_type === 'sip' ? (
                <select
                    className="input-field"
                    value={formData.target}
                    onChange={e => setFormData({ ...formData, target: e.target.value })}
                >
                    <option value="">Select a SIP Trunk...</option>
                    {latestMetrics?.extra?.registrations?.map((r: any) => (
                        <option key={r.name} value={r.name}>{r.name} (PJSIP)</option>
                    ))}
                </select>
            ) : formData.check_type === 'sip_registration' ? (
                <input
                                    type="text"
                                    className="input-field"
                                    placeholder="All registrations"
                                    disabled
                                />
            ) : formData.check_type === 'bandwidth' ? (
                <select
                    className="input-field"
                    value={formData.target}
                    onChange={e => setFormData({ ...formData, target: e.target.value })}
                >
                    <option value="">Select Interface...</option>
                    {latestMetrics?.extra?.interfaces?.map((i: any) => (
                        <option key={i.name} value={i.name}>{i.name}</option>
                    ))}
                </select>
            ) : (
                                <input
                                    type="text"
                                    className="input-field"
                                    placeholder="e.g. System-wide"
                                    disabled={formData.check_type === 'cpu' || formData.check_type === 'memory'}
                                    value={formData.target}
                                    onChange={e => setFormData({ ...formData, target: e.target.value })}
                                />
                            )}
                        </div>

                        {/* Frequency */}
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-400 flex items-center gap-2">
                                <Bell size={14} />
                                Notification Frequency
                            </label>
                            <div className="flex items-center gap-3">
                                <input
                                    type="number"
                                    className="input-field"
                                    value={formData.notification_frequency}
                                    onChange={e => setFormData({ ...formData, notification_frequency: parseInt(e.target.value) })}
                                />
                                <span className="text-slate-500 text-sm font-bold">MINS</span>
                            </div>
                        </div>
                    </div>

                    {/* Thresholds */}
                    <div className="p-4 bg-white/5 rounded-2xl border border-white/10 space-y-6">
                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                            Threshold Levels ({checkTypes.find(t => t.id === formData.check_type)?.unit})
                        </h4>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-4">
                                <div className="flex justify-between items-center">
                                    <label className="text-sm font-bold text-amber-400">Attention</label>
                                    <span className="text-xl font-bold text-white">{formData.thresholds.attention}{checkTypes.find(t => t.id === formData.check_type)?.unit}</span>
                                </div>
                                <input
                                    type="range"
                                    className="w-full accent-amber-500"
                                    min="0"
                                    max={formData.check_type === 'sip' ? 2000 : formData.check_type === 'sip_registration' ? 100 : 100}
                                    step="1"
                                    value={formData.thresholds.attention}
                                    onChange={e => setFormData({
                                        ...formData,
                                        thresholds: { ...formData.thresholds, attention: parseInt(e.target.value) }
                                    })}
                                />
                                <p className="text-[10px] text-slate-500 uppercase">Triggers a 'Warning' alert and notifies channels.</p>
                            </div>

                            <div className="space-y-4">
                                <div className="flex justify-between items-center">
                                    <label className="text-sm font-bold text-red-500">Critical</label>
                                    <span className="text-xl font-bold text-white">{formData.thresholds.critical}{checkTypes.find(t => t.id === formData.check_type)?.unit}</span>
                                </div>
                                <input
                                    type="range"
                                    className="w-full accent-red-500"
                                    min="0"
                                    max={formData.check_type === 'sip' ? 2000 : formData.check_type === 'sip_registration' ? 100 : 100}
                                    step="1"
                                    value={formData.thresholds.critical}
                                    onChange={e => setFormData({
                                        ...formData,
                                        thresholds: { ...formData.thresholds, critical: parseInt(e.target.value) }
                                    })}
                                />
                                <p className="text-[10px] text-slate-500 uppercase">Triggers a 'Critical' alert with high priority marking.</p>
                            </div>
                        </div>
                    </div>

                    {/* Recipients */}
                    <div className="space-y-3">
                        <label className="text-sm font-bold text-slate-400">Selective Notification Recipients</label>
                        <div className="p-4 bg-white/5 rounded-xl border border-dashed border-white/20 text-center">
                            <p className="text-slate-500 text-xs italic">By default, all members of group 'Primary Admin' will be notified. Add specific emails/slack handles to override.</p>
                            <button type="button" className="mt-3 text-primary-400 text-xs font-bold hover:underline">+ Add Member / Group</button>
                        </div>
                    </div>
                </form>

                <div className="px-6 py-4 bg-black/20 border-t border-dark-border flex justify-end gap-3">
                    <button onClick={onClose} className="px-6 py-2 rounded-xl text-slate-400 font-bold hover:text-white transition-all">
                        Cancel
                    </button>
                    <button onClick={handleSubmit} className="px-8 py-2 bg-primary-500 text-white font-bold rounded-xl shadow-[0_0_20px_rgba(14,165,233,0.3)] hover:bg-primary-400 transition-all">
                        Save Monitoring Rule
                    </button>
                </div>
            </div>
        </div>
    );
};
