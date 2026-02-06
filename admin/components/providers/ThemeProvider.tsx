'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'arcade' | 'bubblegum';

interface ThemeContextType {
    theme: Theme;
    toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // Initialize theme from localStorage or time of day
    const [theme, setTheme] = useState<Theme>(() => {
        // We can't access localStorage/window during SSR
        if (typeof window === 'undefined') return 'arcade';

        const savedTheme = localStorage.getItem('itssue-theme') as Theme | null;
        if (savedTheme) return savedTheme;

        const hour = new Date().getHours();
        return (hour >= 9 && hour < 18) ? 'arcade' : 'bubblegum';
    });

    useEffect(() => {
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
