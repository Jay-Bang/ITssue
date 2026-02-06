'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/components/providers/ThemeProvider';

interface SidebarProps {
    isOpen: boolean;
    onClose: () => void;
}

export const Sidebar = ({ isOpen, onClose }: SidebarProps) => {
    const pathname = usePathname();
    const { theme, toggleTheme } = useTheme();

    const navItems = [
        { label: 'Overview', href: '/', icon: '📊' },
        { label: 'Boards', href: '/', icon: '📋' },
        { label: 'Analytics', href: '#', icon: '📈', disabled: true },
        { label: 'Settings', href: '#', icon: '⚙️', disabled: true },
    ];

    const handleLogout = async () => {
        await supabase.auth.signOut();
        window.location.href = '/login';
    };

    // Close sidebar on navigation (for mobile)
    useEffect(() => {
        onClose();
    }, [pathname, onClose]);

    return (
        <>
            {/* Mobile Overlay */}
            {isOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 lg:hidden backdrop-blur-sm transition-opacity"
                    onClick={onClose}
                />
            )}

            <aside className={`
                fixed inset-y-0 left-0 z-50 w-64 bg-card-bg border-r border-muted/20 flex flex-col h-screen transition-transform duration-300 ease-in-out transform
                lg:translate-x-0 lg:static lg:block
                ${isOpen ? 'translate-x-0' : '-translate-x-full'}
            `}>
                <div className="p-6">
                    <div className="flex items-center justify-between lg:justify-start gap-2 mb-8">
                        <div className="flex items-center gap-2">
                            <span className="text-2xl">⚡</span>
                            <h1 className="text-xl font-black text-foreground tracking-tight">ITssue Admin</h1>
                        </div>
                        <button onClick={onClose} className="lg:hidden text-muted hover:text-foreground">
                            ✕
                        </button>
                    </div>

                    <nav className="space-y-1">
                        {navItems.map((item) => (
                            <Link
                                key={item.label}
                                href={item.href}
                                className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-colors ${pathname === item.href
                                    ? 'bg-accent-primary/10 text-accent-primary'
                                    : item.disabled
                                        ? 'text-muted/30 cursor-not-allowed'
                                        : 'text-muted hover:bg-muted/5 hover:text-foreground'
                                    }`}
                            >
                                <span className="text-lg">{item.icon}</span>
                                {item.label}
                            </Link>
                        ))}
                    </nav>
                </div>

                <div className="mt-auto p-6 border-t border-muted/10 space-y-4">
                    {/* Theme Toggle */}
                    <button
                        onClick={toggleTheme}
                        className="flex items-center justify-between px-4 py-3 w-full bg-muted/5 hover:bg-muted/10 rounded-xl transition-all border border-muted/10 group"
                    >
                        <div className="flex items-center gap-3">
                            <span className="text-lg">{theme === 'arcade' ? '☀️' : '🌙'}</span>
                            <span className="text-sm font-bold text-foreground">
                                {theme === 'arcade' ? 'Arcade' : 'Bubblegum'}
                            </span>
                        </div>
                        <div className={`w-10 h-6 bg-muted/20 rounded-full relative transition-colors group-hover:bg-muted/30`}>
                            <div className={`absolute top-1 w-4 h-4 rounded-full transition-all bg-white shadow-sm ${theme === 'arcade' ? 'left-1' : 'left-5'
                                }`} />
                        </div>
                    </button>

                    <div className="bg-accent-primary rounded-xl p-4 text-background shadow-md">
                        <p className="text-xs font-bold opacity-80 mb-1">DYNAMIC THEME</p>
                        <p className="text-sm font-black uppercase tracking-tight">
                            {theme === 'arcade' ? 'Arcade Light' : 'Bubblegum Dark'}
                        </p>
                    </div>

                    <button
                        onClick={handleLogout}
                        className="flex items-center gap-3 px-4 py-2 w-full text-sm font-medium text-muted hover:text-accent-orange hover:bg-accent-orange/10 rounded-lg transition-all"
                    >
                        <span>🚪</span>
                        Sign Out
                    </button>
                </div>
            </aside>
        </>
    );
};
