'use client';

import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

interface ThemeToggleProps {
  className?: string;
  compact?: boolean;
}

export default function ThemeToggle({ className = '', compact = false }: ThemeToggleProps) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem('zhiyan-theme') as 'light' | 'dark' | null;
    if (stored) {
      setTheme(stored);
      if (stored === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (prefersDark) {
        setTheme('dark');
        document.documentElement.classList.add('dark');
      }
    }
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
    localStorage.setItem('zhiyan-theme', nextTheme);
    if (nextTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  if (!mounted) {
    return (
      <div className={`w-8 h-8 rounded-lg bg-surface-subtle border border-line ${className}`} />
    );
  }

  return (
    <button
      id="theme-toggle-btn"
      type="button"
      onClick={toggleTheme}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-line bg-surface-elevated hover:bg-surface-subtle text-content-secondary hover:text-content-primary text-xs font-medium transition-all shadow-sm ${className}`}
      title={theme === 'light' ? '切换为黑曜石对弈暗室 (夜间模式)' : '切换为现代人文杂志 (白天模式)'}
      aria-label={theme === 'light' ? '切换为黑曜石对弈暗室' : '切换为现代人文杂志'}
    >
      {theme === 'light' ? (
        <>
          <Moon className="w-3.5 h-3.5 text-accent" />
          {!compact && <span className="font-serif">书卷白</span>}
        </>
      ) : (
        <>
          <Sun className="w-3.5 h-3.5 text-accent" />
          {!compact && <span className="font-mono">黑曜夜</span>}
        </>
      )}
    </button>
  );
}
