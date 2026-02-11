import nodemailer from 'nodemailer';
import axios from 'axios';
import SystemSettings from '../models/SystemSettings';
import NotificationChannel from '../models/NotificationChannel';

interface NotificationOptions {
    subject: string;
    message: string;
    channelIds?: string[];
    channels: ('email' | 'slack' | 'whatsapp' | 'custom')[];
    recipients: {
        email?: string;
        slackWebhook?: string;
        customWebhookName?: string;
        phone?: string;
    };
    deviceSlack?: string;
}

export class NotificationService {
    private static transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.mailtrap.io',
        port: parseInt(process.env.SMTP_PORT || '2525'),
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });

    static async send(options: NotificationOptions) {
        const promises = [];

        const settings = await SystemSettings.findOne();

        const explicitChannelIds = Array.isArray(options.channelIds)
            ? Array.from(new Set(options.channelIds.map((entry) => String(entry || '').trim()).filter(Boolean)))
            : [];

        let configuredChannels: any[] = [];
        if (explicitChannelIds.length > 0) {
            configuredChannels = await NotificationChannel.find({
                _id: { $in: explicitChannelIds },
                enabled: true,
            });
        } else {
            configuredChannels = await NotificationChannel.find({
                enabled: true,
                is_default: true,
            });
        }

        if (configuredChannels.length > 0) {
            await Promise.allSettled(
                configuredChannels.map((channel) => this.sendViaConfiguredChannel(channel, options.subject, options.message))
            );
            return;
        }

        let slackUrl = options.recipients.slackWebhook || options.deviceSlack || process.env.SLACK_WEBHOOK_URL;
        if (!slackUrl && options.channels.includes('slack')) {
            slackUrl = settings?.notification_slack_webhook || settings?.slack_webhooks?.[0]?.url;
        }

        if (options.channels.includes('email') && options.recipients.email) {
            promises.push(this.sendEmail(options.recipients.email, options.subject, options.message));
        }

        if (options.channels.includes('slack')) {
            if (slackUrl) {
                promises.push(this.sendSlack(slackUrl, options.message));
            } else {
                console.warn('[NotificationService] Slack channel requested but no webhook configured.');
            }
        }

        if (options.channels.includes('custom') && options.recipients.customWebhookName) {
            promises.push(this.sendCustom(options.recipients.customWebhookName, options.message, settings));
        }

        await Promise.allSettled(promises);
    }

    private static async sendViaConfiguredChannel(channel: any, subject: string, message: string) {
        const channelType = String(channel.type || '').toLowerCase();
        const config = channel.config || {};

        if (channelType === 'slack') {
            const slackUrl = String(config.slack_webhook_url || '').trim();
            if (!slackUrl) {
                console.warn(`[NotificationService] Slack channel '${channel.name}' has no webhook URL`);
                return;
            }
            await this.sendSlack(slackUrl, message);
            return;
        }

        if (channelType === 'email') {
            const recipients = Array.isArray(config.email_addresses)
                ? config.email_addresses.map((entry: any) => String(entry || '').trim()).filter(Boolean)
                : [];
            if (recipients.length === 0) {
                console.warn(`[NotificationService] Email channel '${channel.name}' has no email addresses`);
                return;
            }
            await Promise.allSettled(recipients.map((email: string) => this.sendEmail(email, subject, message)));
            return;
        }

        if (channelType === 'webhook') {
            const webhookUrl = String(config.webhook_url || '').trim();
            if (!webhookUrl) {
                console.warn(`[NotificationService] Webhook channel '${channel.name}' has no URL`);
                return;
            }
            await axios.post(webhookUrl, {
                subject,
                message,
                channel: channel.name,
                timestamp: new Date().toISOString(),
            });
            return;
        }

        if (channelType === 'sms') {
            console.warn(`[NotificationService] SMS channel '${channel.name}' is not implemented yet`);
            return;
        }
    }

    private static async sendEmail(to: string, subject: string, text: string) {
        try {
            await this.transporter.sendMail({
                from: '"IoTMonitor Alerts" <alerts@iotmonitor.io>',
                to,
                subject,
                text,
            });
            console.log(`Email sent to ${to}`);
        } catch (err) {
            console.error('Failed to send email:', err);
        }
    }

    private static async sendSlack(webhookUrl: string, text: string) {
        try {
            await axios.post(webhookUrl, { text });
            console.log('Slack notification sent');
        } catch (err) {
            console.error('Failed to send Slack message:', err);
        }
    }

    private static async sendCustom(name: string, text: string, settings: any) {
        try {
            const target = settings?.custom_webhooks?.find((c: any) => c.name === name);
            if (!target) {
                console.warn(`[NotificationService] custom webhook '${name}' not found`);
                return;
            }
            await axios.request({
                url: target.url,
                method: target.method || 'POST',
                headers: target.headers || { 'Content-Type': 'application/json' },
                data: target.body ? target.body.replace('{{message}}', text) : { message: text },
            });
            console.log(`Custom webhook '${name}' sent`);
        } catch (err) {
            console.error('Failed to send custom webhook:', err);
        }
    }
}
