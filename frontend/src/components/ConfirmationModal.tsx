import React from 'react';
import { X, AlertTriangle, AlertCircle, Info as InfoIcon, CheckCircle2 } from 'lucide-react';
import { clsx } from 'clsx';

interface ConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm?: () => void;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    type?: 'info' | 'warning' | 'danger' | 'success';
}

export const ConfirmationModal = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    type = 'info'
}: ConfirmationModalProps) => {
    if (!isOpen) return null;

    const config = {
        info: {
            icon: InfoIcon,
            color: 'text-blue-400',
            bg: 'bg-blue-500/10',
            border: 'border-blue-500/20',
            btn: 'bg-blue-600 hover:bg-blue-500',
            shadow: 'shadow-blue-500/20'
        },
        warning: {
            icon: AlertTriangle,
            color: 'text-amber-400',
            bg: 'bg-amber-500/10',
            border: 'border-amber-500/20',
            btn: 'bg-amber-600 hover:bg-amber-500',
            shadow: 'shadow-amber-500/20'
        },
        danger: {
            icon: AlertCircle,
            color: 'text-red-400',
            bg: 'bg-red-500/10',
            border: 'border-red-500/20',
            btn: 'bg-red-600 hover:bg-red-500',
            shadow: 'shadow-red-500/20'
        },
        success: {
            icon: CheckCircle2,
            color: 'text-emerald-400',
            bg: 'bg-emerald-500/10',
            border: 'border-emerald-500/20',
            btn: 'bg-emerald-600 hover:bg-emerald-500',
            shadow: 'shadow-emerald-500/20'
        }
    };

    const { icon: Icon, color, bg, border, btn, shadow } = config[type];

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div
                className="absolute inset-0 bg-black/80 backdrop-blur-md animate-in fade-in duration-300"
                onClick={onClose}
            />
            <div className={clsx(
                "relative bg-slate-900 border rounded-3xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200",
                border
            )}>
                <div className="p-8 space-y-6">
                    <div className="flex items-center gap-4">
                        <div className={clsx("p-3 rounded-2xl", bg)}>
                            <Icon size={24} className={color} />
                        </div>
                        <h3 className="text-xl font-black text-white uppercase tracking-tight">{title}</h3>
                    </div>

                    <p className="text-slate-400 font-medium leading-relaxed">
                        {message}
                    </p>

                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="flex-1 px-6 py-3.5 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white font-bold rounded-2xl transition-all"
                        >
                            {cancelLabel}
                        </button>
                        {onConfirm && (
                            <button
                                onClick={() => {
                                    onConfirm();
                                    onClose();
                                }}
                                className={clsx(
                                    "flex-1 px-6 py-3.5 text-white font-black uppercase text-xs tracking-widest rounded-2xl transition-all shadow-xl",
                                    btn, shadow
                                )}
                            >
                                {confirmLabel}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
