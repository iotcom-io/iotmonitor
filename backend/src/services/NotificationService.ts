import nodemailer from 'nodemailer';
import axios from 'axios';

interface NotificationOptions {
    subject: string;
    message: string;
    channels: ('email' | 'slack' | 'whatsapp')[];
    recipients: {
        email?: string;
        slackWebhook?: string;
        phone?: string;
    };
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

        const slackUrl = options.recipients.slackWebhook || process.env.SLACK_WEBHOOK_URL;

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

        await Promise.allSettled(promises);
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
}
