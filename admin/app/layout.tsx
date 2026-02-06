'use client';

/**
 * [Admin Dashboard: Root Layout]
 * 
 * [Description] 관리자 도구 전체에 공통적으로 적용되는 최상위 레이아웃 및 인증 보호 계층입니다.
 * 
 * [Design Intent]
 * - [Safety] Supabase Auth 세션을 감지하여 비로그인 사용자를 로그인 페이지로 강제 리다이렉트 처리.
 * - [UX] 전역 글꼴(Geist) 및 스타일 설정을 통해 일관된 브랜드 경험 제공.
 */

import type { } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { ThemeProvider } from "@/components/providers/ThemeProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [loading, setLoading] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session && pathname !== '/login') {
        router.push('/login');
      } else if (session && pathname === '/login') {
        router.push('/');
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
      <html lang="en">
        <body className={`${geistSans.variable} ${geistMono.variable} antialiased font-sans`}>
          <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-400">
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-sm font-bold tracking-widest text-indigo-600">ITSSUE AUTH</p>
            </div>
          </div>
        </body>
      </html>
    );
  }

  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased text-gray-900 font-sans`}
      >
        <ThemeProvider>
          {isLoginPage ? (
            children
          ) : (
            <div className="flex min-h-screen flex-col lg:flex-row">
              {/* Mobile Header */}
              <header className="lg:hidden flex items-center justify-between px-6 py-4 bg-card-bg border-b border-muted/20 sticky top-0 z-30">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">⚡</span>
                  <span className="font-black text-foreground tracking-tight">ITssue</span>
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
      </body>
    </html>
  );
}
