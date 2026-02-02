import { Router } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import Device from '../models/Device';
import crypto from 'crypto';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';

const execAsync = promisify(exec);

const router = Router();

router.use(authenticate);

// Get all devices
router.get('/', async (req: AuthRequest, res) => {
    try {
        const devices = await Device.find();
        res.json(devices);
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// Register a new device
router.post('/register', async (req: AuthRequest, res) => {
    try {
        const { name, type, hostname } = req.body;
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
        });

        await device.save();
        res.status(201).json(device);
    } catch (err: any) {
        res.status(400).json({ message: err.message });
    }
});

// Get device by ID
router.get('/:id', async (req: AuthRequest, res) => {
    try {
        const device = await Device.findOne({ device_id: req.params.id });
        if (!device) return res.status(404).json({ message: 'Device not found' });
        res.json(device);
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

// Build agent for an existing device
router.post('/:id/generate-agent', async (req: AuthRequest, res) => {
    try {
        const { os, arch } = req.body;
        const device = await Device.findOne({ device_id: req.params.id });
        if (!device) return res.status(404).json({ message: 'Device not found' });

        // Prepare build paths
        const agentDir = path.resolve(__dirname, '../../../agent');
        const outputDir = path.resolve(__dirname, '../../builds');
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

        const binary_id = crypto.randomBytes(16).toString('hex');
        const extension = os === 'windows' ? '.exe' : '';
        const fileName = `iotmonitor-agent-${os}-${arch}-${binary_id}${extension}`;
        const outputPath = path.join(outputDir, fileName);

        // Prepare LDFLAGS (Use existing device credentials)
        const ldflags = `-X iotmonitor/internal/config.DefaultDeviceID=${device.device_id} ` +
            `-X iotmonitor/internal/config.DefaultAgentToken=${device.agent_token} ` +
            `-X iotmonitor/internal/config.DefaultMQTTURL=${process.env.MQTT_URL || 'localhost:1883'}`;

        console.log(`[BUILD] Compiling agent for EXISTING device ${device.device_id} (${os}/${arch})...`);

        const buildCmd = `GOOS=${os} GOARCH=${arch} go build -ldflags "${ldflags}" -o "${outputPath}" ./cmd/agent/main.go`;

        await execAsync(buildCmd, { cwd: agentDir });

        const stats = fs.statSync(outputPath);
        const checksum = crypto.createHash('sha256').update(fs.readFileSync(outputPath)).digest('hex');

        res.json({
            binary_id: fileName,
            checksum,
            size: stats.size,
            device_id: device.device_id
        });
    } catch (err: any) {
        console.error('[BUILD] Error:', err);
        res.status(500).json({ message: 'Failed to build agent: ' + err.message });
    }
});

// Generate and build agent binary (creates a new device)
router.post('/generate-agent', async (req: AuthRequest, res) => {
    try {
        const { os, arch, modules } = req.body;

        // 1. Create a new "Pending" device for this agent
        const device_id = crypto.randomBytes(8).toString('hex');
        const agent_token = crypto.randomBytes(32).toString('hex');
        const mqtt_topic = `iotmonitor/device/${device_id}`;

        const device = new Device({
            device_id,
            name: `Agent-${device_id.slice(0, 4)}`,
            type: 'server',
            agent_token,
            mqtt_topic,
            status: 'offline',
            config: { modules }
        });
        await device.save();

        // 2. Prepare build paths
        const agentDir = path.resolve(__dirname, '../../../agent');
        const outputDir = path.resolve(__dirname, '../../builds');
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

        const binary_id = crypto.randomBytes(16).toString('hex');
        const extension = os === 'windows' ? '.exe' : '';
        const fileName = `iotmonitor-agent-${os}-${arch}-${binary_id}${extension}`;
        const outputPath = path.join(outputDir, fileName);

        // 3. Prepare LDFLAGS
        const ldflags = `-X iotmonitor/internal/config.DefaultDeviceID=${device_id} ` +
            `-X iotmonitor/internal/config.DefaultAgentToken=${agent_token} ` +
            `-X iotmonitor/internal/config.DefaultMQTTURL=${process.env.MQTT_URL || 'localhost:1883'}`;

        console.log(`[BUILD] Compiling agent for ${device_id} (${os}/${arch})...`);

        // 4. Build command (using cross-compilation)
        const buildCmd = `GOOS=${os} GOARCH=${arch} go build -ldflags "${ldflags}" -o "${outputPath}" ./cmd/agent/main.go`;

        await execAsync(buildCmd, { cwd: agentDir });

        const stats = fs.statSync(outputPath);
        const checksum = crypto.createHash('sha256').update(fs.readFileSync(outputPath)).digest('hex');

        res.json({
            binary_id: fileName,
            checksum,
            size: stats.size,
            device_id
        });
    } catch (err: any) {
        console.error('[BUILD] Error:', err);
        res.status(500).json({ message: 'Failed to build agent: ' + err.message });
    }
});

// Download agent binary
router.get('/download/:id', async (req, res) => {
    try {
        const fileName = req.params.id;
        const filePath = path.resolve(__dirname, '../../builds', fileName);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ message: 'Binary not found' });
        }

        res.download(filePath, fileName);
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

export default router;
