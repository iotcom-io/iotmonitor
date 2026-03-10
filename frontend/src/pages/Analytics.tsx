import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BrainCircuit, Gauge, RefreshCw, ShieldAlert, TrendingUp } from 'lucide-react';
import api from '../lib/axios';

const RiskBadge = ({ band }: { band: string }) => {
    const key = String(band || 'ok').toLowerCase();
    const cls = key === 'critical'
        ? 'bg-red-500/10 text-red-400 border-red-500/20'
        : key === 'warning'
            ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
            : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    return <span className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${cls}`}>{key}</span>;
};

const Stat = ({ label, value, icon: Icon }: { label: string; value: string; icon: any }) => (
    <div className="card">
        <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-500 uppercase tracking-widest font-bold">{label}</span>
            <Icon size={16} className="text-primary-400" />
        </div>
        <p className="text-2xl font-black text-white">{value}</p>
    </div>
);

export const Analytics = () => {
    const [windowDays, setWindowDays] = useState(7);
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<any>(null);

    const fetchOverview = useCallback(async () => {
        setLoading(true);
        try {
            const response = await api.get('/analytics/overview', { params: { window_days: windowDays } });
            setData(response.data || null);
        } catch (error) {
            console.error('Failed to fetch analytics overview', error);
            setData(null);
        } finally {
            setLoading(false);
        }
    }, [windowDays]);

    useEffect(() => {
        fetchOverview();
    }, [fetchOverview]);

    const kpis = data?.fleet_kpis || {};
    const offenders = useMemo(() => Array.isArray(data?.top_offenders) ? data.top_offenders : [], [data]);
    const forecasts = useMemo(() => Array.isArray(data?.forecasts) ? data.forecasts : [], [data]);
    const hotspots = useMemo(() => Array.isArray(data?.alert_hotspots) ? data.alert_hotspots : [], [data]);
    const recommendations = useMemo(() => Array.isArray(data?.recommendations) ? data.recommendations : [], [data]);

    return (
        <div className="space-y-8">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold text-white mb-2">AI Analytics</h2>
                    <p className="text-slate-400">Reliability KPI, offender ranking, anomaly signals, and 1-hour breach forecast.</p>
                </div>
                <div className="flex items-center gap-3">
                    <select
                        value={windowDays}
                        onChange={(e) => setWindowDays(Number(e.target.value))}
                        className="input-field w-36"
                    >
                        <option value={3}>Last 3 days</option>
                        <option value={7}>Last 7 days</option>
                        <option value={14}>Last 14 days</option>
                        <option value={30}>Last 30 days</option>
                    </select>
                    <button onClick={fetchOverview} className="btn-primary flex items-center gap-2">
                        <RefreshCw size={16} />
                        Refresh
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <Stat label="Fleet Availability" value={`${Number(kpis.availability_pct_estimate || 0).toFixed(2)}%`} icon={Gauge} />
                <Stat label="Incidents (Open)" value={`${kpis.incidents_open || 0}`} icon={AlertTriangle} />
                <Stat label="MTTR" value={`${Number(kpis.mttr_minutes || 0).toFixed(1)} min`} icon={TrendingUp} />
                <Stat label="Alert Noise Ratio" value={`${Number(kpis.notification_noise_ratio || 0).toFixed(2)}`} icon={BrainCircuit} />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                <div className="xl:col-span-2 card">
                    <h3 className="text-lg font-bold text-white mb-4">Top Offenders</h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="text-slate-500">
                                <tr className="border-b border-white/10">
                                    <th className="text-left py-2">Device</th>
                                    <th className="text-right py-2">Risk</th>
                                    <th className="text-right py-2">Incidents</th>
                                    <th className="text-right py-2">Downtime (m)</th>
                                    <th className="text-left py-2">Forecast Breach</th>
                                </tr>
                            </thead>
                            <tbody>
                                {offenders.map((row: any) => (
                                    <tr key={row.device_id} className="border-b border-white/5">
                                        <td className="py-2 text-white font-semibold">{row.name}</td>
                                        <td className="py-2 text-right"><RiskBadge band={row.risk_band} /> <span className="ml-2 text-slate-300">{Number(row.risk_score || 0).toFixed(1)}</span></td>
                                        <td className="py-2 text-right text-slate-300">{row.incident_count || 0}</td>
                                        <td className="py-2 text-right text-slate-300">{Number(row.downtime_minutes || 0).toFixed(1)}</td>
                                        <td className="py-2 text-slate-300">{(row.forecast_breaches || []).join(', ') || '-'}</td>
                                    </tr>
                                ))}
                                {!offenders.length && !loading && (
                                    <tr><td colSpan={5} className="py-6 text-center text-slate-500">No offender analytics yet.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="card">
                    <h3 className="text-lg font-bold text-white mb-4">Recommendations</h3>
                    <div className="space-y-3">
                        {recommendations.map((line: string, idx: number) => (
                            <div key={idx} className="p-3 rounded-lg border border-primary-500/20 bg-primary-500/5 text-sm text-slate-300">
                                {line}
                            </div>
                        ))}
                        {!recommendations.length && !loading && (
                            <p className="text-slate-500 text-sm">No recommendations available.</p>
                        )}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                <div className="card">
                    <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><ShieldAlert size={18} className="text-amber-400" /> Alert Hotspots</h3>
                    <div className="space-y-2">
                        {hotspots.map((row: any) => (
                            <div key={row.key} className="flex items-center justify-between py-2 border-b border-white/5">
                                <span className="text-slate-300">{row.key}</span>
                                <span className="text-slate-500 text-xs">{row.count}</span>
                            </div>
                        ))}
                        {!hotspots.length && !loading && (
                            <p className="text-slate-500 text-sm">No hotspot data.</p>
                        )}
                    </div>
                </div>

                <div className="card">
                    <h3 className="text-lg font-bold text-white mb-4">Forecast (Next 1 Hour)</h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="text-slate-500">
                                <tr className="border-b border-white/10">
                                    <th className="text-left py-2">Device</th>
                                    <th className="text-right py-2">CPU%</th>
                                    <th className="text-right py-2">RAM%</th>
                                    <th className="text-right py-2">Disk%</th>
                                </tr>
                            </thead>
                            <tbody>
                                {forecasts.map((row: any) => (
                                    <tr key={row.device_id} className="border-b border-white/5">
                                        <td className="py-2 text-slate-300">{row.name}</td>
                                        <td className="py-2 text-right text-slate-300">{Number(row.cpu_forecast_pct || 0).toFixed(1)}</td>
                                        <td className="py-2 text-right text-slate-300">{Number(row.memory_forecast_pct || 0).toFixed(1)}</td>
                                        <td className="py-2 text-right text-slate-300">{Number(row.disk_forecast_pct || 0).toFixed(1)}</td>
                                    </tr>
                                ))}
                                {!forecasts.length && !loading && (
                                    <tr><td colSpan={4} className="py-6 text-center text-slate-500">No forecast data available.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {loading && <p className="text-slate-500 text-sm">Loading analytics...</p>}
        </div>
    );
};

