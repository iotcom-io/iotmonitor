import React, { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, Trash2, Activity, Router, ServerOff, CheckCircle, Wifi } from 'lucide-react';
import api from '../lib/axios';
import { useAuthStore } from '../store/useAuthStore';
import { hasPermission } from '../lib/permissions';

const TYPE_ICONS: Record<string, any> = {
    switch: Wifi,
    router: Router,
    firewall: Activity,
    ap: Wifi,
    printer: Activity,
    ups: Activity,
    storage: Activity,
    other: Activity,
};

const TYPE_LABELS: Record<string, string> = {
    switch: 'Switch',
    router: 'Router',
    firewall: 'Firewall',
    ap: 'Access Point',
    printer: 'Printer',
    ups: 'UPS',
    storage: 'Storage',
    other: 'Other',
};

export const NetworkMonitoring = () => {
    const user = useAuthStore((s) => s.user);
    const [devices, setDevices] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAdd, setShowAdd] = useState(false);
    const [pollingId, setPollingId] = useState<string | null>(null);
    const [form, setForm] = useState({
        name: '',
        host: '',
        port: 161,
        community: 'public',
        version: 'v2c',
        device_type: 'switch',
        vendor: '',
        model: '',
        location: '',
        poll_interval_seconds: 300,
    });

    const fetchDevices = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/snmp/devices');
            setDevices(res.data || []);
        } catch (e) {
            console.error('Failed to fetch SNMP devices', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchDevices();
    }, [fetchDevices]);

    const handlePoll = async (id: string) => {
        setPollingId(id);
        try {
            await api.post(`/snmp/devices/${id}/poll`);
            fetchDevices();
        } catch (e) {
            console.error('Poll failed', e);
        } finally {
            setPollingId(null);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this SNMP device?')) return;
        try {
            await api.delete(`/snmp/devices/${id}`);
            fetchDevices();
        } catch (e) {
            console.error('Delete failed', e);
        }
    };

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await api.post('/snmp/devices', form);
            setShowAdd(false);
            setForm({
                name: '', host: '', port: 161, community: 'public',
                version: 'v2c', device_type: 'switch', vendor: '',
                model: '', location: '', poll_interval_seconds: 300,
            });
            fetchDevices();
        } catch (e: any) {
            alert(e.response?.data?.message || 'Failed to add device');
        }
    };

    const canManage = user?.role === 'admin' || hasPermission('devices.manage', user);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">Network Monitoring</h1>
                    <p className="text-sm text-slate-400 mt-1">SNMP-based monitoring for switches, routers, firewalls and other network gear</p>
                </div>
                {canManage && (
                    <button
                        onClick={() => setShowAdd(!showAdd)}
                        className="btn-primary flex items-center gap-2"
                    >
                        <Plus size={18} />
                        Add Device
                    </button>
                )}
            </div>

            {showAdd && (
                <div className="card">
                    <h3 className="text-lg font-semibold text-white mb-4">Add SNMP Device</h3>
                    <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <input className="input" placeholder="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                        <input className="input" placeholder="Host/IP *" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} required />
                        <input className="input" type="number" placeholder="Port" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} />
                        <input className="input" placeholder="Community" value={form.community} onChange={(e) => setForm({ ...form, community: e.target.value })} />
                        <select className="input" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })}>
                            <option value="v1">SNMP v1</option>
                            <option value="v2c">SNMP v2c</option>
                            <option value="v3">SNMP v3</option>
                        </select>
                        <select className="input" value={form.device_type} onChange={(e) => setForm({ ...form, device_type: e.target.value })}>
                            <option value="switch">Switch</option>
                            <option value="router">Router</option>
                            <option value="firewall">Firewall</option>
                            <option value="ap">Access Point</option>
                            <option value="printer">Printer</option>
                            <option value="ups">UPS</option>
                            <option value="storage">Storage</option>
                            <option value="other">Other</option>
                        </select>
                        <input className="input" placeholder="Vendor" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
                        <input className="input" placeholder="Model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
                        <input className="input" placeholder="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
                        <div className="md:col-span-3 flex gap-2">
                            <button type="submit" className="btn-primary">Save</button>
                            <button type="button" onClick={() => setShowAdd(false)} className="btn-secondary">Cancel</button>
                        </div>
                    </form>
                </div>
            )}

            {loading ? (
                <div className="text-slate-400">Loading...</div>
            ) : devices.length === 0 ? (
                <div className="card text-center py-12">
                    <Router size={48} className="text-slate-600 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-white">No SNMP devices configured</h3>
                    <p className="text-slate-400 mt-2">Add switches, routers, firewalls and other network devices to monitor them via SNMP</p>
                </div>
            ) : (
                <div className="grid gap-4">
                    {devices.map((device) => {
                        const Icon = TYPE_ICONS[device.device_type] || Activity;
                        const statusColor = device.status === 'online' ? 'text-emerald-400' : device.status === 'offline' ? 'text-red-400' : 'text-slate-400';
                        const StatusIcon = device.status === 'online' ? CheckCircle : ServerOff;
                        const metrics = device.last_metrics || {};
                        const ifaceSummary = metrics.interface_summary || {};

                        return (
                            <div key={device._id} className="card hover:border-primary-500/20 transition-colors">
                                <div className="flex items-start justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="p-3 rounded-xl bg-primary-500/10">
                                            <Icon size={24} className="text-primary-400" />
                                        </div>
                                        <div>
                                            <h3 className="font-semibold text-white">{device.name}</h3>
                                            <p className="text-sm text-slate-400">{device.host}:{device.port} · {TYPE_LABELS[device.device_type] || device.device_type}</p>
                                            {device.vendor && <p className="text-xs text-slate-500 mt-0.5">{device.vendor} {device.model}</p>}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className={`flex items-center gap-1.5 text-sm ${statusColor}`}>
                                            <StatusIcon size={16} />
                                            <span className="capitalize">{device.status}</span>
                                        </div>
                                        <button
                                            onClick={() => handlePoll(device._id)}
                                            disabled={pollingId === device._id}
                                            className="p-2 rounded-lg text-slate-400 hover:text-primary-400 hover:bg-primary-500/10 transition-colors"
                                            title="Poll now"
                                        >
                                            <RefreshCw size={16} className={pollingId === device._id ? 'animate-spin' : ''} />
                                        </button>
                                        {canManage && (
                                            <button
                                                onClick={() => handleDelete(device._id)}
                                                className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                                title="Delete"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {device.status === 'online' && metrics.sysName && (
                                    <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
                                        <div className="bg-white/5 rounded-lg p-3">
                                            <span className="text-slate-500 block text-xs">System Name</span>
                                            <span className="text-white font-medium truncate">{metrics.sysName}</span>
                                        </div>
                                        {ifaceSummary.total > 0 && (
                                            <div className="bg-white/5 rounded-lg p-3">
                                                <span className="text-slate-500 block text-xs">Interfaces</span>
                                                <span className="text-white font-medium">{ifaceSummary.up} up / {ifaceSummary.down} down</span>
                                            </div>
                                        )}
                                        {metrics.sysUpTime && (
                                            <div className="bg-white/5 rounded-lg p-3">
                                                <span className="text-slate-500 block text-xs">Uptime</span>
                                                <span className="text-white font-medium">{Math.floor(Number(metrics.sysUpTime) / 8640000)}d</span>
                                            </div>
                                        )}
                                        <div className="bg-white/5 rounded-lg p-3">
                                            <span className="text-slate-500 block text-xs">Last Seen</span>
                                            <span className="text-white font-medium">{device.last_seen ? new Date(device.last_seen).toLocaleString() : 'Never'}</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
