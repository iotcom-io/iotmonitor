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
    const parts = topic.split('/');
    // iotmonitor/device/{device_id}/status
    // iotmonitor/device/{device_id}/metrics/{check_type}

    if (parts.length >= 4 && parts[1] === 'device') {
        const device_id = parts[2];
        const type = parts[3];

        if (type === 'status') {
            const status = message.toString();
            await Device.findOneAndUpdate({ device_id }, { status, last_seen: new Date() });
        } else if (type === 'metrics') {
            const check_type = parts[4];
            const payload = JSON.parse(message.toString());

            // Update device heartbeat
            await Device.findOneAndUpdate({ device_id }, { last_seen: new Date() });

            // Evaluate thresholds and trigger alerts
            const { AlertingEngine } = await import('./AlertingEngine');
            await AlertingEngine.evaluate(device_id, { [check_type]: payload });
        }
    }
});

export const publishCommand = (device_id: string, command: any) => {
    const topic = `iotmonitor/device/${device_id}/commands`;
    client.publish(topic, JSON.stringify(command));
};

export default client;
