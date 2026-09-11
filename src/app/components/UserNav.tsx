'use client';

import { useState, useRef, useEffect } from 'react';
import { useCurrentUser } from '../providers/UserProvider';
import { LogOut, LogIn, Sparkles, ChevronDown, User as UserIcon } from 'lucide-react';

interface UserNavProps {
  className?: string;
  compact?: boolean;
}

export default function UserNav({ className = '', compact = false }: UserNavProps) {
  const { user, loading, openAuthModal, logout } = useCurrentUser();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [dropdownOpen]);

  if (loading) {
    return (
      <div className={`h-8 w-24 bg-surface-subtle rounded-lg animate-pulse ${className}`} />
    );
  }

  // Registered user (not guest)
  if (user && !user.isGuest) {
    return (
      <div className={`relative ${className}`} ref={dropdownRef}>
        <button
          id="user-nav-btn"
          type="button"
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-full border border-line bg-surface-elevated hover:bg-surface-subtle transition-colors shadow-xs text-xs text-content-primary"
          aria-expanded={dropdownOpen}
          aria-haspopup="true"
        >
          <span className="w-6 h-6 rounded-full bg-brand text-content-inverse flex items-center justify-center font-bold text-[11px] select-none">
            {user.name ? user.name.charAt(0).toUpperCase() : 'U'}
          </span>
          {!compact && (
            <span className="font-medium truncate max-w-[100px] text-content-primary">{user.name}</span>
          )}
          <ChevronDown
            className={`w-3.5 h-3.5 text-content-tertiary transition-transform ${
              dropdownOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {dropdownOpen && (
          <div
            id="user-nav-dropdown"
            className="absolute right-0 mt-1.5 w-56 rounded-xl border border-line bg-surface-elevated shadow-lg p-2 z-50 animate-in fade-in zoom-in-95 duration-100"
          >
            <div className="px-2.5 py-2 border-b border-line mb-1">
              <div className="flex items-center justify-between gap-1 mb-0.5">
                <span className="text-xs font-semibold text-content-primary truncate">{user.name}</span>
                <span className="px-1.5 py-0.5 text-[9px] font-medium bg-semantic-success-light text-semantic-success border border-semantic-success/20 rounded">
                  已登录
                </span>
              </div>
              <p className="text-[11px] text-content-tertiary truncate">{user.email}</p>
            </div>
            <button
              id="user-logout-btn"
              type="button"
              onClick={async () => {
                setDropdownOpen(false);
                await logout();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-content-secondary hover:text-semantic-error hover:bg-semantic-error-light rounded-lg transition-colors text-left"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>退出登录</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  // Guest mode or unauthenticated
  if (compact) {
    return (
      <div className={`flex items-center gap-1.5 ${className}`}>
        <button
          id="user-nav-login-btn-compact"
          type="button"
          onClick={() => openAuthModal('login')}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-line bg-surface-elevated hover:bg-surface-subtle text-xs font-medium text-content-primary shadow-xs transition-colors"
        >
          <UserIcon className="w-3.5 h-3.5 text-content-tertiary" />
          <span>登录</span>
        </button>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <button
        id="user-login-btn"
        type="button"
        onClick={() => openAuthModal('login')}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line bg-surface-elevated hover:bg-surface-subtle text-xs font-medium text-content-primary shadow-xs hover:border-line-strong transition-colors"
      >
        <LogIn className="w-3.5 h-3.5 text-content-tertiary" />
        <span>账号登录</span>
      </button>
      <button
        id="user-register-btn"
        type="button"
        onClick={() => openAuthModal('register')}
        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-hover text-content-inverse text-xs font-medium shadow-xs transition-colors"
      >
        <Sparkles className="w-3.5 h-3.5 text-accent" />
        <span>注册 / 一键转正</span>
      </button>
    </div>
  );
}
