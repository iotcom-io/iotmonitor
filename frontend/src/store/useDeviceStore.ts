import { create } from 'zustand';
import axios from 'axios';

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
            // Placeholder API call
            // const res = await axios.get('/api/devices');
            // set({ devices: res.data });

            // Mock data for initial setup
            set({
                devices: [
                    { device_id: '1', name: 'Server-NYC-01', status: 'online', last_seen: new Date().toISOString() },
                    { device_id: '2', name: 'PBX-London', status: 'warning', last_seen: new Date().toISOString() },
                ]
            });
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
