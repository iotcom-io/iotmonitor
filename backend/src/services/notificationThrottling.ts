import AlertTracking from '../models/AlertTracking';
import SystemSettings from '../models/SystemSettings';
import { sendNotification, sendRecoveryNotification } from './notifications';

/**
 * Notification Throttling Service
 * 
 * Manages alert lifecycle and notification throttling:
 * 1. New alert -> Immediate notification
 * 2. Throttling phase -> Repeat at configurable intervals for limited duration
 * 3. Hourly only phase -> Only included in hourly digest
 * 4. Resolved -> Immediate recovery notification
 */

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

/**
 * Trigger a new alert or update existing one
 */
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
            throttling_config = {}
        } = params;

        // Check if alert already exists for this device/type/service/endpoint
        const existingAlert = await AlertTracking.findOne({
            device_id,
            alert_type,
            specific_service: specific_service || { $exists: false },
            specific_endpoint: specific_endpoint || { $exists: false },
            state: { $ne: 'resolved' }
        });

        if (existingAlert) {
            // Alert already exists and is active
            console.log(`Alert already active for device ${device_name}: ${alert_type}`);
            return existingAlert;
        }

        // Get defaults from settings
        const settings = await SystemSettings.findOne();

        // Create new alert
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
            throttling_config: {
                repeat_interval_minutes: throttling_config.repeat_interval_minutes || settings?.default_repeat_interval_minutes || 5,
                throttling_duration_minutes: throttling_config.throttling_duration_minutes || settings?.default_throttling_duration_minutes || 60
            },
            details
        });

        await alert.save();

        // Send immediate notification
        await sendNotification(alert, device_name);

        // Move to throttling state
        alert.state = 'throttling';
        await alert.save();

        console.log(`New alert triggered for device ${device_name}: ${alert_type} (${severity})`);
        return alert;
    } catch (error) {
        console.error('Error triggering alert:', error);
        throw error;
    }
}

/**
 * Resolve an existing alert
 */
export async function resolveAlert(params: ResolveAlertParams) {
    try {
        const {
            device_id,
            device_name,
            alert_type,
            specific_service,
            specific_endpoint,
            details = {}
        } = params;

        // Find active alert
        const alert = await AlertTracking.findOne({
            device_id,
            alert_type,
            specific_service: specific_service || { $exists: false },
            specific_endpoint: specific_endpoint || { $exists: false },
            state: { $ne: 'resolved' }
        });

        if (!alert) {
            console.log(`No active alert found for device ${device_name}: ${alert_type}`);
            return null;
        }

        // Calculate duration
        const duration_ms = new Date().getTime() - alert.first_triggered.getTime();
        const duration_minutes = Math.floor(duration_ms / 60000);
        const duration_seconds = Math.floor(duration_ms / 1000);

        // Mark as resolved
        alert.state = 'resolved';
        alert.resolved_at = new Date();
        alert.details = { ...alert.details, ...details, duration_minutes, duration_seconds };
        await alert.save();

        // Send recovery notification
        await sendRecoveryNotification(alert, device_name);

        console.log(`Alert resolved for device ${device_name}: ${alert_type} (duration: ${duration_minutes} min)`);
        return alert;
    } catch (error) {
        console.error('Error resolving alert:', error);
        throw error;
    }
}

/**
 * Process throttled alerts
 * Called periodically to send throttled notifications
 */
export async function processThrottledAlerts() {
    try {
        const now = new Date();

        // Find all alerts in throttling state
        const throttledAlerts = await AlertTracking.find({ state: 'throttling' });

        for (const alert of throttledAlerts) {
            const timeSinceLastNotification = (now.getTime() - alert.last_notified.getTime()) / 60000;
            const timeSinceFirstTrigger = (now.getTime() - alert.first_triggered.getTime()) / 60000;

            // Check if we should send another notification
            if (timeSinceLastNotification >= alert.throttling_config.repeat_interval_minutes) {
                // Check if still within throttling duration
                if (timeSinceFirstTrigger < alert.throttling_config.throttling_duration_minutes) {
                    // Send throttled notification
                    const device = await import('../models/Device');
                    const deviceDoc = await device.default.findById(alert.device_id);

                    if (deviceDoc) {
                        alert.notification_count += 1;
                        alert.last_notified = now;
                        await alert.save();

                        await sendNotification(alert, deviceDoc.name, true); // true = is_reminder
                    }
                } else {
                    // Throttling period expired, move to hourly_only
                    alert.state = 'hourly_only';
                    await alert.save();
                    console.log(`Alert moved to hourly-only for device: ${alert.device_id} (${alert.alert_type})`);
                }
            }
        }
    } catch (error) {
        console.error('Error processing throttled alerts:', error);
    }
}

/**
 * Start throttling service
 */
export function startThrottlingService() {
    console.log('Starting notification throttling service...');

    // Check throttled alerts every minute
    setInterval(processThrottledAlerts, 60000);
}
