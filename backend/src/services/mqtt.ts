import mqtt from 'mqtt';
import Device from '../models/Device';
import { updateDeviceHeartbeat } from './offlineDetection';
import { checkServiceHealth, checkSIPEndpoints } from './serviceMonitoring';

const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const DEBUG_MQTT = process.env.DEBUG_MQTT === 'true';
const client = mqtt.connect(MQTT_URL);
let mqttConnectedAt = 0;

const areStringArraysEqual = (a: string[] = [], b: string[] = []) => {
    if (a.length !== b.length) return false;
    const sa = [...a].sort();
    const sb = [...b].sort();
    return sa.every((v, i) => v === sb[i]);
};

const notifyIPChange = async (device: any, type: 'public' | 'local', previousValue: string | string[], currentValue: string | string[]) => {
    try {
        const { NotificationService } = await import('./NotificationService');
        const settings = await (await import('../models/SystemSettings')).default.findOne();

        const previous = Array.isArray(previousValue) ? previousValue.join(', ') || 'None' : previousValue || 'None';
        const current = Array.isArray(currentValue) ? currentValue.join(', ') || 'None' : currentValue || 'None';

        await NotificationService.send({
            subject: `IP Change Detected: ${device.name}`,
            message: `${type === 'public' ? 'Public' : 'Local'} IP changed for ${device.name}\nPrevious: ${previous}\nCurrent: ${current}`,
            channels: ['slack'],
            recipients: { slackWebhook: settings?.notification_slack_webhook || device.notification_slack_webhook },
        });
    } catch (err) {
        console.error('[MQTT] Failed to send IP change notification:', err);
    }
};

client.on('connect', () => {
    console.log('Connected to MQTT Broker');
    mqttConnectedAt = Date.now();
    client.subscribe('iotmonitor/device/+/status');
    client.subscribe('iotmonitor/device/+/metrics/+');
    client.subscribe('iotmonitor/device/+/responses');
});

