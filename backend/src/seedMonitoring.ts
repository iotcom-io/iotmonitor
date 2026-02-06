import MonitoringTemplate from './models/MonitoringTemplate';
import NotificationChannel from './models/NotificationChannel';

/**
 * Seed predefined monitoring templates
 */
export async function seedMonitoringTemplates() {
    try {
        const templates = [
            {
                name: 'Basic Server',
                description: 'Essential monitoring for Linux/Windows servers',
                device_types: ['server'],
                icon: '🖥️',
                is_system: true,
                default_rules: [
                    {
                        check_type: 'cpu',
                        enabled: true,
                        interval: 60,
                        thresholds: { attention: 80, critical: 95 }
                    },
                    {
                        check_type: 'memory',
                        enabled: true,
                        interval: 60,
                        thresholds: { attention: 85, critical: 95 }
                    },
                    {
                        check_type: 'disk',
                        enabled: true,
                        interval: 60,
                        thresholds: { attention: 80, critical: 90 }
                    },
                    {
                        check_type: 'offline_detection',
                        enabled: true
                    }
                ]
            },
            {
                name: 'Web Server',
                description: 'Web server monitoring with Docker service checks',
                device_types: ['server'],
                icon: '🌐',
                is_system: true,
                default_rules: [
                    {
                        check_type: 'cpu',
                        enabled: true,
                        interval: 60,
                        thresholds: { attention: 70, critical: 90 }
                    },
                    {
                        check_type: 'memory',
                        enabled: true,
                        interval: 60,
                        thresholds: { attention: 80, critical: 90 }
                    },
                    {
                        check_type: 'disk',
                        enabled: true,
                        interval: 60,
                        thresholds: { attention: 75, critical: 85 }
                    },
                    {
                        check_type: 'docker',
                        enabled: true
                    },
                    {
                        check_type: 'offline_detection',
                        enabled: true
                    }
                ]
            },
            {
                name: 'VoIP Server',
                description: 'Asterisk/SIP server with trunk monitoring',
                device_types: ['server'],
                icon: '📞',
                is_system: true,
                default_rules: [
                    {
                        check_type: 'cpu',
                        enabled: true,
                        interval: 60,
                        thresholds: { attention: 75, critical: 90 }
                    },
                    {
                        check_type: 'memory',
                        enabled: true,
                        interval: 60,
                        thresholds: { attention: 80, critical: 90 }
                    },
                    {
                        check_type: 'sip',
                        enabled: true,
                        target_endpoints: 'all',
                        thresholds: { latency: 200 }
                    },
                    {
                        check_type: 'sip_registration',
                        enabled: true
                    },
                    {
                        check_type: 'offline_detection',
                        enabled: true
                    }
                ]
            },
            {
                name: 'Network Device',
                description: 'Network monitoring with interface checks',
                device_types: ['network_device'],
                icon: '🌐',
                is_system: true,
                default_rules: [
                    {
                        check_type: 'network',
                        enabled: true,
                        target_endpoints: 'all'
                    },
                    {
                        check_type: 'ping',
                        enabled: true,
                        thresholds: { latency: 100 }
                    },
                    {
                        check_type: 'offline_detection',
                        enabled: true
                    }
                ]
            }
        ];

        for (const template of templates) {
            await MonitoringTemplate.findOneAndUpdate(
                { name: template.name },
                template,
                { upsert: true, new: true }
            );
        }

        console.log(`✅ Seeded ${templates.length} monitoring templates`);
    } catch (error) {
        console.error('Error seeding monitoring templates:', error);
    }
}

/**
 * Create default notification channel if none exists
 */
export async function seedDefaultNotificationChannel() {
    try {
        const count = await NotificationChannel.countDocuments();

        if (count === 0) {
            // Create default Slack channel
            const defaultChannel = new NotificationChannel({
                name: 'Default Slack',
                description: 'Default notification channel for all alerts',
                type: 'slack',
                enabled: true,
                config: {
                    slack_webhook_url: process.env.SLACK_WEBHOOK_URL || '',
                    slack_group_name: 'General Alerts'
                },
                alert_types: ['offline', 'online', 'service_down', 'sip_issue', 'high_latency', 'threshold'],
                severity_levels: ['info', 'warning', 'critical']
            });

            await defaultChannel.save();
            console.log('✅ Created default notification channel');
        }
    } catch (error) {
        console.error('Error seeding notification channels:', error);
    }
}
