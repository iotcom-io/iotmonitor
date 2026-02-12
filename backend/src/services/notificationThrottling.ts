import mongoose from 'mongoose';
import AlertTracking from '../models/AlertTracking';
import Device from '../models/Device';
import MonitoringCheck from '../models/MonitoringCheck';
import SystemSettings from '../models/SystemSettings';
import Incident from '../models/Incident';
import { sendNotification, sendRecoveryNotification } from './notifications';
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata';

interface TriggerAlertParams {
    device_id: string;
    device_name: string;
    alert_type: string;
    severity?: 'info' | 'warning' | 'critical';
    specific_service?: string;
    specific_endpoint?: string;
    details?: any;
    throttling_config?: {
        repeat_interval_minutes?: number;
        throttling_duration_minutes?: number;
    };
}

interface ResolveAlertParams {
    device_id: string;
    device_name: string;
    alert_type: string;
    specific_service?: string;
    specific_endpoint?: string;
    details?: any;
}

const severityRank: Record<string, number> = {
    info: 0,
    warning: 1,
    critical: 2,
};
const GLOBAL_TARGETS = new Set(['', 'all', 'system-wide', '*']);

const getEnabledModules = (device: any): string[] => {
    const modulesConfig = device.config?.modules;
    if (modulesConfig && typeof modulesConfig === 'object') {
        return Object.keys(modulesConfig).filter((m) => modulesConfig[m] === true);
    }

    if (Array.isArray(device.enabled_modules) && device.enabled_modules.length > 0) {
        return device.enabled_modules;
    }

    return [];
};

const resolvePolicy = async (
    alertType: string,
    severity: 'info' | 'warning' | 'critical',
    overrides: { repeat_interval_minutes?: number; throttling_duration_minutes?: number } = {}
) => {
    const settings = await SystemSettings.findOne();
    const defaultRepeat = settings?.default_repeat_interval_minutes || 5;
    const defaultDuration = settings?.default_throttling_duration_minutes || 60;

    if (overrides.repeat_interval_minutes !== undefined || overrides.throttling_duration_minutes !== undefined) {
        return {
            repeat_interval_minutes: overrides.repeat_interval_minutes ?? defaultRepeat,
            throttling_duration_minutes: overrides.throttling_duration_minutes ?? defaultDuration,
        };
    }

    if (alertType === 'service_down') {
        return { repeat_interval_minutes: 15, throttling_duration_minutes: 60 };
    }

    if (alertType === 'rule_violation') {
        if (severity === 'critical') {
            return { repeat_interval_minutes: 5, throttling_duration_minutes: 0 };
        }
        return { repeat_interval_minutes: 15, throttling_duration_minutes: 60 };
    }

    if (alertType === 'high_latency') {
        if (severity === 'critical') {
            return { repeat_interval_minutes: 5, throttling_duration_minutes: 0 };
        }
        return { repeat_interval_minutes: 15, throttling_duration_minutes: 60 };
    }

    if (alertType === 'offline') {
        return { repeat_interval_minutes: 15, throttling_duration_minutes: 60 };
    }

    return {
        repeat_interval_minutes: defaultRepeat,
        throttling_duration_minutes: defaultDuration,
    };
};

const findDeviceForAlert = async (deviceId: string) => {
    let device = await Device.findOne({ device_id: deviceId });
    if (device) return device;

    if (mongoose.Types.ObjectId.isValid(deviceId)) {
        device = await Device.findById(deviceId);
    }

    return device;
};

const formatDuration = (durationSeconds: number) => {
    if (durationSeconds < 60) return `${durationSeconds}s`;
    if (durationSeconds < 3600) return `${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s`;
    return `${Math.floor(durationSeconds / 3600)}h ${Math.floor((durationSeconds % 3600) / 60)}m`;
};

const normalizeTarget = (value?: string) => String(value || '').trim().toLowerCase();

const toIncidentSeverity = (severity: 'info' | 'warning' | 'critical'): 'warning' | 'critical' => {
    return severity === 'critical' ? 'critical' : 'warning';
};

