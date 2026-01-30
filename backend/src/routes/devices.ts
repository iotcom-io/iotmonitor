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

// Build and download agent binary
router.get('/:id/build', async (req: AuthRequest, res) => {
    try {
        const device = await Device.findOne({ device_id: req.params.id });
        if (!device) return res.status(404).json({ message: 'Device not found' });

        const agentDir = path.resolve(__dirname, '../../../agent');
        const outputDir = path.resolve(__dirname, '../../builds');
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

        const fileName = `iotmonitor-agent-${device.device_id}`;
        const outputPath = path.join(outputDir, fileName);

        const ldflags = `-X iotmonitor/internal/config.DefaultDeviceID=${device.device_id} ` +
            `-X iotmonitor/internal/config.DefaultAgentToken=${device.agent_token} ` +
            `-X iotmonitor/internal/config.DefaultMQTTURL=${process.env.MQTT_URL || 'localhost'}`;

        console.log(`Building agent for ${device.device_id}...`);

        // Command to build the agent
        const buildCmd = `go build -ldflags "${ldflags}" -o "${outputPath}" ./cmd/agent/main.go`;

        await execAsync(buildCmd, { cwd: agentDir });

        res.download(outputPath, fileName, (err) => {
            if (err) console.error('Download error:', err);
            // Optional: clean up file after download
            // fs.unlinkSync(outputPath);
        });
    } catch (err: any) {
        console.error('Build error:', err);
        res.status(500).json({ message: 'Failed to build agent: ' + err.message });
    }
});

export default router;
