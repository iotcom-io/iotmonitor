import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
    id: string;
    name?: string;
    email: string;
    role: 'admin' | 'operator' | 'viewer';
    is_active?: boolean;
    permissions?: Record<string, boolean>;
    assigned_device_ids?: string[];
    assigned_synthetic_ids?: string[];
}

interface AuthState {
    user: User | null;
    token: string | null;
    setAuth: (user: User, token: string) => void;
    logout: () => void;
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set) => ({
            user: null,
            token: null,
            setAuth: (user, token) => set({ user, token }),
            logout: () => set({ user: null, token: null }),
        }),
        {
            name: 'iotmonitor-auth',
        }
    )
);
