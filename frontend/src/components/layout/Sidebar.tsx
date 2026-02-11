import React from 'react';
import { LayoutDashboard, Server, ShieldCheck, Settings, LogOut, Terminal, Bell, Globe, FileText, KeyRound, Users, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import { Link, useLocation } from 'react-router-dom';
import { clsx } from 'clsx';
import { hasPermission } from '../../lib/permissions';

const SidebarItem = ({
    icon: Icon,
    label,
    to,
    active,
    collapsed,
}: {
    icon: any,
    label: string,
    to: string,
    active?: boolean,
    collapsed?: boolean
}) => (
    <Link
        to={to}
        title={label}
        className={clsx(
            "flex items-center rounded-lg transition-all duration-200 group",
            collapsed ? "justify-center px-3 py-3" : "gap-3 px-4 py-3",
            active
                ? "bg-primary-600/10 text-primary-400 border border-primary-500/20"
                : "text-slate-400 hover:text-slate-100 hover:bg-white/5"
        )}
    >
        <Icon size={20} className={active ? "text-primary-400" : "group-hover:text-slate-100 transition-colors"} />
        {!collapsed && <span className="font-medium">{label}</span>}
    </Link>
);

export const Sidebar = ({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) => {
    const location = useLocation();
    const logout = useAuthStore(state => state.logout);
    const user = useAuthStore(state => state.user);

    return (
        <aside className={clsx(
            "fixed left-0 top-0 h-screen bg-dark-surface border-r border-dark-border flex flex-col p-4 transition-all duration-300",
            collapsed ? "w-20" : "w-64"
        )}>
            <div className={clsx("flex items-center px-2 py-4 mb-8", collapsed ? "justify-center" : "justify-between gap-3")}>
                <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center font-bold text-lg shrink-0">I</div>
                    {!collapsed && (
                        <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400 truncate">
                            IoTMonitor
                        </h1>
                    )}
                </div>
                {!collapsed && (
                    <button
                        type="button"
                        onClick={onToggle}
                        className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                        title="Collapse sidebar"
                    >
                        <ChevronLeft size={16} />
                    </button>
                )}
            </div>

            {collapsed && (
                <button
                    type="button"
                    onClick={onToggle}
                    className="mb-4 mx-auto p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                    title="Expand sidebar"
                >
                    <ChevronRight size={16} />
                </button>
            )}

            <nav className="flex-1 space-y-2">
                <SidebarItem
                    icon={LayoutDashboard}
                    label="Dashboard"
                    to="/"
                    active={location.pathname === '/'}
                    collapsed={collapsed}
                />
                {hasPermission('devices.view', user) && (
                    <SidebarItem
                        icon={Server}
                        label="Devices"
                        to="/devices"
                        active={location.pathname.startsWith('/devices')}
                        collapsed={collapsed}
                    />
                )}
                {hasPermission('synthetics.view', user) && (
                    <SidebarItem
                        icon={Globe}
                        label="Web Monitoring"
                        to="/web-monitoring"
                        active={location.pathname.startsWith('/web-monitoring') || location.pathname.startsWith('/synthetics')}
                        collapsed={collapsed}
                    />
                )}
                {hasPermission('devices.build_agent', user) && (
                    <SidebarItem
                        icon={Terminal}
                        label="Agent Builder"
                        to="/agent-builder"
                        active={location.pathname === '/agent-builder'}
                        collapsed={collapsed}
                    />
                )}
                {hasPermission('alerts.view', user) && (
                    <SidebarItem
                        icon={ShieldCheck}
                        label="Alerts"
                        to="/alerts"
                        active={location.pathname === '/alerts'}
                        collapsed={collapsed}
                    />
                )}
                {hasPermission('incidents.view', user) && (
                    <SidebarItem
                        icon={FileText}
                        label="Incidents"
                        to="/incidents"
                        active={location.pathname === '/incidents'}
                        collapsed={collapsed}
                    />
                )}
                {hasPermission('licenses.view', user) && (
                    <SidebarItem
                        icon={KeyRound}
                        label="Licenses"
                        to="/licenses"
                        active={location.pathname === '/licenses'}
                        collapsed={collapsed}
                    />
                )}
                {hasPermission('settings.view', user) && (
                    <SidebarItem
                        icon={Bell}
                        label="Notifications"
                        to="/notification-channels"
                        active={location.pathname === '/notification-channels'}
                        collapsed={collapsed}
                    />
                )}
                {hasPermission('users.view', user) && (
                    <SidebarItem
                        icon={Users}
                        label="Users"
                        to="/users"
                        active={location.pathname === '/users'}
                        collapsed={collapsed}
                    />
                )}
            </nav>

            <div className="mt-auto space-y-2">
                {hasPermission('settings.view', user) && (
                    <SidebarItem
                        icon={Settings}
                        label="Settings"
                        to="/settings"
                        active={location.pathname === '/settings'}
                        collapsed={collapsed}
                    />
                )}
                <button
                    onClick={logout}
                    title="Logout"
                    className={clsx(
                        "rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-400/10 w-full transition-all duration-200",
                        collapsed ? "flex items-center justify-center px-3 py-3" : "flex items-center gap-3 px-4 py-3"
                    )}
                >
                    <LogOut size={20} />
                    {!collapsed && <span className="font-medium">Logout</span>}
                </button>
            </div>
        </aside>
    );
};
