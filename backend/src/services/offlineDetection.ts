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

                    // Mark device as offline
                    device.status = 'offline';
                    device.consecutive_missed_messages = Math.floor(timeSinceLastMessage / expectedInterval);
                    await device.save();

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

                    // Mark device as online
                    device.status = 'online';
                    device.consecutive_missed_messages = 0;
                    await device.save();

                    // Resolve offline alert and trigger recovery notification
                    await resolveAlert({
                        device_id: device._id.toString(),
                        device_name: device.name,
                        alert_type: 'offline',
                        details: {
                            offline_duration_minutes: Math.floor(timeSinceLastMessage / 60000)
                        }
                    });
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
        const device = await Device.findById(deviceId);
        if (!device) return;

        const now = new Date();

        // Update last_seen
        device.last_seen = now;

        // Maintain rolling window of last 4 timestamps
        if (!device.last_message_timestamps) {
            device.last_message_timestamps = [];
        }
        device.last_message_timestamps.push(now);
        if (device.last_message_timestamps.length > 4) {
            device.last_message_timestamps.shift();
        }

        // Reset missed messages counter
        device.consecutive_missed_messages = 0;

        // If device was offline or not monitored, mark it online
        if (device.status === 'offline' || device.status === 'not_monitored') {
            console.log(`Device ${device.name} is now online (transitioned from ${device.status})`);
            const oldStatus = device.status;
            device.status = 'online';

            await device.save();

            // Resolve offline alert if it was offline
            if (oldStatus === 'offline') {
                await resolveAlert({
                    device_id: device._id.toString(),
                    device_name: device.name,
                    alert_type: 'offline',
                    details: {
                        recovery_time: now
                    }
                });
            }
        } else {
            await device.save();
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
    service: 'system' | 'docker' | 'asterisk' | 'network'
) {
    try {
        const device = await Device.findById(deviceId);
        if (!device) return;

        if (!device.last_successful_metrics) {
            device.last_successful_metrics = {};
        }

        device.last_successful_metrics[service] = new Date();
        await device.save();
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
