import Device from '../models/Device';
import MonitoringCheck from '../models/MonitoringCheck';
import { triggerAlert, resolveAlert } from './notificationThrottling';
import { updateServiceMetrics } from './offlineDetection';

/**
 * Service Monitoring Service
 * 
 * Monitors if specific services are responding even when device is online
 * - Checks if expected service data is present in metrics
 * - Triggers alerts for partial failures (device online but service not responding)
 */

export async function checkServiceHealth(deviceId: string, receivedMetrics: any) {
    try {
        const device = await Device.findById(deviceId);
        if (!device || !device.enabled_modules) return;

        const now = new Date();

        // Process each incoming metric type
        for (const module of Object.keys(receivedMetrics)) {
            // If this module just reported, update its successful timestamp
            // and resolve any existing "service_down" alerts for it.
            await updateServiceMetrics(deviceId, module as any);

            await resolveAlert({
                device_id: deviceId,
                device_name: device.name,
                alert_type: 'service_down',
                specific_service: module,
                details: {
                    recovery_time: now
                }
            });
        }

        // Apply dynamic threshold rules for generic metrics (CPU, Memory, etc.)
        await applyThresholdRules(device, receivedMetrics);

    } catch (error) {
        console.error('Error checking service health:', error);
    }
}

/**
 * Apply dynamic threshold rules from MonitoringCheck model
 */
async function applyThresholdRules(device: any, metrics: any) {
    const checks = await MonitoringCheck.find({ device_id: device._id, enabled: true });
    if (checks.length === 0) return;

    for (const check of checks) {
        let value: number | undefined;

        if (check.check_type === 'cpu') {
            value = metrics.system?.cpu_usage || metrics.system?.cpu_load;
        } else if (check.check_type === 'memory') {
            value = metrics.system?.memory_usage;
        } else if (check.check_type === 'bandwidth') {
            const iface = metrics.network?.interfaces?.find((i: any) => i.name === check.target);
            if (iface) {
                // Combine RX and TX for bandwidth check or use one? Usually combined/total.
                value = (iface.rx_bps + iface.tx_bps) / 1000000; // Convert to Mbps
            }
        }

        if (value !== undefined) {
            if (check.thresholds.critical && value > check.thresholds.critical) {
                await triggerAlert({
                    device_id: device._id,
                    device_name: device.name,
                    alert_type: 'threshold',
                    severity: 'critical',
                    specific_service: check.check_type,
                    details: { value, threshold: check.thresholds.critical, unit: check.check_type === 'bandwidth' ? 'Mbps' : '%' }
                });
            } else if (check.thresholds.attention && value > check.thresholds.attention) {
                await triggerAlert({
                    device_id: device._id,
                    device_name: device.name,
                    alert_type: 'threshold',
                    severity: 'warning',
                    specific_service: check.check_type,
                    details: { value, threshold: check.thresholds.attention, unit: check.check_type === 'bandwidth' ? 'Mbps' : '%' }
                });
            } else {
                await resolveAlert({
                    device_id: device._id,
                    device_name: device.name,
                    alert_type: 'threshold',
                    specific_service: check.check_type
                });
            }
        }
    }
}

/**
 * Check if service data is present in metrics
 */
function checkIfServiceDataPresent(service: string, metrics: any): boolean {
    switch (service) {
        case 'system':
            return !!(metrics.system || metrics.cpu_usage !== undefined || metrics.memory_total !== undefined);
        case 'docker':
            return !!(metrics.docker || metrics.containers !== undefined || metrics.docker_version !== undefined);
        case 'asterisk':
            return !!(metrics.asterisk || metrics.sip_peers !== undefined || metrics.asterisk_version !== undefined);
        case 'network':
            return !!(metrics.network || metrics.interfaces !== undefined || metrics.ping_results !== undefined);
        default:
            return false;
    }
}

/**
 * Monitor SIP endpoints for registration status and latency
 */