const buildIncidentSummary = (params: {
    alert_type: string;
    specific_service?: string;
    specific_endpoint?: string;
}) => {
    const alertType = String(params.alert_type || '').trim();
    const service = String(params.specific_service || '').trim();
    const endpoint = String(params.specific_endpoint || '').trim();

    const parts: string[] = [];
    if (alertType === 'offline') {
        parts.push('Device Offline');
    } else if (alertType === 'service_down') {
        parts.push('Service Down');
    } else if (alertType === 'rule_violation') {
        parts.push('Threshold Breach');
    } else if (alertType === 'sip_issue') {
        parts.push('SIP Issue');
    } else if (alertType === 'high_latency') {
        parts.push('High Latency');
    } else if (alertType === 'ip_change') {
        parts.push('IP Change');
    } else {
        parts.push(alertType.replace(/_/g, ' '));
    }

    if (service) parts.push(service);
    if (endpoint) parts.push(endpoint);
    return parts.join(' | ');
};

const ensureDeviceIncidentOpen = async (params: {
    alert: any;
    device_name: string;
    severity: 'info' | 'warning' | 'critical';
}) => {
    const { alert, device_name, severity } = params;
    const summary = buildIncidentSummary({
        alert_type: alert.alert_type,
        specific_service: alert.specific_service,
        specific_endpoint: alert.specific_endpoint,
    });
    const now = new Date();

    let incident = await Incident.findOne({
        target_type: 'device',
        target_id: alert.device_id,
        summary,
        status: 'open',
    });

    if (!incident) {
        incident = await Incident.create({
            target_type: 'device',
            target_id: alert.device_id,
            target_name: device_name,
            severity: toIncidentSeverity(severity),
            status: 'open',
            started_at: alert.first_triggered || now,
            summary,
            updates: [{
                at: now,
                message: `Alert opened (${severity.toUpperCase()})`,
            }],
        });
        return incident;
    }

    const nextSeverity = toIncidentSeverity(severity);
    if (incident.severity !== nextSeverity) {
        incident.severity = nextSeverity;
        incident.updates.push({
            at: now,
            message: `Severity updated to ${nextSeverity.toUpperCase()}`,
        } as any);
        await incident.save();
    }
    return incident;
};

const resolveDeviceIncident = async (params: {
    alert: any;
    device_name: string;
    details?: any;
}) => {
    const { alert, device_name, details } = params;
    const summary = buildIncidentSummary({
        alert_type: alert.alert_type,
        specific_service: alert.specific_service,
        specific_endpoint: alert.specific_endpoint,
    });

    const incident = await Incident.findOne({
        target_type: 'device',
        target_id: alert.device_id,
        summary,
        status: 'open',
    }).sort({ started_at: -1 });

    if (!incident) return null;

    const now = new Date();
    incident.status = 'resolved';
    incident.resolved_at = now;
    const reason = details?.resolution_reason
        ? String(details.resolution_reason)
        : 'Alert recovered';
    incident.target_name = device_name;
    incident.updates.push({
        at: now,
        message: reason,
    } as any);
    await incident.save();
    return incident;
};

const hasMatchingEnabledCheck = async (
    deviceId: string,
    checkTypes: string[],
    endpoint?: string
) => {
    if (!checkTypes.length) return false;

    const checks = await MonitoringCheck.find({
        device_id: deviceId,
        check_type: { $in: checkTypes },
        enabled: true,
    }).select({ target: 1 });

    if (checks.length === 0) return false;
    if (!endpoint) return true;

    const normalizedEndpoint = normalizeTarget(endpoint);
    return checks.some((check: any) => {
        const target = normalizeTarget(check.target);
        return GLOBAL_TARGETS.has(target) || target === normalizedEndpoint;
    });
};

const isAlertStillMonitored = async (alert: any, device: any) => {
    if (device.monitoring_paused || !device.monitoring_enabled) {
        return false;
    }

    if (alert.alert_type === 'service_down') {
        const enabledModules = getEnabledModules(device);
        return alert.specific_service ? enabledModules.includes(alert.specific_service) : true;
    }

    if (alert.alert_type === 'rule_violation') {
        const checkType = String(alert.specific_service || '').trim();
        if (!checkType) return false;
        return hasMatchingEnabledCheck(device.device_id, [checkType], alert.specific_endpoint);
    }

    if (alert.alert_type === 'sip_issue' || alert.alert_type === 'high_latency') {
        let checkTypes: string[] = [];

        if (alert.alert_type === 'sip_issue' && alert.specific_service === 'sip_registration') {
            checkTypes = ['sip_registration'];
        } else {
            // Keep legacy "sip" type for backward compatibility.
            checkTypes = ['sip_rtt', 'sip'];
        }

        return hasMatchingEnabledCheck(device.device_id, checkTypes, alert.specific_endpoint);
    }

    return true;
};

