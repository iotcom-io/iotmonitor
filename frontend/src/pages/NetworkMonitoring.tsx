import React, { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, Trash2, Activity, Router, ServerOff, CheckCircle, Wifi, X, Zap } from 'lucide-react';
import api from '../lib/axios';
import { useAuthStore } from '../store/useAuthStore';
import { hasPermission } from '../lib/permissions';
import { clsx } from 'clsx';

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
        v3_username: '',
        v3_auth_protocol: 'SHA',
        v3_auth_key: '',
        v3_priv_protocol: 'AES',
        v3_priv_key: '',
        device_type: 'switch',
        vendor: '',
        model: '',
        location: '',
        poll_interval_seconds: 300,
    });
    const [testingId, setTestingId] = useState<string | null>(null);
    const [testResult, setTestResult] = useState<{ id: string; success: boolean; message: string } | null>(null);

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
                version: 'v2c', v3_username: '', v3_auth_protocol: 'SHA', v3_auth_key: '', v3_priv_protocol: 'AES', v3_priv_key: '',
                device_type: 'switch', vendor: '',
                model: '', location: '', poll_interval_seconds: 300,
            });
            fetchDevices();
        } catch (e: any) {
            alert(e.response?.data?.message || 'Failed to add device');
        }
    };

    const handleTestConnection = async (deviceOrForm: any) => {
        const isForm = !deviceOrForm._id;
        const id = isForm ? 'form' : deviceOrForm._id;
        setTestingId(id);
        setTestResult(null);
        try {
            const payload = isForm
                ? { host: form.host, port: form.port, community: form.community, version: form.version,
                    v3_username: form.v3_username, v3_auth_protocol: form.v3_auth_protocol, v3_auth_key: form.v3_auth_key,
                    v3_priv_protocol: form.v3_priv_protocol, v3_priv_key: form.v3_priv_key }
                : { host: deviceOrForm.host, port: deviceOrForm.port, community: deviceOrForm.community, version: deviceOrForm.version,
                    v3_username: deviceOrForm.v3_username, v3_auth_protocol: deviceOrForm.v3_auth_protocol, v3_auth_key: deviceOrForm.v3_auth_key,
                    v3_priv_protocol: deviceOrForm.v3_priv_protocol, v3_priv_key: deviceOrForm.v3_priv_key };
            const res = await api.post('/snmp/test', payload);
            setTestResult({ id, success: res.data?.success ?? false, message: res.data?.message || 'No response' });
        } catch (e: any) {
            setTestResult({ id, success: false, message: e.response?.data?.message || 'Connection failed' });
        } finally {
            setTestingId(null);
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
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="bg-[#0a0e1a] border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
                        <div className="flex items-center justify-between p-6 border-b border-white/10">
                            <h3 className="text-lg font-bold text-white">Add SNMP Device</h3>
                            <button onClick={() => setShowAdd(false)} className="p-2 rounded-lg hover:bg-white/10 text-slate-400 transition-colors">
                                <X size={18} />
                            </button>
                        </div>
                        <form onSubmit={handleAdd} className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Name *</label>
                                <input className="input-field" placeholder="e.g. Core Switch 01" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Host/IP *</label>
                                <input className="input-field" placeholder="192.168.1.1" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} required />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Port</label>
                                <input className="input-field" type="number" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Community</label>
                                <input className="input-field" placeholder="public" value={form.community} onChange={(e) => setForm({ ...form, community: e.target.value })} />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Version</label>
                                <select className="input-field" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })}>
                                    <option value="v1">SNMP v1</option>
                                    <option value="v2c">SNMP v2c</option>
                                    <option value="v3">SNMP v3</option>
                                </select>
                            </div>
                            {form.version === 'v3' && (
                                <>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">v3 Username</label>
                                        <input className="input-field" placeholder="snmpuser" value={form.v3_username} onChange={(e) => setForm({ ...form, v3_username: e.target.value })} />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Auth Protocol</label>
                                        <select className="input-field" value={form.v3_auth_protocol} onChange={(e) => setForm({ ...form, v3_auth_protocol: e.target.value })}>
                                            <option value="MD5">MD5</option>
                                            <option value="SHA">SHA</option>
                                            <option value="SHA256">SHA256</option>
                                        </select>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Auth Key</label>
                                        <input className="input-field" type="password" placeholder="Authentication passphrase" value={form.v3_auth_key} onChange={(e) => setForm({ ...form, v3_auth_key: e.target.value })} />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Privacy Protocol</label>
                                        <select className="input-field" value={form.v3_priv_protocol} onChange={(e) => setForm({ ...form, v3_priv_protocol: e.target.value })}>
                                            <option value="DES">DES</option>
                                            <option value="AES">AES</option>
                                            <option value="AES256">AES256</option>
                                        </select>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Privacy Key</label>
                                        <input className="input-field" type="password" placeholder="Encryption passphrase" value={form.v3_priv_key} onChange={(e) => setForm({ ...form, v3_priv_key: e.target.value })} />
                                    </div>
                                </>
                            )}
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Device Type</label>
                                <select className="input-field" value={form.device_type} onChange={(e) => setForm({ ...form, device_type: e.target.value })}>
                                    <option value="switch">Switch</option>
                                    <option value="router">Router</option>
                                    <option value="firewall">Firewall</option>
                                    <option value="ap">Access Point</option>
                                    <option value="printer">Printer</option>
                                    <option value="ups">UPS</option>
                                    <option value="storage">Storage</option>
                                    <option value="other">Other</option>
                                </select>
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Vendor</label>
                                <input className="input-field" placeholder="Cisco, Juniper..." value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Model</label>
                                <input className="input-field" placeholder="Model number" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
                            </div>
                            <div className="md:col-span-2 space-y-1">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Location</label>
                                <input className="input-field" placeholder="Datacenter A, Rack 3..." value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
                            </div>
                            {testResult && testResult.id === 'form' && (
                                <div className={clsx("md:col-span-2 p-3 rounded-lg border text-sm", testResult.success ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-red-500/10 border-red-500/20 text-red-400")}>
                                    {testResult.message}
                                </div>
                            )}
                            <div className="md:col-span-2 flex gap-2 pt-2">
                                <button type="button" onClick={() => handleTestConnection(form)} disabled={!form.host || testingId === 'form'} className="btn-secondary flex items-center gap-2">
                                    <Zap size={16} className={testingId === 'form' ? 'animate-pulse' : ''} />
                                    {testingId === 'form' ? 'Testing...' : 'Test Connection'}
                                </button>
                                <button type="submit" className="btn-primary">Save Device</button>
                                <button type="button" onClick={() => setShowAdd(false)} className="btn-secondary">Cancel</button>
                            </div>
                        </form>
                    </div>
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
                                            onClick={() => handleTestConnection(device)}
                                            disabled={testingId === device._id}
                                            className="p-2 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
                                            title="Test Connection"
                                        >
                                            <Zap size={16} className={testingId === device._id ? 'animate-pulse' : ''} />
                                        </button>
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

                                {testResult && testResult.id === device._id && (
                                    <div className={clsx("mt-3 p-2 rounded-lg border text-xs", testResult.success ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-red-500/10 border-red-500/20 text-red-400")}>
                                        {testResult.message}
                                    </div>
                                )}

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
