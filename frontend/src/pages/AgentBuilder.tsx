import api from '../lib/axios';

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
    const [modules, setModules] = useState({
        system: true,
        docker: false,
        asterisk: false,
        network: true,
    });

    const [platform, setPlatform] = useState('linux-amd64');
    const [building, setBuilding] = useState(false);
    const [buildResult, setBuildResult] = useState<{ url: string, sha: string } | null>(null);

    const toggleModule = (key: keyof typeof modules) => {
        setModules(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const handleBuild = async () => {
        setBuilding(true);
        setBuildResult(null);
        try {
            const [os, arch] = platform.split('-');
            const { data } = await api.post('/devices/generate-agent', {
                os,
                arch,
                modules
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
                            <span className="text-sm text-slate-300">TLS 1.3 Encryption Enforced</span>
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
