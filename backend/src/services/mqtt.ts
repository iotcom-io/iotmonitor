import mqtt from 'mqtt';
import Device from '../models/Device';
import { updateDeviceHeartbeat } from './offlineDetection';
import { checkServiceHealth, checkSIPEndpoints } from './serviceMonitoring';

const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const DEBUG_MQTT = process.env.DEBUG_MQTT === 'true';
const client = mqtt.connect(MQTT_URL);

client.on('connect', () => {
    console.log('Connected to MQTT Broker');
    client.subscribe('iotmonitor/device/+/status');
    client.subscribe('iotmonitor/device/+/metrics/+');
});

client.on('message', async (topic, message) => {
    try {
        if (DEBUG_MQTT) {
            console.log(`[MQTT][IN] ${topic} (${message.length} bytes)`);
        }

        const parts = topic.split('/');
        if (parts.length >= 4 && parts[1] === 'device') {
            const device_id = parts[2];
            const type = parts[3];

            const device = await Device.findOne({ device_id });
            if (!device) return;

            // Update heartbeat for ANY device message (status or metrics)
            // This now handles atomic status transition from offline/not_monitored to online
            await updateDeviceHeartbeat(device._id.toString());

            if (type === 'status') {
                const status = message.toString();
                const oldStatus = device.status;

                // Update status if it changed (updateDeviceHeartbeat handled the transition to online if needed)
                if (oldStatus !== status) {
                    await Device.findOneAndUpdate({ device_id }, { status, last_seen: new Date() });

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
                const check_type = parts[4];
                const payload = JSON.parse(message.toString());

                // Handled above via updateDeviceHeartbeat

                // Telemetry Consolidation Logic
                const Telemetry = (await import('../models/Telemetry')).default;
                const CONSOLIDATION_WINDOW_MS = 2000; // 2 seconds window

                const recentTelemetry = await Telemetry.findOne({
                    device_id,
                    timestamp: { $gte: new Date(Date.now() - CONSOLIDATION_WINDOW_MS) }
                }).sort({ timestamp: -1 });

                if (recentTelemetry) {
                    // Update existing recent record
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
                            // Also update Device model
                            await Device.findOneAndUpdate({ device_id }, {
                                memory_total: payload.memory_total,
                                disk_total: payload.disk_total,
                                hostname: payload.hostname || device.hostname
                            });
                        }
                        if (payload.disk_usage !== undefined) updateData.disk_usage = payload.disk_usage;
                        if (payload.disk_used !== undefined) updateData.disk_used = payload.disk_used;
                        if (payload.disk_total !== undefined) updateData.disk_total = payload.disk_total;

                        // Merge extra system info if present
                        if (payload.extra) {
                            for (const key in payload.extra) {
                                recentTelemetry.extra = recentTelemetry.extra || {};
                                recentTelemetry.extra[key] = payload.extra[key];
                            }
                            recentTelemetry.markModified('extra');
                        }
                    } else if (check_type === 'network') {
                        if (payload.public_ip) updateData.public_ip = payload.public_ip;
                        if (payload.local_ips) updateData.local_ips = payload.local_ips; // Can overwrite array
                        // Update Device model IPs too
                        if (payload.public_ip || payload.local_ips) {
                            await Device.findOneAndUpdate({ device_id }, {
                                public_ip: payload.public_ip,
                                local_ips: payload.local_ips
                            });
                        }

                        // Merge extra network info (ping_results, etc)
                        if (payload.ping_results || payload.port_results || payload.interfaces) {
                            recentTelemetry.extra = recentTelemetry.extra || {};
                            if (payload.ping_results) recentTelemetry.extra.ping_results = payload.ping_results;
                            if (payload.port_results) recentTelemetry.extra.port_results = payload.port_results;
                            if (payload.interfaces) recentTelemetry.extra.interfaces = payload.interfaces;
                            recentTelemetry.markModified('extra');
                        }
                    } else if (check_type === 'docker') {
                        // Persist docker container stats
                        recentTelemetry.extra = recentTelemetry.extra || {};
                        recentTelemetry.extra.docker = payload;
                        recentTelemetry.markModified('extra');
                    } else if (check_type === 'asterisk') {
                        // Merge extra asterisk info
                        recentTelemetry.extra = recentTelemetry.extra || {};
                        Object.assign(recentTelemetry.extra, payload);
                        recentTelemetry.markModified('extra');
                    }

                    // Apply standard field updates
                    Object.assign(recentTelemetry, updateData);
                    await recentTelemetry.save();

                } else {
                    // Create new record
                    if (check_type === 'system') {
                        // Update device hardware info/hostname if provided
                        if (payload.hostname || payload.memory_total || payload.disk_total) {
                            await Device.findOneAndUpdate({ device_id }, {
                                hostname: payload.hostname || device.hostname,
                                memory_total: payload.memory_total || device.memory_total,
                                disk_total: payload.disk_total || device.disk_total,
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
                            extra: payload.extra
                        }).save();
                    } else if (check_type === 'network') {
                        // Update IP info if provided
                        if (payload.public_ip || payload.local_ips) {
                            await Device.findOneAndUpdate({ device_id }, {
                                public_ip: payload.public_ip,
                                local_ips: payload.local_ips
                            });
                        }

                        await new Telemetry({
                            device_id,
                            public_ip: payload.public_ip,
                            local_ips: payload.local_ips,
                            extra: {
                                ping_results: payload.ping_results,
                                port_results: payload.port_results,
                                interfaces: payload.interfaces
                            }
                        }).save();
                    } else if (check_type === 'docker') {
                        await new Telemetry({
                            device_id,
                            extra: {
                                docker: payload
                            }
                        }).save();
                    } else if (check_type === 'asterisk') {
                        await new Telemetry({
                            device_id,
                            extra: payload
                        }).save();
                    }
                }

                // Check service health (detect partial failures)
                await checkServiceHealth(device._id.toString(), { [check_type]: payload });

                // Check SIP endpoints if this is asterisk metrics
                if (check_type === 'asterisk') {
                    await checkSIPEndpoints(device._id.toString(), payload);
                }

                // Alerting logic is now handled by scheduled services (offline detection and threshold monitoring)

                // Notify Frontend via Socket.IO
                try {
                    const { getIO } = await import('./socket');
                    const io = getIO();
                    io.emit('device:update', {
                        device_id,
                        status: 'online', // Implicitly online if sending metrics
                        metrics: payload
                    });
                } catch (socketErr) {
                    console.error('[MQTT] Socket Emit Error:', socketErr);
                }
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
