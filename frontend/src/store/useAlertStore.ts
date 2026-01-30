import { create } from 'zustand';
import axios from 'axios';

interface Alert {
    id: string;
    device_id: string;
    severity: 'critical' | 'warning' | 'info';
    message: string;
    timestamp: string;
}

interface AlertState {
    alerts: Alert[];
    unreadCount: number;
    fetchAlerts: () => Promise<void>;
    addAlert: (alert: Alert) => void;
    clearAlerts: () => void;
}

export const useAlertStore = create<AlertState>((set) => ({
    alerts: [],
    unreadCount: 0,
    fetchAlerts: async () => {
        // Mock fetch
        set({
            alerts: [
                { id: '1', device_id: '1', severity: 'critical', message: 'High CPU Usage on Server-NYC-01', timestamp: new Date().toISOString() }
            ], unreadCount: 1
        });
    },
    addAlert: (alert) => set((state) => ({
        alerts: [alert, ...state.alerts],
        unreadCount: state.unreadCount + 1
    })),
    clearAlerts: () => set({ alerts: [], unreadCount: 0 }),
}));
