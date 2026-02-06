import express from 'express';
import MonitoringTemplate from '../models/MonitoringTemplate';
import Device from '../models/Device';
import { authenticate } from '../middleware/auth';

const router = express.Router();

// Get all templates
router.get('/', authenticate, async (req, res) => {
    try {
        const templates = await MonitoringTemplate.find().sort({ is_system: -1, name: 1 });
        res.json(templates);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Get a specific template
router.get('/:id', authenticate, async (req, res) => {
    try {
        const template = await MonitoringTemplate.findById(req.params.id);
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        res.json(template);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Create a new template
router.post('/', authenticate, async (req, res) => {
    try {
        const template = new MonitoringTemplate({
            ...req.body,
            is_system: false // User-created templates are not system templates
        });
        await template.save();
        res.status(201).json(template);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

// Update a template
router.patch('/:id', authenticate, async (req, res) => {
    try {
        const template = await MonitoringTemplate.findById(req.params.id);
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }

        // Prevent editing system templates
        if (template.is_system) {
            return res.status(403).json({ error: 'Cannot modify system templates' });
        }

        const updated = await MonitoringTemplate.findByIdAndUpdate(
            req.params.id,
            { $set: req.body },
            { new: true, runValidators: true }
        );

        res.json(updated);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

// Delete a template
router.delete('/:id', authenticate, async (req, res) => {
    try {
        const template = await MonitoringTemplate.findById(req.params.id);
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }

        // Prevent deleting system templates
        if (template.is_system) {
            return res.status(403).json({ error: 'Cannot delete system templates' });
        }

        await MonitoringTemplate.findByIdAndDelete(req.params.id);
        res.json({ message: 'Template deleted successfully' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Apply template to a device
router.post('/:templateId/apply/:deviceId', authenticate, async (req, res) => {
    try {
        const template = await MonitoringTemplate.findById(req.params.templateId);
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }

        const device = await Device.findById(req.params.deviceId);
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }

        // For now, just return success - MonitoringRule will be created later
        res.json({
            message: `Template "${template.name}" will be applied to device "${device.name}"`,
            template_rules: template.default_rules.length
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
