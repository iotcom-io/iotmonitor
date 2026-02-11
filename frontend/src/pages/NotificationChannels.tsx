import React, { useEffect, useMemo, useState } from 'react';
import api from '../lib/axios';
import { Bell, Plus, RefreshCw, TestTube2, Trash2, Pencil, Circle, Star } from 'lucide-react';

type ChannelType = 'slack' | 'email' | 'webhook' | 'sms';

type NotificationChannel = {
    _id: string;
    name: string;
    description?: string;
    type: ChannelType;
    enabled: boolean;
    is_default?: boolean;
    config: {
        slack_webhook_url?: string;
        slack_channel?: string;
        slack_group_name?: string;
        email_addresses?: string[];
        webhook_url?: string;
        phone_numbers?: string[];
    };
    alert_types: string[];
    severity_levels: string[];
    created_at: string;
    updated_at: string;
};

const ALL_ALERT_TYPES = ['offline', 'online', 'service_down', 'sip_issue', 'high_latency', 'threshold', 'synthetic', 'ssl', 'license'];
const ALL_SEVERITY_LEVELS = ['info', 'warning', 'critical'];

const blankForm = {
    name: '',
    description: '',
    type: 'slack' as ChannelType,
    enabled: true,
    is_default: false,
    slack_webhook_url: '',
    slack_channel: '',
    slack_group_name: '',
    email_addresses_text: '',
    webhook_url: '',
    phone_numbers_text: '',
    alert_types: ['offline', 'online', 'service_down', 'threshold'],
    severity_levels: ['warning', 'critical'],
};

const parseCsvList = (value: string) => {
    return Array.from(new Set(
        String(value || '')
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
    ));
};

const channelTypeLabel = (type: ChannelType) => {
    if (type === 'slack') return 'Slack';
    if (type === 'email') return 'Email';
    if (type === 'webhook') return 'Webhook';
    return 'SMS';
};

const channelSummary = (channel: NotificationChannel) => {
    if (channel.type === 'slack') {
        return channel.config.slack_channel || channel.config.slack_group_name || 'Slack webhook configured';
    }
    if (channel.type === 'email') {
        return `${(channel.config.email_addresses || []).length} email recipient(s)`;
    }
    if (channel.type === 'webhook') {
        return channel.config.webhook_url || 'Webhook configured';
    }
    return `${(channel.config.phone_numbers || []).length} phone recipient(s)`;
};

