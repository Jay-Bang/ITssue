'use client';

import React from 'react';

interface CardProps {
    children: React.ReactNode;
    title?: string;
    description?: string;
    className?: string;
    footer?: React.ReactNode;
}

export const Card = ({ children, title, description, className = '', footer }: CardProps) => {
    return (
        <div className={`bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col ${className}`}>
            {(title || description) && (
                <div className="px-6 py-4 border-b border-gray-100">
                    {title && <h3 className="text-lg font-bold text-gray-900 leading-tight">{title}</h3>}
                    {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
                </div>
            )}
            <div className="px-6 py-5 flex-1">
                {children}
            </div>
            {footer && (
                <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
                    {footer}
                </div>
            )}
        </div>
    );
};
