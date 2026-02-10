import React, { useState } from 'react';
import { Download, Cpu, Container, Wifi, Activity, Hammer, CheckCircle2, ShieldCheck, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import api from '../lib/axios';
import { useDeviceStore } from '../store/useDeviceStore';
import { useEffect } from 'react';

type DeviceType = 'server' | 'pbx' | 'media_gateway' | 'network_device' | 'website';
const MODULE_DEFAULTS_BY_DEVICE_TYPE: Record<DeviceType, Array<keyof ModuleState>> = {
    server: ['system', 'docker', 'network'],
    pbx: ['system', 'asterisk', 'network'],
    media_gateway: ['system', 'network'],
    network_device: ['network'],
    website: ['system', 'network'],
};

type ModuleState = {
    system: boolean;
    docker: boolean;
    asterisk: boolean;
    network: boolean;
};

const toModuleState = (enabledModules: string[]): ModuleState => ({
    system: enabledModules.includes('system'),
    docker: enabledModules.includes('docker'),
    asterisk: enabledModules.includes('asterisk'),
    network: enabledModules.includes('network'),
});

const ModuleToggle = ({ icon: Icon, label, description, enabled, onToggle }: { icon: any, label: string, description: string, enabled: boolean, onToggle: () => void }) => (
    <div
        onClick={onToggle}
        className={clsx(
            "card cursor-pointer border-2 transition-all flex gap-4",
            enabled ? "border-primary-500 bg-primary-500/5" : "border-dark-border hover:border-slate-700"
        )}
    >
        <div className={clsx(
            "p-3 rounded-xl h-fit",
            enabled ? "bg-primary-500 text-white" : "bg-white/5 text-slate-500"
        )}>
            <Icon size={24} />
        </div>
        <div className="flex-1">
            <div className="flex justify-between items-center mb-1">
                <h4 className="font-bold text-white">{label}</h4>
                {enabled && <CheckCircle2 size={18} className="text-primary-400" />}
            </div>
            <p className="text-sm text-slate-400 leading-relaxed">{description}</p>
        </div>
    </div>
);

export const AgentBuilder = () => {
    const { devices, fetchDevices } = useDeviceStore();
    const [selectedDeviceId, setSelectedDeviceId] = useState<string>('new');
    const [deviceName, setDeviceName] = useState<string>('');
    const [deviceType, setDeviceType] = useState<DeviceType>('server');
    const [asteriskContainerName, setAsteriskContainerName] = useState<string>('asterisk');
    const [template, setTemplate] = useState<'custom' | 'standard' | 'full'>('custom');
    const [modules, setModules] = useState<ModuleState>(toModuleState(MODULE_DEFAULTS_BY_DEVICE_TYPE.server as string[]));

    useEffect(() => {
        fetchDevices();
    }, []);

    useEffect(() => {
        if (selectedDeviceId !== 'new') return;
        setModules(toModuleState(MODULE_DEFAULTS_BY_DEVICE_TYPE[deviceType] as string[]));
        setAsteriskContainerName('asterisk');
    }, [selectedDeviceId, deviceType]);

    useEffect(() => {
        if (selectedDeviceId === 'new') return;

        const selectedDevice = devices.find((d) => d.device_id === selectedDeviceId);
        if (selectedDevice) {
            const selectedModules = Array.isArray(selectedDevice.enabled_modules)
                ? selectedDevice.enabled_modules
                : ['system'];
            setModules(toModuleState(selectedModules as string[]));
            setDeviceType((selectedDevice.type as DeviceType) || 'server');
        }
        const configuredContainer =
            selectedDevice?.asterisk_container_name ||
            selectedDevice?.config?.asterisk_container ||
            'asterisk';
        setAsteriskContainerName(configuredContainer);
    }, [selectedDeviceId, devices]);

    const applyTemplate = (t: 'standard' | 'full') => {
        setTemplate(t);
        if (t === 'standard') {
            setModules({ system: true, docker: false, asterisk: false, network: true });
        } else {
            setModules({ system: true, docker: true, asterisk: true, network: true });
        }
    };

    const [platform, setPlatform] = useState('linux-amd64');
    const [building, setBuilding] = useState(false);
    const [buildResult, setBuildResult] = useState<{ url: string, sha: string } | null>(null);

    const toggleModule = (key: keyof typeof modules) => {
        setModules(prev => {
            if (prev[key] && Object.values(prev).filter(Boolean).length === 1) {
                return prev;
            }
            return { ...prev, [key]: !prev[key] };
        });
    };

    const applyDeviceTypeDefaults = (nextType: DeviceType) => {
        setDeviceType(nextType);
        setTemplate('custom');
        const defaults = MODULE_DEFAULTS_BY_DEVICE_TYPE[nextType];
        setModules(toModuleState(defaults as string[]));
        if (!defaults.includes('asterisk')) {
            setAsteriskContainerName('asterisk');
        }
    };

    const handleBuild = async () => {
        if (selectedDeviceId === 'new' && !deviceName) {
            alert('Please enter a device name for the new agent');
            return;
        }
        if (!Object.values(modules).some(Boolean)) {
            alert('Select at least one module');
            return;
        }
        setBuilding(true);
        setBuildResult(null);
        try {
            const [os, arch] = platform.split('-');
            const endpoint = selectedDeviceId === 'new'
                ? '/devices/generate-agent'
                : `/devices/${selectedDeviceId}/generate-agent`;

            const { data } = await api.post(endpoint, {
                os,
                arch,
                modules,
                name: selectedDeviceId === 'new' ? deviceName : undefined,
                device_type: selectedDeviceId === 'new' ? deviceType : undefined,
                asterisk_container_name: modules.asterisk ? asteriskContainerName.trim() || 'asterisk' : undefined,
            });
            setBuildResult({
                url: `/api/devices/download/${data.binary_id}`,
                sha: data.checksum
            });
        } catch (error) {
            console.error('Build failed', error);
            alert('Build failed. Please try again.');
        } finally {
            setBuilding(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto space-y-8">
            <div>
                <h2 className="text-3xl font-bold text-white mb-2">Agent Builder</h2>
                <p className="text-slate-400">Configure and compile a custom monitoring binary for your infrastructure</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-end mb-4">
                <div className="space-y-3">
                    <label className="text-sm font-medium text-slate-400 uppercase tracking-wider">Select Target Device</label>
                    <select
                        value={selectedDeviceId}
                        onChange={e => setSelectedDeviceId(e.target.value)}
                        className="w-full bg-dark-bg border border-dark-border rounded-xl px-4 py-3 text-white outline-none focus:border-primary-500/50"
                    >
                        <option value="new">+ Register New Agent</option>
                        {devices.map(d => (
                            <option key={d.device_id} value={d.device_id}>{d.name} ({d.device_id.slice(0, 8)})</option>
                        ))}
                    </select>
                </div>
                {selectedDeviceId === 'new' ? (
                    <div className="space-y-3">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-400 uppercase tracking-wider">New Device Name</label>
                            <input
                                type="text"
                                value={deviceName}
                                onChange={e => setDeviceName(e.target.value)}
                                className="w-full bg-dark-bg border border-dark-border rounded-xl px-4 py-3 text-white outline-none focus:border-primary-500/50"
                                placeholder="e.g. Production-Web-01"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-400 uppercase tracking-wider">Device Type</label>
                            <select
                                value={deviceType}
                                onChange={e => applyDeviceTypeDefaults(e.target.value as DeviceType)}
                                className="w-full bg-dark-bg border border-dark-border rounded-xl px-4 py-3 text-white outline-none focus:border-primary-500/50"
                            >
                                <option value="server">Server</option>
                                <option value="pbx">PBX</option>
                                <option value="media_gateway">Media Gateway</option>
                                <option value="network_device">Network Device</option>
                                <option value="website">Website</option>
                            </select>
                        </div>
                    </div>
                ) : (
                    <div className="flex gap-2 p-1 bg-dark-surface border border-dark-border rounded-xl">
                        <button
                            onClick={() => setTemplate('custom')}
                            className={clsx("px-4 py-2 rounded-lg text-sm font-bold transition-all", template === 'custom' ? "bg-primary-600 text-white" : "text-slate-400 hover:text-white")}
                        >Custom</button>
                        <button
                            onClick={() => applyTemplate('standard')}
                            className={clsx("px-4 py-2 rounded-lg text-sm font-bold transition-all", template === 'standard' ? "bg-primary-600 text-white" : "text-slate-400 hover:text-white")}
                        >Standard</button>
                        <button
                            onClick={() => applyTemplate('full')}
                            className={clsx("px-4 py-2 rounded-lg text-sm font-bold transition-all", template === 'full' ? "bg-primary-600 text-white" : "text-slate-400 hover:text-white")}
                        >Full Stack</button>
                    </div>
                )}
            </div>

            {selectedDeviceId === 'new' && (
                <div className="flex gap-2 p-1 bg-dark-surface border border-dark-border rounded-xl w-fit">
                    <button
                        onClick={() => setTemplate('custom')}
                        className={clsx("px-4 py-2 rounded-lg text-sm font-bold transition-all", template === 'custom' ? "bg-primary-600 text-white" : "text-slate-400 hover:text-white")}
                    >Custom</button>
                    <button
                        onClick={() => applyTemplate('standard')}
                        className={clsx("px-4 py-2 rounded-lg text-sm font-bold transition-all", template === 'standard' ? "bg-primary-600 text-white" : "text-slate-400 hover:text-white")}
                    >Standard</button>
                    <button
                        onClick={() => applyTemplate('full')}
                        className={clsx("px-4 py-2 rounded-lg text-sm font-bold transition-all", template === 'full' ? "bg-primary-600 text-white" : "text-slate-400 hover:text-white")}
                    >Full Stack</button>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <ModuleToggle
                    icon={Cpu}
                    label="System Monitor"
                    description="Collect CPU, Memory, Disk usage and Host identification telemetry."
                    enabled={modules.system}
                    onToggle={() => toggleModule('system')}
                />
                <ModuleToggle
                    icon={Container}
                    label="Container Monitor"
                    description="Track Docker/Podman container states, resource usage and logs."
                    enabled={modules.docker}
                    onToggle={() => toggleModule('docker')}
                />
                <ModuleToggle
                    icon={Activity}
                    label="Asterisk/PBX"
                    description="Monitor VoIP infrastructure registration status and active channels."
                    enabled={modules.asterisk}
                    onToggle={() => toggleModule('asterisk')}
                />
                <ModuleToggle
                    icon={Wifi}
                    label="Network Probe"
                    description="Perform ICMP pings and TCP port checks periodically from the agent."
                    enabled={modules.network}
                    onToggle={() => toggleModule('network')}
                />
            </div>

            {modules.asterisk && (
                <div className="card space-y-3">
                    <label className="text-sm font-medium text-slate-400 uppercase tracking-wider">Asterisk Container Name</label>
                    <input
                        type="text"
                        value={asteriskContainerName}
                        onChange={e => setAsteriskContainerName(e.target.value)}
                        className="w-full bg-dark-bg border border-dark-border rounded-xl px-4 py-3 text-white outline-none focus:border-primary-500/50"
                        placeholder="e.g. asterisk, pbx-01, voip-core"
                    />
                    <p className="text-xs text-slate-500">Used by the agent for `docker exec` asterisk commands. Defaults to `asterisk`.</p>
                </div>
            )}

            <div className="card space-y-6">
                <h3 className="text-xl font-bold text-white">Build Options</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-3">
                        <label className="text-sm font-medium text-slate-400 uppercase tracking-wider">Target platform</label>
                        <select
                            value={platform}
                            onChange={e => setPlatform(e.target.value)}
                            className="w-full bg-dark-bg border border-dark-border rounded-xl px-4 py-3 text-white outline-none focus:border-primary-500/50"
                        >
                            <option value="linux-amd64">Linux 64-bit (x86_64)</option>
                            <option value="linux-arm64">Linux ARM 64-bit</option>
                            <option value="windows-amd64">Windows 64-bit</option>
                        </select>
                    </div>
                    <div className="space-y-3">
                        <label className="text-sm font-medium text-slate-400 uppercase tracking-wider">Communication</label>
                        <div className="flex items-center gap-2 p-3 bg-white/5 rounded-xl border border-white/5">
                            <ShieldCheck size={18} className="text-emerald-400" />
                            <span className="text-sm text-slate-300">MQTT security depends on broker TLS/auth configuration</span>
                        </div>
                    </div>
                </div>

                <div className="pt-6 border-t border-dark-border space-y-4">
                    {buildResult && (
                        <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl space-y-3">
                            <div className="flex items-center gap-3 text-emerald-400 text-sm font-bold">
                                <CheckCircle2 size={18} />
                                Binary Ready for Deployment
                            </div>
                            <div className="text-xs text-slate-400 font-mono break-all bg-black/20 p-2 rounded">
                                SHA256: {buildResult.sha}
                            </div>
                            <a
                                href={buildResult.url}
                                className="btn-primary w-full inline-flex items-center justify-center gap-2"
                                download
                            >
                                <Download size={18} />
                                Download Binary
                            </a>
                        </div>
                    )}

                    <div className="flex flex-col md:flex-row justify-between items-center gap-6">
                        <div className="flex items-center gap-4 text-emerald-400 font-medium">
                            <Hammer size={24} className={building ? "animate-spin" : ""} />
                            <span>{building ? 'Compiling Agent...' : 'Ready for compilation'}</span>
                        </div>
                        <button
                            onClick={handleBuild}
                            disabled={building}
                            className="w-full md:w-auto bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white font-bold px-8 py-4 rounded-xl shadow-lg shadow-primary-500/20 transition-all flex items-center justify-center gap-3"
                        >
                            {building ? <Loader2 size={20} className="animate-spin" /> : <Download size={20} />}
                            {building ? 'Building...' : 'Generate Installer'}
                        </button>
                    </div>
                </div>
            </div>

            <div className="p-4 rounded-xl bg-primary-400/5 border border-primary-500/10 flex gap-4">
                <div className="p-2 bg-primary-500/10 rounded-lg h-fit text-primary-400">
                    <Activity size={20} />
                </div>
                <p className="text-sm text-slate-400 leading-relaxed">
                    <span className="text-slate-100 font-semibold">Note:</span> The generated binary will be pre-configured with a unique agent token. Simply run the executable on your target machine to begin monitoring.
                </p>
            </div>
        </div>
    );
};
