import { Router } from 'express';
import { authenticate, authorizePermission, AuthRequest } from '../middleware/auth';
import MonitoringCheck from '../models/MonitoringCheck';
import Device from '../models/Device';
import { resolveAlert } from '../services/notificationThrottling';
import { canAccessDevice, hasPermission } from '../lib/rbac';

const router = Router();
const MODULES = ['system', 'docker', 'asterisk', 'network'] as const;
type ModuleName = typeof MODULES[number];
const CHECK_MODULE_MAP: Record<string, ModuleName | null> = {
    cpu: 'system',
    memory: 'system',
    disk: 'system',
    bandwidth: 'network',
    utilization: 'network',
    sip_rtt: 'asterisk',
    sip_registration: 'asterisk',
    sip: 'asterisk',
    container_status: 'docker',
    custom: null,
};

const getEnabledModules = (device: any): ModuleName[] => {
    const modulesConfig = device?.config?.modules;
    if (modulesConfig && typeof modulesConfig === 'object') {
        return MODULES.filter((module) => modulesConfig[module] === true);
    }
    if (Array.isArray(device?.enabled_modules) && device.enabled_modules.length > 0) {
        return device.enabled_modules.filter((m: string) => MODULES.includes(m as ModuleName));
    }
    return ['system'];
};

