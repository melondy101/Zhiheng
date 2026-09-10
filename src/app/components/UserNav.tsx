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
      <div className={`h-8 w-24 bg-slate-100 rounded-lg animate-pulse ${className}`} />
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
          className="flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-full border border-slate-200 bg-white hover:bg-slate-50 transition-colors shadow-xs text-xs text-slate-700"
          aria-expanded={dropdownOpen}
          aria-haspopup="true"
        >
          <span className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-[11px] select-none">
            {user.name ? user.name.charAt(0).toUpperCase() : 'U'}
          </span>
          {!compact && (
            <span className="font-medium truncate max-w-[100px] text-slate-800">{user.name}</span>
          )}
          <ChevronDown
            className={`w-3.5 h-3.5 text-slate-400 transition-transform ${
              dropdownOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {dropdownOpen && (
          <div
            id="user-nav-dropdown"
            className="absolute right-0 mt-1.5 w-56 rounded-xl border border-slate-200 bg-white shadow-lg p-2 z-50 animate-in fade-in zoom-in-95 duration-100"
          >
            <div className="px-2.5 py-2 border-b border-slate-100 mb-1">
              <div className="flex items-center justify-between gap-1 mb-0.5">
                <span className="text-xs font-semibold text-slate-800 truncate">{user.name}</span>
                <span className="px-1.5 py-0.5 text-[9px] font-medium bg-emerald-50 text-emerald-600 border border-emerald-100 rounded">
                  已登录
                </span>
              </div>
              <p className="text-[11px] text-slate-500 truncate">{user.email}</p>
            </div>
            <button
              id="user-logout-btn"
              type="button"
              onClick={async () => {
                setDropdownOpen(false);
                await logout();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-slate-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors text-left"
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
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 shadow-xs"
        >
          <UserIcon className="w-3.5 h-3.5 text-slate-500" />
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
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 shadow-xs hover:border-slate-300 transition-colors"
      >
        <LogIn className="w-3.5 h-3.5 text-slate-500" />
        <span>账号登录</span>
      </button>
      <button
        id="user-register-btn"
        type="button"
        onClick={() => openAuthModal('register')}
        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium shadow-xs transition-colors"
      >
        <Sparkles className="w-3.5 h-3.5 text-blue-200" />
        <span>注册 / 一键转正</span>
      </button>
    </div>
  );
}
