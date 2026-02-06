'use client';

import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'outline' | 'ghost' | 'danger';
    size?: 'sm' | 'md' | 'lg';
    loading?: boolean;
    children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
    variant = 'primary',
    size = 'md',
    loading = false,
    children,
    className = '',
    ...props
}) => {
    const baseStyles = 'inline-flex items-center justify-center font-black transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl tracking-tight';

    const variants = {
        primary: 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-200',
        outline: 'border-2 border-indigo-600 text-indigo-600 hover:bg-indigo-50',
        ghost: 'text-indigo-600 hover:bg-indigo-50',
        danger: 'bg-red-500 text-white hover:bg-red-600 shadow-lg shadow-red-100'
    };

    const sizes = {
        sm: 'px-3 py-1.5 text-xs',
        md: 'px-5 py-2.5 text-sm',
        lg: 'px-8 py-3.5 text-base'
    };

    return (
        <button
            className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
            disabled={loading || props.disabled}
            {...props}
        >
            {loading ? (
                <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Processing...
                </span>
            ) : children}
        </button>
    );
};
