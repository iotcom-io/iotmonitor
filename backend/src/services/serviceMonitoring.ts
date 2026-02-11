import Device from '../models/Device';
import MonitoringCheck from '../models/MonitoringCheck';
import { triggerAlert, resolveAlert } from './notificationThrottling';
import { updateServiceMetrics } from './offlineDetection';

const MODULES = ['system', 'docker', 'asterisk', 'network'] as const;
type ModuleName = typeof MODULES[number];
const GLOBAL_SIP_TARGETS = new Set(['', 'all', 'system-wide', '*']);
const CHECK_MODULE_MAP: Record<string, ModuleName | null> = {
    cpu: 'system',
    memory: 'system',
    disk: 'system',
    bandwidth: 'network',
    utilization: 'network',
    sip_rtt: 'asterisk',
    sip_registration: 'asterisk',
    sip: 'asterisk', // legacy
    container_status: 'docker',
    custom: null,
};

const toNumber = (value: any): number | undefined => {
    if (value === null || value === undefined) return undefined;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
};

const firstNumber = (...values: any[]): number | undefined => {
    for (const value of values) {
        const parsed = toNumber(value);
        if (parsed !== undefined) {
            return parsed;
        }
    }
    return undefined;
};

const normalizeTarget = (target?: string) => String(target || '').trim().replace(/^\//, '').toLowerCase();

const matchesDiskTarget = (diskEntry: any, target?: string) => {
    const normalizedTarget = normalizeTarget(target);
    if (!normalizedTarget || normalizedTarget === 'system-wide' || normalizedTarget === 'all') {
        return true;
    }

    const candidateValues = [
        diskEntry?.mount,
        diskEntry?.mountpoint,
        diskEntry?.path,
        diskEntry?.name,
        diskEntry?.device,
    ];

    return candidateValues.some((candidate) => normalizeTarget(candidate) === normalizedTarget);
};

const extractDiskUsage = (metrics: any, target?: string): number | undefined => {
    const systemPayload = metrics?.system || metrics;

    const aggregate = firstNumber(
        systemPayload?.disk_usage,
        systemPayload?.disk_percent,
        systemPayload?.disk?.usage_percent,
        systemPayload?.disk?.percent,
        metrics?.disk_usage,
        metrics?.disk_percent
    );

    const diskCollections = [
        systemPayload?.disks,
        systemPayload?.disk_info,
        systemPayload?.diskInfo,
        systemPayload?.partitions,
        metrics?.disk_info,
        metrics?.disks,
    ];

    for (const collection of diskCollections) {
        if (!Array.isArray(collection)) continue;
        const match = collection.find((disk) => matchesDiskTarget(disk, target));
        if (!match) continue;
        const value = firstNumber(
            match?.usage_percent,
            match?.used_percent,
            match?.percent,
            match?.usage,
            match?.usedPct
        );
        if (value !== undefined) return value;
    }

    return aggregate;
};

const getEnabledModules = (device: any): ModuleName[] => {
    const modulesConfig = device.config?.modules;
    if (modulesConfig && typeof modulesConfig === 'object') {
        return MODULES.filter((module) => modulesConfig[module] === true);
    }

    if (Array.isArray(device.enabled_modules) && device.enabled_modules.length > 0) {
        return device.enabled_modules.filter((m: string) => MODULES.includes(m as ModuleName));
    }

    return [];
};

const normalizeText = (value?: string) => String(value || '').trim().toLowerCase();

const endpointMatchesRuleTarget = (endpoint: string, target?: string) => {
    const normalizedTarget = normalizeText(target);
    if (GLOBAL_SIP_TARGETS.has(normalizedTarget)) return true;
    return normalizeText(endpoint) === normalizedTarget;
};

const isEndpointMonitoredByRules = (rules: any[], endpoint: string) => {
    if (!rules || rules.length === 0) return false;
    return rules.some((rule) => endpointMatchesRuleTarget(endpoint, rule.target));
};

const pickRuleForEndpoint = (rules: any[], endpoint: string) => {
    const endpointRule = rules.find((rule) => normalizeText(rule.target) === normalizeText(endpoint));
    if (endpointRule) return endpointRule;
    return rules.find((rule) => GLOBAL_SIP_TARGETS.has(normalizeText(rule.target)));
};

const getCheckUnit = (checkType: string) => {
    if (checkType === 'sip_rtt') return 'ms';
    if (checkType === 'bandwidth') return 'Mbps';
    if (['cpu', 'memory', 'disk', 'utilization', 'sip_registration'].includes(checkType)) return '%';
    if (checkType === 'container_status') return 'state';
    return '';
};

/**
 * Service Monitoring Service
 *
 * Monitors if specific services are responding even when device is online.
 */
export async function checkServiceHealth(deviceId: string, receivedMetrics: any) {
    try {
        const device = await Device.findOne({ device_id: deviceId });
        if (!device || device.monitoring_paused) return;

        const now = new Date();
        const monitoredModules = new Set(getEnabledModules(device));

        // Process each incoming metric type
        for (const moduleName of Object.keys(receivedMetrics)) {
            const module = moduleName as ModuleName;
            if (!monitoredModules.has(module)) {
                continue;
            }

            // If this module just reported, update successful timestamp
            // and resolve any existing "service_down" alert for it.
            await updateServiceMetrics(device.device_id, module);

            await resolveAlert({
                device_id: device.device_id,
                device_name: device.name,
                alert_type: 'service_down',
                specific_service: module,
                details: {
                    recovery_time: now,
                },
            });
        }

        // Apply dynamic threshold rules for generic metrics (CPU, Memory, etc.)
        await applyThresholdRules(device, receivedMetrics);
    } catch (error) {
        console.error('Error checking service health:', error);
    }
}

/**
 * Apply dynamic monitoring rules from MonitoringCheck model.
 */
export async function applyThresholdRules(device: any, metrics: any) {
    if (device.monitoring_paused) return;

    const checks = await MonitoringCheck.find({ device_id: device.device_id, enabled: true });
    if (checks.length === 0) return;
    const enabledModules = new Set(getEnabledModules(device));

    for (const check of checks) {
        const requiredModule = CHECK_MODULE_MAP[String(check.check_type)] ?? null;
        if (requiredModule && !enabledModules.has(requiredModule)) {
            continue;
        }

        let value: number | undefined;
        let isProblem = false;
        let message = '';
        let alertDetails: Record<string, any> = {};

        if (check.check_type === 'cpu') {
            const systemPayload = metrics.system || metrics;
            value = firstNumber(
                systemPayload?.cpu_usage,
                systemPayload?.cpu_percent,
                systemPayload?.cpu?.usage_percent,
                systemPayload?.cpu?.percent,
                metrics?.cpu_usage,
                metrics?.cpu_percent,
                systemPayload?.cpu_load
            );
        } else if (check.check_type === 'memory') {
            const systemPayload = metrics.system || metrics;
            value = firstNumber(
                systemPayload?.memory_usage,
                systemPayload?.memory_percent,
                systemPayload?.memory?.used_percent,
                systemPayload?.memory?.percent,
                metrics?.memory_usage,
                metrics?.memory_percent
            );
        } else if (check.check_type === 'disk') {
            value = extractDiskUsage(metrics, check.target);
        } else if (check.check_type === 'bandwidth' || check.check_type === 'utilization') {
            const networkPayload = metrics.network || metrics;
            const iface = networkPayload?.interfaces?.find((i: any) => i.name === check.target);
            if (iface) {
                if (check.check_type === 'bandwidth') {
                    const rx = firstNumber(iface.rx_bps, iface.rxBps, iface.rx_bytes_per_sec, 0) || 0;
                    const tx = firstNumber(iface.tx_bps, iface.txBps, iface.tx_bytes_per_sec, 0) || 0;
                    value = (rx + tx) / 1000000;
                } else {
                    value = firstNumber(iface.utilization_percent, iface.utilization, iface.usage_percent);
                }
            }
        } else if (check.check_type === 'sip_rtt') {
            const asteriskPayload = metrics.asterisk || metrics;
            const peer = asteriskPayload?.contacts?.find((c: any) => c.aor === check.target || c.endpoint === check.target);
            value = firstNumber(peer?.rttMs, peer?.latency_ms);
        } else if (check.check_type === 'sip_registration') {
            const asteriskPayload = metrics.asterisk || metrics;
            const registrations = asteriskPayload?.registrations || [];
            const reg = registrations.find((r: any) => r.name === check.target);
            if (reg) {
                value = reg.status === 'Registered' ? 100 : 0;
            }
        } else if (check.check_type === 'container_status') {
            const dockerPayload = metrics.docker;
            const containers = Array.isArray(dockerPayload)
                ? dockerPayload
                : (dockerPayload?.containers || []);

            const targetName = String(check.target || '').replace(/^\//, '').toLowerCase();
            const container = containers.find((c: any) => {
                const id = String(c.id || '');
                if (check.target && (id === check.target || id.startsWith(check.target))) {
                    return true;
                }

                const names: string[] = [];
                if (typeof c.name === 'string') {
                    names.push(c.name);
                }
                if (Array.isArray(c.names)) {
                    names.push(...c.names);
                }
                if (Array.isArray(c.Names)) {
                    names.push(...c.Names);
                }

                return names.some((n) => String(n).replace(/^\//, '').toLowerCase() === targetName);
            });
            const normalizedTarget = String(check.target || '').replace(/^\//, '') || 'unknown-container';
            const criticalStates = check.config?.critical_states || ['stopped', 'dead', 'exited', 'unhealthy'];
            const warningStates = check.config?.warning_states || ['restarting', 'paused', 'created'];

            if (!container && containers.length > 0) {
                isProblem = true;
                value = 100;
                message = `Container ${normalizedTarget} was not found in latest docker telemetry`;
                alertDetails = {
                    container_name: normalizedTarget,
                    container_state: 'not_found',
                    container_status: 'not_found',
                    expected_state: 'running/healthy',
                };
            } else if (container) {
                const rawDisplayName =
                    (Array.isArray(container.names) && container.names[0]) ||
                    (Array.isArray(container.Names) && container.Names[0]) ||
                    container.name ||
                    check.target;
                const displayName = String(rawDisplayName || normalizedTarget).replace(/^\//, '');
                const containerState = String(container.state || '').toLowerCase().trim();
                const statusText = String(container.status || container.state || '').trim();
                const health = String(container.health || '').toLowerCase().trim();
                const normalizedStatusText = statusText.toLowerCase();
                const isUnhealthy = normalizedStatusText.includes('unhealthy') || health === 'unhealthy';
                const effectiveState = containerState || (isUnhealthy ? 'unhealthy' : 'running');

                alertDetails = {
                    container_name: displayName,
                    container_state: effectiveState,
                    container_status: statusText || effectiveState,
                    container_health: health || 'unknown',
                    expected_state: 'running/healthy',
                };

                if (criticalStates.includes(effectiveState) || isUnhealthy) {
                    isProblem = true;
                    value = 100;
                    message = `Container ${displayName} is ${statusText || effectiveState}`;
                } else if (warningStates.includes(effectiveState)) {
                    isProblem = true;
                    value = 50;
                    message = `Container ${displayName} is ${statusText || effectiveState}`;
                } else {
                    value = 0;
                    message = `Container ${displayName} is healthy (${statusText || effectiveState})`;
                }
            }
        }

        if (value !== undefined || isProblem) {
            const unit = getCheckUnit(String(check.check_type));

            let newState: 'ok' | 'warning' | 'critical' = 'ok';
            if (check.check_type === 'container_status') {
                if (value === 100) {
                    newState = 'critical';
                } else if (value === 50) {
                    newState = 'warning';
                }
            } else if (check.check_type === 'sip_registration') {
                if (check.thresholds.critical !== undefined && value! <= check.thresholds.critical) {
                    newState = 'critical';
                } else if (check.thresholds.warning !== undefined && value! <= check.thresholds.warning) {
                    newState = 'warning';
                }
            } else {
                if (check.thresholds.critical !== undefined && (value! >= check.thresholds.critical || (isProblem && value === 100))) {
                    newState = 'critical';
                } else if (check.thresholds.warning !== undefined && (value! >= check.thresholds.warning || (isProblem && value === 50))) {
                    newState = 'warning';
                }
            }

            const stateChanged = check.last_state !== newState;
            (check as any).last_value = value;
            check.last_state = newState;
            check.last_evaluated_at = new Date();
            const thresholdValue = newState === 'critical' ? check.thresholds.critical : check.thresholds.warning;
            check.last_message = message || (unit
                ? `${check.check_type.toUpperCase()} is ${value}${unit} (Threshold: ${thresholdValue}${unit})`
                : `${check.check_type.toUpperCase()} is ${value} (Threshold: ${thresholdValue})`);
            await check.save();

            if (newState !== 'ok') {
                const throttlingConfig = newState === 'critical'
                    ? { repeat_interval_minutes: 5, throttling_duration_minutes: 0 }
                    : { repeat_interval_minutes: 15, throttling_duration_minutes: 60 };

                await triggerAlert({
                    device_id: device.device_id,
                    device_name: device.name,
                    alert_type: 'rule_violation',
                    severity: newState,
                    specific_service: check.check_type,
                    specific_endpoint: check.target,
                    details: {
                        ...(check.check_type === 'container_status'
                            ? alertDetails
                            : {
                                value,
                                threshold: thresholdValue,
                                unit,
                            }),
                        rule_id: check._id,
                    },
                    throttling_config: throttlingConfig,
                });
            } else if (stateChanged) {
                await resolveAlert({
                    device_id: device.device_id,
                    device_name: device.name,
                    alert_type: 'rule_violation',
                    specific_service: check.check_type,
                    specific_endpoint: check.target,
                });
            }
        }
    }
}

/**
 * Monitor SIP endpoints for registration status and latency.
 */
export async function checkSIPEndpoints(deviceId: string, sipMetrics: any) {
    try {
        const device = await Device.findOne({ device_id: deviceId });
        if (!device || device.monitoring_paused) return;
        const enabledModules = getEnabledModules(device);
        if (!enabledModules.includes('asterisk')) return;

        const sipRules = await MonitoringCheck.find({
            device_id: deviceId,
            enabled: true,
            check_type: { $in: ['sip_rtt', 'sip_registration', 'sip'] }, // keep legacy 'sip' for backward compatibility
        });
        const registrationRules = sipRules.filter((rule: any) => rule.check_type === 'sip_registration');
        const rttRules = sipRules.filter((rule: any) => rule.check_type === 'sip_rtt' || rule.check_type === 'sip');

        const rttThresholdDefault = device.sip_rtt_threshold_ms || 200;

        const registrations = sipMetrics.registrations || [];
        if (registrations.length > 0) {
            for (const reg of registrations) {
                const { name, status } = reg;

                if (!isEndpointMonitoredByRules(registrationRules, name)) {
                    await resolveAlert({
                        device_id: deviceId,
                        device_name: device.name,
                        alert_type: 'sip_issue',
                        specific_service: 'sip_registration',
                        specific_endpoint: name,
                        details: { resolution_reason: 'Endpoint not monitored' },
                    });
                    continue;
                }

                const registrationRule = pickRuleForEndpoint(registrationRules, name);
                if (registrationRule?.check_type === 'sip_registration') {
                    // Avoid duplicate alerts: registration threshold checks already emit rule_violation alerts.
                    await resolveAlert({
                        device_id: deviceId,
                        device_name: device.name,
                        alert_type: 'sip_issue',
                        specific_service: 'sip_registration',
                        specific_endpoint: name,
                        details: { resolution_reason: 'Handled by sip_registration threshold rule' },
                    });
                    continue;
                }

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
                            type: 'PJSIP Registration',
                        },
                        throttling_config: { repeat_interval_minutes: 15, throttling_duration_minutes: 60 },
                    });
                } else {
                    await resolveAlert({
                        device_id: deviceId,
                        device_name: device.name,
                        alert_type: 'sip_issue',
                        specific_service: 'sip_registration',
                        specific_endpoint: name,
                    });
                }
            }
        }

        const peers = sipMetrics.sip_peers || sipMetrics.contacts || [];
        for (const peer of peers) {
            const { endpoint, status, latency_ms, rttMs, contact, aor, name: peerName } = peer;
            const name = endpoint || aor || peerName || 'unknown-endpoint';
            const latencyValue = latency_ms ?? rttMs;

            if (!isEndpointMonitoredByRules(rttRules, name)) {
                await resolveAlert({
                    device_id: deviceId,
                    device_name: device.name,
                    alert_type: 'sip_issue',
                    specific_service: 'sip_peer',
                    specific_endpoint: name,
                    details: { resolution_reason: 'Endpoint not monitored' },
                });
                await resolveAlert({
                    device_id: deviceId,
                    device_name: device.name,
                    alert_type: 'high_latency',
                    specific_service: 'sip_peer',
                    specific_endpoint: name,
                    details: { resolution_reason: 'Endpoint not monitored' },
                });
                continue;
            }

            const specificRule = pickRuleForEndpoint(rttRules, name);
            const critThresh = specificRule?.thresholds?.critical || rttThresholdDefault;
            const warnThresh = specificRule?.thresholds?.warning || rttThresholdDefault;
            const useRuleBasedRttAlerting = specificRule?.check_type === 'sip_rtt';

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
                        contact: contact || 'N/A',
                    },
                    throttling_config: { repeat_interval_minutes: 5, throttling_duration_minutes: 0 },
                });
            } else {
                await resolveAlert({
                    device_id: deviceId,
                    device_name: device.name,
                    alert_type: 'sip_issue',
                    specific_service: 'sip_peer',
                    specific_endpoint: name,
                });
            }

            if (useRuleBasedRttAlerting) {
                // Avoid duplicate alerts: sip_rtt threshold checks emit rule_violation alerts.
                await resolveAlert({
                    device_id: deviceId,
                    device_name: device.name,
                    alert_type: 'high_latency',
                    specific_service: 'sip_peer',
                    specific_endpoint: name,
                    details: { resolution_reason: 'Handled by sip_rtt threshold rule' },
                });
                continue;
            }

            if (latencyValue) {
                if (latencyValue > critThresh) {
                    await triggerAlert({
                        device_id: deviceId,
                        device_name: device.name,
                        alert_type: 'high_latency',
                        severity: 'critical',
                        specific_service: 'sip_peer',
                        specific_endpoint: name,
                        details: { latency_ms: latencyValue, threshold_ms: critThresh },
                        throttling_config: { repeat_interval_minutes: 5, throttling_duration_minutes: 0 },
                    });
                } else if (latencyValue > warnThresh) {
                    await triggerAlert({
                        device_id: deviceId,
                        device_name: device.name,
                        alert_type: 'high_latency',
                        severity: 'warning',
                        specific_service: 'sip_peer',
                        specific_endpoint: name,
                        details: { latency_ms: latencyValue, threshold_ms: warnThresh },
                        throttling_config: { repeat_interval_minutes: 15, throttling_duration_minutes: 60 },
                    });
                } else {
                    await resolveAlert({
                        device_id: deviceId,
                        device_name: device.name,
                        alert_type: 'high_latency',
                        specific_service: 'sip_peer',
                        specific_endpoint: name,
                    });
                }
            }
        }
    } catch (error) {
        console.error('Error checking SIP endpoints:', error);
    }
}
