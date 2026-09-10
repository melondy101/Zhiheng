'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { AuthModal } from '../components/AuthModal';

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  isGuest: boolean;
}

interface UserContextValue {
  user: CurrentUser | null;
  loading: boolean;
  isAuthModalOpen: boolean;
  authModalTab: 'login' | 'register';
  openAuthModal: (tab?: 'login' | 'register') => void;
  closeAuthModal: () => void;
  login: (email: string, password: string, migrateCurrentGuest?: boolean) => Promise<{ ok: boolean; error?: string }>;
  register: (email: string, password: string, code: string, name?: string) => Promise<{ ok: boolean; error?: string }>;
  sendCode: (email: string) => Promise<{ ok: boolean; error?: string; message?: string }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({
  children,
  initialUser = null,
}: {
  children: React.ReactNode;
  initialUser?: CurrentUser | null;
}) {
  const [user, setUser] = useState<CurrentUser | null>(initialUser);
  const [loading, setLoading] = useState<boolean>(!initialUser);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalTab, setAuthModalTab] = useState<'login' | 'register'>('register');

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          setUser(data.user);
          // Sync owner ID to localStorage for backward compatibility
          try {
            localStorage.setItem('zhiyan_owner_id', data.user.id);
          } catch {
            // ignore
          }
        }
      }
    } catch (err) {
      console.error('[UserProvider] Failed to fetch current user:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialUser) {
      refresh();
    }
  }, [initialUser, refresh]);

  const openAuthModal = useCallback((tab: 'login' | 'register' = 'register') => {
    setAuthModalTab(tab);
    setIsAuthModalOpen(true);
  }, []);

  const closeAuthModal = useCallback(() => {
    setIsAuthModalOpen(false);
  }, []);

  const sendCode = useCallback(async (email: string) => {
    try {
      const res = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data.error || '发送验证码失败' };
      }
      return { ok: true, message: data.message };
    } catch {
      return { ok: false, error: '网络异常，请稍后重试' };
    }
  }, []);

  const login = useCallback(
    async (email: string, password: string, migrateCurrentGuest: boolean = true) => {
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, migrateCurrentGuest }),
        });
        const data = await res.json();
        if (!res.ok) {
          return { ok: false, error: data.error || '登录失败' };
        }
        setUser(data.user);
        try {
          localStorage.setItem('zhiyan_owner_id', data.user.id);
        } catch {
          // ignore
        }
        closeAuthModal();
        return { ok: true };
      } catch {
        return { ok: false, error: '网络异常，请稍后重试' };
      }
    },
    [closeAuthModal]
  );

  const register = useCallback(
    async (email: string, password: string, code: string, name?: string) => {
      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, code, name }),
        });
        const data = await res.json();
        if (!res.ok) {
          return { ok: false, error: data.error || '注册失败' };
        }
        setUser(data.user);
        try {
          localStorage.setItem('zhiyan_owner_id', data.user.id);
        } catch {
          // ignore
        }
        closeAuthModal();
        return { ok: true };
      } catch {
        return { ok: false, error: '网络异常，请稍后重试' };
      }
    },
    [closeAuthModal]
  );

  const logout = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          setUser(data.user);
          try {
            localStorage.setItem('zhiyan_owner_id', data.user.id);
          } catch {
            // ignore
          }
        }
      }
    } catch (err) {
      console.error('[UserProvider] Logout error:', err);
    }
  }, []);

  return (
    <UserContext.Provider
      value={{
        user,
        loading,
        isAuthModalOpen,
        authModalTab,
        openAuthModal,
        closeAuthModal,
        login,
        register,
        sendCode,
        logout,
        refresh,
      }}
    >
      {children}
      <AuthModal
        isOpen={isAuthModalOpen}
        initialTab={authModalTab}
        onClose={closeAuthModal}
        onLogin={login}
        onRegister={register}
        onSendCode={sendCode}
        isGuest={Boolean(user?.isGuest)}
      />
    </UserContext.Provider>
  );
}

export function useCurrentUser() {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error('useCurrentUser must be used within a UserProvider');
  }
  return context;
}
