'use client';

import React from 'react';

interface CardProps {
    title?: string;
    description?: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
    className?: string;
}

export const Card: React.FC<CardProps> = ({ title, description, children, footer, className = '' }) => {
    return (
        <div className={`bg-card-bg border border-muted/20 rounded-2xl shadow-sm overflow-hidden transition-all hover:shadow-md ${className}`}>
            {(title || description) && (
                <div className="px-6 py-5 border-b border-muted/10">
                    {title && <h3 className="text-lg font-black text-foreground tracking-tight">{title}</h3>}
                    {description && <p className="text-sm font-medium text-muted mt-1">{description}</p>}
                </div>
            )}
            <div className="p-6">
                {children}
            </div>
            {footer && (
                <div className="px-6 py-4 bg-muted/5 border-t border-muted/10">
                    {footer}
                </div>
            )}
        </div>
    );
};
