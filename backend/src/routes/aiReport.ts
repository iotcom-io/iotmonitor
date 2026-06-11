import { Router } from 'express';
import { authenticate, authorizePermission, AuthRequest } from '../middleware/auth';
import { canAccessDevice } from '../lib/rbac';
import Device from '../models/Device';
import Incident from '../models/Incident';
import Telemetry from '../models/Telemetry';

const router = Router();
router.use(authenticate);

router.post('/device/:deviceId/report', authorizePermission('monitoring.view'), async (req: AuthRequest, res) => {
    try {
        const { deviceId } = req.params;
        const { timeframe, startDate, endDate } = req.body;

        const device = await Device.findOne({ device_id: deviceId }).select({ device_id: 1, name: 1, status: 1, type: 1, last_seen: 1 });
        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }
        if (!canAccessDevice(req.user, device)) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Parse timeframe
        let since = new Date();
        let end = new Date();
        if (timeframe === '30d' || timeframe === '30 days') {
            since.setDate(since.getDate() - 30);
        } else if (timeframe === '7d' || timeframe === '7 days') {
            since.setDate(since.getDate() - 7);
        } else if (timeframe === 'custom' && startDate && endDate) {
            since = new Date(startDate);
            end = new Date(endDate);
        } else {
            // Default 7 days
            since.setDate(since.getDate() - 7);
        }

        // Fetch telemetry and incidents in parallel
        const [telemetry, incidents] = await Promise.all([
            Telemetry.find({
                device_id: deviceId,
                timestamp: { $gte: since, $lte: end }
            }).sort({ timestamp: 1 }),
            Incident.find({
                target_type: 'device',
                target_id: deviceId,
                $or: [
                    { started_at: { $gte: since, $lte: end } },
                    { resolved_at: { $gte: since, $lte: end } },
                    { status: 'open', started_at: { $lte: end } }
                ]
            }).sort({ started_at: -1 })
        ]);

        // Calculate availability
        const totalMs = end.getTime() - since.getTime();
        let availability = 100;
        let totalDowntimeMs = 0;

        if (totalMs > 0) {
            const intervals: { start: number; end: number }[] = [];
            incidents.forEach((inc) => {
                if (inc.severity !== 'critical') return;
                const startMs = Math.max(new Date(inc.started_at).getTime(), since.getTime());
                const resolvedVal = inc.resolved_at ? new Date(inc.resolved_at).getTime() : Date.now();
                const endMs = Math.min(resolvedVal, end.getTime());
                if (startMs < endMs) {
                    intervals.push({ start: startMs, end: endMs });
                }
            });

            if (intervals.length > 0) {
                intervals.sort((a, b) => a.start - b.start);
                const merged: { start: number; end: number }[] = [intervals[0]];
                for (let i = 1; i < intervals.length; i++) {
                    const last = merged[merged.length - 1];
                    const curr = intervals[i];
                    if (curr.start <= last.end) {
                        last.end = Math.max(last.end, curr.end);
                    } else {
                        merged.push(curr);
                    }
                }
                totalDowntimeMs = merged.reduce((sum, int) => sum + (int.end - int.start), 0);
                availability = ((totalMs - totalDowntimeMs) / totalMs) * 100;
            }
        }

        // Calculate average metrics and peaks
        let avgCpu = 0, avgMem = 0, avgDisk = 0;
        let maxCpu = 0, maxMem = 0, maxDisk = 0;
        let peakCpuTime: Date | null = null;
        let peakMemTime: Date | null = null;

        if (telemetry.length > 0) {
            let cpuSum = 0, memSum = 0, diskSum = 0;
            let cpuCount = 0, memCount = 0, diskCount = 0;

            telemetry.forEach((t) => {
                if (t.cpu_usage !== undefined && t.cpu_usage !== null) {
                    cpuSum += t.cpu_usage;
                    cpuCount++;
                    if (t.cpu_usage > maxCpu) {
                        maxCpu = t.cpu_usage;
                        peakCpuTime = t.timestamp;
                    }
                }
                if (t.memory_usage !== undefined && t.memory_usage !== null) {
                    memSum += t.memory_usage;
                    memCount++;
                    if (t.memory_usage > maxMem) {
                        maxMem = t.memory_usage;
                        peakMemTime = t.timestamp;
                    }
                }
                if (t.disk_usage !== undefined && t.disk_usage !== null) {
                    diskSum += t.disk_usage;
                    diskCount++;
                    if (t.disk_usage > maxDisk) {
                        maxDisk = t.disk_usage;
                    }
                }
            });

            avgCpu = cpuCount > 0 ? cpuSum / cpuCount : 0;
            avgMem = memCount > 0 ? memSum / memCount : 0;
            avgDisk = diskCount > 0 ? diskSum / diskCount : 0;
        }

        // Build Downtime Logs Timeline
        const downtimeLogs = incidents.map(inc => ({
            id: inc._id,
            summary: inc.summary,
            severity: inc.severity,
            status: inc.status,
            started_at: inc.started_at,
            resolved_at: inc.resolved_at,
            duration_minutes: inc.resolved_at 
                ? Math.round((new Date(inc.resolved_at).getTime() - new Date(inc.started_at).getTime()) / 60000)
                : Math.round((Date.now() - new Date(inc.started_at).getTime()) / 60000)
        }));

        // AI Level executive summary and root-cause analysis
        const rootCauses: string[] = [];
        const recommendations: string[] = [];

        if (availability < 99) {
            rootCauses.push(`Device experienced significant availability issues with ${downtimeLogs.length} incident(s) detected.`);
            recommendations.push('Review power supply, network switch logs, and physical Ethernet/Wi-Fi connection stability.');
        } else if (availability < 99.9) {
            rootCauses.push('Minor intermittent connection drops observed during the timeframe.');
            recommendations.push('Monitor network interface metrics and check for local routing/firewall issues.');
        } else {
            rootCauses.push('The device maintained excellent uptime with stable connections.');
            recommendations.push('Maintain current configurations and scheduled maintenance tasks.');
        }

        if (maxCpu > 85) {
            rootCauses.push(`High CPU usage peak of ${maxCpu.toFixed(1)}% detected${peakCpuTime ? ` on ${new Date(peakCpuTime).toLocaleString()}` : ''}.`);
            recommendations.push('Evaluate resource intensive processes and optimize application code or cron jobs running during peaks.');
        }
        if (maxMem > 90) {
            rootCauses.push(`Critical memory usage peak of ${maxMem.toFixed(1)}% detected${peakMemTime ? ` on ${new Date(peakMemTime).toLocaleString()}` : ''}.`);
            recommendations.push('Identify memory leaks, check daemon configuration, or consider vertical RAM upgrade.');
        }
        if (maxDisk > 85) {
            rootCauses.push(`Disk usage is high, reaching ${maxDisk.toFixed(1)}%.`);
            recommendations.push('Implement automated log rotation, clear temporary files, or expand volume storage capacity.');
        }

        // Fallback recommendations if empty
        if (recommendations.length === 0) {
            recommendations.push('All parameters are within normal operating conditions. Continue standard monitoring.');
        }

        res.json({
            ok: true,
            generated_at: new Date().toISOString(),
            timeframe,
            start_date: since,
            end_date: end,
            device: {
                device_id: device.device_id,
                name: device.name,
                status: device.status,
                type: device.type,
                last_seen: device.last_seen
            },
            availability: Number(availability.toFixed(3)),
            total_downtime_minutes: Math.round(totalDowntimeMs / 60000),
            metrics: {
                avg_cpu: Number(avgCpu.toFixed(2)),
                max_cpu: Number(maxCpu.toFixed(2)),
                avg_memory: Number(avgMem.toFixed(2)),
                max_memory: Number(maxMem.toFixed(2)),
                avg_disk: Number(avgDisk.toFixed(2)),
                max_disk: Number(maxDisk.toFixed(2))
            },
            downtime_logs: downtimeLogs,
            ai_summary: {
                overview: availability >= 99.9 
                    ? `Device ${device.name} is highly reliable with an availability score of ${availability.toFixed(3)}% during the reporting period.`
                    : `Device ${device.name} had uptime issues in the reporting period. Availability drops to ${availability.toFixed(3)}%.`,
                root_causes: rootCauses,
                recommendations: recommendations,
                peak_load_hours: peakCpuTime 
                    ? `Peak load of ${maxCpu.toFixed(1)}% CPU usage was observed at ${new Date(peakCpuTime).toLocaleTimeString()}`
                    : 'No significant peak load detected.'
            }
        });

    } catch (error: any) {
        console.error('Failed to generate AI report:', error);
        res.status(500).json({ message: error.message || 'Failed to generate AI report' });
    }
});

export default router;
