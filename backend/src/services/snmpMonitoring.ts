/**
 * SNMP Monitoring Service
 *
 * Polls network devices (switches, routers, firewalls, etc.)
 * using SNMP v1/v2c/v3. Requires 'net-snmp' npm package.
 */
import SnmpDevice from '../models/SnmpDevice';

let snmpLib: any = null;
try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    snmpLib = require('net-snmp');
} catch {
    console.warn('[SNMP] net-snmp package not installed. SNMP monitoring will be disabled.');
    console.warn('[SNMP] Run: npm install net-snmp');
}

// Standard OIDs for common metrics
const STANDARD_OIDS: Record<string, string> = {
    sysDescr: '1.3.6.1.2.1.1.1.0',
    sysUpTime: '1.3.6.1.2.1.1.3.0',
    sysName: '1.3.6.1.2.1.1.5.0',
    sysLocation: '1.3.6.1.2.1.1.6.0',
    // Interfaces
    ifNumber: '1.3.6.1.2.1.2.1.0',
    ifTable: '1.3.6.1.2.1.2.2.1',
    ifInOctets: '1.3.6.1.2.1.2.2.1.10',
    ifOutOctets: '1.3.6.1.2.1.2.2.1.16',
    ifOperStatus: '1.3.6.1.2.1.2.2.1.8',
    ifSpeed: '1.3.6.1.2.1.2.2.1.5',
    // CPU / Memory (HOST-RESOURCES-MIB)
    hrProcessorLoad: '1.3.6.1.2.1.25.3.3.1.2',
    hrMemorySize: '1.3.6.1.2.1.25.2.2.0',
    hrStorageUsed: '1.3.6.1.2.1.25.2.3.1.6',
    hrStorageAllocationUnits: '1.3.6.1.2.1.25.2.3.1.4',
    // Network-specific extensions
    ciscoCpu1min: '1.3.6.1.4.1.9.2.1.56.0',
    ciscoMemUsed: '1.3.6.1.4.1.9.2.1.8.0',
    ciscoMemFree: '1.3.6.1.4.1.9.2.1.9.0',
};

interface PollResult {
    success: boolean;
    metrics: Record<string, any>;
    error?: string;
    responseTimeMs: number;
}

function createSession(device: any) {
    if (!snmpLib) return null;

    const options: any = {
        port: device.port || 161,
        retries: 1,
        timeout: 5000,
        version: snmpLib.Version2c,
    };

    if (device.version === 'v3') {
        options.version = snmpLib.Version3;
        options.authorizationProtocol = snmpLib.AuthProtocols[device.v3_auth_protocol || 'SHA'];
        options.privacyProtocol = snmpLib.PrivProtocols[device.v3_priv_protocol || 'AES'];
        const user = {
            name: device.v3_username || '',
            level: snmpLib.SecurityLevel.authPriv,
            authProtocol: options.authorizationProtocol,
            authKey: device.v3_auth_key || '',
            privProtocol: options.privacyProtocol,
            privKey: device.v3_priv_key || '',
        };
        return snmpLib.createV3Session(device.host, user, options);
    }

    if (device.version === 'v1') {
        options.version = snmpLib.Version1;
    }

    return snmpLib.createSession(device.host, device.community || 'public', options);
}

export async function testSnmpConnection(config: { host: string; port?: number; community?: string; version?: string; v3_username?: string; v3_auth_protocol?: string; v3_auth_key?: string; v3_priv_protocol?: string; v3_priv_key?: string }): Promise<{ success: boolean; message: string }> {
    if (!snmpLib) return { success: false, message: 'net-snmp package is not installed on the server' };
    if (!config.host) return { success: false, message: 'Host is required' };

    const session = createSession({
        host: config.host,
        port: config.port || 161,
        community: config.community || 'public',
        version: config.version || 'v2c',
        v3_username: config.v3_username,
        v3_auth_protocol: config.v3_auth_protocol,
        v3_auth_key: config.v3_auth_key,
        v3_priv_protocol: config.v3_priv_protocol,
        v3_priv_key: config.v3_priv_key,
    });
    if (!session) return { success: false, message: 'Failed to create SNMP session' };

    return new Promise((resolve) => {
        let done = false;
        const timer = setTimeout(() => {
            if (done) return;
            done = true;
            try { session.close(); } catch {}
            resolve({ success: false, message: 'SNMP connection timed out (5s)' });
        }, 6000);

        session.get([STANDARD_OIDS.sysName], (err: any, varbinds: any[]) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try { session.close(); } catch {}
            if (err) {
                resolve({ success: false, message: `SNMP error: ${err.message || err}` });
                return;
            }
            if (!varbinds || varbinds.length === 0) {
                resolve({ success: false, message: 'No response from device' });
                return;
            }
            const vb = varbinds[0];
            if (snmpLib.isVarbindError(vb)) {
                resolve({ success: false, message: `Varbind error: ${vb.oid}` });
                return;
            }
            resolve({ success: true, message: `Connected: ${vb.value || 'SNMP device responded'}` });
        });
    });
}

