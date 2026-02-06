'use client';

/**
 * [Admin Dashboard: Login Page]
 * 
 * [Description] 관리자 도구 접근을 위한 인증 페이지입니다.
 * 
 * [Design Intent]
 * - [Safety] Supabase Auth의 이메일/비밀번호 인증 방식을 사용합니다.
 * - [UX] 인증 성공 시 메인 대시보드로 자동 리다이렉트 및 세션 상태 동기화를 수행합니다.
 */

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const router = useRouter();

    async function handleLogin(e: React.FormEvent) {
        e.preventDefault();
        setLoading(true);
        setError(null);

        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) {
            setError(error.message);
            setLoading(false);
        } else {
            router.push('/');
            router.refresh();
        }
    }

    return (
        <div className="min-h-screen bg-background flex flex-col justify-center py-12 px-6 lg:px-8 relative overflow-hidden">
            {/* Background Decorative Elements */}
            <div className="absolute top-0 left-0 w-full h-full pointer-events-none opacity-20">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-accent-primary/20 rounded-full blur-[100px]" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-accent-secondary/20 rounded-full blur-[100px]" />
            </div>

            <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10 text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-accent-primary/10 rounded-2xl mb-6 ring-1 ring-accent-primary/20">
                    <span className="text-3xl">⚡</span>
                </div>
                <h2 className="text-4xl font-black text-foreground tracking-tight italic mb-2">
                    ITssue <span className="text-accent-primary">Admin</span>
                </h2>
                <p className="text-sm font-medium text-muted uppercase tracking-widest mb-8">Autonomous AI Pipeline Control</p>
            </div>

            <div className="mt-4 sm:mx-auto sm:w-full sm:max-w-md relative z-10">
                <div className="bg-card-bg/50 backdrop-blur-xl py-10 px-8 shadow-2xl rounded-3xl border border-muted/10">
                    <form className="space-y-6" onSubmit={handleLogin}>
                        <div>
                            <label htmlFor="email" className="block text-xs font-black text-muted uppercase tracking-widest mb-2 px-1">
                                Command Center ID
                            </label>
                            <input
                                id="email"
                                type="email"
                                required
                                placeholder="name@itssue.news"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full px-4 py-3 bg-muted/5 border border-muted/10 rounded-xl focus:ring-2 focus:ring-accent-primary outline-none text-foreground font-bold placeholder:text-muted/30 transition-all"
                            />
                        </div>

                        <div>
                            <label htmlFor="password" className="block text-xs font-black text-muted uppercase tracking-widest mb-2 px-1">
                                Security Cipher
                            </label>
                            <input
                                id="password"
                                type="password"
                                required
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full px-4 py-3 bg-muted/5 border border-muted/10 rounded-xl focus:ring-2 focus:ring-accent-primary outline-none text-foreground font-bold placeholder:text-muted/30 transition-all"
                            />
                        </div>

                        {error && (
                            <div className="bg-accent-orange/10 border border-accent-orange/20 text-accent-orange text-xs font-bold p-3 rounded-xl text-center">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full h-12 flex items-center justify-center bg-foreground text-background rounded-xl text-sm font-black hover:bg-accent-primary transition-all duration-300 transform active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
                        >
                            {loading ? (
                                <div className="w-5 h-5 border-2 border-background border-t-transparent rounded-full animate-spin" />
                            ) : (
                                'AUTHENTICATE ACCESS'
                            )}
                        </button>
                    </form>
                </div>

                <div className="mt-8 text-center">
                    <p className="text-[10px] font-black text-muted uppercase tracking-widest opacity-50">
                        ITSSUE AI AUTONOMOUS ENGINE • SECURITY PROTOCOL V2.3
                    </p>
                </div>
            </div>
        </div>
    );
}
