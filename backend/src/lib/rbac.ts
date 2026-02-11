import { IUser, PermissionMap, UserRole } from '../models/User';

export type PermissionKey =
    | 'devices.view'
    | 'devices.create'
    | 'devices.update'
    | 'devices.delete'
    | 'devices.assign'
    | 'devices.build_agent'
    | 'monitoring.view'
    | 'monitoring.create'
    | 'monitoring.update'
    | 'monitoring.delete'
    | 'monitoring.pause_resume'
    | 'synthetics.view'
    | 'synthetics.create'
    | 'synthetics.update'
    | 'synthetics.delete'
    | 'synthetics.run'
    | 'alerts.view'
    | 'incidents.view'
    | 'incidents.resolve'
    | 'settings.view'
    | 'settings.update'
    | 'users.view'
    | 'users.manage'
    | 'remote_terminal.run'
    | 'licenses.view'
    | 'licenses.manage';

export const ALL_PERMISSIONS: PermissionKey[] = [
    'devices.view',
    'devices.create',
    'devices.update',
    'devices.delete',
    'devices.assign',
    'devices.build_agent',
    'monitoring.view',
    'monitoring.create',
    'monitoring.update',
    'monitoring.delete',
    'monitoring.pause_resume',
    'synthetics.view',
    'synthetics.create',
    'synthetics.update',
    'synthetics.delete',
    'synthetics.run',
    'alerts.view',
    'incidents.view',
    'incidents.resolve',
    'settings.view',
    'settings.update',
    'users.view',
    'users.manage',
    'remote_terminal.run',
    'licenses.view',
    'licenses.manage',
];

const defaultPermissionSet = (enabled: PermissionKey[]): PermissionMap => {
    return ALL_PERMISSIONS.reduce((acc: PermissionMap, permission) => {
        acc[permission] = enabled.includes(permission);
        return acc;
    }, {});
};

export const ROLE_DEFAULT_PERMISSIONS: Record<UserRole, PermissionMap> = {
    admin: defaultPermissionSet(ALL_PERMISSIONS),
    operator: defaultPermissionSet([
        'devices.view',
        'devices.create',
        'devices.update',
        'devices.build_agent',
        'monitoring.view',
        'monitoring.create',
        'monitoring.update',
        'monitoring.delete',
        'monitoring.pause_resume',
        'synthetics.view',
        'synthetics.create',
        'synthetics.update',
        'synthetics.delete',
        'synthetics.run',
        'alerts.view',
        'incidents.view',
        'incidents.resolve',
        'settings.view',
        'remote_terminal.run',
        'licenses.view',
        'licenses.manage',
    ]),
    viewer: defaultPermissionSet([
        'devices.view',
        'monitoring.view',
        'synthetics.view',
        'alerts.view',
        'incidents.view',
        'settings.view',
        'licenses.view',
    ]),
};

export interface AuthUserContext {
    id: string;
    name?: string;
    email: string;
    role: UserRole;
    is_active: boolean;
    permissions: PermissionMap;
    assigned_device_ids: string[];
    assigned_synthetic_ids: string[];
}

const normalizeBooleanMap = (value: unknown): PermissionMap => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.entries(value as Record<string, unknown>).reduce((acc: PermissionMap, [key, raw]) => {
        acc[key] = Boolean(raw);
        return acc;
    }, {});
};

export const resolvePermissions = (role: UserRole, overrides?: PermissionMap): PermissionMap => {
    const defaults = ROLE_DEFAULT_PERMISSIONS[role] || ROLE_DEFAULT_PERMISSIONS.viewer;
    const normalizedOverrides = normalizeBooleanMap(overrides);

    return {
        ...defaults,
        ...normalizedOverrides,
    };
};

export const hasPermission = (
    user: Pick<AuthUserContext, 'role' | 'permissions'> | undefined,
    permission: PermissionKey
) => {
    if (!user) return false;
    if (user.role === 'admin') return true;
    return Boolean(user.permissions?.[permission]);
};

const normalizeList = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => String(entry || '').trim())
        .filter(Boolean);
};

export const toAuthUserContext = (user: IUser): AuthUserContext => {
    return {
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
        is_active: user.is_active !== false,
        permissions: resolvePermissions(user.role, user.permissions),
        assigned_device_ids: normalizeList(user.assigned_device_ids),
        assigned_synthetic_ids: normalizeList(user.assigned_synthetic_ids),
    };
};

export const sanitizePermissionOverrides = (input: unknown): PermissionMap => {
    const normalized = normalizeBooleanMap(input);
    return Object.keys(normalized).reduce((acc: PermissionMap, key) => {
        if (ALL_PERMISSIONS.includes(key as PermissionKey)) {
            acc[key] = Boolean(normalized[key]);
        }
        return acc;
    }, {});
};

export const canAccessDevice = (
    user: AuthUserContext | undefined,
    device: { device_id?: string; assigned_user_ids?: string[] | null } | null
) => {
    if (!user || !device?.device_id) return false;
    if (user.role === 'admin') return true;

    const userAssigned = user.assigned_device_ids || [];
    const deviceAssigned = normalizeList(device.assigned_user_ids);
    const userId = String(user.id);

    if (userAssigned.includes(String(device.device_id))) return true;
    if (deviceAssigned.includes(userId)) return true;

    return userAssigned.length === 0 && deviceAssigned.length === 0;
};

export const canAccessSynthetic = (
    user: AuthUserContext | undefined,
    monitor: { _id?: any; assigned_user_ids?: string[] | null } | null
) => {
    if (!user || !monitor?._id) return false;
    if (user.role === 'admin') return true;

    const userAssigned = user.assigned_synthetic_ids || [];
    const monitorAssigned = normalizeList(monitor.assigned_user_ids);
    const monitorId = String(monitor._id);
    const userId = String(user.id);

    if (userAssigned.includes(monitorId)) return true;
    if (monitorAssigned.includes(userId)) return true;

    return userAssigned.length === 0 && monitorAssigned.length === 0;
};