const NotificationChannels: React.FC = () => {
    const [channels, setChannels] = useState<NotificationChannel[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingChannel, setEditingChannel] = useState<NotificationChannel | null>(null);
    const [testingChannel, setTestingChannel] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [formData, setFormData] = useState({ ...blankForm });

    const fetchChannels = async () => {
        try {
            setLoading(true);
            const response = await api.get('/notification-channels');
            setChannels(Array.isArray(response.data) ? response.data : []);
        } catch (error) {
            console.error('Error fetching channels:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchChannels();
    }, []);

    const defaultChannelId = useMemo(() => {
        const row = channels.find((item) => item.is_default);
        return row?._id || null;
    }, [channels]);

    const openCreateModal = () => {
        setEditingChannel(null);
        setFormData({ ...blankForm, is_default: defaultChannelId === null });
        setShowModal(true);
    };

    const openEditModal = (channel: NotificationChannel) => {
        setEditingChannel(channel);
        setFormData({
            name: channel.name,
            description: channel.description || '',
            type: channel.type,
            enabled: Boolean(channel.enabled),
            is_default: Boolean(channel.is_default),
            slack_webhook_url: channel.config.slack_webhook_url || '',
            slack_channel: channel.config.slack_channel || '',
            slack_group_name: channel.config.slack_group_name || '',
            email_addresses_text: (channel.config.email_addresses || []).join(', '),
            webhook_url: channel.config.webhook_url || '',
            phone_numbers_text: (channel.config.phone_numbers || []).join(', '),
            alert_types: Array.isArray(channel.alert_types) ? channel.alert_types : [],
            severity_levels: Array.isArray(channel.severity_levels) ? channel.severity_levels : [],
        });
        setShowModal(true);
    };

    const closeModal = () => {
        setShowModal(false);
        setEditingChannel(null);
        setSaving(false);
    };

    const toggleInArray = (source: string[], value: string) => {
        if (source.includes(value)) return source.filter((item) => item !== value);
        return [...source, value];
    };

    const buildPayload = () => {
        const payload: any = {
            name: formData.name.trim(),
            description: formData.description.trim(),
            type: formData.type,
            enabled: Boolean(formData.enabled),
            is_default: Boolean(formData.is_default),
            alert_types: formData.alert_types,
            severity_levels: formData.severity_levels,
            config: {},
        };

        if (formData.type === 'slack') {
            payload.config = {
                slack_webhook_url: formData.slack_webhook_url.trim(),
                slack_channel: formData.slack_channel.trim(),
                slack_group_name: formData.slack_group_name.trim(),
            };
        } else if (formData.type === 'email') {
            payload.config = {
                email_addresses: parseCsvList(formData.email_addresses_text),
            };
        } else if (formData.type === 'webhook') {
            payload.config = {
                webhook_url: formData.webhook_url.trim(),
            };
        } else {
            payload.config = {
                phone_numbers: parseCsvList(formData.phone_numbers_text),
            };
        }

        return payload;
    };

    const validate = () => {
        if (!formData.name.trim()) return 'Channel name is required.';
        if (formData.alert_types.length === 0) return 'Select at least one alert type.';
        if (formData.severity_levels.length === 0) return 'Select at least one severity level.';

        if (formData.type === 'slack' && !formData.slack_webhook_url.trim()) {
            return 'Slack webhook URL is required for Slack channels.';
        }
        if (formData.type === 'email' && parseCsvList(formData.email_addresses_text).length === 0) {
            return 'At least one email address is required for Email channels.';
        }
        if (formData.type === 'webhook' && !formData.webhook_url.trim()) {
            return 'Webhook URL is required for Webhook channels.';
        }
        if (formData.type === 'sms' && parseCsvList(formData.phone_numbers_text).length === 0) {
            return 'At least one phone number is required for SMS channels.';
        }

        return '';
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const error = validate();
        if (error) {
            window.alert(error);
            return;
        }

        try {
            setSaving(true);
            const payload = buildPayload();
            if (editingChannel) {
                await api.patch(`/notification-channels/${editingChannel._id}`, payload);
            } else {
                await api.post('/notification-channels', payload);
            }
            await fetchChannels();
            closeModal();
        } catch (err) {
            console.error('Error saving notification channel:', err);
            window.alert('Failed to save notification channel.');
        } finally {
            setSaving(false);
        }
    };

    const toggleChannel = async (id: string) => {
        try {
            await api.patch(`/notification-channels/${id}/toggle`);
            await fetchChannels();
        } catch (error) {
            console.error('Error toggling channel:', error);
        }
    };

    const setDefaultChannel = async (id: string) => {
        try {
            await api.patch(`/notification-channels/${id}/default`);
            await fetchChannels();
        } catch (error) {
            console.error('Error setting default channel:', error);
            window.alert('Failed to set default channel.');
        }
    };

    const deleteChannel = async (id: string, name: string) => {
        const confirmed = window.confirm(`Delete channel "${name}"?`);
        if (!confirmed) return;

        try {
            await api.delete(`/notification-channels/${id}`);
            await fetchChannels();
        } catch (error) {
            console.error('Error deleting channel:', error);
            window.alert('Failed to delete channel.');
        }
    };

    const testChannel = async (id: string) => {
        try {
            setTestingChannel(id);
            await api.post(`/notification-channels/${id}/test`);
            window.alert('Test notification sent.');
        } catch (error) {
            console.error('Error sending test notification:', error);
            window.alert('Failed to send test notification.');
        } finally {
            setTestingChannel(null);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="flex items-start gap-3">
                    <Bell className="text-primary-400 mt-1" />
                    <div>
                        <h2 className="text-2xl font-bold text-white">Notification Channels</h2>
                        <p className="text-slate-500 text-sm">Create multiple destinations, choose a default fallback, and assign channels at monitor level.</p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button className="icon-btn" onClick={fetchChannels} title="Refresh channels">
                        <RefreshCw size={16} />
                    </button>
                    <button className="btn-primary flex items-center gap-2" onClick={openCreateModal}>
                        <Plus size={16} /> New Channel
                    </button>
                </div>
            </div>

            <div className="card overflow-x-auto">
                {loading ? (
                    <div className="text-slate-400">Loading...</div>
                ) : channels.length === 0 ? (
                    <div className="py-6 text-slate-400">No channels configured.</div>
                ) : (
                    <table className="min-w-full text-sm">
                        <thead>
                            <tr className="text-left text-slate-400 border-b border-white/10">
                                <th className="py-3 pr-3">Channel</th>
                                <th className="py-3 pr-3">Type</th>
                                <th className="py-3 pr-3">Routing</th>
                                <th className="py-3 pr-3">Alert Scope</th>
                                <th className="py-3 pr-3">Status</th>
                                <th className="py-3 pr-3">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {channels.map((channel) => (
                                <tr key={channel._id} className="border-b border-white/5 align-top">
                                    <td className="py-3 pr-3 min-w-[230px]">
                                        <div className="font-semibold text-white flex items-center gap-2">
                                            <span>{channel.name}</span>
                                            {channel.is_default && (
                                                <span className="text-[10px] px-2 py-0.5 rounded bg-primary-500/20 text-primary-300 inline-flex items-center gap-1">
                                                    <Star size={10} /> DEFAULT
                                                </span>
                                            )}
                                        </div>
                                        {channel.description && <div className="text-xs text-slate-500 mt-1">{channel.description}</div>}
                                    </td>
                                    <td className="py-3 pr-3 text-slate-300">{channelTypeLabel(channel.type)}</td>
                                    <td className="py-3 pr-3 text-xs text-slate-300 min-w-[220px]">{channelSummary(channel)}</td>
                                    <td className="py-3 pr-3 min-w-[220px]">
                                        <div className="text-xs text-slate-300">
                                            <div className="mb-1">Alerts: {channel.alert_types.length || 0}</div>
                                            <div>Severities: {channel.severity_levels.join(', ') || 'none'}</div>
                                        </div>
                                    </td>
                                    <td className="py-3 pr-3">
                                        <span className={`text-xs px-2 py-0.5 rounded inline-flex items-center gap-1 ${channel.enabled ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-500/20 text-slate-300'}`}>
                                            <Circle size={8} fill="currentColor" />
                                            {channel.enabled ? 'Enabled' : 'Paused'}
                                        </span>
                                    </td>
                                    <td className="py-3 pr-3">
                                        <div className="flex flex-wrap gap-2">
                                            <button
                                                className="icon-btn"
                                                title="Send test"
                                                disabled={!channel.enabled || testingChannel === channel._id}
                                                onClick={() => testChannel(channel._id)}
                                            >
                                                <TestTube2 size={14} />
                                            </button>
                                            {!channel.is_default && (
                                                <button className="icon-btn" title="Set as default" onClick={() => setDefaultChannel(channel._id)}>
                                                    <Star size={14} />
                                                </button>
                                            )}
                                            <button className="icon-btn" title={channel.enabled ? 'Pause channel' : 'Enable channel'} onClick={() => toggleChannel(channel._id)}>
                                                {channel.enabled ? '||' : '>'}
                                            </button>
                                            <button className="icon-btn" title="Edit" onClick={() => openEditModal(channel)}>
                                                <Pencil size={14} />
                                            </button>
                                            <button className="icon-btn text-red-400" title="Delete" onClick={() => deleteChannel(channel._id, channel.name)}>
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {showModal && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur flex items-center justify-center p-4">
                    <div className="bg-dark-surface border border-dark-border rounded-2xl w-full max-w-3xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between">
                            <h3 className="text-xl font-bold text-white">{editingChannel ? 'Edit Notification Channel' : 'New Notification Channel'}</h3>
                            <button className="icon-btn" onClick={closeModal}>x</button>
                        </div>

                        <form className="space-y-4" onSubmit={handleSubmit}>
                            <div className="grid md:grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <label className="text-sm text-slate-400">Name</label>
                                    <input className="input-field" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm text-slate-400">Type</label>
                                    <select className="input-field" value={formData.type} onChange={(e) => setFormData({ ...formData, type: e.target.value as ChannelType })}>
                                        <option value="slack">Slack</option>
                                        <option value="email">Email</option>
                                        <option value="webhook">Webhook</option>
                                        <option value="sms">SMS</option>
                                    </select>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm text-slate-400">Description</label>
                                <input className="input-field" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} />
                            </div>

                            {formData.type === 'slack' && (
                                <div className="grid md:grid-cols-3 gap-3">
                                    <div className="space-y-2 md:col-span-2">
                                        <label className="text-sm text-slate-400">Slack Webhook URL</label>
                                        <input className="input-field" value={formData.slack_webhook_url} onChange={(e) => setFormData({ ...formData, slack_webhook_url: e.target.value })} />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm text-slate-400">Slack Channel</label>
                                        <input className="input-field" value={formData.slack_channel} onChange={(e) => setFormData({ ...formData, slack_channel: e.target.value })} placeholder="#alerts" />
                                    </div>
                                    <div className="space-y-2 md:col-span-3">
                                        <label className="text-sm text-slate-400">Slack Group Label (optional)</label>
                                        <input className="input-field" value={formData.slack_group_name} onChange={(e) => setFormData({ ...formData, slack_group_name: e.target.value })} placeholder="Ops Team" />
                                    </div>
                                </div>
                            )}

                            {formData.type === 'email' && (
                                <div className="space-y-2">
                                    <label className="text-sm text-slate-400">Email Recipients (comma separated)</label>
                                    <textarea className="input-field min-h-[100px]" value={formData.email_addresses_text} onChange={(e) => setFormData({ ...formData, email_addresses_text: e.target.value })} placeholder="ops@example.com, oncall@example.com" />
                                </div>
                            )}

                            {formData.type === 'webhook' && (
                                <div className="space-y-2">
                                    <label className="text-sm text-slate-400">Webhook URL</label>
                                    <input className="input-field" value={formData.webhook_url} onChange={(e) => setFormData({ ...formData, webhook_url: e.target.value })} />
                                </div>
                            )}

                            {formData.type === 'sms' && (
                                <div className="space-y-2">
                                    <label className="text-sm text-slate-400">Phone Numbers (comma separated)</label>
                                    <textarea className="input-field min-h-[100px]" value={formData.phone_numbers_text} onChange={(e) => setFormData({ ...formData, phone_numbers_text: e.target.value })} placeholder="+12025550123, +12025550124" />
                                </div>
                            )}

                            <div className="grid md:grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <label className="text-sm text-slate-400">Alert Types</label>
                                    <div className="rounded-xl border border-dark-border p-3 grid grid-cols-2 gap-2 text-sm">
                                        {ALL_ALERT_TYPES.map((type) => (
                                            <label key={type} className="flex items-center gap-2 text-slate-300">
                                                <input
                                                    type="checkbox"
                                                    checked={formData.alert_types.includes(type)}
                                                    onChange={() => setFormData({ ...formData, alert_types: toggleInArray(formData.alert_types, type) })}
                                                />
                                                <span>{type}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-sm text-slate-400">Severity Levels</label>
                                    <div className="rounded-xl border border-dark-border p-3 grid grid-cols-1 gap-2 text-sm">
                                        {ALL_SEVERITY_LEVELS.map((level) => (
                                            <label key={level} className="flex items-center gap-2 text-slate-300">
                                                <input
                                                    type="checkbox"
                                                    checked={formData.severity_levels.includes(level)}
                                                    onChange={() => setFormData({ ...formData, severity_levels: toggleInArray(formData.severity_levels, level) })}
                                                />
                                                <span>{level}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="grid md:grid-cols-2 gap-3">
                                <label className="flex items-center gap-2 text-sm text-slate-300">
                                    <input type="checkbox" checked={Boolean(formData.enabled)} onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })} />
                                    Enable this channel
                                </label>
                                <label className="flex items-center gap-2 text-sm text-slate-300">
                                    <input type="checkbox" checked={Boolean(formData.is_default)} onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })} />
                                    Use as default fallback channel
                                </label>
                            </div>

                            <div className="flex justify-end gap-3 pt-2">
                                <button type="button" className="px-4 py-2 text-slate-400 hover:text-white" onClick={closeModal}>Cancel</button>
                                <button type="submit" disabled={saving} className="btn-primary px-4 py-2">{saving ? 'Saving...' : editingChannel ? 'Update Channel' : 'Create Channel'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default NotificationChannels;
