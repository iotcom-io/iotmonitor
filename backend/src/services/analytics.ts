import AlertTracking from '../models/AlertTracking';
import Device from '../models/Device';
import Incident from '../models/Incident';
import LicenseAsset from '../models/LicenseAsset';
import SyntheticCheck from '../models/SyntheticCheck';
import Telemetry from '../models/Telemetry';

type NumericSeriesPoint = { t: number; v: number };

const round = (value: number, digits = 2) => {
    if (!Number.isFinite(value)) return 0;
    const factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
};

const average = (values: number[]) => {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const stdDev = (values: number[]) => {
    if (values.length < 2) return 0;
    const mean = average(values);
    const variance = average(values.map((value) => Math.pow(value - mean, 2)));
    return Math.sqrt(variance);
};

const linearRegressionForecast = (points: NumericSeriesPoint[], horizonMs: number) => {
    if (points.length < 2) return null;
    const baseT = points[0].t;
    const xs = points.map((point) => (point.t - baseT) / 1000);
    const ys = points.map((point) => point.v);
    const xMean = average(xs);
    const yMean = average(ys);

    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < xs.length; i += 1) {
        numerator += (xs[i] - xMean) * (ys[i] - yMean);
        denominator += Math.pow(xs[i] - xMean, 2);
    }
    if (!denominator) return null;

    const slope = numerator / denominator;
    const intercept = yMean - slope * xMean;
    const lastX = xs[xs.length - 1];
    const horizonX = lastX + horizonMs / 1000;
    return intercept + slope * horizonX;
};

const extractSeries = (telemetryRows: any[], key: 'cpu_usage' | 'memory_usage' | 'disk_usage') => {
    return telemetryRows
        .map((row) => ({
            t: new Date(row.timestamp).getTime(),
            v: Number(row?.[key]),
        }))
        .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.v));
};

const buildAnomaly = (series: NumericSeriesPoint[]) => {
    if (series.length < 6) return { score: 0, latest: null };
    const values = series.map((point) => point.v);
    const latest = values[values.length - 1];
    const mean = average(values.slice(0, -1));
    const sigma = stdDev(values.slice(0, -1));
    if (sigma <= 0) return { score: 0, latest };
    return { score: Math.abs((latest - mean) / sigma), latest };
};

const getRiskBand = (value: number) => {
    if (value >= 80) return 'critical';
    if (value >= 55) return 'warning';
    return 'ok';
};

const hoursToMs = (hours: number) => hours * 60 * 60 * 1000;
const daysToMs = (days: number) => days * 24 * 60 * 60 * 1000;
const SERVICE_THRESHOLDS: Record<'cpu' | 'memory' | 'disk', number> = {
    cpu: 85,
    memory: 90,
    disk: 90,
};

const remediationLibrary: Record<string, string[]> = {
    device_offline: [
        'Validate power/network path and last heartbeat source.',
        'Check agent service status and MQTT connectivity on the affected node.',
    ],
    service_down: [
        'Inspect service unit logs and restart counters.',
        'Add dependency checks to catch upstream failures early.',
    ],
    threshold_breach: [
        'Tune capacity thresholds per environment baseline.',
        'Correlate breach windows with deployments/cron jobs.',
    ],
    sip_issue: [
        'Validate SIP registration expiry/auth and provider reachability.',
        'Check RTP/signaling packet loss and latency trends.',
    ],
    api_latency: [
        'Inspect upstream latency and database slow queries.',
        'Add cache and timeout budget controls for peak windows.',
    ],
    ssl_issue: [
        'Automate certificate renewal and add renewal lead-time alerts.',
        'Track CA/API renewal failures in a dedicated runbook.',
    ],
    license_risk: [
        'Prioritize renewal workflow for critical/expired items.',
        'Add owner escalation and procurement SLA reminders.',
    ],
    synthetic_failure: [
        'Validate DNS/ingress/load-balancer health for monitor targets.',
        'Track monitor failures against deployment change timeline.',
    ],
    latency_issue: [
        'Inspect interface drops/errors and packet path hops.',
        'Set adaptive latency thresholds by route/provider.',
    ],
    ip_change: [
        'Validate static routing/DNS records after IP changes.',
        'Alert dependent services with new endpoint metadata.',
    ],
    other_issue: [
        'Review incident summaries and standardize issue taxonomy.',
    ],
};