client.on('message', async (topic, message, packet) => {
    try {
        if (DEBUG_MQTT) {
            console.log(`[MQTT][IN] ${topic} (${message.length} bytes)`);
        }

        const parts = topic.split('/');
        if (parts.length < 4 || parts[1] !== 'device') return;

        const device_id = parts[2];
        const type = parts[3];
        const device = await Device.findOne({ device_id });
        if (!device) return;

        if (type === 'status') {
            const status = message.toString().trim().toLowerCase();
            const oldStatus = String(device.status || '').toLowerCase();
            const isRetained = packet?.retain === true;
            const isStartupSync = Date.now() - mqttConnectedAt < 60000;

            // Do not treat retained status as heartbeat/notification events.
            // On backend restart, broker retained messages are state sync snapshots, not fresh transitions.
            if (isRetained && isStartupSync) {
                if (oldStatus !== status) {
                    await Device.findOneAndUpdate({ device_id }, { status });
                }
                return;
            }

            // Heartbeat only for non-offline status to avoid false "back online"
            // from retained offline messages.
            if (status && status !== 'offline') {
                await updateDeviceHeartbeat(device_id);
            }

            if (oldStatus !== status) {
                await Device.findOneAndUpdate(
                    { device_id },
                    {
                        status,
                        ...(status !== 'offline' ? { last_seen: new Date() } : {}),
                    }
                );

                if (!device.monitoring_paused) {
                    const { NotificationService } = await import('./NotificationService');
                    const settings = await (await import('../models/SystemSettings')).default.findOne();

                    await NotificationService.send({
                        subject: `Device Status Change: ${device.name}`,
                        message: `Device ${device.name} is now ${status.toUpperCase()}`,
                        channels: ['slack'],
                        recipients: { slackWebhook: settings?.notification_slack_webhook },
                    });
                }
            }
            return;
        }

        if (type === 'metrics') {
            const check_type = parts[4];
            const payload = JSON.parse(message.toString());

            await updateDeviceHeartbeat(device_id);

            const freshDevice = await Device.findOne({ device_id });
            if (!freshDevice) return;

            // If monitoring is paused, skip telemetry persistence, alerts and real-time UI stream.
            if (freshDevice.monitoring_paused) {
                return;
            }

            const Telemetry = (await import('../models/Telemetry')).default;
            const CONSOLIDATION_WINDOW_MS = 2000;

            const recentTelemetry = await Telemetry.findOne({
                device_id,
                timestamp: { $gte: new Date(Date.now() - CONSOLIDATION_WINDOW_MS) },
            }).sort({ timestamp: -1 });

            if (recentTelemetry) {
                const updateData: any = {};

                if (check_type === 'system') {
                    if (payload.cpu_usage !== undefined) updateData.cpu_usage = payload.cpu_usage;
                    if (payload.cpu_load !== undefined) updateData.cpu_load = payload.cpu_load;
                    if (payload.cpu_per_core) updateData.cpu_per_core = payload.cpu_per_core;
                    if (payload.memory_usage !== undefined) updateData.memory_usage = payload.memory_usage;
                    if (payload.memory_used !== undefined) updateData.memory_used = payload.memory_used;
                    if (payload.memory_available !== undefined) updateData.memory_available = payload.memory_available;
                    if (payload.memory_cached !== undefined) updateData.memory_cached = payload.memory_cached;
                    if (payload.memory_buffers !== undefined) updateData.memory_buffers = payload.memory_buffers;
                    if (payload.memory_total !== undefined) {
                        updateData.memory_total = payload.memory_total;
                        await Device.findOneAndUpdate({ device_id }, {
                            memory_total: payload.memory_total,
                            disk_total: payload.disk_total,
                            hostname: payload.hostname || freshDevice.hostname,
                        });
                    }
                    if (payload.disk_usage !== undefined) updateData.disk_usage = payload.disk_usage;
                    if (payload.disk_used !== undefined) updateData.disk_used = payload.disk_used;
                    if (payload.disk_total !== undefined) updateData.disk_total = payload.disk_total;

                    if (payload.extra) {
                        for (const key in payload.extra) {
                            recentTelemetry.extra = recentTelemetry.extra || {};
                            recentTelemetry.extra[key] = payload.extra[key];
                        }
                        recentTelemetry.markModified('extra');
                    }
                } else if (check_type === 'network') {
                    if (payload.public_ip) updateData.public_ip = payload.public_ip;
                    if (payload.local_ips) updateData.local_ips = payload.local_ips;

                    if (payload.public_ip || payload.local_ips) {
                        const previousPublicIP = freshDevice.public_ip || '';
                        const previousLocalIPs = (freshDevice.local_ips || []) as string[];
                        const nextPublicIP = payload.public_ip || '';
                        const nextLocalIPs = Array.isArray(payload.local_ips) ? payload.local_ips : previousLocalIPs;

                        await Device.findOneAndUpdate({ device_id }, {
                            public_ip: payload.public_ip,
                            local_ips: payload.local_ips,
                        });

                        if (nextPublicIP && previousPublicIP && nextPublicIP !== previousPublicIP) {
                            await notifyIPChange(freshDevice, 'public', previousPublicIP, nextPublicIP);
                        }

                        if (!areStringArraysEqual(previousLocalIPs, nextLocalIPs)) {
                            await notifyIPChange(freshDevice, 'local', previousLocalIPs, nextLocalIPs);
                        }
                    }

                    if (payload.ping_results || payload.port_results || payload.interfaces) {
                        recentTelemetry.extra = recentTelemetry.extra || {};
                        if (payload.ping_results) recentTelemetry.extra.ping_results = payload.ping_results;
                        if (payload.port_results) recentTelemetry.extra.port_results = payload.port_results;
                        if (payload.interfaces) recentTelemetry.extra.interfaces = payload.interfaces;
                        recentTelemetry.markModified('extra');
                    }
                } else if (check_type === 'docker') {
                    recentTelemetry.extra = recentTelemetry.extra || {};
                    recentTelemetry.extra.docker = payload;
                    recentTelemetry.markModified('extra');
                } else if (check_type === 'asterisk') {
                    recentTelemetry.extra = recentTelemetry.extra || {};
                    Object.assign(recentTelemetry.extra, payload);
                    recentTelemetry.markModified('extra');
                }

                Object.assign(recentTelemetry, updateData);
                await recentTelemetry.save();
            } else {
                if (check_type === 'system') {
                    if (payload.hostname || payload.memory_total || payload.disk_total) {
                        await Device.findOneAndUpdate({ device_id }, {
                            hostname: payload.hostname || freshDevice.hostname,
                            memory_total: payload.memory_total || freshDevice.memory_total,
                            disk_total: payload.disk_total || freshDevice.disk_total,
                        });
                    }

                    await new Telemetry({
                        device_id,
                        cpu_usage: payload.cpu_usage || 0,
                        cpu_load: payload.cpu_load,
                        cpu_per_core: payload.cpu_per_core,
                        memory_usage: payload.memory_usage || 0,
                        memory_total: payload.memory_total,
                        memory_used: payload.memory_used,
                        memory_available: payload.memory_available,
                        memory_cached: payload.memory_cached,
                        memory_buffers: payload.memory_buffers,
                        disk_usage: payload.disk_usage || 0,
                        disk_total: payload.disk_total,
                        disk_used: payload.disk_used,
                        network_in: payload.network_in,
                        network_out: payload.network_out,
                        extra: payload.extra,
                    }).save();
                } else if (check_type === 'network') {
                    const previousPublicIP = freshDevice.public_ip || '';
                    const previousLocalIPs = (freshDevice.local_ips || []) as string[];
                    const nextPublicIP = payload.public_ip || '';
                    const nextLocalIPs = Array.isArray(payload.local_ips) ? payload.local_ips : previousLocalIPs;

                    if (payload.public_ip || payload.local_ips) {
                        await Device.findOneAndUpdate({ device_id }, {
                            public_ip: payload.public_ip,
                            local_ips: payload.local_ips,
                        });
                    }

                    if (nextPublicIP && previousPublicIP && nextPublicIP !== previousPublicIP) {
                        await notifyIPChange(freshDevice, 'public', previousPublicIP, nextPublicIP);
                    }

                    if (!areStringArraysEqual(previousLocalIPs, nextLocalIPs)) {
                        await notifyIPChange(freshDevice, 'local', previousLocalIPs, nextLocalIPs);
                    }

                    await new Telemetry({
                        device_id,
                        public_ip: payload.public_ip,
                        local_ips: payload.local_ips,
                        extra: {
                            ping_results: payload.ping_results,
                            port_results: payload.port_results,
                            interfaces: payload.interfaces,
                        },
                    }).save();
                } else if (check_type === 'docker') {
                    await new Telemetry({
                        device_id,
                        extra: {
                            docker: payload,
                        },
                    }).save();
                } else if (check_type === 'asterisk') {
                    await new Telemetry({
                        device_id,
                        extra: payload,
                    }).save();
                }
            }

            await checkServiceHealth(device_id, { [check_type]: payload });

            if (check_type === 'asterisk') {
                await checkSIPEndpoints(device_id, payload);
            }

            try {
                const { getIO } = await import('./socket');
                const io = getIO();
                io.emit('device:update', {
                    device_id,
                    status: 'online',
                    metrics: payload,
                });
            } catch (socketErr) {
                console.error('[MQTT] Socket Emit Error:', socketErr);
            }
            return;
        }

        if (type === 'responses') {
            const payload = JSON.parse(message.toString());
            try {
                const { getIO } = await import('./socket');
                const io = getIO();
                io.emit(`terminal:output:${device_id}`, payload);
            } catch (socketErr) {
                console.error('[MQTT] Terminal Response Emit Error:', socketErr);
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
