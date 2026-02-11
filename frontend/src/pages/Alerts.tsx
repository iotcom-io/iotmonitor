import React, { useEffect, useMemo, useState } from 'react';
import api from '../lib/axios';
import { AlertTriangle, RefreshCw, Download } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { hasPermission } from '../lib/permissions';
import { AssigneeBadges } from '../components/AssigneeBadges';

const formatDate = (value?: string) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
};

const severityClass = (severity: string) => {
    if (severity === 'critical') return 'bg-red-500/20 text-red-300';
    if (severity === 'warning') return 'bg-amber-500/20 text-amber-300';
    return 'bg-cyan-500/20 text-cyan-300';
};

const buildAlertLabel = (alert: any) => {
    const service = String(alert.specific_service || '').trim();
    const endpoint = String(alert.specific_endpoint || '').trim();
    let title = String(alert.alert_type || 'alert').replace(/_/g, ' ');
    title = title.charAt(0).toUpperCase() + title.slice(1);

    const segments = [title];
    if (service) segments.push(service);
    if (endpoint) segments.push(endpoint);
    return segments.join(' • ');
};

const compactDetails = (details: any) => {
    if (!details || typeof details !== 'object') return '—';
    const keys = Object.keys(details).slice(0, 3);
    if (keys.length === 0) return '—';
    return keys.map((key) => `${key}: ${String(details[key])}`).join(' | ');
};

export const Alerts = () => {
    const user = useAuthStore(state => state.user);
    const canViewUsers = hasPermission('users.view', user);
    const [alerts, setAlerts] = useState<any[]>([]);
    const [users, setUsers] = useState<Record<string, { name?: string; email?: string }>>({});
    const [loading, setLoading] = useState(true);
    const [exporting, setExporting] = useState(false);

    const fetchAlerts = async () => {
        setLoading(true);
        try {
            const res = await api.get('/alerts/active', { params: { limit: 500 } });
            setAlerts(Array.isArray(res.data) ? res.data : []);
        } finally {
            setLoading(false);
        }
    };

    const exportAlerts = async () => {
        try {
            setExporting(true);
            const response = await api.get('/alerts/active/export', { responseType: 'blob' });
            const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `active-alerts-${Date.now()}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Failed to export active alerts', error);
            window.alert('Failed to export active alerts.');
        } finally {
            setExporting(false);
        }
    };

    useEffect(() => {
        fetchAlerts();
    }, []);

    useEffect(() => {
        if (!canViewUsers) {
            setUsers({});
            return;
        }

        let isMounted = true;
        api.get('/users')
            .then((res) => {
                if (!isMounted) return;
                const rows = Array.isArray(res.data) ? res.data : [];
                const map = rows.reduce((acc: Record<string, { name?: string; email?: string }>, row: any) => {
                    const id = String(row.id || row._id || '').trim();
                    if (!id) return acc;
                    acc[id] = { name: row.name, email: row.email };
                    return acc;
                }, {});
                setUsers(map);
            })
            .catch((error) => {
                console.error('Failed to fetch users for alert assignments', error);
                if (isMounted) setUsers({});
            });

        return () => {
            isMounted = false;
        };
    }, [canViewUsers]);

    const hasAnyAssignees = useMemo(
        () => alerts.some((alert) => Array.isArray(alert.assigned_user_ids) && alert.assigned_user_ids.length > 0),
        [alerts]
    );

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <AlertTriangle className="text-primary-400" />
                    <h2 className="text-2xl font-bold text-white">Active Alerts</h2>
                </div>
                <div className="flex items-center gap-2">
                    <button className="icon-btn" onClick={exportAlerts} disabled={exporting} title="Export active alerts CSV">
                        <Download size={16} />
                    </button>
                    <button className="icon-btn" onClick={fetchAlerts}><RefreshCw size={16} /></button>
                </div>
            </div>

            <div className="card overflow-x-auto">
                {loading ? (
                    <div className="text-slate-400">Loading...</div>
                ) : alerts.length === 0 ? (
                    <div className="py-6 text-slate-400">No active alert.</div>
                ) : (
                    <table className="min-w-full text-sm">
                        <thead>
                            <tr className="text-left text-slate-400 border-b border-white/10">
                                <th className="py-3 pr-3">Device</th>
                                <th className="py-3 pr-3">Alert</th>
                                <th className="py-3 pr-3">Severity</th>
                                <th className="py-3 pr-3">State</th>
                                <th className="py-3 pr-3">Triggered</th>
                                <th className="py-3 pr-3">Last Notified</th>
                                <th className="py-3 pr-3">Next Notification</th>
                                {hasAnyAssignees && <th className="py-3 pr-3">Assigned</th>}
                                <th className="py-3 pr-3">Details</th>
                            </tr>
                        </thead>
                        <tbody>
                            {alerts.map((alert) => (
                                <tr key={alert._id} className="border-b border-white/5 align-top">
                                    <td className="py-3 pr-3 min-w-[180px]">
                                        <div className="text-slate-100 font-medium">{alert.device_name || alert.device_id}</div>
                                        <div className="text-xs text-slate-500">{alert.device_id}</div>
                                    </td>
                                    <td className="py-3 pr-3 min-w-[220px] text-slate-200">{buildAlertLabel(alert)}</td>
                                    <td className="py-3 pr-3">
                                        <span className={`text-xs px-2 py-0.5 rounded ${severityClass(String(alert.severity || 'info'))}`}>
                                            {String(alert.severity || 'info').toUpperCase()}
                                        </span>
                                    </td>
                                    <td className="py-3 pr-3 text-slate-300 text-xs">{String(alert.state || '').toUpperCase()}</td>
                                    <td className="py-3 pr-3 text-xs text-slate-300">{formatDate(alert.first_triggered)}</td>
                                    <td className="py-3 pr-3 text-xs text-slate-300">{formatDate(alert.last_notified)}</td>
                                    <td className="py-3 pr-3 text-xs text-slate-300">{formatDate(alert.next_notification_at)}</td>
                                    {hasAnyAssignees && (
                                        <td className="py-3 pr-3 min-w-[180px]">
                                            <AssigneeBadges ids={alert.assigned_user_ids} users={users} />
                                        </td>
                                    )}
                                    <td className="py-3 pr-3 text-xs text-slate-500 min-w-[260px]">{compactDetails(alert.details)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
};
