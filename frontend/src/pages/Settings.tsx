import React, { useState, useEffect } from 'react';
import { Save, Shield, Bell, Globe, Loader2, CheckCircle2 } from 'lucide-react';
import api from '../lib/axios';

export const Settings = () => {
    const [settings, setSettings] = useState<any>({
        mqtt_public_url: '',
        notification_slack_webhook: '',
        notification_email_user: '',
        notification_email_pass: ''
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

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
                            className="w-full bg-dark-bg border border-dark-border rounded-xl px-4 py-3 text-white outline-none focus:border-primary-500/50"
                            placeholder="e.g. 157.245.x.x or monitor.mycompany.com"
                            required
                        />
                        <p className="text-xs text-slate-500">This address will be baked into all new agents. Remote agents must be able to reach this IP on port 1883.</p>
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
                                className="w-full bg-dark-bg border border-dark-border rounded-xl px-4 py-3 text-white outline-none focus:border-primary-500/50"
                                placeholder="https://hooks.slack.com/services/..."
                            />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-3">
                                <label className="text-sm font-medium text-slate-400 uppercase tracking-wider">SMTP Email User</label>
                                <input
                                    type="text"
                                    value={settings.notification_email_user || ''}
                                    onChange={e => setSettings({ ...settings, notification_email_user: e.target.value })}
                                    className="w-full bg-dark-bg border border-dark-border rounded-xl px-4 py-3 text-white outline-none focus:border-primary-500/50"
                                    placeholder="alerts@mycompany.com"
                                />
                            </div>
                            <div className="space-y-3">
                                <label className="text-sm font-medium text-slate-400 uppercase tracking-wider">SMTP Password</label>
                                <input
                                    type="password"
                                    value={settings.notification_email_pass || ''}
                                    onChange={e => setSettings({ ...settings, notification_email_pass: e.target.value })}
                                    className="w-full bg-dark-bg border border-dark-border rounded-xl px-4 py-3 text-white outline-none focus:border-primary-500/50"
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
        </div>
    );
};
