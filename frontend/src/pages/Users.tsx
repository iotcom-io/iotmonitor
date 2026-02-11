import React, { useEffect, useMemo, useState } from 'react';
import api from '../lib/axios';
import { UserCog, Plus, RefreshCw, Trash2, Edit3, X } from 'lucide-react';

const ROLE_OPTIONS = [
    { value: 'admin', label: 'Admin' },
    { value: 'operator', label: 'Operator' },
    { value: 'viewer', label: 'Viewer' },
];

const PERMISSION_GROUPS: Array<{ title: string; keys: string[] }> = [
    { title: 'Devices', keys: ['devices.view', 'devices.create', 'devices.update', 'devices.delete', 'devices.assign', 'devices.build_agent'] },
    { title: 'Monitoring', keys: ['monitoring.view', 'monitoring.create', 'monitoring.update', 'monitoring.delete', 'monitoring.pause_resume'] },
    { title: 'Web Monitoring', keys: ['synthetics.view', 'synthetics.create', 'synthetics.update', 'synthetics.delete', 'synthetics.run'] },
    { title: 'Operations', keys: ['alerts.view', 'incidents.view', 'incidents.resolve', 'remote_terminal.run'] },
    { title: 'Admin', keys: ['settings.view', 'settings.update', 'users.view', 'users.manage'] },
    { title: 'Licenses', keys: ['licenses.view', 'licenses.manage'] },
];

const blankForm = {
    name: '',
    email: '',
    password: '',
    role: 'viewer',
    is_active: true,
    permissions: {} as Record<string, boolean>,
    assigned_device_ids: [] as string[],
    assigned_synthetic_ids: [] as string[],
};