export async function triggerAlert(params: TriggerAlertParams) {
    try {
        const {
            device_id,
            device_name,
            alert_type,
            severity = 'warning',
            specific_service,
            specific_endpoint,
            details = {},
            throttling_config = {},
        } = params;

        const device = await findDeviceForAlert(device_id);
        if (device && (device.monitoring_paused || !device.monitoring_enabled)) {
            return null;
        }

        if (device && alert_type !== 'offline') {
            const monitored = await isAlertStillMonitored(
                {
                    alert_type,
                    specific_service,
                    specific_endpoint,
                },
                device
            );
            if (!monitored) {
                return null;
            }
        }

        const existingAlert = await AlertTracking.findOne({
            device_id,
            alert_type,
            specific_service: specific_service || { $exists: false },
            specific_endpoint: specific_endpoint || { $exists: false },
            state: { $ne: 'resolved' },
        });

        if (existingAlert) {
            const shouldEscalate = severityRank[severity] > severityRank[existingAlert.severity];
            existingAlert.details = { ...existingAlert.details, ...details };

            if (shouldEscalate) {
                existingAlert.severity = severity;
                existingAlert.last_notified = new Date();
                existingAlert.notification_count += 1;
                await existingAlert.save();
                await sendNotification(existingAlert, device_name);
            } else {
                await existingAlert.save();
            }

            try {
                await ensureDeviceIncidentOpen({
                    alert: existingAlert,
                    device_name,
                    severity: existingAlert.severity as any,
                });
            } catch (incidentErr) {
                console.error('Failed to sync incident for existing alert:', incidentErr);
            }

            return existingAlert;
        }

        const policy = await resolvePolicy(alert_type, severity, throttling_config);

        const alert = new AlertTracking({
            device_id,
            alert_type,
            specific_service,
            specific_endpoint,
            severity,
            state: 'new',
            first_triggered: new Date(),
            last_notified: new Date(),
            notification_count: 1,
            throttling_config: policy,
            details,
        });

        await alert.save();
        await sendNotification(alert, device_name);

        try {
            await ensureDeviceIncidentOpen({
                alert,
                device_name,
                severity,
            });
        } catch (incidentErr) {
            console.error('Failed to create incident for new alert:', incidentErr);
        }

        alert.state = 'throttling';
        await alert.save();

        console.log(`New alert triggered for device ${device_name}: ${alert_type} (${severity})`);
        return alert;
    } catch (error) {
        console.error('Error triggering alert:', error);
        throw error;
    }
}

export async function resolveAlert(params: ResolveAlertParams) {
    try {
        const {
            device_id,
            device_name,
            alert_type,
            specific_service,
            specific_endpoint,
            details = {},
        } = params;

        const alert = await AlertTracking.findOne({
            device_id,
            alert_type,
            specific_service: specific_service || { $exists: false },
            specific_endpoint: specific_endpoint || { $exists: false },
            state: { $ne: 'resolved' },
        });

        if (!alert) {
            return null;
        }

        const duration_ms = new Date().getTime() - alert.first_triggered.getTime();
        const duration_minutes = Math.floor(duration_ms / 60000);
        const duration_seconds = Math.floor(duration_ms / 1000);

        alert.state = 'resolved';
        alert.resolved_at = new Date();
        alert.details = { ...alert.details, ...details, duration_minutes, duration_seconds };
        await alert.save();

        await sendRecoveryNotification(alert, device_name);

        try {
            await resolveDeviceIncident({ alert, device_name, details: alert.details });
        } catch (incidentErr) {
            console.error('Failed to resolve incident for alert:', incidentErr);
        }

        console.log(`Alert resolved for device ${device_name}: ${alert_type} (duration: ${duration_minutes} min)`);
        return alert;
    } catch (error) {
        console.error('Error resolving alert:', error);
        throw error;
    }
}

export async function resolveAllActiveAlertsForDevice(deviceId: string, deviceName: string, reason: string, silent: boolean = false) {
    const activeAlerts = await AlertTracking.find({
        device_id: deviceId,
        state: { $ne: 'resolved' },
    });

    for (const alert of activeAlerts) {
        if (silent) {
            const now = new Date();
            const durationMs = now.getTime() - new Date(alert.first_triggered).getTime();
            alert.state = 'resolved';
            alert.resolved_at = now;
            alert.details = {
                ...alert.details,
                resolution_reason: reason,
                duration_minutes: Math.floor(durationMs / 60000),
                duration_seconds: Math.floor(durationMs / 1000),
            };
            await alert.save();
            try {
                await resolveDeviceIncident({ alert, device_name: deviceName, details: alert.details });
            } catch (incidentErr) {
                console.error('Failed to resolve incident while silently resolving alert:', incidentErr);
            }
            continue;
        }

        await resolveAlert({
            device_id: deviceId,
            device_name: deviceName,
            alert_type: alert.alert_type,
            specific_service: alert.specific_service,
            specific_endpoint: alert.specific_endpoint,
            details: { resolution_reason: reason },
        });
    }
}

