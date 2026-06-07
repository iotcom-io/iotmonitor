/**
 * Analytics Worker — runs CPU-heavy analysis off the main thread.
 * Accepts task descriptions via parentPort messages and returns results.
 */
import { parentPort } from 'worker_threads';

interface TaskMessage {
    id: string;
    type: 'incident_patterns' | 'peak_hours' | 'metric_forecast' | 'correlation' | 'remediation_suggestions';
    payload: any;
}

interface ResultMessage {
    id: string;
    result: any;
    error?: string;
}

const round = (v: number, d = 2) => Math.round(v * Math.pow(10, d)) / Math.pow(10, d);

const average = (values: number[]) => {
    if (!values.length) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
};

const stdDev = (values: number[]) => {
    if (values.length < 2) return 0;
    const mean = average(values);
    return Math.sqrt(average(values.map((v) => Math.pow(v - mean, 2))));
};

/* ─── Incident Pattern Analysis ─── */
function analyzeIncidentPatterns(incidents: any[]) {
    const patterns: Record<string, { count: number; devices: Set<string>; peakHours: number[] }> = {};
    const devicePatterns: Record<string, { count: number; types: Record<string, number> }> = {};

    for (const incident of incidents) {
        const type = incident.severity || incident.alert_type || 'unknown';
        const deviceId = incident.target_id || 'unknown';
        const hour = new Date(incident.started_at).getHours();

        if (!patterns[type]) patterns[type] = { count: 0, devices: new Set(), peakHours: [] };
        patterns[type].count++;
        patterns[type].devices.add(deviceId);
        patterns[type].peakHours.push(hour);

        if (!devicePatterns[deviceId]) devicePatterns[deviceId] = { count: 0, types: {} };
        devicePatterns[deviceId].count++;
        devicePatterns[deviceId].types[type] = (devicePatterns[deviceId].types[type] || 0) + 1;
    }

    // Peak hours analysis per pattern
    const resultPatterns = Object.entries(patterns).map(([type, data]) => {
        const hourCounts = new Array(24).fill(0);
        for (const h of data.peakHours) hourCounts[h]++;
        const maxCount = Math.max(...hourCounts);
        const peakHours = hourCounts
            .map((count, hour) => ({ hour, count }))
            .filter((h) => h.count > 0)
            .sort((a, b) => b.count - a.count)
            .slice(0, 3)
            .map((h) => h.hour);

        return {
            type,
            total_occurrences: data.count,
            affected_devices: data.devices.size,
            peak_hours: peakHours,
            peak_hour_labels: peakHours.map((h) => `${h.toString().padStart(2, '0')}:00`),
        };
    });

    // Top problematic devices
    const topDevices = Object.entries(devicePatterns)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 10)
        .map(([deviceId, data]) => ({
            device_id: deviceId,
            total_incidents: data.count,
            dominant_issue: Object.entries(data.types).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown',
        }));

    return {
        total_incidents: incidents.length,
        patterns: resultPatterns,
        top_problematic_devices: topDevices,
    };
}

