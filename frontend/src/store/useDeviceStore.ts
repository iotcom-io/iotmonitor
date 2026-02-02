import { create } from 'zustand';
import api from '../lib/axios';

interface Device {
    device_id: string;
    name: string;
    status: 'online' | 'offline' | 'warning';
    last_seen: string;
}

interface DeviceState {
    devices: Device[];
    loading: boolean;
    fetchDevices: () => Promise<void>;
    updateDeviceStatus: (deviceId: string, status: 'online' | 'offline' | 'warning') => void;
}

export const useDeviceStore = create<DeviceState>((set) => ({
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
}));
