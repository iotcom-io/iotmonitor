import Device from '../models/Device';
import SystemSettings from '../models/SystemSettings';
import { triggerAlert, resolveAlert, resolveOfflineRecoveryBundle } from './notificationThrottling';

const SERVICE_DOWN_GRACE_MS = 120000;
const MODULES = ['system', 'docker', 'asterisk', 'network'] as const;
type ModuleName = typeof MODULES[number];

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
        const devices = await Device.find({ monitoring_enabled: true, monitoring_paused: { $ne: true } });
        const settings = await SystemSettings.findOne();
        const globalMultiplier = settings?.default_offline_threshold_multiplier || 4;
        const now = new Date();

        for (const device of devices) {
            const expectedInterval = (device.expected_message_interval_seconds || 15) * 1000;
            const multiplier = device.offline_threshold_multiplier || globalMultiplier;
            const offlineThreshold = expectedInterval * multiplier;
            const timeSinceLastMessage = now.getTime() - new Date(device.last_seen).getTime();

            if (timeSinceLastMessage > offlineThreshold) {
                if (device.status !== 'offline') {
                    console.log(`Device ${device.name} is offline (last seen: ${device.last_seen})`);

                    await Device.findOneAndUpdate({ device_id: device.device_id }, {
                        status: 'offline',
                        consecutive_missed_messages: Math.floor(timeSinceLastMessage / expectedInterval),
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

            if (device.status === 'online') {
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

        if ((oldStatus === 'offline' || oldStatus === 'not_monitored') && !device.monitoring_paused) {
            updateData.status = 'online';

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
