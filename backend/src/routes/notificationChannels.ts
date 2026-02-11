import express from 'express';
import NotificationChannel from '../models/NotificationChannel';
import { authenticate, authorizePermission } from '../middleware/auth';

const router = express.Router();

const normalizeStringArray = (value: unknown) => {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(
        value
            .map((entry) => String(entry || '').trim())
            .filter(Boolean)
    ));
};

const normalizePayload = (raw: any) => {
    const payload: any = { ...raw };
    if (payload.name !== undefined) payload.name = String(payload.name || '').trim();
    if (payload.description !== undefined) payload.description = String(payload.description || '').trim();
    if (payload.type !== undefined) payload.type = String(payload.type || '').trim().toLowerCase();
    if (payload.enabled !== undefined) payload.enabled = Boolean(payload.enabled);
    if (payload.is_default !== undefined) payload.is_default = Boolean(payload.is_default);

    if (payload.alert_types !== undefined) payload.alert_types = normalizeStringArray(payload.alert_types);
    if (payload.severity_levels !== undefined) payload.severity_levels = normalizeStringArray(payload.severity_levels);

    if (payload.config && typeof payload.config === 'object') {
        payload.config = { ...payload.config };
        if (payload.config.slack_webhook_url !== undefined) payload.config.slack_webhook_url = String(payload.config.slack_webhook_url || '').trim();
        if (payload.config.slack_channel !== undefined) payload.config.slack_channel = String(payload.config.slack_channel || '').trim();
        if (payload.config.slack_group_name !== undefined) payload.config.slack_group_name = String(payload.config.slack_group_name || '').trim();
        if (payload.config.webhook_url !== undefined) payload.config.webhook_url = String(payload.config.webhook_url || '').trim();
        if (payload.config.email_addresses !== undefined) payload.config.email_addresses = normalizeStringArray(payload.config.email_addresses);
        if (payload.config.phone_numbers !== undefined) payload.config.phone_numbers = normalizeStringArray(payload.config.phone_numbers);
    }

    return payload;
};

const ensureSingleDefaultChannel = async (channelId: string) => {
    await NotificationChannel.updateMany(
        { _id: { $ne: channelId }, is_default: true },
        { $set: { is_default: false } }
    );
};

const ensureAnyDefaultChannel = async () => {
    const hasDefault = await NotificationChannel.exists({ is_default: true });
    if (hasDefault) return;

    const firstEnabled = await NotificationChannel.findOne({ enabled: true }).sort({ created_at: 1 });
    if (!firstEnabled) return;
    firstEnabled.is_default = true;
    await firstEnabled.save();
};

// Get all notification channels
router.get('/', authenticate, authorizePermission('settings.view'), async (req, res) => {
    try {
        const channels = await NotificationChannel.find().sort({ created_at: -1 });
        res.json(channels);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Get a specific channel
router.get('/:id', authenticate, authorizePermission('settings.view'), async (req, res) => {
    try {
        const channel = await NotificationChannel.findById(req.params.id);
        if (!channel) {
            return res.status(404).json({ error: 'Channel not found' });
        }
        res.json(channel);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Create a new notification channel
router.post('/', authenticate, authorizePermission('settings.update'), async (req, res) => {
    try {
        const payload = normalizePayload(req.body);
        const channel = new NotificationChannel(payload);

        if (payload.is_default === undefined) {
            const existingDefault = await NotificationChannel.exists({ is_default: true });
            if (!existingDefault) {
                channel.is_default = true;
            }
        }

        await channel.save();
        if (channel.is_default) {
            await ensureSingleDefaultChannel(String(channel._id));
        }
        res.status(201).json(channel);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

// Update a notification channel
router.patch('/:id', authenticate, authorizePermission('settings.update'), async (req, res) => {
    try {
        const payload = normalizePayload(req.body);
        const channel = await NotificationChannel.findByIdAndUpdate(
            req.params.id,
            { $set: payload },
            { new: true, runValidators: true }
        );
        if (!channel) {
            return res.status(404).json({ error: 'Channel not found' });
        }

        if (channel.is_default) {
            await ensureSingleDefaultChannel(String(channel._id));
        } else {
            await ensureAnyDefaultChannel();
        }
        res.json(channel);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

// Enable/disable a channel
router.patch('/:id/toggle', authenticate, authorizePermission('settings.update'), async (req, res) => {
    try {
        const channel = await NotificationChannel.findById(req.params.id);
        if (!channel) {
            return res.status(404).json({ error: 'Channel not found' });
        }
        channel.enabled = !channel.enabled;
        await channel.save();
        await ensureAnyDefaultChannel();
        res.json(channel);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.patch('/:id/default', authenticate, authorizePermission('settings.update'), async (req, res) => {
    try {
        const channel = await NotificationChannel.findById(req.params.id);
        if (!channel) {
            return res.status(404).json({ error: 'Channel not found' });
        }

        channel.is_default = true;
        await channel.save();
        await ensureSingleDefaultChannel(String(channel._id));

        res.json(channel);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Delete a notification channel
router.delete('/:id', authenticate, authorizePermission('settings.update'), async (req, res) => {
    try {
        const channel = await NotificationChannel.findByIdAndDelete(req.params.id);
        if (!channel) {
            return res.status(404).json({ error: 'Channel not found' });
        }
        await ensureAnyDefaultChannel();
        res.json({ message: 'Channel deleted successfully' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Test a notification channel
router.post('/:id/test', authenticate, authorizePermission('settings.update'), async (req, res) => {
    try {
        const channel = await NotificationChannel.findById(req.params.id);
        if (!channel) {
            return res.status(404).json({ error: 'Channel not found' });
        }

        if (!channel.enabled) {
            return res.status(400).json({ error: 'Channel is disabled' });
        }

        // Import notification service
        const { sendTestNotification } = require('../services/notifications');

        await sendTestNotification(channel);

        res.json({ message: 'Test notification sent successfully' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
