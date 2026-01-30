import React, { useEffect } from 'react';
import { useDeviceStore } from '../store/useDeviceStore';
import { Plus, Search, Filter, MoreVertical, Wifi, WifiOff, AlertCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { useNavigate } from 'react-router-dom';

export const DeviceList = () => {
    const { devices, loading, fetchDevices } = useDeviceStore();
    const navigate = useNavigate();

    useEffect(() => {
        fetchDevices();
    }, []);

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-white">Device Management</h2>
                    <p className="text-slate-400">View and manage all registered monitoring agents</p>
                </div>
                <button className="btn-primary flex items-center gap-2">
                    <Plus size={18} />
                    Register Device
                </button>
            </div>

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
                                    <button className="p-2 text-slate-500 hover:text-white hover:bg-white/5 rounded-lg transition-all">
                                        <MoreVertical size={18} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
