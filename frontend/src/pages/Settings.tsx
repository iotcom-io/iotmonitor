import React, { useState, useEffect } from 'react';
import { Save, Shield, Bell, Globe, Loader2, CheckCircle2, Plus, Trash2, Lock } from 'lucide-react';
import api from '../lib/axios';
import { ConfirmationModal } from '../components/ConfirmationModal';

export const Settings = () => {
    const [settings, setSettings] = useState<any>({
        mqtt_public_url: '',
        mqtt_username: '',
        mqtt_password: '',
        notification_slack_webhook: '',
        slack_webhooks: [],
        custom_webhooks: [],
        notification_email_user: '',
        notification_email_pass: ''
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    // Confirmation Modal State
    const [confirmModal, setConfirmModal] = useState({
        isOpen: false,
        title: '',
        message: '',
        onConfirm: () => { },
        isDangerous: false
    });

    const closeConfirmModal = () => setConfirmModal(prev => ({ ...prev, isOpen: false }));

    const handleDeleteSlack = (idx: number) => {
        setConfirmModal({
            isOpen: true,
            title: 'Delete Slack Webhook?',
            message: 'Are you sure you want to remove this webhook? This action cannot be undone.',
            isDangerous: true,
            onConfirm: () => {
                const list = settings.slack_webhooks.filter((_: any, i: number) => i !== idx);
                setSettings((prev: any) => ({ ...prev, slack_webhooks: list }));
                closeConfirmModal();
            }
        });
    };

    const handleDeleteCustom = (idx: number) => {
        setConfirmModal({
            isOpen: true,
            title: 'Delete Custom Webhook?',
            message: 'Are you sure you want to remove this webhook configuration? This action cannot be undone.',
            isDangerous: true,
            onConfirm: () => {
                const list = settings.custom_webhooks.filter((_: any, i: number) => i !== idx);
                setSettings((prev: any) => ({ ...prev, custom_webhooks: list }));
                closeConfirmModal();
            }
        });
    };

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const { data } = await api.get('/settings');
                setSettings(data);
            } catch (error) {
                console.error('Failed to fetch settings', error);
            } finally {
                setLoading(false);
            }
        };
        fetchSettings();
    }, []);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setSaved(false);
        try {
            await api.post('/settings', settings);
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch (error) {
            console.error('Save failed', error);
            alert('Failed to save settings');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="h-[60vh] flex items-center justify-center">
                <Loader2 size={40} className="text-primary-500 animate-spin" />
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto space-y-8">
            <div>
                <h2 className="text-3xl font-bold text-white mb-2">System Settings</h2>
                <p className="text-slate-400">Configure global parameters for agent communication and automated notifications</p>
            </div>

            <form onSubmit={handleSave} className="space-y-6">
                <div className="card space-y-6">
                    <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                        <Globe className="text-primary-400" size={24} />
                        <h3 className="text-xl font-bold text-white">Connectivity</h3>
                    </div>

                    <div className="space-y-3">
                        <label className="text-sm font-medium text-slate-400 uppercase tracking-wider">Public MQTT Host/IP</label>
                        <input
                            type="text"
                            value={settings.mqtt_public_url}
                            onChange={e => setSettings({ ...settings, mqtt_public_url: e.target.value })}
                            className="input-field"
                            placeholder="e.g. 157.245.x.x or monitor.mycompany.com"
                            required
                        />
                        <p className="text-xs text-slate-500">This address will be baked into all new agents. Remote agents must be able to reach this IP on port 1883.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-400 uppercase tracking-wider flex items-center gap-2">
                                MQTT Username <Lock size={12} className="text-slate-500" />
                            </label>
                            <input className="input-field" value={settings.mqtt_username || ''} onChange={e => setSettings({ ...settings, mqtt_username: e.target.value })} />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-400 uppercase tracking-wider flex items-center gap-2">
                                MQTT Password <Lock size={12} className="text-slate-500" />
                            </label>
                            <input type="password" className="input-field" value={settings.mqtt_password || ''} onChange={e => setSettings({ ...settings, mqtt_password: e.target.value })} />
                        </div>
                    </div>
                </div>

                <div className="card space-y-6">
                    <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                        <Bell className="text-emerald-400" size={24} />
                        <h3 className="text-xl font-bold text-white">Notifications</h3>
                    </div>

                    <div className="space-y-4">
                        <div className="space-y-3">
                            <label className="text-sm font-medium text-slate-400 uppercase tracking-wider">Slack Webhook URL</label>
                            <input
                                type="text"
                                value={settings.notification_slack_webhook || ''}
                                onChange={e => setSettings({ ...settings, notification_slack_webhook: e.target.value })}
                                className="input-field"
                                placeholder="https://hooks.slack.com/services/..."
                            />
                        </div>

                        <div className="space-y-3">
                            <label className="text-sm font-medium text-slate-400 uppercase tracking-wider">Slack Webhook Groups</label>
                            <p className="text-xs text-slate-500">Add multiple webhook URLs; the first is used by default unless overridden by device or rule.</p>
                            {settings.slack_webhooks?.map((w: any, idx: number) => (
                                <div key={idx} className="flex gap-2">
                                    <input
                                        className="input-field flex-1"
                                        placeholder="Name"
                                        value={w.name}
                                        onChange={e => {
                                            const list = [...settings.slack_webhooks];
                                            list[idx] = { ...list[idx], name: e.target.value };
                                            setSettings({ ...settings, slack_webhooks: list });
                                        }}
                                    />
                                    <input
                                        className="input-field flex-[2]"
                                        placeholder="https://hooks.slack.com/services/..."
                                        value={w.url}
                                        onChange={e => {
                                            const list = [...settings.slack_webhooks];
                                            list[idx] = { ...list[idx], url: e.target.value };
                                            setSettings({ ...settings, slack_webhooks: list });
                                        }}
                                    />
                                    <button
                                        type="button"
                                        className="icon-btn text-red-400 hover:text-red-300 transition-colors p-2"
                                        onClick={() => handleDeleteSlack(idx)}
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            ))}
                            <button
                                type="button"
                                className="btn-secondary flex items-center gap-2"
                                onClick={() => setSettings({ ...settings, slack_webhooks: [...(settings.slack_webhooks || []), { name: '', url: '' }] })}
                            >
                                <Plus size={14} /> Add Slack Webhook
                            </button>
                        </div>

                        <div className="space-y-3">
                            <label className="text-sm font-medium text-slate-400 uppercase tracking-wider">Custom Webhooks / APIs</label>
                            <p className="text-xs text-slate-500">Triggered on alerts. Use &#123;&#123;message&#125;&#125; in body.</p>
                            {settings.custom_webhooks?.map((w: any, idx: number) => (
                                <div key={idx} className="p-3 bg-white/5 border border-white/10 rounded-lg space-y-2">
                                    <div className="flex gap-2">
                                        <input className="input-field flex-1" placeholder="Name" value={w.name} onChange={e => {
                                            const list = [...settings.custom_webhooks]; list[idx] = { ...list[idx], name: e.target.value }; setSettings({ ...settings, custom_webhooks: list });
                                        }} />
                                        <input className="input-field flex-[2]" placeholder="https://api.example.com/hook" value={w.url} onChange={e => {
                                            const list = [...settings.custom_webhooks]; list[idx] = { ...list[idx], url: e.target.value }; setSettings({ ...settings, custom_webhooks: list });
                                        }} />
                                        <select className="input-field w-28" value={w.method || 'POST'} onChange={e => {
                                            const list = [...settings.custom_webhooks]; list[idx] = { ...list[idx], method: e.target.value }; setSettings({ ...settings, custom_webhooks: list });
                                        }}>
                                            <option>POST</option><option>GET</option><option>PUT</option><option>DELETE</option>
                                        </select>
                                        <button type="button" className="icon-btn text-red-400 hover:text-red-300 transition-colors p-2" onClick={() => handleDeleteCustom(idx)}>
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                    <textarea className="input-field w-full text-xs" rows={3} placeholder='{"message":"{{message}}"}' value={w.body || ''} onChange={e => {
                                        const list = [...settings.custom_webhooks]; list[idx] = { ...list[idx], body: e.target.value }; setSettings({ ...settings, custom_webhooks: list });
                                    }} />
                                    <textarea className="input-field w-full text-xs" rows={2} placeholder='{"Authorization":"Bearer token"}' value={w.headers ? JSON.stringify(w.headers) : ''} onChange={e => {
                                        const list = [...settings.custom_webhooks]; list[idx] = { ...list[idx], headers: e.target.value ? JSON.parse(e.target.value) : {} }; setSettings({ ...settings, custom_webhooks: list });
                                    }} />
                                </div>
                            ))}
                            <button type="button" className="btn-secondary flex items-center gap-2" onClick={() => setSettings({ ...settings, custom_webhooks: [...(settings.custom_webhooks || []), { name: '', url: '', method: 'POST', headers: {}, body: '' }] })}>
                                <Plus size={14} /> Add Custom Webhook
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-3">
                                <label className="text-sm font-medium text-slate-400 uppercase tracking-wider">SMTP Email User</label>
                                <input
                                    type="text"
                                    value={settings.notification_email_user || ''}
                                    onChange={e => setSettings({ ...settings, notification_email_user: e.target.value })}
                                    className="input-field"
                                    placeholder="alerts@mycompany.com"
                                />
                            </div>
                            <div className="space-y-3">
                                <label className="text-sm font-medium text-slate-400 uppercase tracking-wider">SMTP Password</label>
                                <input
                                    type="password"
                                    value={settings.notification_email_pass || ''}
                                    onChange={e => setSettings({ ...settings, notification_email_pass: e.target.value })}
                                    className="input-field"
                                    placeholder="••••••••"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex justify-end gap-4 items-center">
                    {saved && (
                        <div className="flex items-center gap-2 text-emerald-400 font-bold animate-fade-in">
                            <CheckCircle2 size={18} />
                            Settings Saved Successfully
                        </div>
                    )}
                    <button
                        type="submit"
                        disabled={saving}
                        className="btn-primary px-8 flex items-center justify-center gap-2 min-w-[160px]"
                    >
                        {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                        {saving ? 'Saving...' : 'Save Settings'}
                    </button>
                </div>
            </form>

            <div className="p-4 rounded-xl bg-amber-400/5 border border-amber-500/10 flex gap-4">
                <div className="p-2 bg-amber-500/10 rounded-lg h-fit text-amber-400">
                    <Shield size={20} />
                </div>
                <p className="text-sm text-slate-400 leading-relaxed">
                    <span className="text-slate-100 font-semibold">Security Note:</span> These settings are encrypted at rest and only accessible to authorized administrators. Changing the MQTT host will not affect previously generated agents unless they are manually updated with a new <code className="text-slate-200">config.json</code> file.
                </p>
            </div>

            <ConfirmationModal
                isOpen={confirmModal.isOpen}
                title={confirmModal.title}
                message={confirmModal.message}
                onConfirm={confirmModal.onConfirm}
                onCancel={closeConfirmModal}
                isDangerous={confirmModal.isDangerous}
            />
        </div>
    );
};
