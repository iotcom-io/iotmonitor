import React, { useEffect } from 'react';
import { useDeviceStore } from '../store/useDeviceStore';
import { Plus, Search, Filter, Wifi, WifiOff, AlertCircle, Server, Hammer, Loader2, Trash2, Pause, Play, Pencil } from 'lucide-react';
import { clsx } from 'clsx';
import { useNavigate } from 'react-router-dom';
import api from '../lib/axios';

type DeviceType = 'server' | 'pbx' | 'network_device' | 'website';
const MODULE_DEFAULTS_BY_DEVICE_TYPE: Record<DeviceType, string[]> = {
    server: ['system', 'docker', 'network'],
    pbx: ['system', 'docker', 'asterisk', 'network'],
    network_device: ['network'],
    website: ['system', 'network'],
};
const DEVICE_TYPE_LABELS: Record<DeviceType, string> = {
    server: 'Server',
    pbx: 'PBX',
    network_device: 'Network Device',
    website: 'Website',
};

const normalizeDeviceType = (value?: string): DeviceType => {
    if (value === 'server' || value === 'pbx' || value === 'network_device' || value === 'website') {
        return value;
    }
    return 'server';
};

const formatUptime = (seconds?: number) => {
    const total = Number(seconds || 0);
    if (!Number.isFinite(total) || total <= 0) return '—';

    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
};

