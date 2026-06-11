import React, { useState, useEffect } from 'react';
import api from '../lib/axios';
import { X, Printer, ShieldAlert, Award, Cpu, Database, Server, RefreshCw, Calendar } from 'lucide-react';

interface DowntimeReportModalProps {
    open: boolean;
    onClose: () => void;
    deviceId: string;
    deviceName?: string;
}

export const DowntimeReportModal: React.FC<DowntimeReportModalProps> = ({
    open,
    onClose,
    deviceId,
    deviceName
}) => {
    const [timeframe, setTimeframe] = useState<'7d' | '30d' | 'custom'>('7d');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [reportData, setReportData] = useState<any>(null);

    const generateReport = async () => {
        setLoading(true);
        setError(null);
        try {
            const payload: any = { timeframe };
            if (timeframe === 'custom') {
                if (!startDate || !endDate) {
                    setError('Please select both start and end dates.');
                    setLoading(false);
                    return;
                }
                payload.startDate = new Date(startDate).toISOString();
                payload.endDate = new Date(endDate).toISOString();
            }
            const res = await api.post(`/analytics/device/${deviceId}/report`, payload);
            setReportData(res.data);
        } catch (err: any) {
            console.error('Error generating report:', err);
            setError(err.response?.data?.message || 'Failed to generate downtime report.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (open && deviceId) {
            generateReport();
        } else {
            setReportData(null);
            setError(null);
        }
    }, [open, deviceId, timeframe]);

    if (!open) return null;

    const handlePrint = () => {
        window.print();
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur flex items-center justify-center p-4 overflow-y-auto">
            <style dangerouslySetInnerHTML={{ __html: `
                @media print {
                    /* Hide everything else */
                    body * {
                        visibility: hidden;
                    }
                    /* Show only print area */
                    #report-print-container, #report-print-container * {
                        visibility: visible;
                    }
                    #report-print-container {
                        position: absolute;
                        left: 0;
                        top: 0;
                        width: 100%;
                        background: white !important;
                        color: #0f172a !important;
                        padding: 0 !important;
                        margin: 0 !important;
                        border: none !important;
                    }
                    .no-print {
                        display: none !important;
                    }
                    /* Adjust colors for print */
                    .print-bg-gray {
                        background-color: #f1f5f9 !important;
                    }
                    .print-border {
                        border: 1px solid #cbd5e1 !important;
                    }
                    .print-text-dark {
                        color: #0f172a !important;
                    }
                    .print-text-muted {
                        color: #475569 !important;
                    }
                }
            `}} />

            <div className="bg-dark-surface border border-dark-border rounded-2xl w-full max-w-4xl p-6 space-y-6 max-h-[95vh] overflow-y-auto relative no-print shadow-2xl">
                {/* Header */}
                <div className="flex justify-between items-center border-b border-dark-border pb-4">
                    <div>
                        <h3 className="text-xl font-bold text-white flex items-center gap-2">
                            <Server className="text-primary-500" size={24} />
                            Device Downtime & Archival Report
                        </h3>
                        <p className="text-sm text-slate-400">Generate executive quality reports for device availability.</p>
                    </div>
                    <button className="text-slate-500 hover:text-white" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                {/* Filters */}
                <div className="flex flex-wrap gap-4 items-end bg-dark-bg/60 p-4 rounded-xl border border-dark-border">
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Timeframe</label>
                        <select
                            className="input-field py-1.5 px-3 text-sm min-w-[140px]"
                            value={timeframe}
                            onChange={(e) => setTimeframe(e.target.value as any)}
                        >
                            <option value="7d">Last 7 Days</option>
                            <option value="30d">Last 30 Days</option>
                            <option value="custom">Custom Range</option>
                        </select>
                    </div>

                    {timeframe === 'custom' && (
                        <>
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Start Date</label>
                                <input
                                    type="date"
                                    className="input-field py-1.5 px-3 text-sm"
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">End Date</label>
                                <input
                                    type="date"
                                    className="input-field py-1.5 px-3 text-sm"
                                    value={endDate}
                                    onChange={(e) => setEndDate(e.target.value)}
                                />
                            </div>
                            <button
                                onClick={generateReport}
                                disabled={loading}
                                className="btn-primary py-2 px-4 text-sm flex items-center gap-1.5"
                            >
                                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                                Apply
                            </button>
                        </>
                    )}

                    <div className="ml-auto flex gap-2">
                        {reportData && (
                            <button
                                onClick={handlePrint}
                                className="px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-lg font-medium text-sm flex items-center gap-2 shadow-lg"
                            >
                                <Printer size={16} />
                                Print / Save PDF
                            </button>
                        )}
                    </div>
                </div>

                {/* Main Content Area */}
                {loading && (
                    <div className="flex flex-col items-center justify-center py-12 space-y-3">
                        <RefreshCw className="animate-spin text-primary-500" size={36} />
                        <span className="text-sm text-slate-400">Compiling statistics & generating AI Summary...</span>
                    </div>
                )}

                {error && (
                    <div className="bg-red-500/10 border border-red-500/20 text-red-300 p-4 rounded-xl text-sm">
                        {error}
                    </div>
                )}

                {!loading && !error && !reportData && (
                    <div className="text-center py-12 text-slate-500">
                        Select a timeframe or input date ranges to fetch statistics.
                    </div>
                )}

                {!loading && reportData && (
                    <div id="report-print-container" className="space-y-6 bg-dark-surface p-4 rounded-xl border border-dark-border print-text-dark">
                        {/* Report Header */}
                        <div className="flex justify-between items-start border-b border-slate-700/50 pb-4 print-border">
                            <div>
                                <h2 className="text-2xl font-bold text-white print-text-dark">{reportData.device?.name || deviceName || 'Device'} Report</h2>
                                <p className="text-sm text-slate-400 print-text-muted">
                                    ID: <span className="font-mono text-xs">{reportData.device?.device_id}</span> | Type: {reportData.device?.type || 'Generic'}
                                </p>
                                <p className="text-xs text-slate-500 mt-1 print-text-muted">
                                    Period: {new Date(reportData.start_date).toLocaleDateString()} - {new Date(reportData.end_date).toLocaleDateString()}
                                </p>
                            </div>
                            <div className="text-right">
                                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 px-2 py-1 bg-dark-bg rounded border border-dark-border print-text-muted print-border print-bg-gray">
                                    Status: {reportData.device?.status || 'unknown'}
                                </span>
                                <p className="text-xs text-slate-500 mt-2 print-text-muted">Generated on {new Date(reportData.generated_at).toLocaleString()}</p>
                            </div>
                        </div>

                        {/* Availability Score & KPIs */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="bg-dark-bg border border-dark-border p-4 rounded-xl flex items-center gap-4 print-bg-gray print-border">
                                <div className="rounded-full bg-emerald-500/10 p-3 text-emerald-400">
                                    <Award size={24} />
                                </div>
                                <div>
                                    <span className="text-xs text-slate-400 uppercase print-text-muted">Availability / Uptime</span>
                                    <h3 className="text-2xl font-black text-white print-text-dark">{reportData.availability}%</h3>
                                    <p className="text-xs text-slate-500 mt-0.5 print-text-muted">
                                        Total downtime: {reportData.total_downtime_minutes} min
                                    </p>
                                </div>
                            </div>

                            <div className="bg-dark-bg border border-dark-border p-4 rounded-xl flex items-center gap-4 print-bg-gray print-border">
                                <div className="rounded-full bg-blue-500/10 p-3 text-blue-400">
                                    <Cpu size={24} />
                                </div>
                                <div>
                                    <span className="text-xs text-slate-400 uppercase print-text-muted">Average / Max CPU</span>
                                    <h3 className="text-2xl font-black text-white print-text-dark">
                                        {reportData.metrics?.avg_cpu}% <span className="text-sm font-normal text-slate-400">/ {reportData.metrics?.max_cpu}%</span>
                                    </h3>
                                    <p className="text-xs text-slate-500 mt-0.5 print-text-muted">Processor workload stats</p>
                                </div>
                            </div>

                            <div className="bg-dark-bg border border-dark-border p-4 rounded-xl flex items-center gap-4 print-bg-gray print-border">
                                <div className="rounded-full bg-purple-500/10 p-3 text-purple-400">
                                    <Database size={24} />
                                </div>
                                <div>
                                    <span className="text-xs text-slate-400 uppercase print-text-muted">Memory / Disk Max</span>
                                    <h3 className="text-2xl font-black text-white print-text-dark">
                                        {reportData.metrics?.max_memory}% <span className="text-sm font-normal text-slate-400">/ {reportData.metrics?.max_disk}%</span>
                                    </h3>
                                    <p className="text-xs text-slate-500 mt-0.5 print-text-muted">Capacity limits reached</p>
                                </div>
                            </div>
                        </div>

                        {/* AI Summary Card */}
                        <div className="bg-gradient-to-r from-primary-500/10 to-indigo-500/10 border border-primary-500/20 p-5 rounded-2xl print-bg-gray print-border print-text-dark">
                            <h4 className="text-md font-bold text-white mb-2 flex items-center gap-1.5 print-text-dark">
                                <ShieldAlert size={18} className="text-primary-400" />
                                AI Executive Summary & Diagnostics
                            </h4>
                            <p className="text-sm text-slate-300 leading-relaxed print-text-dark">{reportData.ai_summary?.overview}</p>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-slate-700/50 print-border">
                                <div>
                                    <h5 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 print-text-muted">Root-Cause Insights</h5>
                                    <ul className="list-disc list-inside text-xs text-slate-300 space-y-1.5 print-text-dark">
                                        {reportData.ai_summary?.root_causes?.map((cause: string, i: number) => (
                                            <li key={i} className="leading-normal">{cause}</li>
                                        ))}
                                    </ul>
                                </div>
                                <div>
                                    <h5 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 print-text-muted">Recommended Actions</h5>
                                    <ul className="list-disc list-inside text-xs text-slate-300 space-y-1.5 print-text-dark">
                                        {reportData.ai_summary?.recommendations?.map((rec: string, i: number) => (
                                            <li key={i} className="leading-normal">{rec}</li>
                                        ))}
                                    </ul>
                                </div>
                            </div>

                            <p className="text-xs text-slate-500 mt-4 italic border-t border-slate-700/30 pt-2 print-text-muted">
                                {reportData.ai_summary?.peak_load_hours}
                            </p>
                        </div>

                        {/* Downtime Incidents List */}
                        <div className="space-y-3">
                            <h4 className="text-md font-bold text-white print-text-dark flex items-center gap-1.5">
                                <Calendar size={18} />
                                Downtime Incidents Log
                            </h4>

                            {reportData.downtime_logs?.length === 0 ? (
                                <div className="text-center py-6 border border-dashed border-dark-border rounded-xl text-slate-500">
                                    No downtime incidents detected during this timeframe. Uptime availability was 100%.
                                </div>
                            ) : (
                                <div className="border border-dark-border rounded-xl overflow-hidden print-border">
                                    <table className="w-full text-left border-collapse text-xs">
                                        <thead>
                                            <tr className="bg-dark-bg/60 border-b border-dark-border print-bg-gray print-border">
                                                <th className="p-3 text-slate-400 font-semibold print-text-muted">Incident Summary</th>
                                                <th className="p-3 text-slate-400 font-semibold print-text-muted">Severity</th>
                                                <th className="p-3 text-slate-400 font-semibold print-text-muted">Started At</th>
                                                <th className="p-3 text-slate-400 font-semibold print-text-muted">Resolved At</th>
                                                <th className="p-3 text-slate-400 font-semibold print-text-muted text-right">Duration</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-dark-border/40">
                                            {reportData.downtime_logs.map((log: any) => (
                                                <tr key={log.id} className="hover:bg-dark-bg/25">
                                                    <td className="p-3 font-medium text-slate-200 print-text-dark">{log.summary}</td>
                                                    <td className="p-3">
                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                                            log.severity === 'critical' ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'
                                                        }`}>
                                                            {log.severity}
                                                        </span>
                                                    </td>
                                                    <td className="p-3 text-slate-300 print-text-dark">{new Date(log.started_at).toLocaleString()}</td>
                                                    <td className="p-3 text-slate-300 print-text-dark">
                                                        {log.resolved_at ? new Date(log.resolved_at).toLocaleString() : (
                                                            <span className="text-emerald-400 font-semibold">Active</span>
                                                        )}
                                                    </td>
                                                    <td className="p-3 text-slate-300 print-text-dark text-right font-semibold">
                                                        {log.duration_minutes} min
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
