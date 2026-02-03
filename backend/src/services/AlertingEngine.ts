import MonitoringCheck from '../models/MonitoringCheck';
import Alert from '../models/Alert';
import Device from '../models/Device';
import { NotificationService } from './NotificationService';

export class AlertingEngine {
    static async evaluate(device_id: string, metrics: any) {
        try {
            const device = await Device.findOne({ device_id });
            if (!device || device.monitoring_enabled === false) return;

            const checks = await MonitoringCheck.find({ device_id, enabled: true });

            for (const check of checks) {
                let currentVal: number | null = null;
                let unit = '%';

                if (check.check_type === 'cpu') {
                    currentVal = metrics.cpu_usage;
                } else if (check.check_type === 'memory') {
                    currentVal = metrics.memory_usage;
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

                let severity: 'critical' | 'warning' | null = null;
                if (check.thresholds.critical && currentVal >= check.thresholds.critical) {
                    severity = 'critical';
                } else if (check.thresholds.attention && currentVal >= check.thresholds.attention) {
                    severity = 'warning';
                }

                if (severity) {
                    const alertMessage = `${severity.toUpperCase()}: ${check.check_type.toUpperCase()} on ${device.hostname || device.device_id} is ${currentVal.toFixed(1)}${unit} (Target: ${check.target || 'System'})`;
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
        const cooldownMs = (check.notification_frequency || 60) * 60 * 1000;

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

        // Trigger notification
        const SystemSettings = (await import('../models/SystemSettings')).default;
        const settings = await SystemSettings.findOne();

        await NotificationService.send({
            subject: `IoTMonitor ALERT [${severity.toUpperCase()}]: ${device.hostname || device.device_id}`,
            message,
            channels: ['email', 'slack'],
            recipients: {
                email: settings?.notification_email_user || 'admin@company.com',
                slackWebhook: settings?.notification_slack_webhook || process.env.SLACK_WEBHOOK_URL
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
