import React from 'react';

type UserDirectory = Record<string, { name?: string; email?: string }>;

interface AssigneeBadgesProps {
    ids?: string[];
    users?: UserDirectory;
    maxVisible?: number;
    showUnassigned?: boolean;
    className?: string;
}

const getDisplayName = (id: string, users?: UserDirectory) => {
    const entry = users?.[id];
    if (!entry) return id;
    const name = String(entry.name || '').trim();
    if (name) return name;
    return entry.email || id;
};

export const AssigneeBadges = ({
    ids,
    users,
    maxVisible = 2,
    showUnassigned = true,
    className = '',
}: AssigneeBadgesProps) => {
    const uniqueIds = Array.from(new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter(Boolean)));

    if (uniqueIds.length === 0) {
        if (!showUnassigned) return null;
        return <span className={`text-xs text-slate-500 ${className}`}>Unassigned</span>;
    }

    const visibleIds = uniqueIds.slice(0, Math.max(1, maxVisible));
    const remaining = Math.max(0, uniqueIds.length - visibleIds.length);

    return (
        <div className={`flex flex-wrap gap-1 ${className}`}>
            {visibleIds.map((id) => (
                <span
                    key={id}
                    className="px-2 py-0.5 bg-primary-500/10 text-primary-300 rounded text-[10px] font-bold border border-primary-500/20"
                    title={users?.[id]?.email || id}
                >
                    {getDisplayName(id, users)}
                </span>
            ))}
            {remaining > 0 && (
                <span className="px-2 py-0.5 bg-white/5 text-slate-300 rounded text-[10px] font-bold border border-white/10">
                    +{remaining}
                </span>
            )}
        </div>
    );
};

