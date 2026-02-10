import { Router } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import Device from '../models/Device';
import crypto from 'crypto';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { resolveAllActiveAlertsForDevice } from '../services/notificationThrottling';

const router = Router();

type BuildOS = 'linux' | 'windows';
type BuildArch = 'amd64' | 'arm64';
const ALL_MODULES = ['system', 'docker', 'asterisk', 'network'] as const;
const DEVICE_TYPES = ['server', 'pbx', 'network_device', 'website'] as const;
type DeviceType = typeof DEVICE_TYPES[number];
const LEGACY_DEVICE_TYPE_ALIASES: Record<string, DeviceType> = {
    media_gateway: 'server',
};
const MODULE_DEFAULTS_BY_DEVICE_TYPE: Record<DeviceType, readonly (typeof ALL_MODULES[number])[]> = {
    server: ['system', 'docker', 'network'],
    pbx: ['system', 'docker', 'asterisk', 'network'],
    network_device: ['network'],
    website: ['system', 'network'],
};

const buildRequestSchema = z.object({
    os: z.enum(['linux', 'windows']),
    arch: z.enum(['amd64', 'arm64']),
    name: z.string().trim().min(1).max(120).optional(),
    modules: z.record(z.string(), z.boolean()).optional(),
    asterisk_container_name: z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9_.-]+$/).optional(),
    device_type: z.string().trim().min(1).max(120).optional(),
    ping_host: z.string().trim().min(1).max(255).optional(),
});

const createAndBuildRequestSchema = buildRequestSchema.extend({
    modules: z.record(z.string(), z.boolean()).optional(),
});

const resolveAgentDir = () => {
    let agentDir = path.resolve(__dirname, '../../../agent');
    if (!fs.existsSync(agentDir)) {
        agentDir = path.resolve(__dirname, '../../agent');
    }
    return agentDir;
};

const resolveBuildOutputDir = () => {
    const outputDir = path.resolve(__dirname, '../../builds');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    return outputDir;
};

const normalizeMQTTURL = (rawValue: string | undefined) => {
    const fallback = 'mqtt://localhost:1883';
    if (!rawValue || !rawValue.trim()) return fallback;

    const value = rawValue.trim();
    if (value.startsWith('mqtt://') || value.startsWith('mqtts://')) {
        return value;
    }

    if (!/^[a-zA-Z0-9.-]+(:\d+)?$/.test(value)) {
        return fallback;
    }

    return `mqtt://${value.includes(':') ? value : `${value}:1883`}`;
};

const modulesToCSV = (modules: string[]) => {
    const selected = modules.filter((m) => ALL_MODULES.includes(m as any));
    // Keep an explicit sentinel so the agent doesn't fall back to "all modules enabled".
    return selected.length > 0 ? selected.join(',') : 'none';
};

const modulesArrayToConfig = (modules: string[]) => {
    return ALL_MODULES.reduce((acc: Record<string, boolean>, module) => {
        acc[module] = modules.includes(module);
        return acc;
    }, {});
};

const sanitizeModules = (modules?: unknown): string[] => {
    if (!Array.isArray(modules)) return [];
    return modules.filter((m) => typeof m === 'string' && ALL_MODULES.includes(m as any));
};

const normalizeDeviceType = (rawType?: unknown): DeviceType => {
    const type = typeof rawType === 'string' ? rawType.trim() : '';
    if ((DEVICE_TYPES as readonly string[]).includes(type)) {
        return type as DeviceType;
    }
    if (type && LEGACY_DEVICE_TYPE_ALIASES[type]) {
        return LEGACY_DEVICE_TYPE_ALIASES[type];
    }
    return 'server';
};

const sanitizePingHost = (rawHost?: unknown): string | undefined => {
    if (typeof rawHost !== 'string') return undefined;
    const host = rawHost.trim();
    if (!host) return undefined;
    if (!/^[a-zA-Z0-9_.:-]+$/.test(host)) return undefined;
    return host;
};