const isCheckAllowedForDevice = (device: any, checkType: string) => {
    const requiredModule = CHECK_MODULE_MAP[checkType] ?? null;
    if (!requiredModule) return true;
    const enabledModules = getEnabledModules(device);
    return enabledModules.includes(requiredModule);
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_RAW_RANGE_MS = 2 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_POINTS = 1200;
const MAX_MAX_POINTS = 5000;
const DEFAULT_RANGE_LIMIT = 60000;
const MAX_RANGE_LIMIT = 250000;

type BucketOption = 'auto' | 'raw' | '1m' | '5m' | '15m' | '1h' | '6h' | '1d';

const VALID_BUCKETS: BucketOption[] = ['auto', 'raw', '1m', '5m', '15m', '1h', '6h', '1d'];

const BUCKET_DURATION_MS: Record<Exclude<BucketOption, 'auto'>, number> = {
    raw: 0,
    '1m': 60 * 1000,
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
};

const AGG_BUCKET_SPECS: Record<Exclude<BucketOption, 'auto' | 'raw'>, { unit: 'minute' | 'hour' | 'day'; binSize: number }> = {
    '1m': { unit: 'minute', binSize: 1 },
    '5m': { unit: 'minute', binSize: 5 },
    '15m': { unit: 'minute', binSize: 15 },
    '1h': { unit: 'hour', binSize: 1 },
    '6h': { unit: 'hour', binSize: 6 },
    '1d': { unit: 'day', binSize: 1 },
};

const parseDateQuery = (rawValue: unknown): Date | null => {
    if (!rawValue) return null;
    const parsed = new Date(String(rawValue));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parseBucketQuery = (rawValue: unknown): BucketOption => {
    if (!rawValue) return 'auto';
    const normalized = String(rawValue).trim().toLowerCase() as BucketOption;
    if (!VALID_BUCKETS.includes(normalized)) {
        throw new Error(`Invalid bucket '${rawValue}'. Valid options: ${VALID_BUCKETS.join(', ')}`);
    }
    return normalized;
};

const chooseAutoBucket = (rangeMs: number, maxPoints: number): Exclude<BucketOption, 'auto'> => {
    let choice: Exclude<BucketOption, 'auto'> = 'raw';

    if (rangeMs > 6 * 60 * 60 * 1000 && rangeMs <= 24 * 60 * 60 * 1000) choice = '1m';
    else if (rangeMs > 24 * 60 * 60 * 1000 && rangeMs <= 3 * 24 * 60 * 60 * 1000) choice = '5m';
    else if (rangeMs > 3 * 24 * 60 * 60 * 1000 && rangeMs <= 7 * 24 * 60 * 60 * 1000) choice = '15m';
    else if (rangeMs > 7 * 24 * 60 * 60 * 1000 && rangeMs <= 30 * 24 * 60 * 60 * 1000) choice = '1h';
    else if (rangeMs > 30 * 24 * 60 * 60 * 1000 && rangeMs <= 90 * 24 * 60 * 60 * 1000) choice = '6h';
    else if (rangeMs > 90 * 24 * 60 * 60 * 1000) choice = '1d';

    const order: Exclude<BucketOption, 'auto'>[] = ['raw', '1m', '5m', '15m', '1h', '6h', '1d'];
    let idx = order.indexOf(choice);
    while (idx < order.length - 1) {
        const candidate = order[idx];
        const estimatedPoints = candidate === 'raw'
            ? Math.ceil(rangeMs / 10000) // Typical 10s agent interval estimate
            : Math.ceil(rangeMs / BUCKET_DURATION_MS[candidate]);
        if (estimatedPoints <= maxPoints) break;
        idx += 1;
    }
    return order[idx];
};

const resolveBucket = (requested: BucketOption, rangeMs: number, maxPoints: number): Exclude<BucketOption, 'auto'> => {
    if (requested === 'auto') {
        return chooseAutoBucket(rangeMs, maxPoints);
    }
    return requested;
};

const downsampleMetrics = <T,>(rows: T[], maxPoints: number) => {
    if (rows.length <= maxPoints) return rows;
    const stride = Math.ceil(rows.length / maxPoints);
    const sampled: T[] = [];

    for (let index = 0; index < rows.length; index += stride) {
        sampled.push(rows[index]);
    }

    const last = rows[rows.length - 1];
    if (sampled[sampled.length - 1] !== last) {
        sampled.push(last);
    }

    return sampled;
};

const toNumberExpr = (input: any, nullable = false) => ({
    $convert: {
        input,
        to: 'double',
        onError: nullable ? null : 0,
        onNull: nullable ? null : 0,
    },
});

const buildBandwidthExpr = () => ({
    $let: {
        vars: {
            interfaces: {
                $filter: {
                    input: { $ifNull: ['$extra.interfaces', []] },
                    as: 'iface',
                    cond: {
                        $and: [
                            { $ne: [{ $toLower: { $ifNull: ['$$iface.name', ''] } }, 'lo'] },
                            { $not: [{ $regexMatch: { input: { $toLower: { $ifNull: ['$$iface.name', ''] } }, regex: '^loopback' } }] },
                        ],
                    },
                },
            },
            networkIn: toNumberExpr('$network_in', true),
            networkOut: toNumberExpr('$network_out', true),
        },
        in: {
            $let: {
                vars: {
                    ifaceTraffic: {
                        $sum: {
                            $map: {
                                input: '$$interfaces',
                                as: 'iface',
                                in: {
                                    $add: [
                                        toNumberExpr('$$iface.rx_bps'),
                                        toNumberExpr('$$iface.tx_bps'),
                                    ],
                                },
                            },
                        },
                    },
                    fallbackTraffic: {
                        $cond: [
                            {
                                $or: [
                                    { $ne: ['$$networkIn', null] },
                                    { $ne: ['$$networkOut', null] },
                                ],
                            },
                            {
                                $add: [
                                    { $ifNull: ['$$networkIn', 0] },
                                    { $ifNull: ['$$networkOut', 0] },
                                ],
                            },
                            null,
                        ],
                    },
                },
                in: {
                    $let: {
                        vars: {
                            trafficBps: {
                                $cond: [
                                    { $gt: ['$$ifaceTraffic', 0] },
                                    '$$ifaceTraffic',
                                    '$$fallbackTraffic',
                                ],
                            },
                        },
                        in: {
                            $cond: [
                                { $ne: ['$$trafficBps', null] },
                                { $divide: ['$$trafficBps', 1000000] },
                                null,
                            ],
                        },
                    },
                },
            },
        },
    },
});

const buildSipRttExpr = () => ({
    $let: {
        vars: {
            contacts: { $ifNull: ['$extra.contacts', []] },
        },
        in: {
            $let: {
                vars: {
                    rtts: {
                        $filter: {
                            input: {
                                $map: {
                                    input: '$$contacts',
                                    as: 'contact',
                                    in: toNumberExpr('$$contact.rttMs', true),
                                },
                            },
                            as: 'latency',
                            cond: { $ne: ['$$latency', null] },
                        },
                    },
                },
                in: {
                    $cond: [
                        { $gt: [{ $size: '$$rtts' }, 0] },
                        { $avg: '$$rtts' },
                        null,
                    ],
                },
            },
        },
    },
});

const buildSipRegistrationExpr = () => ({
    $let: {
        vars: {
            total: toNumberExpr('$extra.summary.registrationsTotal', true),
            registered: toNumberExpr('$extra.summary.registrationsRegistered', true),
            registrations: { $ifNull: ['$extra.registrations', []] },
        },
        in: {
            $cond: [
                {
                    $and: [
                        { $ne: ['$$total', null] },
                        { $ne: ['$$registered', null] },
                        { $gt: ['$$total', 0] },
                    ],
                },
                {
                    $multiply: [
                        { $divide: ['$$registered', '$$total'] },
                        100,
                    ],
                },
                {
                    $cond: [
                        { $gt: [{ $size: '$$registrations' }, 0] },
                        {
                            $multiply: [
                                {
                                    $divide: [
                                        {
                                            $size: {
                                                $filter: {
                                                    input: '$$registrations',
                                                    as: 'reg',
                                                    cond: {
                                                        $in: [
                                                            { $toLower: { $ifNull: ['$$reg.status', ''] } },
                                                            ['registered', 'ok'],
                                                        ],
                                                    },
                                                },
                                            },
                                        },
                                        { $size: '$$registrations' },
                                    ],
                                },
                                100,
                            ],
                        },
                        null,
                    ],
                },
            ],
        },
    },
});

const buildEndpointLabelExpr = (input: any) => ({
    $let: {
        vars: {
            rawValue: {
                $trim: {
                    input: {
                        $toString: {
                            $ifNull: [input, ''],
                        },
                    },
                },
            },
        },
        in: {
            $cond: [
                { $gt: [{ $strLenCP: '$$rawValue' }, 0] },
                {
                    $let: {
                        vars: {
                            parts: { $split: ['$$rawValue', '@'] },
                        },
                        in: {
                            $trim: {
                                input: {
                                    $cond: [
                                        { $gt: [{ $size: '$$parts' }, 1] },
                                        { $arrayElemAt: ['$$parts', 1] },
                                        { $arrayElemAt: ['$$parts', 0] },
                                    ],
                                },
                            },
                        },
                    },
                },
                null,
            ],
        },
    },
});

const buildSipRttEndpointsExpr = () => ({
    $filter: {
        input: {
            $map: {
                input: { $ifNull: ['$extra.contacts', []] },
                as: 'contact',
                in: {
                    endpoint: buildEndpointLabelExpr({
                        $ifNull: ['$$contact.aor', { $ifNull: ['$$contact.endpoint', '$$contact.name'] }],
                    }),
                    value: toNumberExpr({ $ifNull: ['$$contact.rttMs', '$$contact.latency_ms'] }, true),
                },
            },
        },
        as: 'entry',
        cond: {
            $and: [
                { $ne: ['$$entry.endpoint', null] },
                { $ne: ['$$entry.endpoint', ''] },
            ],
        },
    },
});

const buildSipRegistrationEndpointsExpr = () => ({
    $filter: {
        input: {
            $map: {
                input: { $ifNull: ['$extra.registrations', []] },
                as: 'registration',
                in: {
                    endpoint: buildEndpointLabelExpr({
                        $ifNull: ['$$registration.name', { $ifNull: ['$$registration.endpoint', '$$registration.serverUri'] }],
                    }),
                    value: {
                        $cond: [
                            {
                                $in: [
                                    { $toLower: { $ifNull: ['$$registration.status', ''] } },
                                    ['registered', 'ok'],
                                ],
                            },
                            100,
                            0,
                        ],
                    },
                },
            },
        },
        as: 'entry',
        cond: {
            $and: [
                { $ne: ['$$entry.endpoint', null] },
                { $ne: ['$$entry.endpoint', ''] },
            ],
        },
    },
});

const toNumber = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const applyModuleFilter = (row: any, enabledModules: Set<ModuleName>) => {
    const normalized = { ...row };
    if (!enabledModules.has('system')) {
        normalized.cpu_usage = null;
        normalized.memory_usage = null;
        normalized.disk_usage = null;
    }
    if (!enabledModules.has('network')) {
        normalized.bandwidth_mbps = null;
    }
    if (!enabledModules.has('asterisk')) {
        normalized.sip_rtt_avg_ms = null;
        normalized.sip_registration_percent = null;
        normalized.sip_rtt_endpoints = [];
        normalized.sip_registration_endpoints = [];
    }
    return normalized;
};

const csvEscape = (value: unknown) => {
    if (value === null || value === undefined) return '';
    const asString = String(value);
    if (/[",\n]/.test(asString)) {
        return `"${asString.replace(/"/g, '""')}"`;
    }
    return asString;
};

type HistoryQueryOptions = {
    from: Date;
    to: Date;
    maxPoints: number;
    limit: number;
    bucket: Exclude<BucketOption, 'auto'>;
};

const parseHistoryQuery = (req: AuthRequest): HistoryQueryOptions => {
    const fromQuery = parseDateQuery(req.query.from);
    const toQuery = parseDateQuery(req.query.to);

    if ((req.query.from && !fromQuery) || (req.query.to && !toQuery)) {
        throw new Error('Invalid date range. Use ISO date values for from/to.');
    }

    const effectiveTo = toQuery || new Date();
    const effectiveFrom = fromQuery || new Date(effectiveTo.getTime() - DEFAULT_LOOKBACK_MS);
    if (effectiveFrom > effectiveTo) {
        throw new Error('`from` date must be before `to` date.');
    }

    const rangeMs = effectiveTo.getTime() - effectiveFrom.getTime();
    if (rangeMs > MAX_RANGE_MS) {
        throw new Error('Date range is too large. Reduce range to 90 days or less.');
    }

    const requestedMaxPoints = Number(req.query.max_points);
    const maxPoints = Number.isFinite(requestedMaxPoints)
        ? clamp(Math.floor(requestedMaxPoints), 100, MAX_MAX_POINTS)
        : DEFAULT_MAX_POINTS;

    const requestedLimit = Number(req.query.limit);
    const limit = Number.isFinite(requestedLimit)
        ? clamp(Math.floor(requestedLimit), 100, MAX_RANGE_LIMIT)
        : DEFAULT_RANGE_LIMIT;

    const requestedBucket = parseBucketQuery(req.query.bucket);
    const bucket = resolveBucket(requestedBucket, rangeMs, maxPoints);

    if (bucket === 'raw' && rangeMs > MAX_RAW_RANGE_MS) {
        throw new Error('Raw bucket supports up to 48 hours. Pick a larger bucket (1m/5m/15m/1h...) for longer ranges.');
    }

    return {
        from: effectiveFrom,
        to: effectiveTo,
        maxPoints,
        limit,
        bucket,
    };
};

const buildMatchStage = (deviceId: string, from: Date, to: Date) => ({
    device_id: deviceId,
    timestamp: {
        $gte: from,
        $lte: to,
    },
});

const normalizeEndpoint = (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    if (raw.includes('@')) {
        const parts = raw.split('@').map((part) => part.trim()).filter(Boolean);
        if (parts.length > 1) return parts[1];
    }
    return raw;
};

const registrationStatusPercent = (status: unknown): number | null => {
    const normalized = String(status || '').toLowerCase().trim();
    if (!normalized) return null;
    if (normalized === 'registered' || normalized === 'ok') return 100;
    return 0;
};

const buildRawHistoryRows = (metrics: any[]) => {
    return metrics.map((metric) => {
        const interfaces = Array.isArray(metric?.extra?.interfaces) ? metric.extra.interfaces : [];
        const interfaceTraffic = interfaces
            .filter((iface: any) => {
                const name = String(iface?.name || '').toLowerCase();
                return name && name !== 'lo' && !name.startsWith('loopback');
            })
            .reduce((sum: number, iface: any) => sum + (toNumber(iface?.rx_bps) || 0) + (toNumber(iface?.tx_bps) || 0), 0);

        const fallbackTraffic = (toNumber(metric?.network_in) || 0) + (toNumber(metric?.network_out) || 0);
        const bandwidthBps = interfaceTraffic > 0 ? interfaceTraffic : (fallbackTraffic > 0 ? fallbackTraffic : null);

        const contacts = Array.isArray(metric?.extra?.contacts) ? metric.extra.contacts : [];
        const rttValues = contacts
            .map((contact: any) => toNumber(contact?.rttMs))
            .filter((value: number | null): value is number => value !== null);
        const sipRttAvg = rttValues.length > 0
            ? rttValues.reduce((sum: number, value: number) => sum + value, 0) / rttValues.length
            : null;

        const summaryTotal = toNumber(metric?.extra?.summary?.registrationsTotal);
        const summaryRegistered = toNumber(metric?.extra?.summary?.registrationsRegistered);
        const registrations = Array.isArray(metric?.extra?.registrations) ? metric.extra.registrations : [];
        let registrationPct: number | null = null;
        if (summaryTotal && summaryTotal > 0 && summaryRegistered !== null) {
            registrationPct = (summaryRegistered / summaryTotal) * 100;
        } else if (registrations.length > 0) {
            const registeredCount = registrations.filter((registration: any) => {
                const status = String(registration?.status || '').toLowerCase();
                return status === 'registered' || status === 'ok';
            }).length;
            registrationPct = (registeredCount / registrations.length) * 100;
        }

        const sipRttEndpoints = contacts.map((contact: any) => {
            const endpoint = normalizeEndpoint(contact?.aor || contact?.endpoint || contact?.name);
            if (!endpoint) return null;
            return {
                endpoint,
                value: toNumber(contact?.rttMs ?? contact?.latency_ms),
            };
        }).filter((entry: any) => entry && entry.endpoint);

        const sipRegistrationEndpoints = registrations.map((registration: any) => {
            const endpoint = normalizeEndpoint(registration?.name || registration?.endpoint || registration?.serverUri);
            if (!endpoint) return null;
            return {
                endpoint,
                value: registrationStatusPercent(registration?.status),
            };
        }).filter((entry: any) => entry && entry.endpoint);

        return {
            timestamp: metric.timestamp,
            cpu_usage: toNumber(metric.cpu_usage),
            memory_usage: toNumber(metric.memory_usage),
            disk_usage: toNumber(metric.disk_usage),
            bandwidth_mbps: bandwidthBps !== null ? bandwidthBps / 1000000 : null,
            sip_rtt_avg_ms: sipRttAvg,
            sip_registration_percent: registrationPct,
            sip_rtt_endpoints: sipRttEndpoints,
            sip_registration_endpoints: sipRegistrationEndpoints,
            point_count: 1,
        };
    });
};

const normalizeAssignedUserIds = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(
        value
            .map((entry) => String(entry || '').trim())
            .filter(Boolean)
    ));
};

const canAccessMonitoringCheck = (user: AuthRequest['user'], check: any) => {
    if (!user) return false;
    if (user.role === 'admin') return true;

    const assigned = normalizeAssignedUserIds(check?.assigned_user_ids);
    if (assigned.length === 0) return true;
    return assigned.includes(user.id);
};

router.use(authenticate);

// Get metrics (telemetry history) for a device
router.get('/metrics/:deviceId', authorizePermission('monitoring.view'), async (req: AuthRequest, res) => {
    try {
        const deviceId = String(req.params.deviceId);
        const device = await Device.findOne({ device_id: deviceId });
        if (!device) return res.status(404).json({ message: 'Device not found' });
        if (!canAccessDevice(req.user, device)) {
            return res.status(403).json({ message: 'Access denied for this device' });
        }
        const hasRangeQuery = Boolean(req.query.from || req.query.to || req.query.bucket);
        const enabledModules = new Set(getEnabledModules(device));

        // Keep real-time panels blank when paused, but allow historical range queries.
        if (device.monitoring_paused && !hasRangeQuery) {
            return res.json([]);
        }

        const Telemetry = (await import('../models/Telemetry')).default;

        if (!hasRangeQuery) {
            const requestedLimit = Number(req.query.limit);
            const realtimeLimit = Number.isFinite(requestedLimit)
                ? clamp(Math.floor(requestedLimit), 1, 500)
                : 50;

            const metrics = await Telemetry.find({ device_id: deviceId })
                .sort({ timestamp: -1 })
                .limit(realtimeLimit)
                .lean();

            // Return in chronological order for charts
            return res.json(metrics.reverse());
        }

        let options: HistoryQueryOptions;
        try {
            options = parseHistoryQuery(req);
        } catch (parseErr: any) {
            return res.status(400).json({ message: parseErr.message });
        }

        const match = buildMatchStage(deviceId, options.from, options.to);

        if (options.bucket === 'raw') {
            const metrics = await Telemetry.find(match)
                .sort({ timestamp: 1 })
                .limit(options.limit)
                .lean();

            const rawRows = buildRawHistoryRows(metrics);
            const sampledRows = downsampleMetrics(rawRows, options.maxPoints)
                .map((row) => applyModuleFilter(row, enabledModules));

            return res.json(sampledRows);
        }

        const bucketSpec = AGG_BUCKET_SPECS[options.bucket];
        const aggregatedRows = await Telemetry.aggregate([
            { $match: match },
            {
                $addFields: {
                    _cpu_usage: toNumberExpr('$cpu_usage', true),
                    _memory_usage: toNumberExpr('$memory_usage', true),
                    _disk_usage: toNumberExpr('$disk_usage', true),
                    _bandwidth_mbps: buildBandwidthExpr(),
                    _sip_rtt_avg_ms: buildSipRttExpr(),
                    _sip_registration_percent: buildSipRegistrationExpr(),
                    _sip_rtt_endpoints: buildSipRttEndpointsExpr(),
                    _sip_registration_endpoints: buildSipRegistrationEndpointsExpr(),
                    _bucket_ts: {
                        $dateTrunc: {
                            date: '$timestamp',
                            unit: bucketSpec.unit,
                            binSize: bucketSpec.binSize,
                        },
                    },
                },
            },
            {
                $group: {
                    _id: '$_bucket_ts',
                    cpu_usage: { $avg: '$_cpu_usage' },
                    memory_usage: { $avg: '$_memory_usage' },
                    disk_usage: { $avg: '$_disk_usage' },
                    bandwidth_mbps: { $avg: '$_bandwidth_mbps' },
                    sip_rtt_avg_ms: { $avg: '$_sip_rtt_avg_ms' },
                    sip_registration_percent: { $avg: '$_sip_registration_percent' },
                    sip_rtt_endpoints: { $last: '$_sip_rtt_endpoints' },
                    sip_registration_endpoints: { $last: '$_sip_registration_endpoints' },
                    point_count: { $sum: 1 },
                },
            },
            { $sort: { _id: 1 } },
            { $limit: MAX_RANGE_LIMIT },
        ]);

        const normalizedRows = aggregatedRows.map((row: any) => applyModuleFilter({
            timestamp: row._id,
            cpu_usage: toNumber(row.cpu_usage),
            memory_usage: toNumber(row.memory_usage),
            disk_usage: toNumber(row.disk_usage),
            bandwidth_mbps: toNumber(row.bandwidth_mbps),
            sip_rtt_avg_ms: toNumber(row.sip_rtt_avg_ms),
            sip_registration_percent: toNumber(row.sip_registration_percent),
            sip_rtt_endpoints: Array.isArray(row.sip_rtt_endpoints) ? row.sip_rtt_endpoints : [],
            sip_registration_endpoints: Array.isArray(row.sip_registration_endpoints) ? row.sip_registration_endpoints : [],
            point_count: row.point_count || 0,
        }, enabledModules));

        return res.json(downsampleMetrics(normalizedRows, options.maxPoints));
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// Export telemetry history as CSV
router.get('/metrics/:deviceId/export', authorizePermission('monitoring.view'), async (req: AuthRequest, res) => {
    try {
        const deviceId = String(req.params.deviceId);
        const device = await Device.findOne({ device_id: deviceId });
        if (!device) return res.status(404).json({ message: 'Device not found' });
        if (!canAccessDevice(req.user, device)) {
            return res.status(403).json({ message: 'Access denied for this device' });
        }

        let options: HistoryQueryOptions;
        try {
            options = parseHistoryQuery(req);
        } catch (parseErr: any) {
            return res.status(400).json({ message: parseErr.message });
        }

        const Telemetry = (await import('../models/Telemetry')).default;
        const enabledModules = new Set(getEnabledModules(device));
        const match = buildMatchStage(deviceId, options.from, options.to);
        let rows: any[] = [];

        if (options.bucket === 'raw') {
            const metrics = await Telemetry.find(match)
                .sort({ timestamp: 1 })
                .limit(options.limit)
                .lean();
            rows = buildRawHistoryRows(metrics)
                .map((row) => applyModuleFilter(row, enabledModules));
        } else {
            const bucketSpec = AGG_BUCKET_SPECS[options.bucket];
            const aggregatedRows = await Telemetry.aggregate([
                { $match: match },
                {
                    $addFields: {
                        _cpu_usage: toNumberExpr('$cpu_usage', true),
                        _memory_usage: toNumberExpr('$memory_usage', true),
                        _disk_usage: toNumberExpr('$disk_usage', true),
                        _bandwidth_mbps: buildBandwidthExpr(),
                        _sip_rtt_avg_ms: buildSipRttExpr(),
                        _sip_registration_percent: buildSipRegistrationExpr(),
                        _bucket_ts: {
                            $dateTrunc: {
                                date: '$timestamp',
                                unit: bucketSpec.unit,
                                binSize: bucketSpec.binSize,
                            },
                        },
                    },
                },
                {
                    $group: {
                        _id: '$_bucket_ts',
                        cpu_usage: { $avg: '$_cpu_usage' },
                        memory_usage: { $avg: '$_memory_usage' },
                        disk_usage: { $avg: '$_disk_usage' },
                        bandwidth_mbps: { $avg: '$_bandwidth_mbps' },
                        sip_rtt_avg_ms: { $avg: '$_sip_rtt_avg_ms' },
                        sip_registration_percent: { $avg: '$_sip_registration_percent' },
                        point_count: { $sum: 1 },
                    },
                },
                { $sort: { _id: 1 } },
                { $limit: MAX_RANGE_LIMIT },
            ]);

            rows = aggregatedRows.map((row: any) => applyModuleFilter({
                timestamp: row._id,
                cpu_usage: toNumber(row.cpu_usage),
                memory_usage: toNumber(row.memory_usage),
                disk_usage: toNumber(row.disk_usage),
                bandwidth_mbps: toNumber(row.bandwidth_mbps),
                sip_rtt_avg_ms: toNumber(row.sip_rtt_avg_ms),
                sip_registration_percent: toNumber(row.sip_registration_percent),
                point_count: row.point_count || 0,
            }, enabledModules));
        }

        const headers = ['timestamp', 'cpu_usage', 'memory_usage', 'disk_usage', 'bandwidth_mbps', 'sip_rtt_avg_ms', 'sip_registration_percent', 'point_count'];
        const csvBody = [
            headers.join(','),
            ...rows.map((row) => ([
                row.timestamp ? new Date(row.timestamp).toISOString() : '',
                row.cpu_usage,
                row.memory_usage,
                row.disk_usage,
                row.bandwidth_mbps,
                row.sip_rtt_avg_ms,
                row.sip_registration_percent,
                row.point_count,
            ]).map(csvEscape).join(',')),
        ].join('\n');

        const safeBucket = options.bucket.replace(/[^a-zA-Z0-9]/g, '');
        const fileName = `telemetry-${deviceId}-${safeBucket}-${Date.now()}.csv`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        return res.send(csvBody);
    } catch (err: any) {
        return res.status(500).json({ message: err.message });
    }
});

// List checks for a device
router.get('/checks/:deviceId', authorizePermission('monitoring.view'), async (req: AuthRequest, res) => {
    try {
        const device = await Device.findOne({ device_id: req.params.deviceId });
        if (!device) return res.status(404).json({ message: 'Device not found' });
        if (!canAccessDevice(req.user, device)) {
            return res.status(403).json({ message: 'Access denied for this device' });
        }

        const checks = await MonitoringCheck.find({ device_id: req.params.deviceId });
        res.json(checks.filter((check) => canAccessMonitoringCheck(req.user, check)));
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// Add a check to a device
router.post('/', authorizePermission('monitoring.create'), async (req: AuthRequest, res) => {
    try {
        const { device_id, check_type, target, config, interval, thresholds, notification_frequency, notification_recipients, notify, assigned_user_ids } = req.body;
        const device = await Device.findOne({ device_id });
        if (!device) return res.status(404).json({ message: 'Device not found' });
        if (!canAccessDevice(req.user, device)) {
            return res.status(403).json({ message: 'Access denied for this device' });
        }
        if (!isCheckAllowedForDevice(device, check_type)) {
            return res.status(400).json({ message: `Check type '${check_type}' is not allowed for this device's selected modules` });
        }

        const check = new MonitoringCheck({
            device_id,
            check_type,
            target,
            config,
            interval,
            thresholds,
            notification_frequency,
            notify: notify || notification_recipients,
            assigned_user_ids: hasPermission(req.user, 'devices.assign')
                ? normalizeAssignedUserIds(assigned_user_ids)
                : [],
        });
        await check.save();
        res.status(201).json(check);
    } catch (err: any) {
        res.status(400).json({ message: err.message });
    }
});

// Update a check
router.put('/:id', authorizePermission('monitoring.update'), async (req: AuthRequest, res) => {
    try {
        const previous = await MonitoringCheck.findById(req.params.id);
        if (!previous) return res.status(404).json({ message: 'Check not found' });
        if (!canAccessMonitoringCheck(req.user, previous)) {
            return res.status(403).json({ message: 'Access denied for this monitoring rule' });
        }

        const nextCheckType = req.body?.check_type || previous.check_type;
        const device = await Device.findOne({ device_id: previous.device_id });
        if (!device) return res.status(404).json({ message: 'Device not found' });
        if (!canAccessDevice(req.user, device)) {
            return res.status(403).json({ message: 'Access denied for this device' });
        }
        if (!isCheckAllowedForDevice(device, nextCheckType)) {
            return res.status(400).json({ message: `Check type '${nextCheckType}' is not allowed for this device's selected modules` });
        }

        const updateDoc: any = { ...req.body };
        if (updateDoc.assigned_user_ids !== undefined) {
            if (!hasPermission(req.user, 'devices.assign')) {
                delete updateDoc.assigned_user_ids;
            } else {
                updateDoc.assigned_user_ids = normalizeAssignedUserIds(updateDoc.assigned_user_ids);
            }
        }

        if (req.body.enabled !== undefined && req.body.enabled !== previous.enabled) {
            if (!hasPermission(req.user, 'monitoring.pause_resume')) {
                return res.status(403).json({ message: 'Insufficient permissions to pause/resume monitoring rules' });
            }
        }

        const check = await MonitoringCheck.findByIdAndUpdate(req.params.id, updateDoc, { new: true });
        if (!check) return res.status(404).json({ message: 'Check not found' });

        if (previous.enabled !== check.enabled) {
            const device = await Device.findOne({ device_id: check.device_id });
            const { NotificationService } = await import('../services/NotificationService');
            const SystemSettings = (await import('../models/SystemSettings')).default;
            const settings = await SystemSettings.findOne();

            const stateLabel = check.enabled ? 'resumed' : 'paused';
            if (!check.enabled) {
                await resolveAlert({
                    device_id: check.device_id,
                    device_name: device?.name || check.device_id,
                    alert_type: 'rule_violation',
                    specific_service: check.check_type,
                    specific_endpoint: check.target,
                    details: { resolution_reason: 'Service monitoring paused' },
                });
            }

            await NotificationService.send({
                subject: `Service Monitoring ${check.enabled ? 'Resumed' : 'Paused'}: ${device?.name || check.device_id}`,
                message: `Monitoring for ${check.check_type}${check.target ? ` (${check.target})` : ''} is ${stateLabel} on ${device?.name || check.device_id}.`,
                channels: ['slack'],
                recipients: { slackWebhook: settings?.notification_slack_webhook || device?.notification_slack_webhook },
            });
        }

        res.json(check);
    } catch (err: any) {
        res.status(400).json({ message: err.message });
    }
});

// Delete a check
router.delete('/:id', authorizePermission('monitoring.delete'), async (req: AuthRequest, res) => {
    try {
        const existing = await MonitoringCheck.findById(req.params.id);
        if (!existing) return res.status(404).json({ message: 'Check not found' });
        if (!canAccessMonitoringCheck(req.user, existing)) {
            return res.status(403).json({ message: 'Access denied for this monitoring rule' });
        }

        const device = await Device.findOne({ device_id: existing.device_id });
        if (!device) return res.status(404).json({ message: 'Device not found' });
        if (!canAccessDevice(req.user, device)) {
            return res.status(403).json({ message: 'Access denied for this device' });
        }

        const check = await MonitoringCheck.findByIdAndDelete(req.params.id);
        if (!check) return res.status(404).json({ message: 'Check not found' });
        res.json({ message: 'Check deleted' });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

export default router;
