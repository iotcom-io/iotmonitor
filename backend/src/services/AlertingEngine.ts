import MonitoringCheck from '../models/MonitoringCheck';
import Alert from '../models/Alert';
import Device from '../models/Device';
import { NotificationService } from './NotificationService';

export class AlertingEngine {
    static async evaluate(device_id: string, metrics: any) {
        try {
            const device = await Device.findOne({ device_id });
            if (!device) return;

            const checks = await MonitoringCheck.find({ device_id, enabled: true });

            for (const check of checks) {
                let isTriggered = false;
                let alertMessage = '';

                if (check.check_type === 'cpu' && metrics.cpu && check.thresholds.critical) {
                    if (metrics.cpu > check.thresholds.critical) {
                        isTriggered = true;
                        alertMessage = `CRITICAL: CPU usage on ${device.name} is ${metrics.cpu.toFixed(1)}% (Threshold: ${check.thresholds.critical}%)`;
                    }
                }

                if (check.check_type === 'memory' && metrics.memory && check.thresholds.critical) {
                    if (metrics.memory > check.thresholds.critical) {
                        isTriggered = true;
                        alertMessage = `CRITICAL: Memory usage on ${device.name} is ${metrics.memory.toFixed(1)}% (Threshold: ${check.thresholds.critical}%)`;
                    }
                }

                if (isTriggered) {
                    await this.processAlert(device, check, alertMessage);
                }
            }
        } catch (err) {
            console.error('Alerting engine error:', err);
        }
    }

    private static async processAlert(device: any, check: any, message: string) {
        // Check for existing unresolved alert
        const existingAlert = await Alert.findOne({
            device_id: device.device_id,
            check_id: check._id,
            resolved: false
        });

        if (existingAlert) return; // Don't spam alerts

        const alert = new Alert({
            device_id: device.device_id,
            check_id: check._id,
            severity: 'critical',
            message,
        });

        await alert.save();

        // Trigger notification using stored settings
        const SystemSettings = (await import('../models/SystemSettings')).default;
        const settings = await SystemSettings.findOne();

        await NotificationService.send({
            subject: `IoTMonitor Alert: ${device.name}`,
            message,
            channels: ['email', 'slack'],
            recipients: {
                email: settings?.notification_email_user || 'admin@company.com',
                slackWebhook: settings?.notification_slack_webhook || process.env.SLACK_WEBHOOK_URL
            }
        });
    }
}
