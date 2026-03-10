import Device from '../models/Device';
import SystemSettings from '../models/SystemSettings';
import MonitoringCheck from '../models/MonitoringCheck';
import { triggerAlert, resolveAlert, resolveOfflineRecoveryBundle } from './notificationThrottling';
import { isMqttBrokerConnected } from './mqttState';

const SERVICE_DOWN_GRACE_MS = 120000;
const OFFLINE_DETECTION_STARTUP_GRACE_MS = Math.max(
    0,
    (Number(process.env.OFFLINE_DETECTION_STARTUP_GRACE_SECONDS || 90) || 90) * 1000
);
const MODULES = ['system', 'docker', 'asterisk', 'network'] as const;
type ModuleName = typeof MODULES[number];
let offlineServiceStartedAt = Date.now();
const RECOVERY_SUMMARY_DELAY_MS = Math.max(
    0,
    (Number(process.env.RECOVERY_SUMMARY_DELAY_SECONDS || 120) || 120) * 1000
);

const formatDurationMinutes = (minutes: number) => {
    if (minutes <= 1) return '1 minute';
    return `${minutes} minutes`;
};

const sendRecoveryStabilitySummary = async (device: any) => {
    const now = new Date();
    const checks = await MonitoringCheck.find({
        device_id: device.device_id,
        enabled: true,
    }).select({ check_type: 1, target: 1, last_state: 1, last_value: 1, last_evaluated_at: 1 });

    const statusCounts = checks.reduce((acc: any, check: any) => {
        const state = String(check.last_state || 'unknown').toLowerCase();
        if (state === 'ok') acc.ok += 1;
        else if (state === 'warning') acc.warning += 1;
        else if (state === 'critical') acc.critical += 1;
        else acc.unknown += 1;
        return acc;
    }, { ok: 0, warning: 0, critical: 0, unknown: 0 });

    const degraded = checks
        .filter((check: any) => ['warning', 'critical'].includes(String(check.last_state || '').toLowerCase()))
        .slice(0, 8)
        .map((check: any) => `- ${check.check_type} | ${check.target || 'System-wide'} | ${String(check.last_state).toUpperCase()}`);

    const settings = await SystemSettings.findOne();
    const { NotificationService } = await import('./NotificationService');
    let message = `RECOVERY SUMMARY\n\n`;
    message += `Device: ${device.name}\n`;
    message += `Status: Stable online for ${formatDurationMinutes(Math.max(1, Math.round(RECOVERY_SUMMARY_DELAY_MS / 60000)))}\n`;
    message += `Time: ${now.toLocaleString('en-US', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' })}\n`;
    message += `Checks: ${checks.length} total | OK ${statusCounts.ok} | Warning ${statusCounts.warning} | Critical ${statusCounts.critical} | Unknown ${statusCounts.unknown}\n`;

    if (degraded.length > 0) {
        message += `\nCurrent non-OK checks:\n${degraded.join('\n')}`;
    } else {
        message += `\nAll monitored checks are healthy.`;
    }

    await NotificationService.send({
        subject: `Device Stable Summary: ${device.name}`,
        message,
        channels: ['slack'],
        recipients: { slackWebhook: settings?.notification_slack_webhook || device.notification_slack_webhook },
    });

    await Device.findOneAndUpdate(
        { device_id: device.device_id },
        { $set: { online_summary_sent_at: now } }
    );
};

const getEnabledModules = (device: any): ModuleName[] => {
    const modulesConfig = device.config?.modules;
    if (modulesConfig && typeof modulesConfig === 'object') {
        return MODULES.filter((module) => modulesConfig[module] === true);
    }

    if (Array.isArray(device.enabled_modules) && device.enabled_modules.length > 0) {
        return device.enabled_modules.filter((m: string) => MODULES.includes(m as ModuleName));
    }

    return [];
};

/**
 * Offline Detection Service
 */
