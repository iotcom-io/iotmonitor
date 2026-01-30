import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/useAuthStore';
import { Sidebar } from './components/layout/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { DeviceList } from './pages/DeviceList';
import { DeviceDetail } from './pages/DeviceDetail';
import { AgentBuilder } from './pages/AgentBuilder';

const PrivateRoute = ({ children }: { children: React.ReactNode }) => {
    const token = useAuthStore(state => state.token);
    return token ? <>{children}</> : <Navigate to="/login" />;
};

function App() {
    const token = useAuthStore(state => state.token);

    return (
        <Router>
            <div className="flex bg-dark-bg min-h-screen text-slate-200">
                {token && <Sidebar />}
                <main className={token ? "flex-1 ml-64 p-8 transition-all duration-300" : "flex-1"}>
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
                        <Route path="/alerts" element={<PrivateRoute><div className="card">Alerts (Pending)</div></PrivateRoute>} />
                        <Route path="/settings" element={<PrivateRoute><div className="card">Settings (Pending)</div></PrivateRoute>} />
                    </Routes>
                </main>
            </div>
        </Router>
    );
}

export default App;
