import React, { useEffect, useState } from 'react';
import { Activity, Server, AlertTriangle, Cpu, HardDrive } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useDeviceStore } from '../store/useDeviceStore';

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

export const Dashboard = () => {
    const { devices, fetchDevices, initSocket } = useDeviceStore();
    const [cpuHistory, setCpuHistory] = useState<{ time: string; value: number }[]>([]);

    useEffect(() => {
        fetchDevices();
        initSocket();
    }, []);

    // Create a live history of CPU usage
    useEffect(() => {
        const interval = setInterval(() => {
            const totalCpu = useDeviceStore.getState().devices.reduce((acc, d) => acc + (d.config?.cpu_usage || 0), 0);
            const count = useDeviceStore.getState().devices.length;
            const avg = count ? Number((totalCpu / count).toFixed(1)) : 0;

            setCpuHistory(prev => {
                const now = new Date();
                const timeStr = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
                const newHistory = [...prev, { time: timeStr, value: avg }];
                if (newHistory.length > 20) return newHistory.slice(newHistory.length - 20);
                return newHistory;
            });
        }, 3000); // Update chart every 3 seconds

        return () => clearInterval(interval);
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
                <div className="lg:col-span-2 card h-96 flex flex-col">
                    <h3 className="text-lg font-bold text-white mb-6">Real-Time CPU Usage (Avg)</h3>
                    <div className="flex-1 w-full min-h-0">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={cpuHistory}>
                                <defs>
                                    <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} vertical={false} />
                                <XAxis
                                    dataKey="time"
                                    stroke="#94a3b8"
                                    fontSize={12}
                                    tickLine={false}
                                    axisLine={false}
                                />
                                <YAxis
                                    stroke="#94a3b8"
                                    fontSize={12}
                                    tickLine={false}
                                    axisLine={false}
                                    domain={[0, 100]}
                                />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '8px' }}
                                    itemStyle={{ color: '#fff' }}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="value"
                                    stroke="#10b981"
                                    strokeWidth={2}
                                    fillOpacity={1}
                                    fill="url(#colorCpu)"
                                />
                            </AreaChart>
                        </ResponsiveContainer>
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
