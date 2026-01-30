import React, { useState } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { Shield, Mail, Lock, ArrowRight } from 'lucide-react';

export const Login = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const setAuth = useAuthStore(state => state.setAuth);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        // Mock login for now
        setAuth({ id: '1', email, role: 'admin' }, 'mock-token');
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-dark-bg p-4">
            <div className="max-w-md w-full glass rounded-2xl p-8 shadow-2xl">
                <div className="text-center mb-10">
                    <div className="w-16 h-16 bg-primary-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-primary-500/20">
                        <Shield size={32} className="text-white" />
                    </div>
                    <h1 className="text-3xl font-bold text-white mb-2">Welcome Back</h1>
                    <p className="text-slate-400">IoTMonitor Enterprise Portal</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-300 ml-1">Email Address</label>
                        <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                            <input
                                type="email"
                                required
                                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-11 pr-4 text-white placeholder:text-slate-600 focus:border-primary-500/50 focus:ring-1 focus:ring-primary-500/20 transition-all outline-none"
                                placeholder="admin@company.com"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-300 ml-1">Password</label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                            <input
                                type="password"
                                required
                                className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-11 pr-4 text-white placeholder:text-slate-600 focus:border-primary-500/50 focus:ring-1 focus:ring-primary-500/20 transition-all outline-none"
                                placeholder="••••••••"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        className="w-full bg-primary-600 hover:bg-primary-500 text-white font-bold py-3 rounded-xl shadow-lg shadow-primary-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                    >
                        Sign In
                        <ArrowRight size={18} />
                    </button>
                </form>

                <div className="mt-8 pt-8 border-t border-white/5 text-center">
                    <p className="text-slate-500 text-sm">
                        Interested in IoTMonitor? <a href="#" className="text-primary-400 hover:text-primary-300 transition-colors">Contact Support</a>
                    </p>
                </div>
            </div>
        </div>
    );
};
