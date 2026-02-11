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
import NotificationChannels from './pages/NotificationChannels';

const PrivateRoute = ({ children }: { children: React.ReactNode }) => {
    const token = useAuthStore(state => state.token);
    return token ? <>{children}</> : <Navigate to="/login" />;
};

function App() {
    const token = useAuthStore(state => state.token);
    const version = import.meta.env.VITE_APP_VERSION || 'dev';
    const build = import.meta.env.VITE_APP_BUILD || 'local';

    return (
        <Router>
            <div className="flex bg-dark-bg min-h-screen text-slate-200">
                {token && <Sidebar />}
                <main className={token ? "flex-1 ml-64 p-8 transition-all duration-300 flex flex-col min-h-screen" : "flex-1 flex flex-col min-h-screen"}>
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
                            <Route path="/devices" element={<PrivateRoute><DeviceList /></PrivateRoute>} />
                            <Route path="/devices/:id" element={<PrivateRoute><DeviceDetail /></PrivateRoute>} />
                            <Route path="/agent-builder" element={<PrivateRoute><AgentBuilder /></PrivateRoute>} />
                            <Route path="/alerts" element={<PrivateRoute><Incidents /></PrivateRoute>} />
                            <Route path="/notification-channels" element={<PrivateRoute><NotificationChannels /></PrivateRoute>} />
                            <Route path="/settings" element={<PrivateRoute><Settings /></PrivateRoute>} />
                            <Route path="/web-monitoring" element={<PrivateRoute><Synthetics /></PrivateRoute>} />
                            <Route path="/synthetics" element={<Navigate to="/web-monitoring" replace />} />
                        </Routes>
                    </div>
                    <footer className="mt-8 text-xs text-slate-500 flex items-center justify-between border-t border-white/5 pt-4">
                        <span>© 2026 iotcom.io</span>
                        <span>Version {version} · Build {build}</span>
                    </footer>
                </main>
            </div>
        </Router>
    );
}

export default App;
