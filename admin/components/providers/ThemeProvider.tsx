/**
 * [Global Provider: Dynamic Theme Engine]
 * 
 * [Description] 애플리케이션의 테마(Arcade/Bubblegum) 상태를 관리하고 영속화하는 테마 엔진입니다.
 */
import React, { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'arcade' | 'bubblegum';

interface ThemeContextType {
    theme: Theme;
    toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // [Design Intent] 사용자 설정 또는 시간대(Day/Night)에 기반한 초기 테마 설정
    const [theme, setTheme] = useState<Theme>(() => {
        // [Safety] SSR 환경에서의 에러 방지를 위한 윈도우 객체 체크 (window/localStorage 가용성 확인)
        if (typeof window === 'undefined') return 'arcade';

        const savedTheme = localStorage.getItem('itssue-theme') as Theme | null;
        if (savedTheme) return savedTheme;

        const hour = new Date().getHours();
        return (hour >= 9 && hour < 18) ? 'arcade' : 'bubblegum';
    });

    useEffect(() => {
        // [Logic] 테마 변경 시 HTML 데이터 속성 및 로컬 스토리지 동기화
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('itssue-theme', theme);
    }, [theme]);

    const toggleTheme = () => {
        setTheme(prev => (prev === 'arcade' ? 'bubblegum' : 'arcade'));
    };

    return (
        <ThemeContext.Provider value={{ theme, toggleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
};