export async function resolveOfflineRecoveryBundle(
    deviceId: string,
    deviceName: string,
    deviceSlackWebhook?: string
) {
    const activeAlerts = await AlertTracking.find({
        device_id: deviceId,
        alert_type: { $in: ['offline', 'service_down'] },
        state: { $ne: 'resolved' },
    });

    if (activeAlerts.length === 0) {
        return { resolvedCount: 0, restoredServices: [] as string[] };
    }

    const now = new Date();
    let offlineDurationSeconds = 0;
    const restoredServices = new Set<string>();

    for (const alert of activeAlerts) {
        const durationMs = now.getTime() - new Date(alert.first_triggered).getTime();
        const durationSeconds = Math.floor(durationMs / 1000);

        alert.state = 'resolved';
        alert.resolved_at = now;
        alert.details = {
            ...alert.details,
            resolution_reason: 'Device recovered',
            duration_minutes: Math.floor(durationMs / 60000),
            duration_seconds: durationSeconds,
        };
        await alert.save();
        try {
            await resolveDeviceIncident({ alert, device_name: deviceName, details: alert.details });
        } catch (incidentErr) {
            console.error('Failed to resolve incident in offline recovery bundle:', incidentErr);
        }

        if (alert.alert_type === 'offline') {
            offlineDurationSeconds = Math.max(offlineDurationSeconds, durationSeconds);
        }
        if (alert.alert_type === 'service_down' && alert.specific_service) {
            restoredServices.add(alert.specific_service);
        }
    }

    const { NotificationService } = await import('./NotificationService');
    const settings = await SystemSettings.findOne();
    const recoveryTime = now.toLocaleString('en-US', { timeZone: APP_TIMEZONE });

    let message = `RESOLVED\n\n`;
    message += `Device: ${deviceName}\n`;
    message += `Status: Device Back Online\n`;
    message += `Recovery Time: ${recoveryTime}\n`;
    if (offlineDurationSeconds > 0) {
        message += `Offline Duration: ${formatDuration(offlineDurationSeconds)}\n`;
    }
    if (restoredServices.size > 0) {
        message += `Services Restored: ${Array.from(restoredServices).sort().join(', ')}\n`;
    }
    message += `Resolved Alerts: ${activeAlerts.length}`;

    await NotificationService.send({
        subject: `Device Recovery: ${deviceName}`,
        message,
        channels: ['slack'],
        recipients: { slackWebhook: settings?.notification_slack_webhook || deviceSlackWebhook },
    });

    return {
        resolvedCount: activeAlerts.length,
        restoredServices: Array.from(restoredServices),
    };
}

export async function processThrottledAlerts() {
    try {
        const now = new Date();
        const activeAlerts = await AlertTracking.find({ state: { $in: ['throttling', 'hourly_only'] } });

        for (const alert of activeAlerts) {
            const deviceDoc = await findDeviceForAlert(alert.device_id);
            if (!deviceDoc) continue;

            if (!(await isAlertStillMonitored(alert, deviceDoc))) {
                if (deviceDoc.monitoring_paused || !deviceDoc.monitoring_enabled) {
                    const now = new Date();
                    const durationMs = now.getTime() - new Date(alert.first_triggered).getTime();
                    alert.state = 'resolved';
                    alert.resolved_at = now;
                    alert.details = {
                        ...alert.details,
                        resolution_reason: 'Monitoring paused/disabled',
                        duration_minutes: Math.floor(durationMs / 60000),
                        duration_seconds: Math.floor(durationMs / 1000),
                    };
                    await alert.save();
                    try {
                        await resolveDeviceIncident({ alert, device_name: deviceDoc.name, details: alert.details });
                    } catch (incidentErr) {
                        console.error('Failed to resolve incident while auto-resolving paused alert:', incidentErr);
                    }
                } else {
                    await resolveAlert({
                        device_id: alert.device_id,
                        device_name: deviceDoc.name,
                        alert_type: alert.alert_type,
                        specific_service: alert.specific_service,
                        specific_endpoint: alert.specific_endpoint,
                        details: { resolution_reason: 'Service/endpoint no longer monitored' },
                    });
                }
                continue;
            }

            const timeSinceLastNotification = (now.getTime() - alert.last_notified.getTime()) / 60000;
            const timeSinceFirstTrigger = (now.getTime() - alert.first_triggered.getTime()) / 60000;

            if (alert.state === 'hourly_only') {
                if (timeSinceLastNotification >= 60) {
                    alert.notification_count += 1;
                    alert.last_notified = now;
                    await alert.save();
                    await sendNotification(alert, deviceDoc.name, true);
                }
                continue;
            }

            const repeatEvery = alert.throttling_config.repeat_interval_minutes;
            const throttleDuration = alert.throttling_config.throttling_duration_minutes;

            if (timeSinceLastNotification < repeatEvery) {
                continue;
            }

            if (throttleDuration <= 0 || timeSinceFirstTrigger < throttleDuration) {
                alert.notification_count += 1;
                alert.last_notified = now;
                await alert.save();
                await sendNotification(alert, deviceDoc.name, true);
                continue;
            }

            alert.state = 'hourly_only';
            await alert.save();
            console.log(`Alert moved to hourly-only for device: ${alert.device_id} (${alert.alert_type})`);
        }
    } catch (error) {
        console.error('Error processing throttled alerts:', error);
    }
}

