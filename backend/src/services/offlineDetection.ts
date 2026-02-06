import Device from '../models/Device';
import AlertTracking from '../models/AlertTracking';
import SystemSettings from '../models/SystemSettings';
import { triggerAlert, resolveAlert } from './notificationThrottling';

/**
 * Offline Detection Service
 * 
 * Monitors device message timestamps and detects when devices go offline.
 * - Expected message interval: 15 seconds
 * - Offline threshold: 4 consecutive missed messages (1 minute)
 * - Immediate recovery when message received
 */

export async function checkOfflineDevices() {
    try {
        const devices = await Device.find({ monitoring_enabled: true });
        const settings = await SystemSettings.findOne();
        const globalMultiplier = settings?.default_offline_threshold_multiplier || 4;
        const now = new Date();

        for (const device of devices) {
            const expectedInterval = (device.expected_message_interval_seconds || 15) * 1000;
            const multiplier = device.offline_threshold_multiplier || globalMultiplier;
            const offlineThreshold = expectedInterval * multiplier;
            const timeSinceLastMessage = now.getTime() - device.last_seen.getTime();

            if (timeSinceLastMessage > offlineThreshold) {
                // Device is offline
                if (device.status !== 'offline') {
                    console.log(`Device ${device.name} is offline (last seen: ${device.last_seen})`);

                    // Atomic update to offline status
                    await Device.findByIdAndUpdate(device._id, {
                        status: 'offline',
                        consecutive_missed_messages: Math.floor(timeSinceLastMessage / expectedInterval)
                    });

                    // Trigger offline alert
                    await triggerAlert({
                        device_id: device._id.toString(),
                        device_name: device.name,
                        alert_type: 'offline',
                        severity: 'critical',
                        throttling_config: {
                            repeat_interval_minutes: device.repeat_interval_minutes,
                            throttling_duration_minutes: device.throttling_duration_minutes
                        },
                        details: {
                            last_seen: device.last_seen,
                            expected_interval_seconds: device.expected_message_interval_seconds,
                            missed_messages: Math.floor(timeSinceLastMessage / expectedInterval),
                            offline_duration_minutes: Math.floor(timeSinceLastMessage / 60000)
                        }
                    });
                }
            } else {
                // Device is communicating
                if (device.status === 'offline') {
                    console.log(`Device ${device.name} is back online`);

                    // Atomic update to online status
                    await Device.findByIdAndUpdate(device._id, {
                        status: 'online',
                        consecutive_missed_messages: 0
                    });

                    // Resolve offline alert
                    await resolveAlert({
                        device_id: device._id.toString(),
                        device_name: device.name,
                        alert_type: 'offline',
                        details: {
                            offline_duration_minutes: Math.floor(timeSinceLastMessage / 60000)
                        }
                    });
                }

                // CHECK ENABLED SERVICES (Partial failure detection)
                // This is now the ONLY place where service_down alerts are detected (not resolved)
                if (device.status === 'online' && device.enabled_modules) {
                    for (const module of device.enabled_modules as string[]) {
                        if (module === 'system') continue; // Always checked via heartbeat

                        const lastSuccess = (device.last_successful_metrics as any)?.[module];
                        if (lastSuccess) {
                            const timeSinceSuccess = now.getTime() - new Date(lastSuccess).getTime();

                            // Trigger alert if service hasn't responded in 2 minutes
                            if (timeSinceSuccess > 120000) {
                                await triggerAlert({
                                    device_id: device._id.toString(),
                                    device_name: device.name,
                                    alert_type: 'service_down',
                                    severity: 'warning',
                                    specific_service: module,
                                    details: {
                                        last_successful: lastSuccess,
                                        missing_duration_minutes: Math.floor(timeSinceSuccess / 60000)
                                    }
                                });
                            }
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error in offline detection:', error);
    }
}

/**
 * Update device message timestamp
 * Called when a message is received from a device
 */
export async function updateDeviceHeartbeat(deviceId: string) {
    try {
        const now = new Date();
        const device = await Device.findById(deviceId);
        if (!device) return;

        // Atomic update of last_seen and status
        let updateData: any = {
            last_seen: now,
            consecutive_missed_messages: 0
        };

        const oldStatus = device.status;
        if (oldStatus === 'offline' || oldStatus === 'not_monitored') {
            updateData.status = 'online';
            console.log(`Device ${device.name} is now online (transitioned from ${oldStatus})`);
        }

        // Maintain rolling window using atomic $push and $slice
        await Device.findByIdAndUpdate(deviceId, {
            $set: updateData,
            $push: {
                last_message_timestamps: {
                    $each: [now],
                    $slice: -4
                }
            }
        });

        // Resolve offline alert if it was offline
        if (oldStatus === 'offline') {
            await resolveAlert({
                device_id: deviceId,
                device_name: device.name,
                alert_type: 'offline',
                details: { recovery_time: now }
            });
        }
    } catch (error) {
        console.error('Error updating device heartbeat:', error);
    }
}

/**
 * Update last successful metrics timestamp for a service
 */
export async function updateServiceMetrics(
    deviceId: string,
    service: string
) {
    try {
        const now = new Date();
        const updateField = `last_successful_metrics.${service}`;

        await Device.findByIdAndUpdate(deviceId, {
            $set: { [updateField]: now }
        });
    } catch (error) {
        console.error('Error updating service metrics:', error);
    }
}

// Run offline detection with dynamic interval
export async function startOfflineDetection() {
    console.log('Starting offline detection service...');

    const runDetection = async () => {
        try {
            await checkOfflineDevices();

            // Get latest interval from settings
            const settings = await SystemSettings.findOne();
            const intervalSeconds = settings?.monitoring_check_interval_seconds || 30;

            setTimeout(runDetection, intervalSeconds * 1000);
        } catch (error) {
            console.error('Error in offline detection loop:', error);
            setTimeout(runDetection, 30000); // Retry after 30s on error
        }
    };

    runDetection();
}
