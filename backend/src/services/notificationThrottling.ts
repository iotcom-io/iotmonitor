import mongoose from 'mongoose';
import AlertTracking from '../models/AlertTracking';
import Device from '../models/Device';
import MonitoringCheck from '../models/MonitoringCheck';
import SystemSettings from '../models/SystemSettings';
import { sendNotification, sendRecoveryNotification } from './notifications';

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

const getEnabledModules = (device: any): string[] => {
    if (Array.isArray(device.enabled_modules) && device.enabled_modules.length > 0) {
        return device.enabled_modules;
    }

    const modulesConfig = device.config?.modules;
    if (modulesConfig && typeof modulesConfig === 'object') {
        return Object.keys(modulesConfig).filter((m) => modulesConfig[m] === true);
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

const isAlertStillMonitored = async (alert: any, device: any) => {
    if (device.monitoring_paused || !device.monitoring_enabled) {
        return false;
    }

    if (alert.alert_type === 'service_down') {
        const enabledModules = getEnabledModules(device);
        return alert.specific_service ? enabledModules.includes(alert.specific_service) : true;
    }

    if (alert.alert_type === 'rule_violation') {
        const query: any = {
            device_id: device.device_id,
            check_type: alert.specific_service,
            enabled: true,
        };
        if (alert.specific_endpoint) {
            query.target = alert.specific_endpoint;
        }

        const check = await MonitoringCheck.findOne(query);
        return !!check;
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
                } else {
                    await resolveAlert({
                        device_id: alert.device_id,
                        device_name: deviceDoc.name,
                        alert_type: alert.alert_type,
                        specific_service: alert.specific_service,
                        specific_endpoint: alert.specific_endpoint,
                        details: { resolution_reason: 'Monitoring paused/disabled' },
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

export function startThrottlingService() {
    console.log('Starting notification throttling service...');
    setInterval(processThrottledAlerts, 60000);
}
