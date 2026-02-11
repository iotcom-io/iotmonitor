import React from 'react';
import { LayoutDashboard, Server, ShieldCheck, Settings, LogOut, Terminal, Bell, Globe, FileText } from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import { Link, useLocation } from 'react-router-dom';
import { clsx } from 'clsx';

const SidebarItem = ({ icon: Icon, label, to, active }: { icon: any, label: string, to: string, active?: boolean }) => (
    <Link
        to={to}
        className={clsx(
            "flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 group",
            active
                ? "bg-primary-600/10 text-primary-400 border border-primary-500/20"
                : "text-slate-400 hover:text-slate-100 hover:bg-white/5"
        )}
    >
        <Icon size={20} className={active ? "text-primary-400" : "group-hover:text-slate-100 transition-colors"} />
        <span className="font-medium">{label}</span>
    </Link>
);

export const Sidebar = () => {
    const location = useLocation();
    const logout = useAuthStore(state => state.logout);

    return (
        <aside className="fixed left-0 top-0 h-screen w-64 bg-dark-surface border-r border-dark-border flex flex-col p-4">
            <div className="flex items-center gap-3 px-2 py-4 mb-8">
                <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center font-bold text-lg">I</div>
                <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
                    IoTMonitor
                </h1>
            </div>

            <nav className="flex-1 space-y-2">
                <SidebarItem
                    icon={LayoutDashboard}
                    label="Dashboard"
                    to="/"
                    active={location.pathname === '/'}
                />
                <SidebarItem
                    icon={Server}
                    label="Devices"
                    to="/devices"
                    active={location.pathname.startsWith('/devices')}
                />
                <SidebarItem
                    icon={Globe}
                    label="Web Monitoring"
                    to="/web-monitoring"
                    active={location.pathname.startsWith('/web-monitoring') || location.pathname.startsWith('/synthetics')}
                />
                <SidebarItem
                    icon={Terminal}
                    label="Agent Builder"
                    to="/agent-builder"
                    active={location.pathname === '/agent-builder'}
                />
                <SidebarItem
                    icon={ShieldCheck}
                    label="Alerts"
                    to="/alerts"
                    active={location.pathname === '/alerts'}
                />
                <SidebarItem
                    icon={FileText}
                    label="Incidents"
                    to="/incidents"
                    active={location.pathname === '/incidents'}
                />
                <SidebarItem
                    icon={Bell}
                    label="Notifications"
                    to="/notification-channels"
                    active={location.pathname === '/notification-channels'}
                />
            </nav>

            <div className="mt-auto space-y-2">
                <SidebarItem
                    icon={Settings}
                    label="Settings"
                    to="/settings"
                    active={location.pathname === '/settings'}
                />
                <button
                    onClick={logout}
                    className="flex items-center gap-3 px-4 py-3 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-400/10 w-full transition-all duration-200"
                >
                    <LogOut size={20} />
                    <span className="font-medium">Logout</span>
                </button>
            </div>
        </aside>
    );
};
