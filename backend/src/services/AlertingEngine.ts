import MonitoringCheck from '../models/MonitoringCheck';
import Alert from '../models/Alert';
import Device from '../models/Device';
import { NotificationService } from './NotificationService';
import SystemSettings from '../models/SystemSettings';

export class AlertingEngine {
    static async evaluate(device_id: string, metrics: any, check_type?: string) {
        try {
            const device = await Device.findOne({ device_id });
            if (!device || device.monitoring_enabled === false) return;

            const checks = await MonitoringCheck.find({ device_id, enabled: true });
            const settings = await SystemSettings.findOne();

            for (const check of checks) {
                // Only evaluate checks that match the incoming metric type if provided
                const isAsteriskRelated = check_type === 'asterisk' && (check.check_type === 'sip' || check.check_type === 'sip_registration');
                if (check_type && check.check_type !== check_type && !isAsteriskRelated) {
                    continue;
                }

                let currentVal: number | null = null;
                let unit = '%';

                if (check.check_type === 'cpu') {
                    currentVal = metrics.cpu_usage;
                } else if (check.check_type === 'memory') {
                    currentVal = metrics.memory_usage;
                } else if (check.check_type === 'sip_registration' && metrics.summary) {
                    unit = 'registrations';
                    const total = metrics.summary.registrationsTotal || 0;
                    const ok = metrics.summary.registrationsRegistered || 0;
                    currentVal = total === 0 ? null : (ok / total) * 100; // percent registered
                } else if (check.check_type === 'sip' && metrics.extra?.contacts) {
                    unit = 'ms';
                    const contact = metrics.extra.contacts.find((c: any) => c.aor === check.target);
                    if (contact && contact.rttMs) {
                        currentVal = contact.rttMs;
                    } else if (contact && contact.status === 'Unavail') {
                        // High penalty for Unavailable
                        currentVal = 9999;
                    }
                } else if (check.check_type === 'bandwidth' && metrics.extra?.interfaces) {
                    unit = 'bps';
                    const iface = metrics.extra.interfaces.find((i: any) => i.name === check.target);
                    if (iface) {
                        currentVal = Math.max(iface.rx_bps, iface.tx_bps);
                    }
                }

                if (currentVal === null) continue;

                // Apply thresholds with defaults from settings if missing
                const thresholds = {
                    attention: check.thresholds.attention ?? settings?.default_thresholds?.[check.check_type]?.attention,
                    critical: check.thresholds.critical ?? settings?.default_thresholds?.[check.check_type]?.critical
                };

                let severity: 'critical' | 'warning' | null = null;
                const isLowerBetter = check.check_type === 'sip_registration';
                if (isLowerBetter) {
                    if (thresholds.critical && currentVal <= thresholds.critical) {
                        severity = 'critical';
                    } else if (thresholds.attention && currentVal <= thresholds.attention) {
                        severity = 'warning';
                    }
                } else {
                    if (thresholds.critical && currentVal >= thresholds.critical) {
                        severity = 'critical';
                    } else if (thresholds.attention && currentVal >= thresholds.attention) {
                        severity = 'warning';
                    }
                }

                if (severity) {
                    const alertMessage = `${severity.toUpperCase()}: ${check.check_type.toUpperCase()} on ${device.hostname || device.device_id} is ${currentVal.toFixed(1)}${unit} (Target: ${check.target || 'System'})`;
                    console.log('[Alert] Trigger', { device: device.device_id, type: check.check_type, severity, value: currentVal, thresholds });
                    await this.processAlert(device, check, severity, alertMessage);
                } else {
                    // Potential recovery
                    await this.checkRecovery(device, check);
                }
            }
        } catch (err) {
            console.error('Alerting engine error:', err);
        }
    }

    private static async processAlert(device: any, check: any, severity: 'critical' | 'warning', message: string) {
        // Use per-check frequency or system default
        const settings = await SystemSettings.findOne();
        const cooldownMinutes = check.notification_frequency || settings?.default_notification_frequency || 60;
        const cooldownMs = cooldownMinutes * 60 * 1000;

        const lastAlert = await Alert.findOne({
            device_id: device.device_id,
            check_id: check._id,
        }).sort({ created_at: -1 });

        // If active unresolved alert exists, check cooldown
        if (lastAlert && !lastAlert.resolved) {
            const timeSinceLast = Date.now() - new Date(lastAlert.created_at).getTime();
            if (timeSinceLast < cooldownMs) return; // Still in cooldown
        }

        const alert = new Alert({
            device_id: device.device_id,
            check_id: check._id,
            severity,
            message,
        });

        await alert.save();

        // Trigger notification using device-specific webhook or system defaults
        const slackWebhook = device.notification_slack_webhook || settings?.notification_slack_webhook || settings?.slack_webhooks?.[0]?.url || process.env.SLACK_WEBHOOK_URL;
        const customWebhookName = check.config?.custom_webhook_name;

        await NotificationService.send({
            subject: `IoTMonitor ALERT [${severity.toUpperCase()}]: ${device.hostname || device.device_id}`,
            message,
            channels: ['email', 'slack', ...(customWebhookName ? ['custom'] : [])],
            recipients: {
                email: settings?.notification_email_user || 'admin@company.com',
                slackWebhook,
                customWebhookName
            }
        });
    }

    private static async checkRecovery(device: any, check: any) {
        const lastAlert = await Alert.findOne({
            device_id: device.device_id,
            check_id: check._id,
            resolved: false
        });

        if (lastAlert) {
            lastAlert.resolved = true;
            await lastAlert.save();

            const recoveryMsg = `RECOVERY: ${check.check_type.toUpperCase()} on ${device.hostname || device.device_id} has returned to normal levels.`;

            // Explicitly notify on restoration if desired
            await NotificationService.send({
                subject: `IoTMonitor RECOVERY: ${device.hostname || device.device_id}`,
                message: recoveryMsg,
                channels: ['email', 'slack'],
                recipients: {} // NotificationService will use defaults
            });
        }
    }
}