export async function normalizeAlertDeviceIds() {
    try {
        const activeAlerts = await AlertTracking.find({ state: { $ne: 'resolved' } });
        for (const alert of activeAlerts) {
            const currentId = String(alert.device_id || '');
            if (!currentId) continue;

            const byDeviceId = await Device.findOne({ device_id: currentId }).select({ _id: 1, device_id: 1, name: 1, status: 1 });
            if (byDeviceId) {
                if (alert.alert_type === 'offline' && byDeviceId.status === 'online') {
                    const now = new Date();
                    const durationMs = now.getTime() - new Date(alert.first_triggered).getTime();
                    alert.state = 'resolved';
                    alert.resolved_at = now;
                    alert.details = {
                        ...alert.details,
                        resolution_reason: 'Auto-resolved during startup normalization',
                        duration_minutes: Math.floor(durationMs / 60000),
                        duration_seconds: Math.floor(durationMs / 1000),
                    };
                    await alert.save();
                    try {
                        await resolveDeviceIncident({ alert, device_name: String(byDeviceId.name || byDeviceId.device_id), details: alert.details });
                    } catch (incidentErr) {
                        console.error('Failed to resolve incident during startup normalization:', incidentErr);
                    }
                }
                continue;
            }

            if (!mongoose.Types.ObjectId.isValid(currentId)) continue;
            const byObjectId = await Device.findById(currentId).select({ _id: 1, device_id: 1, name: 1, status: 1 });
            if (!byObjectId) continue;

            alert.device_id = byObjectId.device_id;
            if (alert.alert_type === 'offline' && byObjectId.status === 'online') {
                const now = new Date();
                const durationMs = now.getTime() - new Date(alert.first_triggered).getTime();
                alert.state = 'resolved';
                alert.resolved_at = now;
                alert.details = {
                    ...alert.details,
                    resolution_reason: 'Auto-resolved during startup normalization',
                    duration_minutes: Math.floor(durationMs / 60000),
                    duration_seconds: Math.floor(durationMs / 1000),
                };
            }
            await alert.save();
            if (alert.state === 'resolved') {
                try {
                    await resolveDeviceIncident({ alert, device_name: String(byObjectId.name || byObjectId.device_id), details: alert.details });
                } catch (incidentErr) {
                    console.error('Failed to resolve incident while normalizing ObjectId device alerts:', incidentErr);
                }
            }
        }
    } catch (error) {
        console.error('Error normalizing alert device IDs:', error);
    }
}

export async function backfillActiveAlertIncidents() {
    try {
        const activeAlerts = await AlertTracking.find({ state: { $ne: 'resolved' } });
        for (const alert of activeAlerts) {
            const device = await findDeviceForAlert(alert.device_id);
            const deviceName = String(device?.name || alert.device_id || 'Unknown Device');
            await ensureDeviceIncidentOpen({
                alert,
                device_name: deviceName,
                severity: (alert.severity || 'warning') as any,
            });
        }
    } catch (error) {
        console.error('Error backfilling incidents from active alerts:', error);
    }
}

export function startThrottlingService() {
    console.log('Starting notification throttling service...');
    normalizeAlertDeviceIds();
    backfillActiveAlertIncidents();
    setInterval(processThrottledAlerts, 60000);
}
