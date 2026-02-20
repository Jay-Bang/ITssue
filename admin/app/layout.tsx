/**
 * [Admin Infrastructure: Main Layout]
 *
 * [Description] 관리자 대시보드의 전체 프레임과 공통 레이아웃을 정의합니다.
 *
 * [Design Intent]
 * - [Strategy] 일관된 테마와 사이드바 레이아웃을 UI 전역에 강제하여 사용자 경험(UX) 통일성을 확보합니다.
 *
 * [Key Features]
 * - 글로벌 폰트(Ge Geist) 설정 및 적용.
 * - 애플리케이션 메타데이터 관리.
 * - 전역 상태(Auth, Theme 등)를 주입하는 AppProvider 래핑.
 */
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import React from "react";
import { AppProvider } from "@/components/providers/AppProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// [Config] Metadata Settings
export const metadata: Metadata = {
  title: "ITssue Admin | AI Autonomous Dashboard",
  description: "Advanced analytics and management for the ITssue AI autonomous engine.",
};

// [Config] Viewport Settings
export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased text-gray-900 font-sans`}
      >
        {/* [Logic] AppProvider를 통해 전역 상태(Auth, Theme 등)를 주입합니다. */}
        <AppProvider>
          {children}
        </AppProvider>
      </body>
    </html>
  );
}
