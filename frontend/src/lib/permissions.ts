import { useAuthStore } from '../store/useAuthStore';

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

export const hasPermission = (permission: PermissionKey, user?: any) => {
    const resolvedUser = user || useAuthStore.getState().user;
    if (!resolvedUser) return false;
    if (resolvedUser.role === 'admin') return true;
    if (resolvedUser.permissions && Object.keys(resolvedUser.permissions).length > 0) {
        return Boolean(resolvedUser.permissions?.[permission]);
    }

    const roleDefaults: Record<string, PermissionKey[]> = {
        operator: [
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
        ],
        viewer: [
            'devices.view',
            'monitoring.view',
            'synthetics.view',
            'alerts.view',
            'incidents.view',
            'settings.view',
            'licenses.view',
        ],
    };
    return (roleDefaults[resolvedUser.role] || []).includes(permission);
};