const formatDayKey = (value: Date) => value.toISOString().slice(0, 10);

export const classifyIncident = (incident: any) => {
    const targetType = String(incident?.target_type || '').toLowerCase();
    const summary = String(incident?.summary || '').toLowerCase();

    if (targetType === 'license') return { key: 'license_risk', label: 'License / Subscription Risk' };
    if (targetType === 'synthetic') {
        if (summary.includes('ssl')) return { key: 'ssl_issue', label: 'SSL Issue' };
        if (summary.includes('latency') || summary.includes('response')) return { key: 'api_latency', label: 'API / Website Latency' };
        return { key: 'synthetic_failure', label: 'Synthetic Monitor Failure' };
    }

    if (summary.includes('offline')) return { key: 'device_offline', label: 'Device Offline' };
    if (summary.includes('service down')) return { key: 'service_down', label: 'Service Down' };
    if (summary.includes('threshold breach')) return { key: 'threshold_breach', label: 'Threshold Breach' };
    if (summary.includes('sip')) return { key: 'sip_issue', label: 'SIP Issue' };
    if (summary.includes('latency')) return { key: 'latency_issue', label: 'Latency Issue' };
    if (summary.includes('ip change')) return { key: 'ip_change', label: 'IP Change' };
    return { key: 'other_issue', label: 'Other Issue' };
};