const sanitizeProbeConfig = (probeConfig?: any) => {
    const pingHost = sanitizePingHost(probeConfig?.ping_host);
    if (!pingHost) return undefined;
    return { ping_host: pingHost };
};

const getTypeDefaultModules = (deviceType?: string) => {
    const normalizedType = normalizeDeviceType(deviceType);
    return [...MODULE_DEFAULTS_BY_DEVICE_TYPE[normalizedType]];
};

const resolveEffectiveModules = (params: {
    requestedModules?: Record<string, boolean>;
    deviceModules?: string[];
    deviceConfigModules?: Record<string, boolean>;
    deviceType?: string;
}) => {
    const { requestedModules, deviceModules, deviceConfigModules, deviceType } = params;

    if (requestedModules) {
        return ALL_MODULES.filter((module) => requestedModules[module] === true);
    }

    const fromDevice = sanitizeModules(deviceModules);
    if (fromDevice.length > 0) return fromDevice;

    if (deviceConfigModules && typeof deviceConfigModules === 'object') {
        const fromConfig = ALL_MODULES.filter((module) => deviceConfigModules[module] === true);
        if (fromConfig.length > 0) return fromConfig;
    }

    return getTypeDefaultModules(deviceType);
};

const buildAgentBinary = async ({
    agentDir,
    outputPath,
    os,
    arch,
    ldflags,
}: {
    agentDir: string;
    outputPath: string;
    os: BuildOS;
    arch: BuildArch;
    ldflags: string;
}) => {
    await new Promise<void>((resolve, reject) => {
        const child = spawn(
            'go',
            ['build', '-ldflags', `${ldflags} -s -w`, '-o', outputPath, './cmd/agent/main.go'],
            {
                cwd: agentDir,
                shell: false,
                env: {
                    ...process.env,
                    CGO_ENABLED: '0',
                    GOOS: os,
                    GOARCH: arch,
                },
            }
        );

        let stderr = '';
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        child.on('error', (err) => reject(err));

        child.on('close', (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(stderr.trim() || `go build exited with code ${code}`));
        });
    });
};

const getArtifactMeta = (outputPath: string) => {
    const stats = fs.statSync(outputPath);
    const checksum = crypto.createHash('sha256').update(fs.readFileSync(outputPath)).digest('hex');
    return {
        size: stats.size,
        checksum,
    };
};

// Download agent binary (kept unauthenticated for browser direct downloads)
router.get('/download/:id', async (req, res) => {
    try {
        const fileName = req.params.id;
        if (!/^[a-zA-Z0-9._-]+$/.test(fileName)) {
            return res.status(400).json({ message: 'Invalid binary id' });
        }

        const filePath = path.resolve(__dirname, '../../builds', fileName);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ message: 'Binary not found' });
        }

        res.download(filePath, fileName);
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

router.use(authenticate);

