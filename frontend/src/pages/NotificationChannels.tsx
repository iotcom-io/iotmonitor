import React, { useState, useEffect } from 'react';
import api from '../lib/axios';

interface NotificationChannel {
    _id: string;
    name: string;
    description?: string;
    type: 'slack' | 'email' | 'webhook' | 'sms';
    enabled: boolean;
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
    device_filters?: {
        device_ids?: string[];
        device_types?: string[];
        tags?: string[];
    };
    created_at: string;
    updated_at: string;
}

const NotificationChannels: React.FC = () => {
    const [channels, setChannels] = useState<NotificationChannel[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingChannel, setEditingChannel] = useState<NotificationChannel | null>(null);
    const [testingChannel, setTestingChannel] = useState<string | null>(null);

    const [formData, setFormData] = useState({
        name: '',
        description: '',
        type: 'slack' as NotificationChannel['type'],
        enabled: true,
        slack_webhook_url: '',
        slack_channel: '',
        slack_group_name: '',
        alert_types: ['offline', 'online', 'service_down', 'sip_issue', 'high_latency', 'threshold'],
        severity_levels: ['info', 'warning', 'critical']
    });

    useEffect(() => {
        fetchChannels();
    }, []);

    const fetchChannels = async () => {
        try {
            setLoading(true);
            const response = await api.get('/notification-channels');
            setChannels(response.data);
        } catch (error) {
            console.error('Error fetching channels:', error);
        } finally {
            setLoading(false);
        }
    };

    const openCreateModal = () => {
        setEditingChannel(null);
        setFormData({
            name: '',
            description: '',
            type: 'slack',
            enabled: true,
            slack_webhook_url: '',
            slack_channel: '',
            slack_group_name: '',
            alert_types: ['offline', 'online', 'service_down', 'sip_issue', 'high_latency', 'threshold'],
            severity_levels: ['info', 'warning', 'critical']
        });
        setShowModal(true);
    };

    const openEditModal = (channel: NotificationChannel) => {
        setEditingChannel(channel);
        setFormData({
            name: channel.name,
            description: channel.description || '',
            type: channel.type,
            enabled: channel.enabled,
            slack_webhook_url: channel.config.slack_webhook_url || '',
            slack_channel: channel.config.slack_channel || '',
            slack_group_name: channel.config.slack_group_name || '',
            alert_types: channel.alert_types,
            severity_levels: channel.severity_levels
        });
        setShowModal(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const payload = {
            name: formData.name,
            description: formData.description,
            type: formData.type,
            enabled: formData.enabled,
            config: {
                slack_webhook_url: formData.slack_webhook_url,
                slack_channel: formData.slack_channel,
                slack_group_name: formData.slack_group_name
            },
            alert_types: formData.alert_types,
            severity_levels: formData.severity_levels
        };

        try {
            if (editingChannel) {
                await api.patch(`/notification-channels/${editingChannel._id}`, payload);
            } else {
                await api.post('/notification-channels', payload);
            }
            await fetchChannels();
            setShowModal(false);
        } catch (error) {
            console.error('Error saving channel:', error);
            alert('Failed to save notification channel');
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

    const deleteChannel = async (id: string, name: string) => {
        if (!confirm(`Delete channel "${name}"?`)) return;

        try {
            await api.delete(`/notification-channels/${id}`);
            await fetchChannels();
        } catch (error) {
            console.error('Error deleting channel:', error);
            alert('Failed to delete channel');
        }
    };

    const testChannel = async (id: string) => {
        setTestingChannel(id);
        try {
            await api.post(`/notification-channels/${id}/test`);
            alert('✅ Test notification sent! Check your channel.');
        } catch (error) {
            console.error('Error testing channel:', error);
            alert('❌ Failed to send test notification');
        } finally {
            setTestingChannel(null);
        }
    };

    const getChannelIcon = (type: string) => {
        switch (type) {
            case 'slack': return '💬';
            case 'email': return '📧';
            case 'webhook': return '🔗';
            case 'sms': return '📱';
            default: return '🔔';
        }
    };

    return (
        <div className="p-6">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Notification Channels</h1>
                    <p className="text-gray-600 mt-1">Manage notification destinations for alerts and status updates</p>
                </div>
                <button
                    onClick={openCreateModal}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                    + Add Channel
                </button>
            </div>

            {loading ? (
                <div className="text-center py-12">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
            ) : channels.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                    <span className="text-4xl">🔔</span>
                    <h3 className="mt-2 text-lg font-medium text-gray-900">No notification channels</h3>
                    <p className="mt-1 text-gray-500">Get started by creating your first notification channel</p>
                    <button
                        onClick={openCreateModal}
                        className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                        Create Channel
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {channels.map((channel) => (
                        <div key={channel._id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
                            <div className="flex justify-between items-start mb-3">
                                <div className="flex items-center gap-2">
                                    <span className="text-2xl">{getChannelIcon(channel.type)}</span>
                                    <div>
                                        <h3 className="font-semibold text-gray-900">{channel.name}</h3>
                                        <span className="text-xs text-gray-500 uppercase">{channel.type}</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1">
                                    <span className={`px-2 py-1 text-xs rounded-full ${channel.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                                        }`}>
                                        {channel.enabled ? ' Active' : 'Disabled'}
                                    </span>
                                </div>
                            </div>

                            {channel.description && (
                                <p className="text-sm text-gray-600 mb-3">{channel.description}</p>
                            )}

                            {channel.config.slack_group_name && (
                                <div className="mb-3 p-2 bg-purple-50 rounded text-sm">
                                    <span className="text-purple-700 font-medium">Group: {channel.config.slack_group_name}</span>
                                </div>
                            )}

                            <div className="mb-3">
                                <div className="text-xs text-gray-500 mb-1">Alert Types:</div>
                                <div className="flex flex-wrap gap-1">
                                    {channel.alert_types.slice(0, 3).map(type => (
                                        <span key={type} className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">
                                            {type}
                                        </span>
                                    ))}
                                    {channel.alert_types.length > 3 && (
                                        <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">
                                            +{channel.alert_types.length - 3} more
                                        </span>
                                    )}
                                </div>
                            </div>

                            <div className="flex gap-2 pt-3 border-t border-gray-100">
                                <button
                                    onClick={() => testChannel(channel._id)}
                                    disabled={!channel.enabled || testingChannel === channel._id}
                                    className="flex-1 text-xs px-3 py-1.5 bg-green-50 text-green-700 rounded hover:bg-green-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    {testingChannel === channel._id ? 'Sending...' : '🧪 Test'}
                                </button>
                                <button
                                    onClick={() => toggleChannel(channel._id)}
                                    className="flex-1 text-xs px-3 py-1.5 bg-gray-50 text-gray-700 rounded hover:bg-gray-100 transition-colors"
                                >
                                    {channel.enabled ? '⏸ Disable' : '▶️ Enable'}
                                </button>
                                <button
                                    onClick={() => openEditModal(channel)}
                                    className="flex-1 text-xs px-3 py-1.5 bg-blue-50 text-blue-700 rounded hover:bg-blue-100 transition-colors"
                                >
                                    ✏️ Edit
                                </button>
                                <button
                                    onClick={() => deleteChannel(channel._id, channel.name)}
                                    className="text-xs px-3 py-1.5 bg-red-50 text-red-700 rounded hover:bg-red-100 transition-colors"
                                >
                                    🗑️
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="p-6 border-b border-gray-200">
                            <h2 className="text-xl font-bold">
                                {editingChannel ? 'Edit Notification Channel' : 'Create Notification Channel'}
                            </h2>
                        </div>

                        <form onSubmit={handleSubmit} className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Channel Name *
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                        placeholder="e.g., Production Alerts"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Type *
                                    </label>
                                    <select
                                        value={formData.type}
                                        onChange={(e) => setFormData({ ...formData, type: e.target.value as NotificationChannel['type'] })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    >
                                        <option value="slack">💬 Slack</option>
                                        <option value="email">📧 Email</option>
                                        <option value="webhook">🔗 Webhook</option>
                                        <option value="sms">📱 SMS</option>
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Description
                                </label>
                                <input
                                    type="text"
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    placeholder="Optional description"
                                />
                            </div>

                            {formData.type === 'slack' && (
                                <>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            Slack Webhook URL *
                                        </label>
                                        <input
                                            type="url"
                                            required
                                            value={formData.slack_webhook_url}
                                            onChange={(e) => setFormData({ ...formData, slack_webhook_url: e.target.value })}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                                            placeholder="https://hooks.slack.com/services/..."
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                                Slack Channel
                                            </label>
                                            <input
                                                type="text"
                                                value={formData.slack_channel}
                                                onChange={(e) => setFormData({ ...formData, slack_channel: e.target.value })}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                                placeholder="#alerts"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                                Group Name
                                            </label>
                                            <input
                                                type="text"
                                                value={formData.slack_group_name}
                                                onChange={(e) => setFormData({ ...formData, slack_group_name: e.target.value })}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                                placeholder="e.g., Network Team"
                                            />
                                        </div>
                                    </div>
                                </>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Alert Types to Receive
                                </label>
                                <div className="grid grid-cols-2 gap-2">
                                    {['offline', 'online', 'service_down', 'sip_issue', 'high_latency', 'threshold'].map(type => (
                                        <label key={type} className="flex items-center gap-2 p-2 border border-gray-200 rounded cursor-pointer hover:bg-gray-50">
                                            <input
                                                type="checkbox"
                                                checked={formData.alert_types.includes(type)}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setFormData({ ...formData, alert_types: [...formData.alert_types, type] });
                                                    } else {
                                                        setFormData({ ...formData, alert_types: formData.alert_types.filter(t => t !== type) });
                                                    }
                                                }}
                                                className="rounded text-blue-600 focus:ring-blue-500"
                                            />
                                            <span className="text-sm capitalize">{type.replace('_', ' ')}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Severity Levels
                                </label>
                                <div className="flex gap-2">
                                    {['info', 'warning', 'critical'].map(level => (
                                        <label key={level} className="flex items-center gap-2 p-2 border border-gray-200 rounded cursor-pointer hover:bg-gray-50">
                                            <input
                                                type="checkbox"
                                                checked={formData.severity_levels.includes(level)}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setFormData({ ...formData, severity_levels: [...formData.severity_levels, level] });
                                                    } else {
                                                        setFormData({ ...formData, severity_levels: formData.severity_levels.filter(l => l !== level) });
                                                    }
                                                }}
                                                className="rounded text-blue-600 focus:ring-blue-500"
                                            />
                                            <span className="text-sm capitalize">{level}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="enabled"
                                    checked={formData.enabled}
                                    onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                                    className="rounded text-blue-600 focus:ring-blue-500"
                                />
                                <label htmlFor="enabled" className="text-sm font-medium text-gray-700">
                                    Enable this channel
                                </label>
                            </div>

                            <div className="flex gap-3 pt-4 border-t border-gray-200">
                                <button
                                    type="button"
                                    onClick={() => setShowModal(false)}
                                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                                >
                                    {editingChannel ? 'Update Channel' : 'Create Channel'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default NotificationChannels;
