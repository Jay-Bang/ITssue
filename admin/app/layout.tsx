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
        className={`${geistSans.variable} ${geistMono.variable} antialiased text-gray-900 bg-gray-50 font-sans`}
      >
        {isLoginPage ? (
          children
        ) : (
          <div className="flex min-h-screen">
            <Sidebar />
            <main className="flex-1 overflow-x-hidden overflow-y-auto">
              <div className="max-w-7xl mx-auto py-8 px-6 lg:px-8">
                {children}
              </div>
            </main>
          </div>
        )}
      </body>
    </html>
  );
}
