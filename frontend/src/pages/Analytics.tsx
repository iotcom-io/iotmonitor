import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BrainCircuit, Gauge, RefreshCw, ShieldAlert, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
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

    const [selectedIssueKey, setSelectedIssueKey] = useState('');
    const [issueDeviceId, setIssueDeviceId] = useState('');
    const [issueDetail, setIssueDetail] = useState<any>(null);
    const [issueLoading, setIssueLoading] = useState(false);
    const [aiData, setAiData] = useState<any>(null);
    const [aiLoading, setAiLoading] = useState(false);

    const [forecastDeviceId, setForecastDeviceId] = useState('');
    const [forecastService, setForecastService] = useState<'all' | 'cpu' | 'memory' | 'disk'>('all');
    const [forecastData, setForecastData] = useState<any>(null);
    const [forecastLoading, setForecastLoading] = useState(false);

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

    const fetchAIInsights = useCallback(async () => {
        setAiLoading(true);
        try {
            const res = await api.get('/ai-analytics/overview', { params: { window_days: windowDays } });
            setAiData(res.data || null);
        } catch (error) {
            console.error('Failed to fetch AI insights', error);
            setAiData(null);
        } finally {
            setAiLoading(false);
        }
    }, [windowDays]);

    useEffect(() => {
        fetchOverview();
        fetchAIInsights();
    }, [fetchOverview, fetchAIInsights]);

    const runForecast = useCallback(async () => {
        setForecastLoading(true);
        try {
            const response = await api.get('/analytics/forecast', {
                params: {
                    window_days: windowDays,
                    service: forecastService,
                    device_id: forecastDeviceId || undefined,
                },
            });
            setForecastData(response.data || null);
        } catch (error) {
            console.error('Failed to fetch forecast explorer data', error);
            setForecastData(null);
        } finally {
            setForecastLoading(false);
        }
    }, [forecastDeviceId, forecastService, windowDays]);

    useEffect(() => {
        if (!selectedIssueKey) {
            setIssueDetail(null);
            return;
        }
        let mounted = true;
        setIssueLoading(true);
        api.get(`/analytics/issues/${encodeURIComponent(selectedIssueKey)}`, {
            params: {
                window_days: windowDays,
                device_id: issueDeviceId || undefined,
            },
        })
            .then((res) => {
                if (!mounted) return;
                setIssueDetail(res.data || null);
            })
            .catch((error) => {
                console.error('Failed to fetch issue detail', error);
                if (mounted) setIssueDetail(null);
            })
            .finally(() => {
                if (mounted) setIssueLoading(false);
            });

        return () => {
            mounted = false;
        };
    }, [selectedIssueKey, issueDeviceId, windowDays]);

    const kpis = data?.fleet_kpis || {};
    const offenders = useMemo(() => Array.isArray(data?.top_offenders) ? data.top_offenders : [], [data]);
    const hotspots = useMemo(() => Array.isArray(data?.issue_hotspots) ? data.issue_hotspots : [], [data]);
    const recommendations = useMemo(() => Array.isArray(data?.recommendations) ? data.recommendations : [], [data]);
    const topForecastRisk = useMemo(() => (Array.isArray(data?.top_forecast_risks) ? data.top_forecast_risks[0] : null), [data]);
    const deviceOptions = useMemo(
        () => offenders.map((row: any) => ({ id: String(row.device_id), name: row.name })),
        [offenders]
    );

    return (
        <div className="space-y-8">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold text-white mb-2">AI Analytics</h2>
                    <p className="text-slate-400">Incident-grounded reliability analytics, issue drilldown, and on-demand forecast explorer.</p>
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

            {/* AI Insights */}
            {(aiData || aiLoading) && (
                <div className="space-y-6">
                    <div className="flex items-center gap-2">
                        <BrainCircuit size={20} className="text-primary-400" />
                        <h3 className="text-lg font-bold text-white">AI-Powered Insights</h3>
                        {aiLoading && <span className="text-xs text-slate-500">Computing...</span>}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="card border border-amber-500/20">
                            <p className="text-xs text-slate-500 uppercase font-bold">Most Problematic Device</p>
                            <p className="text-lg font-bold text-white mt-1">{aiData?.most_problematic_device?.name || '-'}</p>
                            <p className="text-xs text-amber-400 mt-1">{aiData?.most_problematic_device?.incident_count || 0} incidents</p>
                        </div>
                        <div className="card border border-red-500/20">
                            <p className="text-xs text-slate-500 uppercase font-bold">Top Issue Type</p>
                            <p className="text-lg font-bold text-white mt-1 capitalize">{aiData?.top_issue_type || '-'}</p>
                            <p className="text-xs text-red-400 mt-1">{aiData?.unresolved_count || 0} unresolved</p>
                        </div>
                        <div className="card border border-primary-500/20">
                            <p className="text-xs text-slate-500 uppercase font-bold">Incident Patterns</p>
                            <p className="text-lg font-bold text-white mt-1">{aiData?.patterns?.length || 0} patterns</p>
                            <p className="text-xs text-primary-400 mt-1">{aiData?.incident_count || 0} total incidents</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                        {/* Peak Hours */}
                        <div className="card">
                            <h4 className="text-sm font-bold text-white mb-4">Peak Incident Hours</h4>
                            <div className="space-y-2">
                                {(aiData?.peak_hours?.incident_peak_hours || []).map((row: any, i: number) => (
                                    <div key={i} className="flex items-center gap-3">
                                        <span className="text-xs text-slate-500 w-12">{row.label}</span>
                                        <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-amber-500/60 rounded-full"
                                                style={{ width: `${Math.min(100, (row.count / (aiData.peak_hours.incident_peak_hours[0]?.count || 1)) * 100)}%` }}
                                            />
                                        </div>
                                        <span className="text-xs text-slate-300 w-8 text-right">{row.count}</span>
                                    </div>
                                ))}
                                {!(aiData?.peak_hours?.incident_peak_hours?.length) && !aiLoading && (
                                    <p className="text-slate-500 text-sm">No peak hour data available.</p>
                                )}
                            </div>
                        </div>

                        {/* Remediation Suggestions */}
                        <div className="card">
                            <h4 className="text-sm font-bold text-white mb-4">Remediation Suggestions</h4>
                            <div className="space-y-3 max-h-64 overflow-auto">
                                {(aiData?.remediation_suggestions || []).slice(0, 5).map((row: any, i: number) => (
                                    <div key={i} className="p-3 rounded-lg border border-primary-500/20 bg-primary-500/5">
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-xs font-bold text-primary-400 uppercase">{row.issue_type}</span>
                                            <span className="text-[10px] text-slate-500">{row.total_occurrences} occurrences</span>
                                        </div>
                                        <ul className="space-y-1 mt-2">
                                            {row.suggestions.map((tip: string, j: number) => (
                                                <li key={j} className="text-xs text-slate-300 flex items-start gap-1.5">
                                                    <span className="text-primary-400 mt-0.5">•</span>
                                                    {tip}
                                                </li>
                                            ))}
                                        </ul>
                                        {row.avg_resolution_minutes && (
                                            <p className="text-[10px] text-slate-500 mt-2">Avg resolution: {row.avg_resolution_minutes} min</p>
                                        )}
                                    </div>
                                ))}
                                {!(aiData?.remediation_suggestions?.length) && !aiLoading && (
                                    <p className="text-slate-500 text-sm">No remediation suggestions available.</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                <div className="xl:col-span-2 card">
                    <h3 className="text-lg font-bold text-white mb-4">Top Offenders (Incident-Based)</h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="text-slate-500">
                                <tr className="border-b border-white/10">
                                    <th className="text-left py-2">Device</th>
                                    <th className="text-right py-2">Risk</th>
                                    <th className="text-right py-2">Incidents</th>
                                    <th className="text-right py-2">Downtime (m)</th>
                                    <th className="text-left py-2">Top Issue</th>
                                    <th className="text-left py-2">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {offenders.map((row: any) => (
                                    <tr key={row.device_id} className="border-b border-white/5">
                                        <td className="py-2 text-white font-semibold">{row.name}</td>
                                        <td className="py-2 text-right"><RiskBadge band={row.risk_band} /> <span className="ml-2 text-slate-300">{Number(row.risk_score || 0).toFixed(1)}</span></td>
                                        <td className="py-2 text-right text-slate-300">{row.incident_count || 0}</td>
                                        <td className="py-2 text-right text-slate-300">{Number(row.downtime_minutes || 0).toFixed(1)}</td>
                                        <td className="py-2 text-slate-300">{row.top_issue_label || '-'}</td>
                                        <td className="py-2 text-xs">
                                            <Link className="text-primary-400 hover:text-primary-300" to={`/incidents?target_id=${encodeURIComponent(row.device_id)}&status=all`}>
                                                View incidents
                                            </Link>
                                        </td>
                                    </tr>
                                ))}
                                {!offenders.length && !loading && (
                                    <tr><td colSpan={6} className="py-6 text-center text-slate-500">No offender analytics yet.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="space-y-6">
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

                    <div className="card">
                        <h3 className="text-lg font-bold text-white mb-4">Top Forecast Breach (Default)</h3>
                        {topForecastRisk ? (
                            <div className="space-y-2">
                                <p className="text-sm text-slate-300">{topForecastRisk.name}</p>
                                <p className="text-xs text-slate-400 uppercase">
                                    Service: {String(topForecastRisk.top_service || '').toUpperCase()} | Forecast {Number(topForecastRisk.top_service_value || 0).toFixed(1)}%
                                </p>
                                <p className="text-xs text-red-400">Threshold {topForecastRisk.top_service_threshold}% | Gap +{Number(topForecastRisk.breach_gap || 0).toFixed(1)}%</p>
                            </div>
                        ) : (
                            <p className="text-sm text-slate-500">No forecast breach candidate in current window.</p>
                        )}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                <div className="card">
                    <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><ShieldAlert size={18} className="text-amber-400" /> Frequent Issue Types</h3>
                    <div className="space-y-2">
                        {hotspots.map((row: any) => (
                            <div key={row.key} className="flex items-center justify-between py-2 border-b border-white/5">
                                <div className="flex flex-col">
                                    <span className="text-slate-300">{row.label}</span>
                                    <span className="text-[10px] text-slate-500">{row.key}</span>
                                </div>
                                <span className="text-slate-500 text-xs">{row.count}</span>
                            </div>
                        ))}
                        {!hotspots.length && !loading && (
                            <p className="text-slate-500 text-sm">No issue hotspot data.</p>
                        )}
                    </div>
                </div>

                <div className="card">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold text-white">Forecast Explorer</h3>
                        <button onClick={runForecast} className="btn-primary text-xs px-3 py-1.5" disabled={forecastLoading}>
                            {forecastLoading ? 'Running...' : 'Run'}
                        </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                        <select className="input-field" value={forecastDeviceId} onChange={(e) => setForecastDeviceId(e.target.value)}>
                            <option value="">All devices</option>
                            {deviceOptions.map((device: any) => (
                                <option key={device.id} value={device.id}>{device.name}</option>
                            ))}
                        </select>
                        <select
                            className="input-field"
                            value={forecastService}
                            onChange={(e) => setForecastService(e.target.value as 'all' | 'cpu' | 'memory' | 'disk')}
                        >
                            <option value="all">All services</option>
                            <option value="cpu">CPU</option>
                            <option value="memory">Memory</option>
                            <option value="disk">Disk</option>
                        </select>
                    </div>
                    <div className="max-h-80 overflow-auto">
                        <table className="w-full text-sm">
                            <thead className="text-slate-500">
                                <tr className="border-b border-white/10">
                                    <th className="text-left py-2">Device</th>
                                    <th className="text-right py-2">CPU%</th>
                                    <th className="text-right py-2">RAM%</th>
                                    <th className="text-right py-2">Disk%</th>
                                    <th className="text-left py-2">Top Breach</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(forecastData?.rows || []).slice(0, 20).map((row: any) => (
                                    <tr key={row.device_id} className="border-b border-white/5">
                                        <td className="py-2 text-slate-300">{row.name}</td>
                                        <td className="py-2 text-right text-slate-300">{Number(row.cpu_forecast_pct || 0).toFixed(1)}</td>
                                        <td className="py-2 text-right text-slate-300">{Number(row.memory_forecast_pct || 0).toFixed(1)}</td>
                                        <td className="py-2 text-right text-slate-300">{Number(row.disk_forecast_pct || 0).toFixed(1)}</td>
                                        <td className="py-2 text-xs text-slate-400">
                                            {row.top_breach ? `${String(row.top_breach.service).toUpperCase()} (+${Number(row.top_breach.value - row.top_breach.threshold).toFixed(1)}%)` : '-'}
                                        </td>
                                    </tr>
                                ))}
                                {forecastData && !(forecastData?.rows || []).length && (
                                    <tr><td colSpan={5} className="py-6 text-center text-slate-500">No forecast rows found.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div className="card">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
                    <h3 className="text-lg font-bold text-white">Issue Detail</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full md:w-auto">
                        <select
                            className="input-field min-w-[220px]"
                            value={selectedIssueKey}
                            onChange={(e) => setSelectedIssueKey(e.target.value)}
                        >
                            <option value="">Select issue type</option>
                            {hotspots.map((row: any) => (
                                <option key={row.key} value={row.key}>{row.label}</option>
                            ))}
                        </select>
                        <select
                            className="input-field min-w-[220px]"
                            value={issueDeviceId}
                            onChange={(e) => setIssueDeviceId(e.target.value)}
                        >
                            <option value="">All devices</option>
                            {deviceOptions.map((device: any) => (
                                <option key={device.id} value={device.id}>{device.name}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {issueLoading ? (
                    <p className="text-slate-500 text-sm">Loading issue detail...</p>
                ) : issueDetail ? (
                    <div className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                            <div className="p-3 bg-white/5 border border-white/10 rounded-lg">
                                <p className="text-[10px] uppercase text-slate-500 font-bold">Incidents</p>
                                <p className="text-xl font-black text-white">{issueDetail.summary?.incidents_total || 0}</p>
                            </div>
                            <div className="p-3 bg-white/5 border border-white/10 rounded-lg">
                                <p className="text-[10px] uppercase text-slate-500 font-bold">Open</p>
                                <p className="text-xl font-black text-white">{issueDetail.summary?.incidents_open || 0}</p>
                            </div>
                            <div className="p-3 bg-white/5 border border-white/10 rounded-lg">
                                <p className="text-[10px] uppercase text-slate-500 font-bold">MTTR</p>
                                <p className="text-xl font-black text-white">{Number(issueDetail.summary?.mttr_minutes || 0).toFixed(1)}m</p>
                            </div>
                            <div className="p-3 bg-white/5 border border-white/10 rounded-lg">
                                <p className="text-[10px] uppercase text-slate-500 font-bold">MTBF</p>
                                <p className="text-xl font-black text-white">{Number(issueDetail.summary?.mtbf_minutes || 0).toFixed(1)}m</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                            <div>
                                <h4 className="text-sm font-bold text-white mb-2">MTTR/MTBF Trend</h4>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead className="text-slate-500">
                                            <tr className="border-b border-white/10">
                                                <th className="text-left py-2">Day</th>
                                                <th className="text-right py-2">Incidents</th>
                                                <th className="text-right py-2">MTTR (m)</th>
                                                <th className="text-right py-2">MTBF (m)</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(issueDetail.trend || []).map((row: any) => (
                                                <tr key={row.day} className="border-b border-white/5">
                                                    <td className="py-2 text-slate-300">{row.day}</td>
                                                    <td className="py-2 text-right text-slate-300">{row.incidents}</td>
                                                    <td className="py-2 text-right text-slate-300">{Number(row.mttr_minutes || 0).toFixed(1)}</td>
                                                    <td className="py-2 text-right text-slate-300">{Number(row.mtbf_minutes || 0).toFixed(1)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div>
                                <h4 className="text-sm font-bold text-white mb-2">Remediation Notes</h4>
                                <ul className="space-y-2">
                                    {(issueDetail.remediation_notes || []).map((note: string, idx: number) => (
                                        <li key={idx} className="p-3 rounded-lg border border-primary-500/20 bg-primary-500/5 text-sm text-slate-300">
                                            {note}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>

                        <div>
                            <h4 className="text-sm font-bold text-white mb-2">Affected Devices</h4>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="text-slate-500">
                                        <tr className="border-b border-white/10">
                                            <th className="text-left py-2">Device</th>
                                            <th className="text-right py-2">Incidents</th>
                                            <th className="text-right py-2">Open</th>
                                            <th className="text-right py-2">Downtime (m)</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(issueDetail.affected_devices || []).map((row: any) => (
                                            <tr key={row.device_id} className="border-b border-white/5">
                                                <td className="py-2 text-slate-300">{row.target_name || row.device_id}</td>
                                                <td className="py-2 text-right text-slate-300">{row.incident_count}</td>
                                                <td className="py-2 text-right text-slate-300">{row.open_count}</td>
                                                <td className="py-2 text-right text-slate-300">{Number(row.total_downtime_minutes || 0).toFixed(1)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <h4 className="text-sm font-bold text-white">Recent Linked Incidents</h4>
                                <Link
                                    to={`/incidents?q=${encodeURIComponent(issueDetail.issue_label || issueDetail.issue_key)}&status=all`}
                                    className="text-xs text-primary-400 hover:text-primary-300"
                                >
                                    Open in incidents
                                </Link>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="text-slate-500">
                                        <tr className="border-b border-white/10">
                                            <th className="text-left py-2">Incident</th>
                                            <th className="text-left py-2">Device</th>
                                            <th className="text-left py-2">Summary</th>
                                            <th className="text-left py-2">Severity</th>
                                            <th className="text-left py-2">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(issueDetail.recent_incidents || []).map((incident: any) => (
                                            <tr key={incident.id} className="border-b border-white/5">
                                                <td className="py-2 text-primary-400">#{incident.id.slice(-6)}</td>
                                                <td className="py-2 text-slate-300">{incident.target_name || incident.target_id}</td>
                                                <td className="py-2 text-slate-300">{incident.summary}</td>
                                                <td className="py-2 text-slate-300">{incident.severity}</td>
                                                <td className="py-2 text-slate-300">{incident.status}</td>
                                            </tr>
                                        ))}
                                        {(!issueDetail.recent_incidents || issueDetail.recent_incidents.length === 0) && (
                                            <tr><td colSpan={5} className="py-6 text-center text-slate-500">No incidents found in selected window.</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                ) : (
                    <p className="text-slate-500 text-sm">Select an issue type to load MTTR/MTBF trend and impacted devices.</p>
                )}
            </div>

            {loading && <p className="text-slate-500 text-sm">Loading analytics...</p>}
        </div>
    );
};
