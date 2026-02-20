/**
 * [Admin UI Component: Card]
 * 
 * [Description] 대시보드에서 데이터를 구획화하여 보여주는 기본 컨테이너 라이브러리입니다.
 * 
 * [Design Intent]
 * - [Layout] 일관된 여백과 그림자 효과를 통해 시각적 계층 구조를 형성합니다.
 */
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
            {/* [Logic] 타이틀 또는 설명이 있는 경우에만 헤더 영역을 렌더링합니다. */}
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