export const buildAnalyticsOverview = async (windowDays = 7) => {
    const now = Date.now();
    const since = new Date(now - daysToMs(windowDays));
    const forecastHorizonMs = hoursToMs(1);
    const telemetryWindow = new Date(now - hoursToMs(24));

    const [devices, incidents, alerts, synthetics, licenses] = await Promise.all([
        Device.find({ monitoring_enabled: true }).select({
            device_id: 1,
            name: 1,
            status: 1,
            expected_message_interval_seconds: 1,
            offline_threshold_multiplier: 1,
            last_seen: 1,
        }),
        Incident.find({ started_at: { $gte: since } }).select({
            target_type: 1,
            target_id: 1,
            status: 1,
            severity: 1,
            started_at: 1,
            resolved_at: 1,
            summary: 1,
        }),
        AlertTracking.find({ first_triggered: { $gte: since } }).select({
            device_id: 1,
            alert_type: 1,
            severity: 1,
            first_triggered: 1,
            resolved_at: 1,
            specific_service: 1,
            specific_endpoint: 1,
        }),
        SyntheticCheck.find({ enabled: true }).select({
            name: 1,
            target_kind: 1,
            type: 1,
            url: 1,
            last_status: 1,
            last_response_time_ms: 1,
            max_response_time_ms: 1,
            ssl_expiry_at: 1,
            ssl_last_state: 1,
        }),
        LicenseAsset.find({ enabled: true, status: { $ne: 'paused' } }).select({
            name: 1,
            renewal_date: 1,
            warning_days: 1,
            critical_days: 1,
            status: 1,
            last_state: 1,
        }),
    ]);

    const deviceIds = devices.map((device: any) => String(device.device_id));
    const telemetryRows = await Telemetry.find({
        device_id: { $in: deviceIds },
        timestamp: { $gte: telemetryWindow },
    }).select({
        device_id: 1,
        timestamp: 1,
        cpu_usage: 1,
        memory_usage: 1,
        disk_usage: 1,
    }).sort({ timestamp: 1 });

    const telemetryByDevice = new Map<string, any[]>();
    telemetryRows.forEach((row: any) => {
        const key = String(row.device_id);
        if (!telemetryByDevice.has(key)) telemetryByDevice.set(key, []);
        telemetryByDevice.get(key)!.push(row);
    });

    const incidentDurationsMinutes = incidents
        .filter((incident: any) => incident.status === 'resolved' && incident.resolved_at)
        .map((incident: any) => (
            (new Date(incident.resolved_at).getTime() - new Date(incident.started_at).getTime()) / 60000
        ))
        .filter((value: number) => Number.isFinite(value) && value >= 0);

    const openIncidents = incidents.filter((incident: any) => incident.status === 'open');
    const criticalIncidents = incidents.filter((incident: any) => incident.severity === 'critical');

    const incidentTypeCounts = new Map<string, { key: string; label: string; count: number }>();
    incidents.forEach((incident: any) => {
        const issue = classifyIncident(incident);
        const existing = incidentTypeCounts.get(issue.key);
        if (existing) {
            existing.count += 1;
        } else {
            incidentTypeCounts.set(issue.key, { ...issue, count: 1 });
        }
    });

    const topIssueTypes = Array.from(incidentTypeCounts.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 12);

    const topOffenders = devices.map((device: any) => {
        const did = String(device.device_id);
        const deviceIncidents = incidents.filter((incident: any) => incident.target_type === 'device' && String(incident.target_id) === did);
        const deviceAlerts = alerts.filter((alert: any) => String(alert.device_id) === did);
        const rows = telemetryByDevice.get(did) || [];
        const issueBreakdownMap = new Map<string, { key: string; label: string; count: number }>();
        deviceIncidents.forEach((incident: any) => {
            const issue = classifyIncident(incident);
            const existing = issueBreakdownMap.get(issue.key);
            if (existing) existing.count += 1;
            else issueBreakdownMap.set(issue.key, { ...issue, count: 1 });
        });
        const issueBreakdown = Array.from(issueBreakdownMap.values()).sort((a, b) => b.count - a.count);
        const topIssue = issueBreakdown[0] || null;

        const cpuSeries = extractSeries(rows, 'cpu_usage');
        const memSeries = extractSeries(rows, 'memory_usage');
        const diskSeries = extractSeries(rows, 'disk_usage');

        const cpuAnomaly = buildAnomaly(cpuSeries).score;
        const memAnomaly = buildAnomaly(memSeries).score;
        const diskAnomaly = buildAnomaly(diskSeries).score;
        const anomalyScore = Math.max(cpuAnomaly, memAnomaly, diskAnomaly);

        const cpuForecast = linearRegressionForecast(cpuSeries, forecastHorizonMs);
        const memForecast = linearRegressionForecast(memSeries, forecastHorizonMs);
        const diskForecast = linearRegressionForecast(diskSeries, forecastHorizonMs);

        const breachFlags: string[] = [];
        if (cpuForecast !== null && cpuForecast >= 85) breachFlags.push('cpu');
        if (memForecast !== null && memForecast >= 90) breachFlags.push('memory');
        if (diskForecast !== null && diskForecast >= 90) breachFlags.push('disk');

        const downtimeMinutes = deviceIncidents
            .filter((incident: any) => String(incident.summary || '').toLowerCase().includes('offline'))
            .reduce((sum: number, incident: any) => {
                const start = new Date(incident.started_at).getTime();
                const end = incident.resolved_at ? new Date(incident.resolved_at).getTime() : now;
                return sum + Math.max(0, (end - start) / 60000);
            }, 0);

        const riskScore = Math.min(100, round(
            (deviceIncidents.length * 8)
            + (deviceAlerts.length * 1.8)
            + (downtimeMinutes * 0.2)
            + (anomalyScore * 8)
            + (breachFlags.length * 12),
            2
        ));

        return {
            device_id: did,
            name: device.name,
            status: device.status,
            incident_count: deviceIncidents.length,
            alert_count: deviceAlerts.length,
            downtime_minutes: round(downtimeMinutes),
            anomaly_score: round(anomalyScore),
            forecast_breaches: breachFlags,
            risk_score: riskScore,
            risk_band: getRiskBand(riskScore),
            top_issue_key: topIssue?.key || null,
            top_issue_label: topIssue?.label || null,
            issue_breakdown: issueBreakdown,
            recent_incidents: deviceIncidents
                .sort((a: any, b: any) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
                .slice(0, 5)
                .map((incident: any) => ({
                    id: String(incident._id),
                    summary: incident.summary,
                    severity: incident.severity,
                    status: incident.status,
                    started_at: incident.started_at,
                    resolved_at: incident.resolved_at,
                    issue: classifyIncident(incident),
                })),
        };
    }).sort((a, b) => b.risk_score - a.risk_score);

    const totalWindowMinutes = windowDays * 24 * 60;
    const fleetDowntimeMinutes = topOffenders.reduce((sum, item) => sum + item.downtime_minutes, 0);
    const fleetAvailability = devices.length > 0
        ? Math.max(0, 100 - ((fleetDowntimeMinutes / (devices.length * totalWindowMinutes)) * 100))
        : 100;

    const syntheticSummary = (() => {
        const rows = synthetics.map((check: any) => {
            const status = String(check.last_status || '').toLowerCase();
            const latency = Number(check.last_response_time_ms || 0);
            const maxLatency = Number(check.max_response_time_ms || 0);
            const slow = maxLatency > 0 && latency > maxLatency;
            const sslState = String(check.ssl_last_state || '').toLowerCase();
            const state = check.type === 'ssl'
                ? (sslState || 'ok')
                : (status === 'fail' ? 'down' : (slow ? 'degraded' : 'healthy'));
            return {
                id: String(check._id),
                name: check.name,
                type: check.type,
                target_kind: check.target_kind || 'website',
                url: check.url,
                state,
                latency_ms: latency || null,
            };
        });

        const down = rows.filter((row) => ['down', 'critical', 'expired', 'fail'].includes(row.state)).length;
        const degraded = rows.filter((row) => ['degraded', 'warning'].includes(row.state)).length;
        return {
            total: rows.length,
            down,
            degraded,
            healthy: Math.max(0, rows.length - down - degraded),
            top_risks: rows.filter((row) => row.state !== 'healthy' && row.state !== 'ok').slice(0, 10),
        };
    })();

    const licenseSummary = (() => {
        const rows = licenses.map((license: any) => {
            const daysLeft = Math.floor((new Date(license.renewal_date).getTime() - now) / daysToMs(1));
            const state = daysLeft < 0
                ? 'expired'
                : daysLeft <= Number(license.critical_days || 7)
                    ? 'critical'
                    : daysLeft <= Number(license.warning_days || 30)
                        ? 'warning'
                        : 'ok';
            return {
                id: String(license._id),
                name: license.name,
                days_left: daysLeft,
                state,
            };
        });

        return {
            total: rows.length,
            critical: rows.filter((row) => row.state === 'critical').length,
            warning: rows.filter((row) => row.state === 'warning').length,
            expired: rows.filter((row) => row.state === 'expired').length,
            top_risks: rows
                .filter((row) => row.state !== 'ok')
                .sort((a, b) => a.days_left - b.days_left)
                .slice(0, 10),
        };
    })();

    const forecastRows = topOffenders.slice(0, 20).map((offender) => {
        const rows = telemetryByDevice.get(offender.device_id) || [];
        const cpuSeries = extractSeries(rows, 'cpu_usage');
        const memSeries = extractSeries(rows, 'memory_usage');
        const diskSeries = extractSeries(rows, 'disk_usage');
        return {
            device_id: offender.device_id,
            name: offender.name,
            horizon_minutes: 60,
            cpu_forecast_pct: round(linearRegressionForecast(cpuSeries, forecastHorizonMs) || 0),
            memory_forecast_pct: round(linearRegressionForecast(memSeries, forecastHorizonMs) || 0),
            disk_forecast_pct: round(linearRegressionForecast(diskSeries, forecastHorizonMs) || 0),
            breach_flags: offender.forecast_breaches,
        };
    });

    const topForecastRisks = forecastRows
        .filter((row) => Array.isArray(row.breach_flags) && row.breach_flags.length > 0)
        .map((row) => {
            const serviceScores = [
                { service: 'cpu', value: row.cpu_forecast_pct, threshold: SERVICE_THRESHOLDS.cpu },
                { service: 'memory', value: row.memory_forecast_pct, threshold: SERVICE_THRESHOLDS.memory },
                { service: 'disk', value: row.disk_forecast_pct, threshold: SERVICE_THRESHOLDS.disk },
            ];
            const topService = serviceScores.sort((a, b) => (b.value - b.threshold) - (a.value - a.threshold))[0];
            return {
                ...row,
                top_service: topService.service,
                top_service_value: round(topService.value),
                top_service_threshold: topService.threshold,
                breach_gap: round(topService.value - topService.threshold),
            };
        })
        .sort((a, b) => b.breach_gap - a.breach_gap)
        .slice(0, 5);

    const recommendations: string[] = [];
    if (topOffenders.some((offender) => offender.forecast_breaches.includes('disk'))) {
        recommendations.push('Disk forecast breach detected: schedule cleanup/log rotation on high-risk nodes in next 1 hour.');
    }
    if (topOffenders.some((offender) => offender.forecast_breaches.includes('memory'))) {
        recommendations.push('Memory pressure forecast detected: verify leaks and set service memory limits/restart policies.');
    }
    if (syntheticSummary.down > 0) {
        recommendations.push('Web/API monitors are down: verify DNS, ingress, certificates, and upstream dependencies.');
    }
    if (licenseSummary.critical + licenseSummary.expired > 0) {
        recommendations.push('Critical/expired licenses present: prioritize renewals to avoid service disruption.');
    }
    if (recommendations.length === 0) {
        recommendations.push('No immediate high-risk forecast. Continue baseline monitoring and weekly reliability review.');
    }

    return {
        generated_at: new Date().toISOString(),
        window_days: windowDays,
        fleet_kpis: {
            devices_total: devices.length,
            incidents_total: incidents.length,
            incidents_open: openIncidents.length,
            incidents_critical: criticalIncidents.length,
            alerts_total: alerts.length,
            mttr_minutes: round(average(incidentDurationsMinutes)),
            availability_pct_estimate: round(fleetAvailability),
            notification_noise_ratio: round(alerts.length / Math.max(1, incidents.length), 2),
        },
        top_offenders: topOffenders.slice(0, 10),
        issue_hotspots: topIssueTypes,
        top_forecast_risks: topForecastRisks,
        synthetic_summary: syntheticSummary,
        license_summary: licenseSummary,
        recommendations,
    };
};

export const buildDeviceAnalytics = async (deviceId: string, windowDays = 7) => {
    const now = Date.now();
    const since = new Date(now - daysToMs(windowDays));
    const telemetryWindow = new Date(now - hoursToMs(24));
    const forecastHorizonMs = hoursToMs(1);

    const device = await Device.findOne({ device_id: deviceId }).select({ device_id: 1, name: 1, status: 1, type: 1, last_seen: 1 });
    if (!device) return null;

    const [incidents, alerts, telemetry] = await Promise.all([
        Incident.find({ target_type: 'device', target_id: deviceId, started_at: { $gte: since } }).select({
            severity: 1,
            status: 1,
            started_at: 1,
            resolved_at: 1,
            summary: 1,
        }),
        AlertTracking.find({ device_id: deviceId, first_triggered: { $gte: since } }).select({
            alert_type: 1,
            severity: 1,
            specific_service: 1,
            specific_endpoint: 1,
            first_triggered: 1,
            resolved_at: 1,
        }),
        Telemetry.find({ device_id: deviceId, timestamp: { $gte: telemetryWindow } }).select({
            timestamp: 1,
            cpu_usage: 1,
            memory_usage: 1,
            disk_usage: 1,
        }).sort({ timestamp: 1 }),
    ]);

    const cpuSeries = extractSeries(telemetry, 'cpu_usage');
    const memSeries = extractSeries(telemetry, 'memory_usage');
    const diskSeries = extractSeries(telemetry, 'disk_usage');

    const cpuForecast = linearRegressionForecast(cpuSeries, forecastHorizonMs);
    const memForecast = linearRegressionForecast(memSeries, forecastHorizonMs);
    const diskForecast = linearRegressionForecast(diskSeries, forecastHorizonMs);
    const anomalies = {
        cpu: round(buildAnomaly(cpuSeries).score),
        memory: round(buildAnomaly(memSeries).score),
        disk: round(buildAnomaly(diskSeries).score),
    };

    const serviceFrequency = alerts.reduce((acc: Record<string, number>, alert: any) => {
        const key = alert.specific_service || alert.alert_type || 'unknown';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});

    const issueFrequency = incidents.reduce((acc: Record<string, number>, incident: any) => {
        const issue = classifyIncident(incident);
        acc[issue.label] = (acc[issue.label] || 0) + 1;
        return acc;
    }, {});

    const topCauses = Object.entries(serviceFrequency)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([service, count]) => ({ service, count }));

    const breachFlags: string[] = [];
    if ((cpuForecast || 0) >= 85) breachFlags.push('cpu');
    if ((memForecast || 0) >= 90) breachFlags.push('memory');
    if ((diskForecast || 0) >= 90) breachFlags.push('disk');

    const riskScore = Math.min(100, round(
        incidents.length * 10
        + alerts.length * 2
        + Math.max(anomalies.cpu, anomalies.memory, anomalies.disk) * 8
        + breachFlags.length * 12
    ));

    const remediationHints: string[] = [];
    if (breachFlags.includes('cpu')) remediationHints.push('Investigate top CPU processes and review recent deploy/cron jobs.');
    if (breachFlags.includes('memory')) remediationHints.push('Capture memory profiles and evaluate restart policy/heap limits.');
    if (breachFlags.includes('disk')) remediationHints.push('Rotate logs, cleanup temp data, and validate retention policies.');
    if (topCauses.some((cause) => cause.service.includes('sip'))) remediationHints.push('Review SIP trunk/network path and registration expiry timers.');
    if (!remediationHints.length) remediationHints.push('No immediate forecast breach detected. Keep routine health checks.');

    return {
        generated_at: new Date().toISOString(),
        window_days: windowDays,
        device: {
            device_id: device.device_id,
            name: device.name,
            status: device.status,
            type: device.type,
            last_seen: device.last_seen,
        },
        reliability: {
            incidents_total: incidents.length,
            incidents_open: incidents.filter((incident: any) => incident.status === 'open').length,
            critical_incidents: incidents.filter((incident: any) => incident.severity === 'critical').length,
            alerts_total: alerts.length,
            top_causes: topCauses,
            top_issue_types: Object.entries(issueFrequency)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 8)
                .map(([issue, count]) => ({ issue, count })),
            recent_incidents: incidents
                .sort((a: any, b: any) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
                .slice(0, 10)
                .map((incident: any) => ({
                    id: String(incident._id),
                    summary: incident.summary,
                    severity: incident.severity,
                    status: incident.status,
                    started_at: incident.started_at,
                    resolved_at: incident.resolved_at,
                    issue: classifyIncident(incident),
                })),
        },
        forecast: {
            horizon_minutes: 60,
            cpu_forecast_pct: round(cpuForecast || 0),
            memory_forecast_pct: round(memForecast || 0),
            disk_forecast_pct: round(diskForecast || 0),
            breach_flags: breachFlags,
        },
        anomaly: {
            cpu_zscore: anomalies.cpu,
            memory_zscore: anomalies.memory,
            disk_zscore: anomalies.disk,
        },
        risk: {
            score: riskScore,
            band: getRiskBand(riskScore),
        },
        remediation_hints: remediationHints,
    };
};