// Get all devices
router.get('/', authorize(['admin', 'operator', 'viewer']), async (_req: AuthRequest, res) => {
    try {
        const devices = await Device.find();
        res.json(devices);
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// Register a new device
router.post('/register', authorize(['admin', 'operator']), async (req: AuthRequest, res) => {
    try {
        const { name, type, hostname, enabled_modules, probe_config, asterisk_container_name } = req.body;
        const normalizedType = normalizeDeviceType(type);
        const effectiveModules = resolveEffectiveModules({
            deviceModules: sanitizeModules(enabled_modules),
            deviceType: normalizedType,
        });
        const normalizedProbeConfig = sanitizeProbeConfig(probe_config);
        const asteriskEnabled = effectiveModules.includes('asterisk');
        const normalizedAsteriskContainer = asteriskEnabled
            ? (String(asterisk_container_name || '').trim() || 'asterisk')
            : undefined;
        const device_id = crypto.randomBytes(8).toString('hex');
        const agent_token = crypto.randomBytes(32).toString('hex');
        const mqtt_topic = `iotmonitor/device/${device_id}`;

        const device = new Device({
            device_id,
            name,
            type: normalizedType,
            hostname,
            agent_token,
            mqtt_topic,
            enabled_modules: effectiveModules,
            probe_config: normalizedProbeConfig,
            config: {
                modules: modulesArrayToConfig(effectiveModules),
                ...(normalizedAsteriskContainer ? { asterisk_container: normalizedAsteriskContainer } : {}),
            },
            asterisk_container_name: normalizedAsteriskContainer,
            status: 'not_monitored',
        });

        await device.save();
        res.status(201).json(device);
    } catch (err: any) {
        res.status(400).json({ message: err.message });
    }
});

// Get device by ID
router.get('/:id', authorize(['admin', 'operator', 'viewer']), async (req: AuthRequest, res) => {
    try {
        const device = await Device.findOne({ device_id: req.params.id });
        if (!device) return res.status(404).json({ message: 'Device not found' });
        res.json(device);
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// Update device
router.patch('/:id', authorize(['admin', 'operator']), async (req: AuthRequest, res) => {
    try {
        const previous = await Device.findOne({ device_id: req.params.id });
        if (!previous) return res.status(404).json({ message: 'Device not found' });

        const updateBody: any = { ...req.body };
        const unsetFields: Record<string, ''> = {};

        if (Array.isArray(updateBody.enabled_modules)) {
            const normalizedModules = sanitizeModules(updateBody.enabled_modules);
            updateBody.enabled_modules = normalizedModules;
            const mergedConfig: Record<string, any> = {
                ...(previous.config || {}),
                ...(updateBody.config || {}),
                modules: modulesArrayToConfig(normalizedModules),
            };

            if (!normalizedModules.includes('asterisk')) {
                delete mergedConfig.asterisk_container;
                unsetFields.asterisk_container_name = '';
            }
            updateBody.config = mergedConfig;
        }

        const nextModules = Array.isArray(updateBody.enabled_modules)
            ? updateBody.enabled_modules
            : resolveEffectiveModules({
                deviceModules: sanitizeModules(previous.enabled_modules as any),
                deviceConfigModules: previous.config?.modules,
                deviceType: previous.type,
            });

        if (typeof updateBody.asterisk_container_name === 'string') {
            const nextContainer = updateBody.asterisk_container_name.trim();
            if (nextContainer && nextModules.includes('asterisk')) {
                updateBody.asterisk_container_name = nextContainer;
                updateBody.config = {
                    ...(previous.config || {}),
                    ...(updateBody.config || {}),
                    asterisk_container: nextContainer,
                };
            } else {
                delete updateBody.asterisk_container_name;
            }
        }

        if (typeof updateBody.type === 'string') {
            if ((DEVICE_TYPES as readonly string[]).includes(updateBody.type)) {
                // keep as-is
            } else if (updateBody.type === 'media_gateway') {
                updateBody.type = 'server';
            } else {
                delete updateBody.type;
            }
        }

        if (updateBody.probe_config !== undefined) {
            const normalizedProbeConfig = sanitizeProbeConfig(updateBody.probe_config);
            if (normalizedProbeConfig) {
                updateBody.probe_config = normalizedProbeConfig;
            } else {
                delete updateBody.probe_config;
                unsetFields.probe_config = '';
            }
        }

        const updateDoc: any = { $set: updateBody };
        if (Object.keys(unsetFields).length > 0) {
            updateDoc.$unset = unsetFields;
        }

        const device = await Device.findOneAndUpdate(
            { device_id: req.params.id },
            updateDoc,
            { new: true }
        );
        if (!device) return res.status(404).json({ message: 'Device not found' });

        const pausedChanged = previous.monitoring_paused !== device.monitoring_paused;
        if (pausedChanged) {
            const { NotificationService } = await import('../services/NotificationService');
            const SystemSettings = (await import('../models/SystemSettings')).default;
            const settings = await SystemSettings.findOne();

            if (device.monitoring_paused) {
                await resolveAllActiveAlertsForDevice(device.device_id, device.name, 'Monitoring paused', true);
                await NotificationService.send({
                    subject: `Monitoring Paused: ${device.name}`,
                    message: `Monitoring has been paused for ${device.name}. No further monitoring alerts will be sent until resumed.`,
                    channels: ['slack'],
                    recipients: { slackWebhook: settings?.notification_slack_webhook || device.notification_slack_webhook },
                });
            } else {
                await NotificationService.send({
                    subject: `Monitoring Resumed: ${device.name}`,
                    message: `Monitoring has resumed for ${device.name}. Alerts and real-time monitoring are active again.`,
                    channels: ['slack'],
                    recipients: { slackWebhook: settings?.notification_slack_webhook || device.notification_slack_webhook },
                });
            }
        }

        res.json(device);
    } catch (err: any) {
        res.status(400).json({ message: err.message });
    }
});

// Delete device
router.delete('/:id', authorize(['admin']), async (req: AuthRequest, res) => {
    try {
        const result = await Device.deleteOne({ device_id: req.params.id });
        if (result.deletedCount === 0) return res.status(404).json({ message: 'Device not found' });
        res.json({ message: 'Device deleted successfully' });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// Regenerate agent token
router.post('/:id/regenerate-token', authorize(['admin']), async (req: AuthRequest, res) => {
    try {
        const new_token = crypto.randomBytes(32).toString('hex');
        const device = await Device.findOneAndUpdate(
            { device_id: req.params.id },
            { $set: { agent_token: new_token } },
            { new: true }
        );
        if (!device) return res.status(404).json({ message: 'Device not found' });
        res.json({ agent_token: new_token });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// Build agent for an existing device
router.post('/:id/generate-agent', authorize(['admin', 'operator']), async (req: AuthRequest, res) => {
    try {
        const { os, arch, name, modules, asterisk_container_name, ping_host } = buildRequestSchema.parse(req.body) as {
            os: BuildOS;
            arch: BuildArch;
            name?: string;
            modules?: Record<string, boolean>;
            asterisk_container_name?: string;
            ping_host?: string;
        };

        const device = await Device.findOne({ device_id: req.params.id });
        if (!device) return res.status(404).json({ message: 'Device not found' });

        if (name) {
            device.name = name;
        }
        if (modules) {
            const effectiveModules = resolveEffectiveModules({
                requestedModules: modules,
                deviceType: device.type,
            });
            device.enabled_modules = effectiveModules as any;
            const nextConfig: Record<string, any> = {
                ...(device.config || {}),
                modules: modulesArrayToConfig(effectiveModules),
            };
            if (!effectiveModules.includes('asterisk')) {
                delete nextConfig.asterisk_container;
            }
            device.config = nextConfig;
        }
        const buildModules = resolveEffectiveModules({
            requestedModules: modules,
            deviceModules: device.enabled_modules as string[],
            deviceConfigModules: device.config?.modules,
            deviceType: device.type,
        });
        const asteriskEnabled = buildModules.includes('asterisk');

        if (asterisk_container_name && asteriskEnabled) {
            const normalizedContainer = asterisk_container_name.trim();
            if (normalizedContainer) {
                device.asterisk_container_name = normalizedContainer;
                device.config = { ...(device.config || {}), asterisk_container: normalizedContainer };
            }
        }
        if (!asteriskEnabled) {
            device.asterisk_container_name = undefined;
        }
        if (ping_host !== undefined) {
            const normalizedPingHost = sanitizePingHost(ping_host);
            if (normalizedPingHost) {
                device.probe_config = {
                    ...(device.probe_config || {}),
                    ping_host: normalizedPingHost,
                };
            }
        }
        if (name || modules || asterisk_container_name || ping_host !== undefined) {
            await device.save();
        }

        const agentDir = resolveAgentDir();
        const outputDir = resolveBuildOutputDir();

        const extension = os === 'windows' ? '.exe' : '';
        const safeName = device.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        const fileName = `iotmonitor-${safeName}-${os}-${arch}${extension}`;
        const outputPath = path.join(outputDir, fileName);

        const SystemSettings = (await import('../models/SystemSettings')).default;
        const settings = await SystemSettings.findOne();
        const mqttUrl = normalizeMQTTURL(settings?.mqtt_public_url || process.env.MQTT_URL);
        const mqttUsername = String(settings?.mqtt_username || '').trim();
        const mqttPassword = String(settings?.mqtt_password || '').trim();
        const effectiveModules = buildModules;
        const enabledModules = modulesToCSV(effectiveModules);
        const asteriskContainer = asteriskEnabled
            ? (
                asterisk_container_name ||
                device.asterisk_container_name ||
                device.config?.asterisk_container ||
                'asterisk'
            )
            : '';
        const pingHost = sanitizePingHost(
            ping_host ||
            device.probe_config?.ping_host ||
            device.hostname
        ) || '1.1.1.1';

        const ldflags = `-X github.com/iotmonitor/agent/internal/config.DefaultDeviceID=${device.device_id} ` +
            `-X github.com/iotmonitor/agent/internal/config.DefaultAgentToken=${device.agent_token} ` +
            `-X github.com/iotmonitor/agent/internal/config.DefaultMQTTURL=${mqttUrl} ` +
            `-X github.com/iotmonitor/agent/internal/config.DefaultMQTTUsername=${mqttUsername} ` +
            `-X github.com/iotmonitor/agent/internal/config.DefaultMQTTPassword=${mqttPassword} ` +
            `-X github.com/iotmonitor/agent/internal/config.DefaultEnabledModules=${enabledModules} ` +
            `-X github.com/iotmonitor/agent/internal/config.DefaultAsteriskContainer=${asteriskContainer} ` +
            `-X github.com/iotmonitor/agent/internal/config.DefaultPingHost=${pingHost}`;

        await buildAgentBinary({
            agentDir,
            outputPath,
            os,
            arch,
            ldflags,
        });

        const meta = getArtifactMeta(outputPath);

        res.json({
            binary_id: fileName,
            checksum: meta.checksum,
            size: meta.size,
            device_id: device.device_id,
        });
    } catch (err: any) {
        if (err?.name === 'ZodError') {
            return res.status(400).json({ message: 'Invalid build request payload' });
        }
        console.error('[BUILD] Error:', err);
        res.status(500).json({ message: 'Failed to build agent: ' + err.message });
    }
});

// Generate and build agent binary (creates a new device)
router.post('/generate-agent', authorize(['admin', 'operator']), async (req: AuthRequest, res) => {
    try {
        const { os, arch, modules, name, asterisk_container_name, device_type, ping_host } = createAndBuildRequestSchema.parse(req.body) as {
            os: BuildOS;
            arch: BuildArch;
            modules?: Record<string, boolean>;
            name?: string;
            asterisk_container_name?: string;
            device_type?: string;
            ping_host?: string;
        };
        const normalizedType = normalizeDeviceType(device_type);
        const effectiveModules = resolveEffectiveModules({
            requestedModules: modules,
            deviceType: normalizedType,
        });
        const asteriskEnabled = effectiveModules.includes('asterisk');
        const normalizedAsteriskContainer = asteriskEnabled
            ? (String(asterisk_container_name || '').trim() || 'asterisk')
            : undefined;

        const device_id = crypto.randomBytes(8).toString('hex');
        const agent_token = crypto.randomBytes(32).toString('hex');
        const mqtt_topic = `iotmonitor/device/${device_id}`;

        const config: Record<string, any> = { modules: modulesArrayToConfig(effectiveModules) };
        if (normalizedAsteriskContainer) {
            config.asterisk_container = normalizedAsteriskContainer;
        }
        const normalizedPingHost = sanitizePingHost(ping_host);

        const device = new Device({
            device_id,
            name: name || `Agent-${device_id.slice(0, 4)}`,
            type: normalizedType,
            agent_token,
            mqtt_topic,
            status: 'offline',
            enabled_modules: effectiveModules,
            ...(normalizedPingHost ? { probe_config: { ping_host: normalizedPingHost } } : {}),
            config,
            asterisk_container_name: normalizedAsteriskContainer,
        });
        await device.save();

        try {
            const { NotificationService } = await import('../services/NotificationService');
            const SystemSettings = (await import('../models/SystemSettings')).default;
            const settings = await SystemSettings.findOne();

            await NotificationService.send({
                subject: 'New Device Registered',
                message: `A new agent was generated for device: ${device.name} (ID: ${device_id})`,
                channels: ['slack'],
                recipients: { slackWebhook: settings?.notification_slack_webhook },
            });
        } catch (nErr) {
            console.error('[NOTIFY] New device notification failed:', nErr);
        }

        const agentDir = resolveAgentDir();
        const outputDir = resolveBuildOutputDir();

        const binary_id = crypto.randomBytes(16).toString('hex');
        const extension = os === 'windows' ? '.exe' : '';
        const fileName = `iotmonitor-agent-${os}-${arch}-${binary_id}${extension}`;
        const outputPath = path.join(outputDir, fileName);

        const SystemSettings = (await import('../models/SystemSettings')).default;
        const settings = await SystemSettings.findOne();
        const mqttUrl = normalizeMQTTURL(settings?.mqtt_public_url || process.env.MQTT_URL);
        const mqttUsername = String(settings?.mqtt_username || '').trim();
        const mqttPassword = String(settings?.mqtt_password || '').trim();
        const enabledModules = modulesToCSV(effectiveModules);
        const asteriskContainer = normalizedAsteriskContainer || '';
        const pingHost = normalizedPingHost || sanitizePingHost(device.hostname) || '1.1.1.1';

        const ldflags = `-X github.com/iotmonitor/agent/internal/config.DefaultDeviceID=${device_id} ` +
            `-X github.com/iotmonitor/agent/internal/config.DefaultAgentToken=${agent_token} ` +
            `-X github.com/iotmonitor/agent/internal/config.DefaultMQTTURL=${mqttUrl} ` +
            `-X github.com/iotmonitor/agent/internal/config.DefaultMQTTUsername=${mqttUsername} ` +
            `-X github.com/iotmonitor/agent/internal/config.DefaultMQTTPassword=${mqttPassword} ` +
            `-X github.com/iotmonitor/agent/internal/config.DefaultEnabledModules=${enabledModules} ` +
            `-X github.com/iotmonitor/agent/internal/config.DefaultAsteriskContainer=${asteriskContainer} ` +
            `-X github.com/iotmonitor/agent/internal/config.DefaultPingHost=${pingHost}`;

        await buildAgentBinary({
            agentDir,
            outputPath,
            os,
            arch,
            ldflags,
        });

        const meta = getArtifactMeta(outputPath);

        res.json({
            binary_id: fileName,
            checksum: meta.checksum,
            size: meta.size,
            device_id,
        });
    } catch (err: any) {
        if (err?.name === 'ZodError') {
            return res.status(400).json({ message: 'Invalid build request payload' });
        }
        console.error('[BUILD] Error:', err);
        res.status(500).json({ message: 'Failed to build agent: ' + err.message });
    }
});

// Trigger test notification
router.post('/:id/test-notification', authorize(['admin', 'operator']), async (req: AuthRequest, res) => {
    try {
        const device = await Device.findOne({ device_id: req.params.id });
        if (!device) return res.status(404).json({ message: 'Device not found' });

        const { NotificationService } = await import('../services/NotificationService');
        const SystemSettings = (await import('../models/SystemSettings')).default;
        const settings = await SystemSettings.findOne();

        await NotificationService.send({
            subject: `[TEST] Alert Notification for ${device.name}`,
            message: `This is a test notification from device ${device.name} (${device.hostname || 'No Hostname'}).`,
            channels: ['slack'],
            recipients: { slackWebhook: settings?.notification_slack_webhook || device.notification_slack_webhook },
        });

        res.json({ message: 'Test notification sent' });
    } catch (err: any) {
        console.error('[TEST-NOTIFY] Error:', err);
        res.status(500).json({ message: 'Failed to send test notification: ' + err.message });
    }
});

export default router;
