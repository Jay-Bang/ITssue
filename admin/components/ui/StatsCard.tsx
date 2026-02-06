'use client';

import React from 'react';

interface StatsCardProps {
    title: string;
    value: string | number;
    icon: string;
    trend?: {
        value: string;
        isUp: boolean;
    };
    color?: 'indigo' | 'purple' | 'emerald' | 'rose' | 'amber';
}

export const StatsCard: React.FC<StatsCardProps> = ({ title, value, icon, trend, color = 'indigo' }) => {
    // Mapping base colors to theme-aware variants
    const colorStyles = {
        indigo: "text-accent-primary bg-accent-primary/10",
        purple: "text-accent-secondary bg-accent-secondary/10",
        emerald: "text-accent-secondary bg-accent-secondary/20",
        rose: "text-accent-orange bg-accent-orange/10",
        amber: "text-accent-orange bg-accent-orange/20",
    };

    return (
        <div className="group bg-card-bg p-6 rounded-2xl border border-muted/20 shadow-sm hover:shadow-md transition-all">
            <div className="flex items-center justify-between mb-4">
                <div className={`p-3 rounded-xl transition-transform group-hover:scale-110 ${colorStyles[color]}`}>
                    <span className="text-xl">{icon}</span>
                </div>
                {trend && (
                    <span className={`text-xs font-black px-2.5 py-1 rounded-full ${trend.isUp ? 'bg-accent-secondary/10 text-accent-secondary' : 'bg-accent-orange/10 text-accent-orange'
                        }`}>
                        {trend.isUp ? '↑' : '↓'} {trend.value}
                    </span>
                )}
            </div>
            <div>
                <p className="text-xs font-black text-muted uppercase tracking-widest mb-1">{title}</p>
                <h3 className="text-2xl font-black text-foreground tracking-tight">{value}</h3>
            </div>
        </div>
    );
};
