import SyntheticCheck from '../models/SyntheticCheck';
import Incident from '../models/Incident';
import { NotificationService } from './NotificationService';
import https from 'https';
import http from 'http';
import tls from 'tls';
import { URL } from 'url';

let timer: NodeJS.Timeout | null = null;

const runHttp = async (check: any) => {
    const url = new URL(check.url);
    const lib = url.protocol === 'https:' ? https : http;
    const opts: any = {
        method: check.method || 'GET',
        timeout: check.timeout || 8000,
        headers: check.headers || {}
    };

    return new Promise<{ ok: boolean; message: string }>((resolve) => {
        const req = lib.request(check.url, opts, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                if (check.expected_status && res.statusCode !== check.expected_status) {
                    return resolve({ ok: false, message: `Status ${res.statusCode}` });
                }
                if (check.must_include && !body.includes(check.must_include)) {
                    return resolve({ ok: false, message: 'Keyword missing' });
                }
                resolve({ ok: true, message: `Status ${res.statusCode}` });
            });
        });
        req.on('error', (err) => resolve({ ok: false, message: err.message }));
        req.on('timeout', () => {
            req.destroy(new Error('Timeout'));
            resolve({ ok: false, message: 'Timeout' });
        });
        if (check.body) {
            req.write(check.body);
        }
        req.end();
    });
};

const ensureIncident = async (check: any, ok: boolean, message: string) => {
    let incident = await Incident.findOne({ target_type: 'synthetic', target_id: check._id, status: 'open' });
    if (!ok) {
        if (!incident) {
            incident = new Incident({
                target_type: 'synthetic',
                target_id: check._id,
                target_name: check.name,
                severity: 'critical',
                status: 'open',
                summary: `Synthetic check failed: ${message}`,
                updates: [{ at: new Date(), message }]
            });
            await incident.save();
            await NotificationService.send({
                subject: `Synthetic DOWN: ${check.name}`,
                message,
                channels: ['email', 'slack'],
                recipients: {}
            });
        } else {
            incident.updates.push({ at: new Date(), message });
            await incident.save();
        }
    } else if (incident) {
        incident.status = 'resolved';
        incident.resolved_at = new Date();
        incident.updates.push({ at: new Date(), message: 'Recovered' });
        await incident.save();
        await NotificationService.send({
            subject: `Synthetic RECOVERED: ${check.name}`,
            message: 'Service restored',
            channels: ['email', 'slack'],
            recipients: {}
        });
    }
};

const runSSL = async (check: any) => {
    return new Promise<{ ok: boolean; message: string }>((resolve) => {
        const url = new URL(check.url);
        const host = url.hostname;
        const port = url.port ? parseInt(url.port) : 443;
        const socket = tls.connect(port, host, { servername: host, timeout: check.timeout || 8000 }, () => {
            const cert = socket.getPeerCertificate();
            if (!cert || !cert.valid_to) {
                resolve({ ok: false, message: 'No certificate' });
                socket.end();
                return;
            }
            const exp = new Date(cert.valid_to);
            const days = Math.round((exp.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
            if (days <= (check.ssl_expiry_days || 14)) {
                resolve({ ok: false, message: `Cert expires in ${days}d (${cert.subject.CN || host})` });
            } else {
                resolve({ ok: true, message: `Cert valid ${days}d` });
            }
            socket.end();
        });
        socket.on('error', (err) => resolve({ ok: false, message: err.message }));
        socket.on('timeout', () => {
            socket.destroy(new Error('Timeout'));
            resolve({ ok: false, message: 'Timeout' });
        });
    });
};

const tick = async () => {
    const checks = await SyntheticCheck.find({ enabled: true });
    const now = Date.now();
    for (const check of checks) {
        if (check.last_run && now - check.last_run.getTime() < (check.interval || 300) * 1000) continue;
        const result = check.type === 'ssl' ? await runSSL(check) : await runHttp(check);
        check.last_run = new Date();
        check.last_status = result.ok ? 'ok' : 'fail';
        check.last_message = result.message;
        await check.save();
        await ensureIncident(check, result.ok, result.message);
    }
};

export const startSyntheticRunner = () => {
    if (timer) return;
    timer = setInterval(tick, 15 * 1000);
    setTimeout(tick, 3000);
};
