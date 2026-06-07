/**
 * AI-Powered Analytics Service
 *
 * Uses worker thread pool for CPU-intensive statistical analysis:
 * - Incident pattern detection
 * - Peak hours analysis
 * - Metric correlation
 * - Remediation suggestions
 */
import Incident from '../models/Incident';
import Device from '../models/Device';
import Telemetry from '../models/Telemetry';
import { getWorkerPool } from './workerPool';

const HOURS_TO_MS = (h: number) => h * 60 * 60 * 1000;

interface AnalyticsWindow {
    windowDays: number;
    since: Date;
}

function buildWindow(windowDays: number): AnalyticsWindow {
    return {
        windowDays,
        since: new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000),
    };
}

/* ─── Incident Patterns & Peak Hours ─── */
export async function getIncidentInsights(windowDays = 7, deviceId?: string) {
    const { since } = buildWindow(windowDays);
    const query: any = { started_at: { $gte: since } };
    if (deviceId) query.target_id = deviceId;

    const [incidents, metrics] = await Promise.all([
        Incident.find(query).sort({ started_at: -1 }).lean().limit(5000),
        deviceId
            ? Telemetry.find({ device_id: deviceId, timestamp: { $gte: since } })
                .select({ timestamp: 1, cpu_usage: 1 })
                .sort({ timestamp: 1 })
                .lean()
                .limit(20000)
            : Promise.resolve([]),
    ]);

    const pool = getWorkerPool();

    const [patterns, peakHours, remediations] = await Promise.all([
        pool.execute('incident_patterns', { incidents }),
        pool.execute('peak_hours', { incidents, metrics }),
        pool.execute('remediation_suggestions', { incidents }),
    ]);

    return {
        window_days: windowDays,
        total_incidents: incidents.length,
        patterns,
        peak_hours: peakHours,
        remediation_suggestions: remediations,
    };
}

/* ─── Device Health Forecast ─── */
export async function getDeviceForecast(deviceId: string, metricKey: 'cpu_usage' | 'memory_usage' | 'disk_usage', windowDays = 7) {
    const { since } = buildWindow(windowDays);

    const rows = await Telemetry.find({
        device_id: deviceId,
        timestamp: { $gte: since },
    })
        .select({ timestamp: 1, [metricKey]: 1 })
        .sort({ timestamp: 1 })
        .lean()
        .limit(10000);

    const series = rows
        .map((r: any) => ({
            t: new Date(r.timestamp).getTime(),
            v: Number(r[metricKey]),
        }))
        .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v));

    if (series.length < 6) {
        return { forecast: [], trend: 'insufficient_data', confidence: 0 };
    }

    // Downsample if too many points for the worker
    const sample = series.length > 5000 ? series.filter((_, i) => i % Math.ceil(series.length / 2000) === 0) : series;

    const pool = getWorkerPool();
    const result = await pool.execute('metric_forecast', { series: sample, horizon: 12 });

    return {
        metric: metricKey,
        historical_points: series.length,
        ...result,
    };
}

/* ─── Cross-Metric Correlation ─── */
export async function getMetricCorrelation(deviceId: string, metricA: string, metricB: string, windowDays = 7) {
    const { since } = buildWindow(windowDays);

    const rows = await Telemetry.find({
        device_id: deviceId,
        timestamp: { $gte: since },
    })
        .select({ timestamp: 1, [metricA]: 1, [metricB]: 1 })
        .sort({ timestamp: 1 })
        .lean()
        .limit(10000);

    const seriesA = rows.map((r: any) => Number(r[metricA])).filter((v: number) => Number.isFinite(v));
    const seriesB = rows.map((r: any) => Number(r[metricB])).filter((v: number) => Number.isFinite(v));

    if (seriesA.length < 3 || seriesB.length < 3) {
        return { correlation: 0, strength: 'none', sample_size: 0 };
    }

    const pool = getWorkerPool();
    return pool.execute('correlation', { seriesA, seriesB });
}

/* ─── AI Overview (combined for dashboard) ─── */
export async function getAIOverview(windowDays = 7) {
    const { since } = buildWindow(windowDays);

    const [incidentCount, unresolvedCount, deviceCount] = await Promise.all([
        Incident.countDocuments({ started_at: { $gte: since } }),
        Incident.countDocuments({ started_at: { $gte: since }, status: { $ne: 'resolved' } }),
        Device.countDocuments({ status: 'online' }),
    ]);

    // Run heavy analysis in worker
    const incidents = await Incident.find({ started_at: { $gte: since } })
        .sort({ started_at: -1 })
        .lean()
        .limit(2000);

    const pool = getWorkerPool();
    const patterns = await pool.execute('incident_patterns', { incidents });

    const topIssueType = patterns.patterns?.[0]?.type || 'none';
    const topDevice = patterns.top_problematic_devices?.[0]?.device_id || 'none';

    const device = topDevice !== 'none' ? await Device.findOne({ device_id: topDevice }).select({ name: 1 }).lean() : null;

    return {
        window_days: windowDays,
        incident_count: incidentCount,
        unresolved_count: unresolvedCount,
        online_devices: deviceCount,
        top_issue_type: topIssueType,
        most_problematic_device: {
            device_id: topDevice,
            name: device?.name || topDevice,
            incident_count: patterns.top_problematic_devices?.[0]?.total_incidents || 0,
        },
        patterns: patterns.patterns?.slice(0, 5) || [],
        peak_hours: await pool.execute('peak_hours', { incidents, metrics: [] }),
    };
}
