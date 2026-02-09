import { Router } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import Device from '../models/Device';
import crypto from 'crypto';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';

const router = Router();

type BuildOS = 'linux' | 'windows';
type BuildArch = 'amd64' | 'arm64';

const buildRequestSchema = z.object({
    os: z.enum(['linux', 'windows']),
    arch: z.enum(['amd64', 'arm64']),
    name: z.string().trim().min(1).max(120).optional(),
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
        const { name, type, hostname, enabled_modules, probe_config } = req.body;
        const device_id = crypto.randomBytes(8).toString('hex');
        const agent_token = crypto.randomBytes(32).toString('hex');
        const mqtt_topic = `iotmonitor/device/${device_id}`;

        const device = new Device({
            device_id,
            name,
            type,
            hostname,
            agent_token,
            mqtt_topic,
            enabled_modules,
            probe_config,
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
        const device = await Device.findOneAndUpdate(
            { device_id: req.params.id },
            { $set: req.body },
            { new: true }
        );
        if (!device) return res.status(404).json({ message: 'Device not found' });
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
        const { os, arch, name } = buildRequestSchema.parse(req.body) as {
            os: BuildOS;
            arch: BuildArch;
            name?: string;
        };

        const device = await Device.findOne({ device_id: req.params.id });
        if (!device) return res.status(404).json({ message: 'Device not found' });

        if (name) {
            device.name = name;
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

        const ldflags = `-X github.com/iotmonitor/agent/internal/config.DefaultDeviceID=${device.device_id} ` +
            `-X github.com/iotmonitor/agent/internal/config.DefaultAgentToken=${device.agent_token} ` +
            `-X github.com/iotmonitor/agent/internal/config.DefaultMQTTURL=${mqttUrl}`;

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
        const { os, arch, modules, name } = createAndBuildRequestSchema.parse(req.body) as {
            os: BuildOS;
            arch: BuildArch;
            modules?: Record<string, boolean>;
            name?: string;
        };

        const device_id = crypto.randomBytes(8).toString('hex');
        const agent_token = crypto.randomBytes(32).toString('hex');
        const mqtt_topic = `iotmonitor/device/${device_id}`;

        const device = new Device({
            device_id,
            name: name || `Agent-${device_id.slice(0, 4)}`,
            type: 'server',
            agent_token,
            mqtt_topic,
            status: 'offline',
            config: { modules },
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

        const ldflags = `-X github.com/iotmonitor/agent/internal/config.DefaultDeviceID=${device_id} ` +
            `-X github.com/iotmonitor/agent/internal/config.DefaultAgentToken=${agent_token} ` +
            `-X github.com/iotmonitor/agent/internal/config.DefaultMQTTURL=${mqttUrl}`;

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
