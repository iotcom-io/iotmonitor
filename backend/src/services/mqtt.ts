import mqtt from 'mqtt';
import Device from '../models/Device';
import Alert from '../models/Alert';

const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const client = mqtt.connect(MQTT_URL);

client.on('connect', () => {
    console.log('Connected to MQTT Broker');
    client.subscribe('iotmonitor/device/+/status');
    client.subscribe('iotmonitor/device/+/metrics/+');
});

client.on('message', async (topic, message) => {
    try {
        const parts = topic.split('/');
        if (parts.length >= 4 && parts[1] === 'device') {
            const device_id = parts[2];
            const type = parts[3];

            const device = await Device.findOne({ device_id });

            if (type === 'status') {
                const status = message.toString();
                const oldStatus = device?.status;

                await Device.findOneAndUpdate({ device_id }, { status, last_seen: new Date() });

                // Notify if status changed
                if (device && oldStatus !== status) {
                    const { NotificationService } = await import('./NotificationService');
                    const settings = await (await import('../models/SystemSettings')).default.findOne();

                    await NotificationService.send({
                        subject: `Device Status Change: ${device.name}`,
                        message: `Device ${device.name} is now ${status.toUpperCase()}`,
                        channels: ['slack'],
                        recipients: { slackWebhook: settings?.notification_slack_webhook }
                    });
                }
            } else if (type === 'metrics') {
                if (!device) return;

                const check_type = parts[4];
                const payload = JSON.parse(message.toString());

                await Device.findOneAndUpdate({ device_id }, { last_seen: new Date() });

                if (check_type === 'system') {
                    const Telemetry = (await import('../models/Telemetry')).default;
                    await new Telemetry({
                        device_id,
                        cpu_usage: payload.cpu_usage || 0,
                        memory_usage: payload.memory_usage || 0,
                        disk_usage: payload.disk_usage || 0,
                        network_in: payload.network_in,
                        network_out: payload.network_out,
                        extra: payload.extra
                    }).save();
                }

                const { AlertingEngine } = await import('./AlertingEngine');
                await AlertingEngine.evaluate(device_id, { [check_type]: payload });
            }
        }
    } catch (err) {
        console.error('[MQTT] Handler Error:', err);
    }
});

export const publishCommand = (device_id: string, command: any) => {
    const topic = `iotmonitor/device/${device_id}/commands`;
    client.publish(topic, JSON.stringify(command));
};

export default client;