const buildForecastForDevice = (device: any, telemetryRows: any[], service: 'cpu' | 'memory' | 'disk' | 'all') => {
    const horizonMinutes = 60;
    const horizonMs = hoursToMs(1);
    const cpuSeries = extractSeries(telemetryRows, 'cpu_usage');
    const memorySeries = extractSeries(telemetryRows, 'memory_usage');
    const diskSeries = extractSeries(telemetryRows, 'disk_usage');

    const cpuForecast = round(linearRegressionForecast(cpuSeries, horizonMs) || 0);
    const memoryForecast = round(linearRegressionForecast(memorySeries, horizonMs) || 0);
    const diskForecast = round(linearRegressionForecast(diskSeries, horizonMs) || 0);

    const breaches = [
        { service: 'cpu', value: cpuForecast, threshold: SERVICE_THRESHOLDS.cpu },
        { service: 'memory', value: memoryForecast, threshold: SERVICE_THRESHOLDS.memory },
        { service: 'disk', value: diskForecast, threshold: SERVICE_THRESHOLDS.disk },
    ].filter((entry) => entry.value >= entry.threshold);

    const filteredBreaches = service === 'all' ? breaches : breaches.filter((entry) => entry.service === service);
    const topBreach = filteredBreaches
        .sort((a, b) => (b.value - b.threshold) - (a.value - a.threshold))[0] || null;

    return {
        device_id: String(device.device_id),
        name: device.name,
        horizon_minutes: horizonMinutes,
        cpu_forecast_pct: cpuForecast,
        memory_forecast_pct: memoryForecast,
        disk_forecast_pct: diskForecast,
        breaches: filteredBreaches,
        top_breach: topBreach,
    };
};

