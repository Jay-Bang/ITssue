'use client';

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { ThemeProvider } from "@/components/providers/ThemeProvider";

export function AppProvider({ children }: { children: React.ReactNode }) {
    const [loading, setLoading] = useState(true);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        const checkAuth = async () => {
            const { data: { session } } = await supabase.auth.getSession();

            if (!session && pathname !== '/login') {
                router.push('/login');
            } else if (session) {
                // Strict Admin Email Protection
                const ADMIN_EMAIL = 'jaejungbang@gmail.com';
                if (session.user.email !== ADMIN_EMAIL) {
                    await supabase.auth.signOut();
                    router.push('/login');
                    return;
                }

                if (pathname === '/login') {
                    router.push('/');
                }
            }

            setLoading(false);
        };

        checkAuth();

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            if (!session && pathname !== '/login') {
                router.push('/login');
            }
        });

        return () => subscription.unsubscribe();
    }, [pathname, router]);

    const isLoginPage = pathname === '/login';

    if (loading && !isLoginPage) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-10 h-10 border-4 border-accent-primary border-t-transparent rounded-full animate-spin"></div>
                    <p className="text-sm font-black tracking-widest text-accent-primary uppercase">ITssue Securing...</p>
                </div>
            </div>
        );
    }

    return (
        <ThemeProvider>
            {isLoginPage ? (
                children
            ) : (
                <div className="flex min-h-screen flex-col lg:flex-row">
                    {/* Mobile Header */}
                    <header className="lg:hidden flex items-center justify-between px-6 py-4 bg-card-bg border-b border-muted/20 sticky top-0 z-30">
                        <div className="flex items-center gap-2">
                            <span className="text-2xl">⚡</span>
                            <span className="font-black text-foreground tracking-tight italic">ITssue</span>
                        </div>
                        <button
                            onClick={() => setIsSidebarOpen(true)}
                            className="p-2 -mr-2 text-foreground hover:text-accent-primary transition-colors"
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                            </svg>
                        </button>
                    </header>

                    <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

                    <main className="flex-1 overflow-x-hidden overflow-y-auto w-full">
                        <div className="max-w-7xl mx-auto py-6 px-4 sm:py-8 sm:px-6 lg:px-8">
                            {children}
                        </div>
                    </main>
                </div>
            )}
        </ThemeProvider>
    );
}
