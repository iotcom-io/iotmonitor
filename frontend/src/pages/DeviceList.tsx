import React, { useEffect } from 'react';
import { useDeviceStore } from '../store/useDeviceStore';
import { Plus, Search, Filter, Wifi, WifiOff, AlertCircle, Server, Hammer, Loader2, Trash2, Pause, Play } from 'lucide-react';
import { clsx } from 'clsx';
import { useNavigate } from 'react-router-dom';
import api from '../lib/axios';

export const DeviceList = () => {
    const { devices, loading, fetchDevices } = useDeviceStore();
    const navigate = useNavigate();
    const [showModal, setShowModal] = React.useState(false);
    const [newName, setNewName] = React.useState('');
    const [newType, setNewType] = React.useState<'server' | 'network_device' | 'website'>('server');
    const [newHostname, setNewHostname] = React.useState('');
    const [registering, setRegistering] = React.useState(false);
    const [buildingId, setBuildingId] = React.useState<string | null>(null);

    useEffect(() => {
        fetchDevices();
    }, []);

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setRegistering(true);
        try {
            await api.post('/devices/register', {
                name: newName,
                type: newType,
                hostname: newHostname
            });
            await fetchDevices();
            setShowModal(false);
            setNewName('');
            setNewHostname('');
        } catch (error) {
            console.error('Registration failed', error);
            alert('Failed to register device');
        } finally {
            setRegistering(false);
        }
    };

    const handleBuild = async (e: React.MouseEvent, deviceId: string) => {
        e.stopPropagation();
        setBuildingId(deviceId);
        try {
            const { data } = await api.post(`/devices/${deviceId}/generate-agent`, {
                os: 'linux',
                arch: 'amd64'
            });
            // Auto-trigger download
            const url = `/api/devices/download/${data.binary_id}`;
            window.open(url, '_blank');
        } catch (error) {
            console.error('Build failed', error);
            alert('Failed to build agent for this device');
        } finally {
            setBuildingId(null);
        }
    };

    const handleDelete = async (e: React.MouseEvent, deviceId: string) => {
        e.stopPropagation();
        if (window.confirm('Are you sure you want to delete this device? This action cannot be undone.')) {
            const { deleteDevice } = useDeviceStore.getState();
            await deleteDevice(deviceId);
        }
    };

    const handleToggle = async (e: React.MouseEvent, deviceId: string) => {
        e.stopPropagation();
        const { toggleMonitoring } = useDeviceStore.getState();
        await toggleMonitoring(deviceId);
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-white">Device Management</h2>
                    <p className="text-slate-400">View and manage all registered monitoring agents</p>
                </div>
                <button
                    onClick={() => setShowModal(true)}
                    className="btn-primary flex items-center gap-2"
                >
                    <Plus size={18} />
                    Register Device
                </button>
            </div>

            {showModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="card max-w-md w-full animate-in fade-in zoom-in duration-200">
                        <h3 className="text-xl font-bold text-white mb-6">Register New Device</h3>
                        <form onSubmit={handleRegister} className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-300">Device Name</label>
                                <input
                                    required
                                    type="text"
                                    className="w-full bg-dark-bg border border-dark-border rounded-xl px-4 py-2 text-white outline-none focus:border-primary-500/50"
                                    placeholder="e.g. Production Web 01"
                                    value={newName}
                                    onChange={e => setNewName(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-300">Device Type</label>
                                <select
                                    className="w-full bg-dark-bg border border-dark-border rounded-xl px-4 py-2 text-white outline-none focus:border-primary-500/50"
                                    value={newType}
                                    onChange={e => setNewType(e.target.value as any)}
                                >
                                    <option value="server">Linux/Windows Server</option>
                                    <option value="network_device">Network Device</option>
                                    <option value="website">Website/URL</option>
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-300">Target Host/IP</label>
                                <input
                                    type="text"
                                    className="w-full bg-dark-bg border border-dark-border rounded-xl px-4 py-2 text-white outline-none focus:border-primary-500/50"
                                    placeholder="e.g. 192.168.1.10 or app.example.com"
                                    value={newHostname}
                                    onChange={e => setNewHostname(e.target.value)}
                                />
                            </div>
                            <div className="flex gap-4 pt-4">
                                <button
                                    type="button"
                                    onClick={() => setShowModal(false)}
                                    className="flex-1 px-4 py-2 border border-dark-border rounded-xl text-slate-300 hover:bg-white/5 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={registering}
                                    className="flex-1 btn-primary"
                                >
                                    {registering ? 'Registering...' : 'Confirm'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <div className="flex gap-4 mb-6">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                    <input
                        type="text"
                        className="w-full bg-dark-surface border border-dark-border rounded-xl py-2 pl-10 pr-4 text-white focus:border-primary-500/50 outline-none"
                        placeholder="Search devices..."
                    />
                </div>
                <button className="px-4 py-2 bg-dark-surface border border-dark-border rounded-xl text-slate-300 flex items-center gap-2 hover:bg-white/5 transition-colors">
                    <Filter size={18} />
                    Filter
                </button>
            </div>

            <div className="card overflow-hidden p-0">
                <table className="w-full text-left">
                    <thead>
                        <tr className="border-b border-dark-border bg-white/[0.02]">
                            <th className="px-6 py-4 text-sm font-semibold text-slate-400">Device Name</th>
                            <th className="px-6 py-4 text-sm font-semibold text-slate-400">ID</th>
                            <th className="px-6 py-4 text-sm font-semibold text-slate-400">Status</th>
                            <th className="px-6 py-4 text-sm font-semibold text-slate-400">Last Seen</th>
                            <th className="px-6 py-4 text-sm font-semibold text-slate-400 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-dark-border">
                        {devices.map((device) => (
                            <tr
                                key={device.device_id}
                                className="hover:bg-white/[0.02] transition-colors cursor-pointer group"
                                onClick={() => navigate(`/devices/${device.device_id}`)}
                            >
                                <td className="px-6 py-4">
                                    <div className="flex items-center gap-3">
                                        <div className={clsx(
                                            "w-10 h-10 rounded-lg flex items-center justify-center",
                                            device.status === 'online' ? "bg-emerald-500/10 text-emerald-400" :
                                                device.status === 'warning' ? "bg-amber-500/10 text-amber-400" : "bg-slate-500/10 text-slate-400"
                                        )}>
                                            <Server size={20} />
                                        </div>
                                        <div>
                                            <div className="text-sm font-bold text-white mb-0.5">{device.name}</div>
                                            <div className="text-xs text-slate-500">Enterprise Server</div>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-sm text-slate-400 font-mono">
                                    {device.device_id}
                                </td>
                                <td className="px-6 py-4">
                                    <div className={clsx(
                                        "inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-semibold",
                                        device.status === 'online' ? "bg-emerald-500/10 text-emerald-400" :
                                            device.status === 'warning' ? "bg-amber-500/10 text-amber-400" : "bg-red-500/10 text-red-400"
                                    )}>
                                        {device.status === 'online' ? <Wifi size={14} /> :
                                            device.status === 'warning' ? <AlertCircle size={14} /> : <WifiOff size={14} />}
                                        <span className="capitalize">{device.status}</span>
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-sm text-slate-400">
                                    {new Date(device.last_seen).toLocaleString()}
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <div className="flex justify-end gap-2">
                                        <button
                                            onClick={(e) => handleToggle(e, device.device_id)}
                                            title={device.monitoring_enabled === false ? "Resume Monitoring" : "Pause Monitoring"}
                                            className={clsx(
                                                "p-2 rounded-lg transition-all",
                                                device.monitoring_enabled === false ? "text-amber-400 hover:bg-amber-500/10" : "text-slate-400 hover:bg-white/5"
                                            )}
                                        >
                                            {device.monitoring_enabled === false ? <Play size={18} /> : <Pause size={18} />}
                                        </button>
                                        <button
                                            onClick={(e) => handleBuild(e, device.device_id)}
                                            disabled={!!buildingId}
                                            title="Build Agent Binary"
                                            className={clsx(
                                                "p-2 rounded-lg transition-all",
                                                buildingId === device.device_id ? "bg-primary-500/20 text-primary-400" : "text-primary-400 hover:text-white hover:bg-primary-500/10"
                                            )}
                                        >
                                            {buildingId === device.device_id ? <Loader2 size={18} className="animate-spin" /> : <Hammer size={18} />}
                                        </button>
                                        <button
                                            onClick={(e) => handleDelete(e, device.device_id)}
                                            title="Delete Device"
                                            className="p-2 rounded-lg text-red-400 hover:text-red-500 hover:bg-red-500/10 transition-all ml-2"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