export const buildForecastExplorer = async (params: {
    windowDays?: number;
    deviceId?: string;
    service?: 'cpu' | 'memory' | 'disk' | 'all';
}) => {
    const windowDays = Math.max(1, Math.min(30, Number(params.windowDays || 7)));
    const service = (params.service || 'all');
    const deviceId = params.deviceId ? String(params.deviceId) : '';
    const telemetrySince = new Date(Date.now() - hoursToMs(24));

    const deviceQuery: any = { monitoring_enabled: true };
    if (deviceId) deviceQuery.device_id = deviceId;
    const devices = await Device.find(deviceQuery).select({ device_id: 1, name: 1, status: 1 });
    const ids = devices.map((device: any) => String(device.device_id));

    const telemetryRows = await Telemetry.find({
        device_id: { $in: ids },
        timestamp: { $gte: telemetrySince },
    }).select({ device_id: 1, timestamp: 1, cpu_usage: 1, memory_usage: 1, disk_usage: 1 }).sort({ timestamp: 1 });

    const byDevice = new Map<string, any[]>();
    telemetryRows.forEach((row: any) => {
        const key = String(row.device_id);
        if (!byDevice.has(key)) byDevice.set(key, []);
        byDevice.get(key)!.push(row);
    });

    const rows = devices.map((device: any) => {
        const telemetry = byDevice.get(String(device.device_id)) || [];
        return buildForecastForDevice(device, telemetry, service as any);
    });

    const filteredRows = service === 'all'
        ? rows
        : rows.map((row) => ({
            ...row,
            breaches: row.breaches.filter((breach: any) => breach.service === service),
            top_breach: row.top_breach && row.top_breach.service === service ? row.top_breach : null,
        }));

    const sorted = filteredRows
        .sort((a: any, b: any) => {
            const aGap = a.top_breach ? (a.top_breach.value - a.top_breach.threshold) : -9999;
            const bGap = b.top_breach ? (b.top_breach.value - b.top_breach.threshold) : -9999;
            return bGap - aGap;
        });

    return {
        generated_at: new Date().toISOString(),
        window_days: windowDays,
        service,
        device_id: deviceId || null,
        rows: sorted,
    };
};