export async function pollSnmpDevice(deviceId: string): Promise<PollResult> {
    const device = await SnmpDevice.findById(deviceId);
    if (!device) return { success: false, metrics: {}, error: 'Device not found', responseTimeMs: 0 };
    if (!device.enabled) return { success: false, metrics: {}, error: 'Device disabled', responseTimeMs: 0 };
    if (!snmpLib) return { success: false, metrics: {}, error: 'net-snmp not installed', responseTimeMs: 0 };

    const start = Date.now();
    const session = createSession(device);
    if (!session) return { success: false, metrics: {}, error: 'Failed to create SNMP session', responseTimeMs: 0 };

    const oidsToPoll = [
        STANDARD_OIDS.sysDescr,
        STANDARD_OIDS.sysUpTime,
        STANDARD_OIDS.sysName,
        STANDARD_OIDS.ifNumber,
    ];

    // Add device-specific custom OIDs
    if (device.custom_oids) {
        for (const custom of device.custom_oids) {
            if (custom.oid) oidsToPoll.push(custom.oid);
        }
    }

    return new Promise((resolve) => {
        const metrics: Record<string, any> = {};
        let done = false;
        const safeClose = () => { if (!done) { done = true; try { session.close(); } catch {} } };

        session.get(oidsToPoll, (err: any, varbinds: any[]) => {
            if (done) return;
            if (err) {
                safeClose();
                resolve({
                    success: false,
                    metrics: {},
                    error: err.message || String(err),
                    responseTimeMs: Date.now() - start,
                });
                return;
            }

            for (const vb of varbinds || []) {
                if (snmpLib.isVarbindError(vb)) {
                    continue;
                }
                // Map OID to friendly name
                const oidKey = Object.entries(STANDARD_OIDS).find(([, oid]) => oid === vb.oid)?.[0]
                    || vb.oid;
                metrics[oidKey] = vb.value;
            }

            // Try interface table for network devices
            if (device.device_type === 'switch' || device.device_type === 'router' || device.device_type === 'firewall') {
                session.getBulk([STANDARD_OIDS.ifOperStatus], 0, 50, (ifaceErr: any, ifaceBinds: any[]) => {
                    safeClose();

                    const interfaces: any[] = [];
                    let upCount = 0;
                    let downCount = 0;

                    for (const vb of ifaceBinds || []) {
                        if (snmpLib.isVarbindError(vb)) continue;
                        const idx = vb.oid.split('.').pop();
                        const status = Number(vb.value);
                        const iface = { index: idx, oper_status: status, status_label: status === 1 ? 'up' : 'down' };
                        interfaces.push(iface);
                        if (status === 1) upCount++;
                        else downCount++;
                    }

                    metrics.interfaces = interfaces;
                    metrics.interface_summary = { total: interfaces.length, up: upCount, down: downCount };

                    resolve({
                        success: true,
                        metrics,
                        responseTimeMs: Date.now() - start,
                    });
                });
                return;
            }

            safeClose();
            resolve({
                success: true,
                metrics,
                responseTimeMs: Date.now() - start,
            });
        });
    });
}

export async function pollAllSnmpDevices() {
    const devices = await SnmpDevice.find({ enabled: true });
    const results = await Promise.allSettled(
        devices.map(async (device) => {
            const result = await pollSnmpDevice(device._id.toString());
            const status = result.success ? 'online' : 'offline';
            await SnmpDevice.updateOne(
                { _id: device._id },
                {
                    $set: {
                        status,
                        last_seen: new Date(),
                        last_metrics: result.metrics,
                    },
                }
            );
            return { deviceId: device._id, name: device.name, ...result };
        })
    );
    return results;
}

// Background scheduler hook
let snmpInterval: ReturnType<typeof setInterval> | null = null;

export function startSnmpPolling() {
    if (snmpInterval) return;
    console.log('[SNMP] Starting background polling (every 5 minutes)');
    snmpInterval = setInterval(() => {
        pollAllSnmpDevices().catch((err) => console.error('[SNMP] Polling error:', err));
    }, 5 * 60 * 1000);
    // Immediate first run
    pollAllSnmpDevices().catch((err) => console.error('[SNMP] Initial polling error:', err));
}

export function stopSnmpPolling() {
    if (snmpInterval) {
        clearInterval(snmpInterval);
        snmpInterval = null;
    }
}
