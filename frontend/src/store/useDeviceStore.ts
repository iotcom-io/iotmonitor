import { create } from 'zustand';
import api from '../lib/axios';

interface Device {
    device_id: string;
    name: string;
    status: 'online' | 'offline' | 'warning';
    last_seen: string;
    monitoring_enabled?: boolean;
}

interface DeviceState {
    devices: Device[];
    loading: boolean;
    fetchDevices: () => Promise<void>;
    updateDeviceStatus: (deviceId: string, status: 'online' | 'offline' | 'warning') => void;
    deleteDevice: (deviceId: string) => Promise<void>;
    toggleMonitoring: (deviceId: string) => Promise<void>;
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
    }
}));