export const buildIssueDetail = async (params: {
    issueKey: string;
    windowDays?: number;
    deviceId?: string;
}) => {
    const issueKey = String(params.issueKey || '').trim().toLowerCase();
    if (!issueKey) return null;
    const windowDays = Math.max(1, Math.min(30, Number(params.windowDays || 7)));
    const since = new Date(Date.now() - daysToMs(windowDays));
    const deviceId = params.deviceId ? String(params.deviceId) : '';

    const query: any = {
        started_at: { $gte: since },
        target_type: 'device',
    };
    if (deviceId) query.target_id = deviceId;
    const incidents = await Incident.find(query).sort({ started_at: 1 });

    const filtered = incidents.filter((incident: any) => classifyIncident(incident).key === issueKey);
    const durationMinutes = filtered
        .filter((incident: any) => incident.resolved_at)
        .map((incident: any) => (new Date(incident.resolved_at).getTime() - new Date(incident.started_at).getTime()) / 60000)
        .filter((value: number) => Number.isFinite(value) && value >= 0);

    const dayBuckets = new Map<string, any>();
    filtered.forEach((incident: any) => {
        const day = formatDayKey(new Date(incident.started_at));
        const bucket = dayBuckets.get(day) || { day, mttr_values: [] as number[], started_at_values: [] as number[] };
        const started = new Date(incident.started_at).getTime();
        bucket.started_at_values.push(started);
        if (incident.resolved_at) {
            const duration = (new Date(incident.resolved_at).getTime() - started) / 60000;
            if (Number.isFinite(duration) && duration >= 0) bucket.mttr_values.push(duration);
        }
        dayBuckets.set(day, bucket);
    });

    const trend = Array.from(dayBuckets.values())
        .sort((a, b) => a.day.localeCompare(b.day))
        .map((bucket: any) => {
            const starts = bucket.started_at_values.sort((x: number, y: number) => x - y);
            const deltas: number[] = [];
            for (let i = 1; i < starts.length; i += 1) {
                deltas.push((starts[i] - starts[i - 1]) / 60000);
            }
            return {
                day: bucket.day,
                incidents: starts.length,
                mttr_minutes: round(average(bucket.mttr_values)),
                mtbf_minutes: round(average(deltas)),
            };
        });

    const affectedMap = new Map<string, any>();
    filtered.forEach((incident: any) => {
        const key = String(incident.target_id || 'unknown');
        const entry = affectedMap.get(key) || {
            device_id: key,
            target_name: incident.target_name || key,
            incident_count: 0,
            open_count: 0,
            total_downtime_minutes: 0,
        };
        entry.incident_count += 1;
        if (incident.status === 'open') entry.open_count += 1;
        const end = incident.resolved_at ? new Date(incident.resolved_at).getTime() : Date.now();
        const start = new Date(incident.started_at).getTime();
        entry.total_downtime_minutes += Math.max(0, (end - start) / 60000);
        affectedMap.set(key, entry);
    });
    const affectedDevices = Array.from(affectedMap.values())
        .map((row: any) => ({ ...row, total_downtime_minutes: round(row.total_downtime_minutes) }))
        .sort((a, b) => b.incident_count - a.incident_count);

    const issueLabel = filtered[0] ? classifyIncident(filtered[0]).label : issueKey;
    const remediationNotes = remediationLibrary[issueKey] || remediationLibrary.other_issue;

    return {
        generated_at: new Date().toISOString(),
        window_days: windowDays,
        issue_key: issueKey,
        issue_label: issueLabel,
        summary: {
            incidents_total: filtered.length,
            incidents_open: filtered.filter((incident: any) => incident.status === 'open').length,
            mttr_minutes: round(average(durationMinutes)),
            mtbf_minutes: round(average(
                filtered.length > 1
                    ? filtered.slice(1).map((incident: any, idx: number) => (
                        (new Date(incident.started_at).getTime() - new Date(filtered[idx].started_at).getTime()) / 60000
                    ))
                    : []
            )),
        },
        trend,
        affected_devices: affectedDevices,
        remediation_notes: remediationNotes,
        recent_incidents: filtered
            .slice()
            .sort((a: any, b: any) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
            .slice(0, 20)
            .map((incident: any) => ({
                id: String(incident._id),
                target_id: incident.target_id,
                target_name: incident.target_name,
                summary: incident.summary,
                severity: incident.severity,
                status: incident.status,
                started_at: incident.started_at,
                resolved_at: incident.resolved_at,
            })),
    };
};
