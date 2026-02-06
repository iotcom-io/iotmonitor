import express from 'express';
import NotificationChannel from '../models/NotificationChannel';
import { authenticate } from '../middleware/auth';

const router = express.Router();

// Get all notification channels
router.get('/', authenticate, async (req, res) => {
    try {
        const channels = await NotificationChannel.find().sort({ created_at: -1 });
        res.json(channels);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Get a specific channel
router.get('/:id', authenticate, async (req, res) => {
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
router.post('/', authenticate, async (req, res) => {
    try {
        const channel = new NotificationChannel(req.body);
        await channel.save();
        res.status(201).json(channel);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

// Update a notification channel
router.patch('/:id', authenticate, async (req, res) => {
    try {
        const channel = await NotificationChannel.findByIdAndUpdate(
            req.params.id,
            { $set: req.body },
            { new: true, runValidators: true }
        );
        if (!channel) {
            return res.status(404).json({ error: 'Channel not found' });
        }
        res.json(channel);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

// Enable/disable a channel
router.patch('/:id/toggle', authenticate, async (req, res) => {
    try {
        const channel = await NotificationChannel.findById(req.params.id);
        if (!channel) {
            return res.status(404).json({ error: 'Channel not found' });
        }
        channel.enabled = !channel.enabled;
        await channel.save();
        res.json(channel);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Delete a notification channel
router.delete('/:id', authenticate, async (req, res) => {
    try {
        const channel = await NotificationChannel.findByIdAndDelete(req.params.id);
        if (!channel) {
            return res.status(404).json({ error: 'Channel not found' });
        }
        res.json({ message: 'Channel deleted successfully' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Test a notification channel
router.post('/:id/test', authenticate, async (req, res) => {
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
