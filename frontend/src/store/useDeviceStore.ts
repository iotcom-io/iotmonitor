import { create } from 'zustand';
import api from '../lib/axios';

interface Device {
    device_id: string;
    name: string;
    owner?: string;
    hostname?: string;
    type?: 'server' | 'pbx' | 'network_device' | 'website';
    status: 'online' | 'offline' | 'warning' | 'not_monitored';
    last_seen: string;
    uptime_seconds?: number;
    monitoring_enabled?: boolean;
    enabled_modules?: ('system' | 'docker' | 'asterisk' | 'network')[];
    asterisk_container_name?: string;
    probe_config?: {
        ping_host?: string;
        [key: string]: any;
    };
    config?: {
        cpu_usage?: number;
        disk_usage?: number;
        asterisk_container?: string;
        [key: string]: any;
    };
}

interface DeviceState {
    devices: Device[];
    loading: boolean;
    fetchDevices: () => Promise<void>;
    updateDeviceStatus: (deviceId: string, status: 'online' | 'offline' | 'warning' | 'not_monitored') => void;
    deleteDevice: (deviceId: string) => Promise<void>;
    toggleMonitoring: (deviceId: string) => Promise<void>;
    initSocket: () => void;
}

export const useDeviceStore = create<DeviceState>((set, get) => ({
    devices: [],
    loading: false,
    fetchDevices: async () => {
        set({ loading: true });
        try {
            const res = await api.get('/devices');
            set({ devices: res.data });
        } catch (error) {
            console.error('Failed to fetch devices', error);
        } finally {
            set({ loading: false });
        }
    },
    updateDeviceStatus: (deviceId, status) => set((state) => ({
        devices: state.devices.map(d => d.device_id === deviceId ? { ...d, status } : d)
    })),
    deleteDevice: async (deviceId) => {
        await api.delete(`/devices/${deviceId}`);
        set(state => ({ devices: state.devices.filter(d => d.device_id !== deviceId) }));
    },
    toggleMonitoring: async (deviceId) => {
        const device = get().devices.find(d => d.device_id === deviceId);
        if (!device) return;
        const newStatus = !device.monitoring_enabled;
        await api.patch(`/devices/${deviceId}`, { monitoring_enabled: newStatus });
        set(state => ({
            devices: state.devices.map(d => d.device_id === deviceId ? { ...d, monitoring_enabled: newStatus } : d)
        }));
    },
    initSocket: () => {
        // Dynamic import to avoid SSR issues if we ever go there, but also cleaner separation
        import('../lib/socket').then(({ socket }) => {
            if (!socket.connected) {
                socket.connect();
            }

            socket.off('device:update'); // Prevent duplicate listeners
            socket.on('device:update', (data: any) => {
                const { device_id, status, metrics } = data;
                set(state => ({
                    devices: state.devices.map(d => {
                        if (d.device_id === device_id) {
                            // Merge metrics if available (this is partial since IStore doesn't fully type 'metrics' yet)
                            return {
                                ...d,
                                status: status || d.status,
                                last_seen: new Date().toISOString(),
                                ...(metrics?.uptime !== undefined ? { uptime_seconds: Number(metrics.uptime) || 0 } : {}),
                            };
                        }
                        return d;
                    })
                }));
            });
        });
    }
}));