const UserModal = ({
    open,
    onClose,
    onSaved,
    initial,
    devices,
    synthetics,
}: any) => {
    const [form, setForm] = useState<any>(blankForm);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        if (!initial) {
            setForm(blankForm);
            return;
        }
        setForm({
            ...blankForm,
            ...initial,
            password: '',
            permissions: initial.permissions || {},
            assigned_device_ids: initial.assigned_device_ids || [],
            assigned_synthetic_ids: initial.assigned_synthetic_ids || [],
        });
    }, [open, initial]);

    if (!open) return null;

    const togglePermission = (key: string) => {
        setForm((prev: any) => ({
            ...prev,
            permissions: {
                ...(prev.permissions || {}),
                [key]: !prev.permissions?.[key],
            },
        }));
    };

    const toggleList = (field: 'assigned_device_ids' | 'assigned_synthetic_ids', value: string) => {
        setForm((prev: any) => {
            const current = new Set(prev[field] || []);
            if (current.has(value)) current.delete(value);
            else current.add(value);
            return { ...prev, [field]: Array.from(current) };
        });
    };

    const save = async () => {
        setSaving(true);
        try {
            const payload: any = {
                name: form.name || undefined,
                email: form.email,
                role: form.role,
                is_active: Boolean(form.is_active),
                permissions: form.permissions || {},
                assigned_device_ids: form.assigned_device_ids || [],
                assigned_synthetic_ids: form.assigned_synthetic_ids || [],
            };

            if (form.password) payload.password = form.password;

            if (form.id) {
                await api.put(`/users/${form.id}`, payload);
            } else {
                if (!payload.password) {
                    alert('Password is required for new user');
                    return;
                }
                await api.post('/users', payload);
            }

            onSaved();
            onClose();
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur flex items-center justify-center p-4">
            <div className="bg-dark-surface border border-dark-border rounded-2xl w-full max-w-5xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center">
                    <h3 className="text-xl font-bold text-white">{form.id ? 'Edit User' : 'Create User'}</h3>
                    <button className="text-slate-500 hover:text-white" onClick={onClose}><X size={20} /></button>
                </div>

                <div className="grid md:grid-cols-2 gap-3">
                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Name</label>
                        <input className="input-field" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Email</label>
                        <input className="input-field" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                    </div>
                </div>

                <div className="grid md:grid-cols-3 gap-3">
                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Role</label>
                        <select className="input-field" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                            {ROLE_OPTIONS.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                        </select>
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">{form.id ? 'New Password (optional)' : 'Password'}</label>
                        <input type="password" className="input-field" value={form.password || ''} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm text-slate-400">Status</label>
                        <select className="input-field" value={String(form.is_active)} onChange={(e) => setForm({ ...form, is_active: e.target.value === 'true' })}>
                            <option value="true">Active</option>
                            <option value="false">Disabled</option>
                        </select>
                    </div>
                </div>

                <div className="grid md:grid-cols-2 gap-3">
                    <div className="rounded-xl border border-white/10 p-3 space-y-3">
                        <h4 className="text-sm font-semibold text-white">Assigned Devices</h4>
                        <div className="max-h-48 overflow-y-auto space-y-1">
                            {devices.map((device: any) => (
                                <label key={device.device_id} className="flex items-center gap-2 text-xs text-slate-300">
                                    <input
                                        type="checkbox"
                                        checked={(form.assigned_device_ids || []).includes(device.device_id)}
                                        onChange={() => toggleList('assigned_device_ids', device.device_id)}
                                    />
                                    {device.name} ({device.device_id})
                                </label>
                            ))}
                            {devices.length === 0 && <div className="text-xs text-slate-500">No devices found</div>}
                        </div>
                    </div>
                    <div className="rounded-xl border border-white/10 p-3 space-y-3">
                        <h4 className="text-sm font-semibold text-white">Assigned Web Monitors</h4>
                        <div className="max-h-48 overflow-y-auto space-y-1">
                            {synthetics.map((monitor: any) => (
                                <label key={monitor._id} className="flex items-center gap-2 text-xs text-slate-300">
                                    <input
                                        type="checkbox"
                                        checked={(form.assigned_synthetic_ids || []).includes(monitor._id)}
                                        onChange={() => toggleList('assigned_synthetic_ids', monitor._id)}
                                    />
                                    {monitor.name}
                                </label>
                            ))}
                            {synthetics.length === 0 && <div className="text-xs text-slate-500">No web monitors found</div>}
                        </div>
                    </div>
                </div>

                <div className="rounded-xl border border-white/10 p-3 space-y-3">
                    <h4 className="text-sm font-semibold text-white">Permissions</h4>
                    <div className="grid md:grid-cols-2 gap-3">
                        {PERMISSION_GROUPS.map((group) => (
                            <div key={group.title} className="rounded-lg bg-white/5 p-2 space-y-1">
                                <div className="text-xs text-slate-400 uppercase tracking-wider">{group.title}</div>
                                {group.keys.map((permission) => (
                                    <label key={permission} className="flex items-center gap-2 text-xs text-slate-300">
                                        <input
                                            type="checkbox"
                                            checked={Boolean(form.permissions?.[permission])}
                                            onChange={() => togglePermission(permission)}
                                        />
                                        {permission}
                                    </label>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex justify-end gap-3">
                    <button className="px-4 py-2 text-slate-400 hover:text-white" onClick={onClose}>Cancel</button>
                    <button disabled={saving} className="btn-primary px-4 py-2" onClick={save}>{saving ? 'Saving...' : 'Save User'}</button>
                </div>
            </div>
        </div>
    );
};

export const Users = () => {
    const [users, setUsers] = useState<any[]>([]);
    const [devices, setDevices] = useState<any[]>([]);
    const [synthetics, setSynthetics] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<any>(null);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [usersRes, devicesRes, syntheticsRes] = await Promise.all([
                api.get('/users'),
                api.get('/devices'),
                api.get('/synthetics'),
            ]);
            setUsers(usersRes.data || []);
            setDevices(devicesRes.data || []);
            setSynthetics(syntheticsRes.data || []);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const sortedUsers = useMemo(() => {
        return [...users].sort((a, b) => String(a.email || '').localeCompare(String(b.email || '')));
    }, [users]);

    const remove = async (id: string) => {
        const confirmed = window.confirm('Delete this user?');
        if (!confirmed) return;
        await api.delete(`/users/${id}`);
        fetchData();
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <UserCog className="text-primary-400" />
                    <div>
                        <h2 className="text-2xl font-bold text-white">User Management</h2>
                        <p className="text-slate-500 text-sm">Roles, permissions, and device/monitor assignments</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button className="icon-btn" onClick={fetchData}><RefreshCw size={16} /></button>
                    <button className="btn-primary flex items-center gap-2" onClick={() => { setEditing(null); setModalOpen(true); }}>
                        <Plus size={16} /> New User
                    </button>
                </div>
            </div>

            <div className="card overflow-x-auto">
                {loading ? (
                    <div className="text-slate-400">Loading...</div>
                ) : (
                    <table className="min-w-full text-sm">
                        <thead>
                            <tr className="text-left text-slate-400 border-b border-white/10">
                                <th className="py-3 pr-3">User</th>
                                <th className="py-3 pr-3">Role</th>
                                <th className="py-3 pr-3">Status</th>
                                <th className="py-3 pr-3">Devices</th>
                                <th className="py-3 pr-3">Web Monitors</th>
                                <th className="py-3 pr-3">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedUsers.map((user) => (
                                <tr key={user.id} className="border-b border-white/5">
                                    <td className="py-3 pr-3">
                                        <div className="font-semibold text-white">{user.name || user.email}</div>
                                        <div className="text-xs text-slate-500">{user.email}</div>
                                    </td>
                                    <td className="py-3 pr-3 text-slate-300">{String(user.role || '').toUpperCase()}</td>
                                    <td className="py-3 pr-3">
                                        <span className={`text-xs px-2 py-0.5 rounded ${user.is_active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}>
                                            {user.is_active ? 'ACTIVE' : 'DISABLED'}
                                        </span>
                                    </td>
                                    <td className="py-3 pr-3 text-slate-300">{Array.isArray(user.assigned_device_ids) ? user.assigned_device_ids.length : 0}</td>
                                    <td className="py-3 pr-3 text-slate-300">{Array.isArray(user.assigned_synthetic_ids) ? user.assigned_synthetic_ids.length : 0}</td>
                                    <td className="py-3 pr-3">
                                        <div className="flex gap-2">
                                            <button className="icon-btn" onClick={() => { setEditing(user); setModalOpen(true); }}><Edit3 size={14} /></button>
                                            <button className="icon-btn text-red-400" onClick={() => remove(user.id)}><Trash2 size={14} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {!loading && sortedUsers.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="py-6 text-slate-400">No users found.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                )}
            </div>

            <UserModal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                onSaved={fetchData}
                initial={editing}
                devices={devices}
                synthetics={synthetics}
            />
        </div>
    );
};

