'use client';

import React from 'react';

interface StatsCardProps {
    title: string;
    value: string | number;
    subValue?: string;
    icon: string;
    trend?: {
        value: string;
        positive: boolean;
    };
    color?: 'indigo' | 'green' | 'amber' | 'blue';
}

export const StatsCard = ({ title, value, subValue, icon, trend, color = 'indigo' }: StatsCardProps) => {
    const colorMap = {
        indigo: 'bg-indigo-50 text-indigo-600',
        green: 'bg-green-50 text-green-600',
        amber: 'bg-amber-50 text-amber-600',
        blue: 'bg-blue-50 text-blue-600',
    };

    return (
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex items-start gap-4 transition-all hover:shadow-md hover:border-indigo-100 group">
            <div className={`p-3 rounded-lg text-2xl ${colorMap[color]} group-hover:scale-110 transition-transform`}>
                {icon}
            </div>
            <div>
                <p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">{title}</p>
                <div className="flex items-baseline gap-2 mt-1">
                    <h3 className="text-2xl font-black text-gray-900">{value}</h3>
                    {trend && (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${trend.positive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {trend.positive ? '↑' : '↓'} {trend.value}
                        </span>
                    )}
                </div>
                {subValue && <p className="text-xs text-gray-400 mt-1 font-medium italic">{subValue}</p>}
            </div>
        </div>
    );
};
