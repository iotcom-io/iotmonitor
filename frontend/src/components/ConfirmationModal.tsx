import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmationModalProps {
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm: () => void;
    onCancel: () => void;
    isDangerous?: boolean;
}

export const ConfirmationModal = ({
    isOpen,
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    onConfirm,
    onCancel,
    isDangerous = false
}: ConfirmationModalProps) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-dark-surface border border-dark-border rounded-2xl w-full max-w-md overflow-hidden shadow-2xl scale-100 animate-in zoom-in-95 duration-200">
                <div className="p-6 text-center space-y-4">
                    <div className={`mx-auto w-12 h-12 rounded-full flex items-center justify-center ${isDangerous ? 'bg-red-500/20 text-red-500' : 'bg-amber-500/20 text-amber-500'}`}>
                        <AlertTriangle size={24} />
                    </div>

                    <h3 className="text-xl font-bold text-white">{title}</h3>
                    <p className="text-slate-400 text-sm leading-relaxed">{message}</p>
                </div>

                <div className="px-6 py-4 bg-black/20 border-t border-dark-border flex gap-3">
                    <button
                        onClick={onCancel}
                        className="flex-1 px-4 py-2.5 rounded-xl text-slate-400 font-bold hover:bg-white/5 hover:text-white transition-all"
                    >
                        {cancelText}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`flex-1 px-4 py-2.5 rounded-xl font-bold text-white shadow-lg transition-all ${isDangerous
                                ? 'bg-red-500 hover:bg-red-600 shadow-red-500/20'
                                : 'bg-primary-500 hover:bg-primary-600 shadow-primary-500/20'
                            }`}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};
