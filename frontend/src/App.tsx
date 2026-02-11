import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/useAuthStore';
import { Sidebar } from './components/layout/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { DeviceList } from './pages/DeviceList';
import { DeviceDetail } from './pages/DeviceDetail';
import { AgentBuilder } from './pages/AgentBuilder';
import { Settings } from './pages/Settings';
import { Synthetics } from './pages/Synthetics';
import { Incidents } from './pages/Incidents';
import { Alerts } from './pages/Alerts';
import { Users } from './pages/Users';
import { Licenses } from './pages/Licenses';
import NotificationChannels from './pages/NotificationChannels';
import { hasPermission, PermissionKey } from './lib/permissions';
import api from './lib/axios';

const PrivateRoute = ({ children }: { children: React.ReactNode }) => {
    const token = useAuthStore(state => state.token);
    return token ? <>{children}</> : <Navigate to="/login" />;
};

const PermissionRoute = ({ permission, children }: { permission: PermissionKey, children: React.ReactNode }) => {
    const user = useAuthStore(state => state.user);
    return hasPermission(permission, user) ? <>{children}</> : <Navigate to="/" replace />;
};

function App() {
    const token = useAuthStore(state => state.token);
    const user = useAuthStore(state => state.user);
    const setAuth = useAuthStore(state => state.setAuth);
    const [sidebarCollapsed, setSidebarCollapsed] = React.useState<boolean>(() => {
        if (typeof window === 'undefined') return false;
        return window.localStorage.getItem('iotmonitor.sidebar.collapsed') === '1';
    });
    const version = import.meta.env.VITE_APP_VERSION || 'dev';
    const build = import.meta.env.VITE_APP_BUILD || 'local';

    React.useEffect(() => {
        if (!token) return;
        if (user?.permissions && Object.keys(user.permissions).length > 0) return;

        api.get('/auth/me')
            .then((res) => {
                const profile = res.data?.user;
                if (profile) {
                    setAuth(profile, token);
                }
            })
            .catch(() => { });
    }, [token, user, setAuth]);

    React.useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem('iotmonitor.sidebar.collapsed', sidebarCollapsed ? '1' : '0');
    }, [sidebarCollapsed]);

    return (
        <Router>
            <div className="flex bg-dark-bg min-h-screen text-slate-200">
                {token && <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((prev) => !prev)} />}
                <main className={token
                    ? `flex-1 ${sidebarCollapsed ? 'ml-20' : 'ml-64'} p-8 transition-all duration-300 flex flex-col min-h-screen`
                    : "flex-1 flex flex-col min-h-screen"}
                >
                    <div className="flex-1">
                        <Routes>
                            <Route path="/login" element={!token ? <Login /> : <Navigate to="/" />} />
                            <Route
                                path="/"
                                element={
                                    <PrivateRoute>
                                        <Dashboard />
                                    </PrivateRoute>
                                }
                            />
                            {/* Placeholders for other routes */}
                            <Route path="/devices" element={<PrivateRoute><PermissionRoute permission="devices.view"><DeviceList /></PermissionRoute></PrivateRoute>} />
                            <Route path="/devices/:id" element={<PrivateRoute><PermissionRoute permission="devices.view"><DeviceDetail /></PermissionRoute></PrivateRoute>} />
                            <Route path="/agent-builder" element={<PrivateRoute><PermissionRoute permission="devices.build_agent"><AgentBuilder /></PermissionRoute></PrivateRoute>} />
                            <Route path="/alerts" element={<PrivateRoute><PermissionRoute permission="alerts.view"><Alerts /></PermissionRoute></PrivateRoute>} />
                            <Route path="/incidents" element={<PrivateRoute><PermissionRoute permission="incidents.view"><Incidents /></PermissionRoute></PrivateRoute>} />
                            <Route path="/notification-channels" element={<PrivateRoute><PermissionRoute permission="settings.view"><NotificationChannels /></PermissionRoute></PrivateRoute>} />
                            <Route path="/settings" element={<PrivateRoute><PermissionRoute permission="settings.view"><Settings /></PermissionRoute></PrivateRoute>} />
                            <Route path="/web-monitoring" element={<PrivateRoute><PermissionRoute permission="synthetics.view"><Synthetics /></PermissionRoute></PrivateRoute>} />
                            <Route path="/licenses" element={<PrivateRoute><PermissionRoute permission="licenses.view"><Licenses /></PermissionRoute></PrivateRoute>} />
                            <Route path="/users" element={<PrivateRoute><PermissionRoute permission="users.view"><Users /></PermissionRoute></PrivateRoute>} />
                            <Route path="/synthetics" element={<Navigate to="/web-monitoring" replace />} />
                        </Routes>
                    </div>
                    <footer className="mt-8 text-xs text-slate-500 flex items-center justify-between border-t border-white/5 pt-4">
                        <span>(c) 2026 iotcom.io</span>
                        <span>Version {version} | Build {build}</span>
                    </footer>
                </main>
            </div>
        </Router>
    );
}

export default App;