export async function checkSIPEndpoints(deviceId: string, sipMetrics: any) {
    try {
        const device = await Device.findById(deviceId);
        if (!device) return;

        // Fetch custom monitoring rules for SIP
        const sipRules = await MonitoringCheck.find({
            device_id: deviceId,
            enabled: true,
            check_type: { $in: ['sip', 'sip_registration'] }
        });

        const rttThresholdDefault = device.sip_rtt_threshold_ms || 200;

        // 1. Check SIP Registrations (Outbound trunks)
        const registrations = sipMetrics.registrations || [];
        if (registrations.length > 0) {
            for (const reg of registrations) {
                const { name, status } = reg;

                if (shouldMonitor(device, name)) {
                    if (status !== 'Registered' && status !== 'OK') {
                        await triggerAlert({
                            device_id: deviceId,
                            device_name: device.name,
                            alert_type: 'sip_issue',
                            severity: 'warning',
                            specific_service: 'sip_registration',
                            specific_endpoint: name,
                            details: {
                                issue_type: 'registration_failed',
                                status,
                                type: 'PJSIP Registration'
                            }
                        });
                    } else {
                        await resolveAlert({
                            device_id: deviceId,
                            device_name: device.name,
                            alert_type: 'sip_issue',
                            specific_service: 'sip_registration',
                            specific_endpoint: name
                        });
                    }
                }
            }
        }

        // 2. Check SIP Peers/Contacts (Availability and RTT)
        const peers = sipMetrics.sip_peers || sipMetrics.contacts || [];
        for (const peer of peers) {
            const { endpoint, status, latency_ms, contact, aor, name: peerName } = peer;
            const name = endpoint || aor || peerName || 'unknown-endpoint';

            if (!shouldMonitor(device, name)) continue;

            // Check dynamic rules for this specific endpoint
            const specificRule = sipRules.find((r: any) => r.check_type === 'sip' && (r.target === name || !r.target));
            const critThresh = specificRule?.thresholds?.critical || rttThresholdDefault;
            const attnThresh = specificRule?.thresholds?.attention || rttThresholdDefault;

            // Check registration/reachability status
            if (status !== 'registered' && status !== 'OK' && status !== 'Avail') {
                await triggerAlert({
                    device_id: deviceId,
                    device_name: device.name,
                    alert_type: 'sip_issue',
                    severity: 'critical',
                    specific_service: 'sip_peer',
                    specific_endpoint: name,
                    details: {
                        issue_type: 'contact_unreachable',
                        status,
                        contact: contact || 'N/A'
                    }
                });
            } else {
                await resolveAlert({
                    device_id: deviceId,
                    device_name: device.name,
                    alert_type: 'sip_issue',
                    specific_service: 'sip_peer',
                    specific_endpoint: name
                });
            }

            // Check latency against threshold (Rule or Global)
            if (latency_ms) {
                if (latency_ms > critThresh) {
                    await triggerAlert({
                        device_id: deviceId,
                        device_name: device.name,
                        alert_type: 'high_latency',
                        severity: 'critical',
                        specific_service: 'sip_peer',
                        specific_endpoint: name,
                        details: { latency_ms, threshold_ms: critThresh }
                    });
                } else if (latency_ms > attnThresh) {
                    await triggerAlert({
                        device_id: deviceId,
                        device_name: device.name,
                        alert_type: 'high_latency',
                        severity: 'warning',
                        specific_service: 'sip_peer',
                        specific_endpoint: name,
                        details: { latency_ms, threshold_ms: attnThresh }
                    });
                } else {
                    await resolveAlert({
                        device_id: deviceId,
                        device_name: device.name,
                        alert_type: 'high_latency',
                        specific_service: 'sip_peer',
                        specific_endpoint: name
                    });
                }
            }
        }
    } catch (error) {
        console.error('Error checking SIP endpoints:', error);
    }
}

/**
 * Helper to check if a specific endpoint should be monitored
 */
function shouldMonitor(device: any, endpoint: string): boolean {
    if (!device.monitored_sip_endpoints || device.monitored_sip_endpoints.length === 0) return true;
    return device.monitored_sip_endpoints.includes(endpoint) || device.monitored_sip_endpoints.includes('all');
}
