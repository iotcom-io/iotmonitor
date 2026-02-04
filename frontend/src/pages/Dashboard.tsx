import React, { useEffect, useState } from 'react';
import { Activity, Server, AlertTriangle, Cpu, HardDrive } from 'lucide-react';

const StatCard = ({ icon: Icon, label, value, color, subvalue }: { icon: any, label: string, value: string, color: string, subvalue?: string }) => (
    <div className="card">
        <div className="flex justify-between items-start mb-4">
            <div className={`p-2 rounded-lg bg-${color}-500/10 text-${color}-400`}>
                <Icon size={24} />
            </div>
            {subvalue && <span className="text-xs text-slate-500 font-medium">{subvalue}</span>}
        </div>
        <h3 className="text-slate-400 text-sm font-medium mb-1">{label}</h3>
        <p className="text-2xl font-bold text-white">{value}</p>
    </div>
);

import { useDeviceStore } from '../store/useDeviceStore';

export const Dashboard = () => {
    const { devices, fetchDevices, initSocket } = useDeviceStore();

    useEffect(() => {
        fetchDevices();
        initSocket();
    }, []);

    const onlineCount = devices.filter(d => d.status === 'online').length;

    // Calculate Averages
    const totalCpu = devices.reduce((acc, d) => acc + (d.config?.cpu_usage || 0), 0);
    const avgCpu = devices.length ? (totalCpu / devices.length).toFixed(1) : '0';

    const totalDisk = devices.reduce((acc, d) => acc + (d.config?.disk_usage || 0), 0);
    const avgDisk = devices.length ? (totalDisk / devices.length).toFixed(1) : '0';

    return (
        <div className="space-y-8">
            <div className="flex justify-between items-end">
                <div>
                    <h2 className="text-3xl font-bold text-white mb-2">Systems Overview</h2>
                    <p className="text-slate-400">Real-time health status for all registered devices</p>
                </div>
                <div className="flex gap-3">
                    <button className="btn-primary flex items-center gap-2">
                        <Activity size={18} />
                        Analyze Metrics
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard
                    icon={Server}
                    label="Total Devices"
                    value={devices.length.toString()}
                    color="primary"
                    subvalue={`${onlineCount} Online`}
                />
                <StatCard
                    icon={AlertTriangle}
                    label="Active Alerts"
                    value="3"
                    color="red"
                    subvalue="1 Critical"
                />
                <StatCard
                    icon={Cpu}
                    label="Avg CPU Usage"
                    value={`${avgCpu}%`}
                    color="emerald"
                />
                <StatCard
                    icon={HardDrive}
                    label="Avg Disk Usage"
                    value={`${avgDisk}%`}
                    color="amber"
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 card h-96">
                    <h3 className="text-lg font-bold text-white mb-6">Device Status Distribution</h3>
                    <div className="flex items-center justify-center h-full text-slate-500 italic">
                        Telemetry Chart Placeholder
                    </div>
                </div>
                <div className="card h-96 overflow-hidden flex flex-col">
                    <h3 className="text-lg font-bold text-white mb-6 px-2">Recent Alerts</h3>
                    <div className="flex-1 space-y-4 overflow-y-auto pr-2">
                        {[1, 2, 3, 4, 5].map(i => (
                            <div key={i} className="flex gap-4 p-3 rounded-lg bg-white/5 border border-white/5">
                                <div className="w-1 h-10 rounded-full bg-red-500" />
                                <div>
                                    <h4 className="text-sm font-bold text-white">Critical: High CPU Usage</h4>
                                    <p className="text-xs text-slate-400">Server-NYC-01 • 2 mins ago</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};