/* ─── Peak Hours Analysis ─── */
function analyzePeakHours(incidents: any[], metrics: any[]) {
    const hourlyIncidents = new Array(24).fill(0);
    const hourlyMetrics = new Array(24).fill(0).map(() => [] as number[]);

    for (const inc of incidents) {
        const hour = new Date(inc.started_at).getHours();
        hourlyIncidents[hour]++;
    }

    for (const m of metrics) {
        const hour = new Date(m.timestamp || m.t).getHours();
        const val = m.cpu_usage ?? m.v ?? 0;
        if (typeof val === 'number' && !Number.isNaN(val)) {
            hourlyMetrics[hour].push(val);
        }
    }

    const incidentPeak = hourlyIncidents
        .map((count, hour) => ({ hour, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    const metricPeaks = hourlyMetrics
        .map((vals, hour) => {
            const avg = vals.length ? average(vals) : 0;
            return { hour, avg_cpu: round(avg, 1), sample_count: vals.length };
        })
        .filter((h) => h.sample_count > 0)
        .sort((a, b) => b.avg_cpu - a.avg_cpu)
        .slice(0, 5);

    return {
        incident_peak_hours: incidentPeak.map((p) => ({
            hour: p.hour,
            label: `${p.hour.toString().padStart(2, '0')}:00`,
            count: p.count,
        })),
        metric_peak_hours: metricPeaks.map((p) => ({
            hour: p.hour,
            label: `${p.hour.toString().padStart(2, '0')}:00`,
            avg_cpu: p.avg_cpu,
        })),
    };
}

/* ─── Metric Forecast (Linear Regression) ─── */
function forecastMetrics(series: { t: number; v: number }[], horizonPoints: number) {
    if (series.length < 3) return { forecast: [], trend: 'insufficient_data' };

    const xs = series.map((p, i) => i);
    const ys = series.map((p) => p.v);
    const xMean = average(xs);
    const yMean = average(ys);

    let num = 0;
    let den = 0;
    for (let i = 0; i < xs.length; i++) {
        num += (xs[i] - xMean) * (ys[i] - yMean);
        den += Math.pow(xs[i] - xMean, 2);
    }
    if (!den) return { forecast: [], trend: 'flat' };

    const slope = num / den;
    const intercept = yMean - slope * xMean;
    const lastT = series[series.length - 1].t;
    const interval = series.length > 1
        ? (series[series.length - 1].t - series[0].t) / (series.length - 1)
        : 60000;

    const forecast = [];
    for (let i = 1; i <= horizonPoints; i++) {
        const x = xs[xs.length - 1] + i;
        const y = intercept + slope * x;
        forecast.push({
            timestamp: lastT + interval * i,
            value: round(Math.max(0, y), 2),
        });
    }

    return {
        trend: slope > 0.001 ? 'increasing' : slope < -0.001 ? 'decreasing' : 'stable',
        slope: round(slope, 4),
        forecast,
    };
}

/* ─── Correlation Analysis ─── */
function analyzeCorrelation(seriesA: number[], seriesB: number[]) {
    const n = Math.min(seriesA.length, seriesB.length);
    if (n < 3) return { correlation: 0, strength: 'none' };

    const aSlice = seriesA.slice(-n);
    const bSlice = seriesB.slice(-n);
    const meanA = average(aSlice);
    const meanB = average(bSlice);

    let num = 0;
    let denA = 0;
    let denB = 0;
    for (let i = 0; i < n; i++) {
        const da = aSlice[i] - meanA;
        const db = bSlice[i] - meanB;
        num += da * db;
        denA += da * da;
        denB += db * db;
    }

    const corr = denA && denB ? num / Math.sqrt(denA * denB) : 0;
    const absCorr = Math.abs(corr);
    const strength = absCorr > 0.7 ? 'strong' : absCorr > 0.4 ? 'moderate' : 'weak';

    return { correlation: round(corr, 3), strength };
}

/* ─── Remediation Suggestions ─── */
function suggestRemediations(incidents: any[]) {
    const resolutionMap: Record<string, { resolved: number; unresolved: number; avg_resolution_minutes: number[] }> = {};

    for (const inc of incidents) {
        const type = inc.alert_type || inc.severity || 'unknown';
        if (!resolutionMap[type]) {
            resolutionMap[type] = { resolved: 0, unresolved: 0, avg_resolution_minutes: [] };
        }
        if (inc.resolved_at && inc.started_at) {
            resolutionMap[type].resolved++;
            const mins = (new Date(inc.resolved_at).getTime() - new Date(inc.started_at).getTime()) / 60000;
            resolutionMap[type].avg_resolution_minutes.push(mins);
        } else {
            resolutionMap[type].unresolved++;
        }
    }

    const suggestions = Object.entries(resolutionMap).map(([type, data]) => {
        const avgMins = data.avg_resolution_minutes.length
            ? round(average(data.avg_resolution_minutes), 1)
            : null;
        const unresolvedRate = data.resolved + data.unresolved > 0
            ? round(data.unresolved / (data.resolved + data.unresolved), 2)
            : 0;

        // Generate contextual suggestions
        const tips: string[] = [];
        if (type === 'offline' || type === 'device_offline') {
            tips.push('Check network stability and power supply at affected locations');
            tips.push('Consider redundant connectivity (dual WAN / failover)');
        }
        if (type === 'threshold' || type === 'rule_violation') {
            tips.push('Review threshold baselines against historical averages');
            tips.push('Investigate scheduled jobs that coincide with breach windows');
        }
        if (type === 'service_down') {
            tips.push('Add service dependency health checks upstream');
            tips.push('Configure automatic restart policies with backoff');
        }
        if (type === 'sip_issue') {
            tips.push('Validate SIP provider SLA and regional outage history');
            tips.push('Monitor jitter and packet loss during peak call hours');
        }
        if (unresolvedRate > 0.3) {
            tips.push('High unresolved rate detected — review escalation policies and on-call coverage');
        }
        if (avgMins && avgMins > 60) {
            tips.push('Average resolution time exceeds 1 hour — consider automated remediation runbooks');
        }

        return {
            issue_type: type,
            total_occurrences: data.resolved + data.unresolved,
            resolved_count: data.resolved,
            unresolved_count: data.unresolved,
            avg_resolution_minutes: avgMins,
            unresolved_rate: unresolvedRate,
            suggestions: tips,
        };
    });

    return suggestions.sort((a, b) => b.total_occurrences - a.total_occurrences);
}

/* ─── Message Handler ─── */
if (parentPort) {
    parentPort.on('message', (task: TaskMessage) => {
        try {
            let result: any;
            switch (task.type) {
                case 'incident_patterns':
                    result = analyzeIncidentPatterns(task.payload.incidents || []);
                    break;
                case 'peak_hours':
                    result = analyzePeakHours(
                        task.payload.incidents || [],
                        task.payload.metrics || []
                    );
                    break;
                case 'metric_forecast':
                    result = forecastMetrics(task.payload.series || [], task.payload.horizon || 12);
                    break;
                case 'correlation':
                    result = analyzeCorrelation(task.payload.seriesA || [], task.payload.seriesB || []);
                    break;
                case 'remediation_suggestions':
                    result = suggestRemediations(task.payload.incidents || []);
                    break;
                default:
                    result = { error: 'Unknown task type: ' + task.type };
            }
            parentPort!.postMessage({ id: task.id, result } as ResultMessage);
        } catch (err: any) {
            parentPort!.postMessage({ id: task.id, result: null, error: err.message } as ResultMessage);
        }
    });
}
