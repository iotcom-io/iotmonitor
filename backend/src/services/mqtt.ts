import mqtt from 'mqtt';
import Device from '../models/Device';
import { updateDeviceHeartbeat } from './offlineDetection';
import { checkServiceHealth, checkSIPEndpoints } from './serviceMonitoring';
import { setMqttBrokerConnected } from './mqttState';

const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
const DEBUG_MQTT = process.env.DEBUG_MQTT === 'true';
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata';
const client = mqtt.connect(MQTT_URL, {
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
});
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
        const changedAt = new Date().toLocaleString('en-US', { timeZone: APP_TIMEZONE });
        const ipTypeLabel = type === 'public' ? 'Public IP' : 'Local IP';

        await NotificationService.send({
            subject: `IP Change Detected: ${device.name}`,
            message:
                `ALERT\n\n` +
                `Device: ${device.name}\n` +
                `Alert: ${ipTypeLabel} Changed\n` +
                `Time: ${changedAt}\n` +
                `Previous: ${previous}\n` +
                `Current: ${current}`,
            channels: ['slack'],
            recipients: { slackWebhook: settings?.notification_slack_webhook || device.notification_slack_webhook },
        });
    } catch (err) {
        console.error('[MQTT] Failed to send IP change notification:', err);
    }
};

client.on('connect', () => {
    setMqttBrokerConnected(true);
    const authInfo = MQTT_USERNAME ? `user=${MQTT_USERNAME}` : 'user=<none>';
    console.log(`[MQTT] Connected to broker ${MQTT_URL} (${authInfo})`);
    mqttConnectedAt = Date.now();
    client.subscribe('iotmonitor/device/+/status');
    client.subscribe('iotmonitor/device/+/metrics/+');
    client.subscribe('iotmonitor/device/+/responses');
});

client.on('reconnect', () => {
    console.warn('[MQTT] Reconnecting to broker...');
});

client.on('offline', () => {
    setMqttBrokerConnected(false);
    console.warn('[MQTT] Client went offline');
});

client.on('close', () => {
    setMqttBrokerConnected(false);
    console.warn('[MQTT] Connection closed');
});

