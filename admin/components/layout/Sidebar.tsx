'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface SidebarProps {
    isOpen: boolean;
    onClose: () => void;
}

export const Sidebar = ({ isOpen, onClose }: SidebarProps) => {
    const pathname = usePathname();

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
                fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 flex flex-col h-screen transition-transform duration-300 ease-in-out transform
                lg:translate-x-0 lg:static lg:block
                ${isOpen ? 'translate-x-0' : '-translate-x-full'}
            `}>
                <div className="p-6">
                    <div className="flex items-center justify-between lg:justify-start gap-2 mb-8">
                        <div className="flex items-center gap-2">
                            <span className="text-2xl">⚡</span>
                            <h1 className="text-xl font-black text-gray-900 tracking-tight">ITssue Admin</h1>
                        </div>
                        <button onClick={onClose} className="lg:hidden text-gray-400 hover:text-gray-600">
                            ✕
                        </button>
                    </div>

                    <nav className="space-y-1">
                        {navItems.map((item) => (
                            <Link
                                key={item.label}
                                href={item.href}
                                className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-colors ${pathname === item.href
                                    ? 'bg-indigo-50 text-indigo-700'
                                    : item.disabled
                                        ? 'text-gray-300 cursor-not-allowed'
                                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                                    }`}
                            >
                                <span className="text-lg">{item.icon}</span>
                                {item.label}
                            </Link>
                        ))}
                    </nav>
                </div>

                <div className="mt-auto p-6 border-t border-gray-100">
                    <div className="bg-indigo-600 rounded-xl p-4 text-white mb-4 bg-gradient-to-br from-indigo-500 to-purple-600 shadow-md">
                        <p className="text-xs font-bold opacity-80 mb-1">PRO PLAN</p>
                        <p className="text-sm font-bold">Autonomous Engine</p>
                    </div>

                    <button
                        onClick={handleLogout}
                        className="flex items-center gap-3 px-4 py-2 w-full text-sm font-medium text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                    >
                        <span>🚪</span>
                        Sign Out
                    </button>
                </div>
            </aside>
        </>
    );
};