export const DeviceList = () => {
    const { devices, loading, fetchDevices } = useDeviceStore();
    const navigate = useNavigate();
    const [showModal, setShowModal] = React.useState(false);
    const [isEditMode, setIsEditMode] = React.useState(false);
    const [editingDeviceId, setEditingDeviceId] = React.useState<string | null>(null);
    const [newName, setNewName] = React.useState('');
    const [newType, setNewType] = React.useState<DeviceType>('server');
    const [newHostname, setNewHostname] = React.useState('');
    const [enabledModules, setEnabledModules] = React.useState<string[]>([...MODULE_DEFAULTS_BY_DEVICE_TYPE.server]);
    const [asteriskContainerName, setAsteriskContainerName] = React.useState('asterisk');
    const [pingHost, setPingHost] = React.useState('');

    const [registering, setRegistering] = React.useState(false);
    const [buildingId, setBuildingId] = React.useState<string | null>(null);

    useEffect(() => {
        fetchDevices();
    }, []);

    const resetForm = () => {
        setIsEditMode(false);
        setEditingDeviceId(null);
        setNewName('');
        setNewType('server');
        setNewHostname('');
        setEnabledModules([...MODULE_DEFAULTS_BY_DEVICE_TYPE.server]);
        setAsteriskContainerName('asterisk');
        setPingHost('');
    };

    const openCreateModal = () => {
        resetForm();
        setShowModal(true);
    };

    const openEditModal = (e: React.MouseEvent, device: any) => {
        e.stopPropagation();
        setIsEditMode(true);
        setEditingDeviceId(device.device_id);
        setNewName(device.name || '');
        setNewType(normalizeDeviceType(device.type));
        setNewHostname(device.hostname || '');
        const nextModules = Array.isArray(device.enabled_modules) && device.enabled_modules.length > 0
            ? device.enabled_modules
            : [...MODULE_DEFAULTS_BY_DEVICE_TYPE[normalizeDeviceType(device.type)]];
        setEnabledModules(nextModules);
        setAsteriskContainerName(device.asterisk_container_name || device.config?.asterisk_container || 'asterisk');
        setPingHost(device.probe_config?.ping_host || device.hostname || '');
        setShowModal(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setRegistering(true);
        try {
            const payload = {
                name: newName,
                type: newType,
                hostname: newHostname,
                enabled_modules: enabledModules,
                asterisk_container_name: enabledModules.includes('asterisk') ? (asteriskContainerName.trim() || 'asterisk') : undefined,
                probe_config: enabledModules.includes('network') ? {
                    ping_host: pingHost.trim() || undefined,
                } : undefined
            };

            if (isEditMode && editingDeviceId) {
                await api.patch(`/devices/${editingDeviceId}`, payload);
            } else {
                await api.post('/devices/register', payload);
            }
            await fetchDevices();
            setShowModal(false);
            resetForm();
        } catch (error) {
            console.error('Save device failed', error);
            alert(isEditMode ? 'Failed to update device' : 'Failed to register device');
        } finally {
            setRegistering(false);
        }
    };

    const toggleModule = (module: string) => {
        setEnabledModules(prev => {
            if (prev.includes(module)) {
                if (prev.length === 1) {
                    return prev;
                }
                return prev.filter(m => m !== module);
            }
            return [...prev, module];
        });
    };

    const handleTypeChange = (nextType: DeviceType) => {
        setNewType(nextType);
        setEnabledModules([...MODULE_DEFAULTS_BY_DEVICE_TYPE[nextType]]);
        if (!MODULE_DEFAULTS_BY_DEVICE_TYPE[nextType].includes('asterisk')) {
            setAsteriskContainerName('asterisk');
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
            // Download using the new filename
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
                    onClick={openCreateModal}
                    className="btn-primary flex items-center gap-2"
                >
                    <Plus size={18} />
                    Register Device
                </button>
            </div>

            {showModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="card max-w-lg w-full animate-in fade-in zoom-in duration-200 max-h-[90vh] overflow-y-auto">
                        <h3 className="text-xl font-bold text-white mb-6">{isEditMode ? 'Edit Device' : 'Register New Device'}</h3>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-300">Device Name</label>
                                <input
                                    required
                                    type="text"
                                    className="input-field"
                                    placeholder="e.g. Production Web 01"
                                    value={newName}
                                    onChange={e => setNewName(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-300">Device Type</label>
                                <select
                                    className="input-field"
                                    value={newType}
                                    onChange={e => handleTypeChange(e.target.value as DeviceType)}
                                >
                                    <option value="server">Linux/Windows Server</option>
                                    <option value="pbx">PBX / VoIP Server</option>
                                    <option value="network_device">Network Device</option>
                                    <option value="website">Website/URL</option>
                                </select>
                            </div>

                            {/* Capabilities / Modules */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-300">Monitoring Modules</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {[
                                        { id: 'system', label: 'System Metrics' },
                                        { id: 'docker', label: 'Docker Containers' },
                                        { id: 'asterisk', label: 'Asterisk PBX' },
                                        { id: 'network', label: 'Network Probe' }
                                    ].map(mod => (
                                        <div
                                            key={mod.id}
                                            onClick={() => toggleModule(mod.id)}
                                            className={`p-3 rounded-lg border cursor-pointer transition-colors ${enabledModules.includes(mod.id)
                                                    ? 'bg-primary-500/20 border-primary-500/50 text-white'
                                                    : 'bg-dark-bg border-dark-border text-slate-400 hover:bg-white/5'
                                                }`}
                                        >
                                            <div className="text-sm font-medium">{mod.label}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Network Probe Config */}
                            {enabledModules.includes('asterisk') && (
                                <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-2">
                                    <h4 className="text-sm font-bold text-primary-400">Asterisk Settings</h4>
                                    <label className="text-xs text-slate-400">Asterisk Docker Container Name</label>
                                    <input
                                        type="text"
                                        className="input-field text-sm"
                                        placeholder="asterisk"
                                        value={asteriskContainerName}
                                        onChange={e => setAsteriskContainerName(e.target.value)}
                                    />
                                    <p className="text-[11px] text-slate-500">This value is embedded into the generated agent binary.</p>
                                </div>
                            )}

                            {/* Network Probe Config */}
                            {enabledModules.includes('network') && (
                                <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-4">
                                    <h4 className="text-sm font-bold text-primary-400 flex items-center gap-2">
                                        <Wifi size={14} /> Network Probe Configuration
                                    </h4>
                                    <div className="space-y-1">
                                        <label className="text-xs text-slate-400">Ping Host</label>
                                        <input
                                            type="text"
                                            className="input-field text-sm py-1.5"
                                            placeholder="e.g. monitoring.iotcom.io or 1.1.1.1"
                                            value={pingHost}
                                            onChange={e => setPingHost(e.target.value)}
                                        />
                                        <p className="text-[11px] text-slate-500">Agent pings only this host for network probe metrics.</p>
                                    </div>
                                </div>
                            )}

                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-300">Hostname (for references)</label>
                                <input
                                    type="text"
                                    className="input-field"
                                    placeholder="e.g. app.example.com"
                                    value={newHostname}
                                    onChange={e => setNewHostname(e.target.value)}
                                />
                            </div>
                            <div className="flex gap-4 pt-4">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowModal(false);
                                        resetForm();
                                    }}
                                    className="flex-1 px-4 py-2 border border-dark-border rounded-xl text-slate-300 hover:bg-white/5 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={registering}
                                    className="flex-1 btn-primary"
                                >
                                    {registering ? (isEditMode ? 'Updating...' : 'Registering...') : (isEditMode ? 'Update Device' : 'Confirm')}
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
                            <th className="px-6 py-4 text-sm font-semibold text-slate-400">Uptime</th>
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
                                            <div className="text-xs text-slate-500">{DEVICE_TYPE_LABELS[(device.type as DeviceType) || 'server'] || 'Server'}</div>
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
                                <td className="px-6 py-4 text-sm text-slate-300 font-mono">
                                    {formatUptime(device.uptime_seconds)}
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <div className="flex justify-end gap-2">
                                        <button
                                            onClick={(e) => openEditModal(e, device)}
                                            title="Edit Device"
                                            className="p-2 rounded-lg transition-all text-slate-400 hover:text-white hover:bg-white/5"
                                        >
                                            <Pencil size={16} />
                                        </button>
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
                        {!loading && devices.length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                                    No devices registered yet.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