client.on('error', (err) => {
    setMqttBrokerConnected(false);
    console.error('[MQTT] Connection error:', err?.message || err);
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

            // Retained status messages are primarily used to restore backend state on restart.
            // We do not emit transition notifications from retained payloads, but we still
            // refresh heartbeat for retained ONLINE state to prevent false offline alerts.
            if (isRetained) {
                if (status === 'online') {
                    await updateDeviceHeartbeat(device_id);
                    if (oldStatus !== 'online') {
                        await Device.findOneAndUpdate(
                            { device_id },
                            { status: 'online', last_seen: new Date() }
                        );
                    }
                    return;
                }

                if (isStartupSync && status !== 'offline' && oldStatus !== status) {
                    await Device.findOneAndUpdate(
                        { device_id },
                        {
                            status,
                            last_seen: new Date(),
                        }
                    );
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
                    if (status === 'offline') {
                        // Immediate offline alert when agent explicitly reports offline.
                        // Offline detection still covers abrupt disconnect cases.
                        const { triggerAlert } = await import('./notificationThrottling');
                        await triggerAlert({
                            device_id,
                            device_name: device.name,
                            alert_type: 'offline',
                            severity: 'critical',
                            throttling_config: {
                                repeat_interval_minutes: 15,
                                throttling_duration_minutes: 60,
                            },
                            details: {
                                last_seen: device.last_seen,
                                source: 'agent_status',
                            },
                        });
                    }

                    // Offline/online notifications are handled by alert lifecycle logic.
                    // Keep this only for non-primary statuses to avoid duplicate recovery noise.
                    if (!['offline', 'online'].includes(status)) {
                        const { NotificationService } = await import('./NotificationService');
                        const settings = await (await import('../models/SystemSettings')).default.findOne();
                        const changedAt = new Date().toLocaleString('en-US', { timeZone: APP_TIMEZONE });

                        await NotificationService.send({
                            subject: `Device Status Change: ${device.name}`,
                            message:
                                `STATUS UPDATE\n\n` +
                                `Device: ${device.name}\n` +
                                `Status: ${status.toUpperCase()}\n` +
                                `Time: ${changedAt}`,
                            channels: ['slack'],
                            recipients: { slackWebhook: settings?.notification_slack_webhook || device.notification_slack_webhook },
                        });
                    }
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
                    if (payload.uptime !== undefined) updateData.uptime = payload.uptime;
                    if (payload.cpu_load !== undefined) updateData.cpu_load = payload.cpu_load;
                    if (payload.cpu_per_core) updateData.cpu_per_core = payload.cpu_per_core;
                    if (payload.memory_usage !== undefined) updateData.memory_usage = payload.memory_usage;
                    if (payload.memory_used !== undefined) updateData.memory_used = payload.memory_used;
                    if (payload.memory_available !== undefined) updateData.memory_available = payload.memory_available;
                    if (payload.memory_cached !== undefined) updateData.memory_cached = payload.memory_cached;
                    if (payload.memory_buffers !== undefined) updateData.memory_buffers = payload.memory_buffers;
                    if (
                        payload.memory_total !== undefined ||
                        payload.disk_total !== undefined ||
                        payload.hostname !== undefined ||
                        payload.uptime !== undefined
                    ) {
                        if (payload.memory_total !== undefined) updateData.memory_total = payload.memory_total;
                        await Device.findOneAndUpdate({ device_id }, {
                            memory_total: payload.memory_total ?? freshDevice.memory_total,
                            disk_total: payload.disk_total ?? freshDevice.disk_total,
                            hostname: payload.hostname || freshDevice.hostname,
                            uptime_seconds: payload.uptime ?? freshDevice.uptime_seconds,
                        });
                    }
                    if (payload.disk_usage !== undefined) updateData.disk_usage = payload.disk_usage;
                    if (payload.disk_used !== undefined) updateData.disk_used = payload.disk_used;
                    if (payload.disk_total !== undefined) updateData.disk_total = payload.disk_total;
                    if (payload.disk_read_bytes_per_sec !== undefined) updateData.disk_read_bytes_per_sec = payload.disk_read_bytes_per_sec;
                    if (payload.disk_write_bytes_per_sec !== undefined) updateData.disk_write_bytes_per_sec = payload.disk_write_bytes_per_sec;

                    if (payload.extra) {
                        for (const key in payload.extra) {
                            recentTelemetry.extra = recentTelemetry.extra || {};
                            recentTelemetry.extra[key] = payload.extra[key];
                        }
                        recentTelemetry.markModified('extra');
                    }

                    if (Array.isArray(payload.top_cpu_processes)) {
                        recentTelemetry.extra = recentTelemetry.extra || {};
                        recentTelemetry.extra.top_cpu_processes = payload.top_cpu_processes;
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

                        if (
                            previousLocalIPs.length > 0 &&
                            nextLocalIPs.length > 0 &&
                            !areStringArraysEqual(previousLocalIPs, nextLocalIPs)
                        ) {
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
                    if (payload.hostname || payload.memory_total || payload.disk_total || payload.uptime !== undefined) {
                        await Device.findOneAndUpdate({ device_id }, {
                            hostname: payload.hostname || freshDevice.hostname,
                            memory_total: payload.memory_total || freshDevice.memory_total,
                            disk_total: payload.disk_total || freshDevice.disk_total,
                            uptime_seconds: payload.uptime ?? freshDevice.uptime_seconds,
                        });
                    }

                    await new Telemetry({
                        device_id,
                        cpu_usage: payload.cpu_usage,
                        uptime: payload.uptime,
                        cpu_load: payload.cpu_load,
                        cpu_per_core: payload.cpu_per_core,
                        memory_usage: payload.memory_usage,
                        memory_total: payload.memory_total,
                        memory_used: payload.memory_used,
                        memory_available: payload.memory_available,
                        memory_cached: payload.memory_cached,
                        memory_buffers: payload.memory_buffers,
                        disk_usage: payload.disk_usage,
                        disk_total: payload.disk_total,
                        disk_used: payload.disk_used,
                        disk_read_bytes_per_sec: payload.disk_read_bytes_per_sec,
                        disk_write_bytes_per_sec: payload.disk_write_bytes_per_sec,
                        network_in: payload.network_in,
                        network_out: payload.network_out,
                        extra: {
                            ...(payload.extra || {}),
                            ...(Array.isArray(payload.top_cpu_processes) ? { top_cpu_processes: payload.top_cpu_processes } : {}),
                        },
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

                    if (
                        previousLocalIPs.length > 0 &&
                        nextLocalIPs.length > 0 &&
                        !areStringArraysEqual(previousLocalIPs, nextLocalIPs)
                    ) {
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
