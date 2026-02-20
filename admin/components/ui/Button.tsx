/**
 * [Admin UI Component: Button]
 * 
 * [Description] 관리자 도구에서 다양한 액션을 수행하기 위한 표준 버튼 컴포넌트입니다.
 * 
 * [Design Intent]
 * - [UX] 로딩 상태(Loading Spinner) 및 비활성화 처리를 캡슐화하여 일관된 인터랙션을 제공합니다.
 */
import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
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
    const baseStyles = "inline-flex items-center justify-center rounded-lg font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95";

    const variants = {
        primary: "bg-accent-primary text-background hover:opacity-90 shadow-sm",
        secondary: "bg-accent-secondary text-background hover:opacity-90",
        outline: "border-2 border-accent-primary text-accent-primary hover:bg-accent-primary/10",
        ghost: "text-foreground hover:bg-muted/10",
    };

    const sizes = {
        sm: "px-3 py-1.5 text-xs",
        md: "px-5 py-2.5 text-sm",
        lg: "px-8 py-3.5 text-base",
    };

    return (
        <button
            className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
            disabled={loading || props.disabled}
            {...props}
        >
            {/* [Logic] 로딩 중인 경우 스피너와 함께 처리 중 메시지를 표시합니다. */}
            {loading ? (
                <div className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>Processing...</span>
                </div>
            ) : children}
        </button>
    );
};