export async function checkOfflineDevices() {
    try {
        if (!isMqttBrokerConnected()) {
            console.warn('[OFFLINE] Skipping offline detection because MQTT broker is disconnected');
            return;
        }

        const devices = await Device.find({ monitoring_enabled: true, monitoring_paused: { $ne: true } });
        const settings = await SystemSettings.findOne();
        const globalMultiplier = settings?.default_offline_threshold_multiplier || 4;
        const now = new Date();
        const inStartupGraceWindow = Date.now() - offlineServiceStartedAt < OFFLINE_DETECTION_STARTUP_GRACE_MS;

        for (const device of devices) {
            const expectedInterval = (device.expected_message_interval_seconds || 15) * 1000;
            const multiplier = device.offline_threshold_multiplier || globalMultiplier;
            const offlineThreshold = expectedInterval * multiplier;
            const lastSeenAt = new Date(device.last_seen || 0);
            const timeSinceLastMessage = now.getTime() - lastSeenAt.getTime();

            if (timeSinceLastMessage > offlineThreshold) {
                if (inStartupGraceWindow) {
                    continue;
                }

                if (device.status !== 'offline') {
                    console.log(`Device ${device.name} is offline (last seen: ${device.last_seen})`);

                    await Device.findOneAndUpdate({ device_id: device.device_id }, {
                        status: 'offline',
                        consecutive_missed_messages: Math.floor(timeSinceLastMessage / expectedInterval),
                        online_recovered_at: null,
                        notification_suppressed_until: null,
                        online_summary_sent_at: null,
                    });

                    await triggerAlert({
                        device_id: device.device_id,
                        device_name: device.name,
                        alert_type: 'offline',
                        severity: 'critical',
                        throttling_config: {
                            repeat_interval_minutes: 15,
                            throttling_duration_minutes: 60,
                        },
                        details: {
                            last_seen: device.last_seen,
                            expected_interval_seconds: device.expected_message_interval_seconds,
                            missed_messages: Math.floor(timeSinceLastMessage / expectedInterval),
                            offline_duration_minutes: Math.floor(timeSinceLastMessage / 60000),
                        },
                    });
                }
                continue;
            }

            if (
                device.status === 'online' &&
                device.online_recovered_at &&
                device.notification_suppressed_until &&
                !device.online_summary_sent_at
            ) {
                const suppressUntil = new Date(device.notification_suppressed_until);
                if (!Number.isNaN(suppressUntil.getTime()) && now.getTime() >= suppressUntil.getTime()) {
                    await sendRecoveryStabilitySummary(device);
                }
            }

            if (device.status === 'online') {
                if (inStartupGraceWindow) {
                    continue;
                }

                const modules = getEnabledModules(device).filter((m) => m !== 'system');
                for (const module of modules) {
                    const lastSuccess = (device.last_successful_metrics as any)?.[module];
                    if (!lastSuccess) continue;

                    const timeSinceSuccess = now.getTime() - new Date(lastSuccess).getTime();
                    if (timeSinceSuccess > SERVICE_DOWN_GRACE_MS) {
                        await triggerAlert({
                            device_id: device.device_id,
                            device_name: device.name,
                            alert_type: 'service_down',
                            severity: 'warning',
                            specific_service: module,
                            throttling_config: {
                                repeat_interval_minutes: 15,
                                throttling_duration_minutes: 60,
                            },
                            details: {
                                last_successful: lastSuccess,
                                missing_duration_minutes: Math.floor(timeSinceSuccess / 60000),
                            },
                        });
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error in offline detection:', error);
    }
}

/**
 * Update device heartbeat timestamp when a valid message is received.
 */
export async function updateDeviceHeartbeat(deviceId: string) {
    try {
        const now = new Date();
        const device = await Device.findOne({ device_id: deviceId });
        if (!device) return;

        const oldStatus = device.status;
        const updateData: any = {
            last_seen: now,
            consecutive_missed_messages: 0,
        };

        // If monitoring is paused and the device heartbeat returns while status is still offline,
        // keep a marker so resume flow can report that recovery happened during the paused window.
        if (
            device.monitoring_paused &&
            (oldStatus === 'offline' || oldStatus === 'not_monitored') &&
            !device.pause_window_online_at
        ) {
            updateData.pause_window_online_at = now;
        }

        if ((oldStatus === 'offline' || oldStatus === 'not_monitored') && !device.monitoring_paused) {
            updateData.status = 'online';
            updateData.online_recovered_at = now;
            updateData.notification_suppressed_until = new Date(now.getTime() + RECOVERY_SUMMARY_DELAY_MS);
            updateData.online_summary_sent_at = null;

            // Grace window: initialize module success timestamps to now.
            // This prevents immediate false service_down alerts after recovery.
            const enabledModules = getEnabledModules(device);
            const nextLastSuccessful: Record<string, Date | undefined> = { ...(device.last_successful_metrics || {}) };
            for (const module of enabledModules) {
                if (module !== 'system') {
                    nextLastSuccessful[module] = now;
                }
            }
            updateData.last_successful_metrics = nextLastSuccessful;

            console.log(`Device ${device.name} is now online (transitioned from ${oldStatus})`);
        }

        await Device.findOneAndUpdate(
            { device_id: deviceId },
            {
                $set: updateData,
                $push: {
                    last_message_timestamps: {
                        $each: [now],
                        $slice: -4,
                    },
                },
            }
        );

        if (oldStatus === 'offline' && !device.monitoring_paused) {
            const recovery = await resolveOfflineRecoveryBundle(
                deviceId,
                device.name,
                device.notification_slack_webhook
            );

            if (recovery.resolvedCount === 0) {
                await resolveAlert({
                    device_id: deviceId,
                    device_name: device.name,
                    alert_type: 'offline',
                    details: { recovery_time: now },
                });
            }
        }
    } catch (error) {
        console.error('Error updating device heartbeat:', error);
    }
}

/**
 * Update last successful metrics timestamp for a module.
 */
export async function updateServiceMetrics(deviceId: string, service: string) {
    try {
        const now = new Date();
        const updateField = `last_successful_metrics.${service}`;

        await Device.findOneAndUpdate(
            { device_id: deviceId },
            { $set: { [updateField]: now } }
        );
    } catch (error) {
        console.error('Error updating service metrics:', error);
    }
}

export async function startOfflineDetection() {
    console.log('Starting offline detection service...');
    offlineServiceStartedAt = Date.now();

    const runDetection = async () => {
        try {
            await checkOfflineDevices();

            const settings = await SystemSettings.findOne();
            const intervalSeconds = settings?.monitoring_check_interval_seconds || 30;

            setTimeout(runDetection, intervalSeconds * 1000);
        } catch (error) {
            console.error('Error in offline detection loop:', error);
            setTimeout(runDetection, 30000);
        }
    };

    runDetection();
}
