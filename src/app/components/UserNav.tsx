'use client';

/* eslint-disable @next/next/no-img-element -- local data URL avatar is intentionally not optimized */

import { useState, useRef, useEffect } from 'react';
import { useCurrentUser } from '../providers/UserProvider';
import { LogOut, LogIn, Sparkles, ChevronDown, User as UserIcon, Settings, X, Check, Image as ImageIcon } from 'lucide-react';

interface UserNavProps {
  className?: string;
  compact?: boolean;
}

export default function UserNav({ className = '', compact = false }: UserNavProps) {
  const { user, loading, openAuthModal, logout, zhihuStatus } = useCurrentUser();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [nickname, setNickname] = useState('');
  const [avatar, setAvatar] = useState('');
  const [saved, setSaved] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user?.name) {
      setNickname(localStorage.getItem('zhiyan_nickname') || user.name || '');
    }
    setAvatar(localStorage.getItem('zhiyan_avatar') || '');
  }, [user?.name]);

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

  const handleSaveProfile = () => {
    if (nickname.trim()) {
      localStorage.setItem('zhiyan_nickname', nickname.trim());
    }
    localStorage.setItem('zhiyan_avatar', avatar);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      alert('图片大小不能超过 2MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setAvatar(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const displayName = nickname.trim() || user?.name || '用户';
  const displayAvatarLetter = displayName.charAt(0).toUpperCase() || 'U';

  const settingsModal = settingsOpen ? (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-xs px-4"
      onClick={() => setSettingsOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-line bg-surface-elevated p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-4 border-b border-line mb-5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-surface-subtle flex items-center justify-center text-content-primary">
              <Settings className="w-4 h-4" />
            </div>
            <div>
              <h2 id="settings-modal-title" className="text-base font-semibold text-content-primary">
                个人设置
              </h2>
              <p className="text-xs text-content-secondary">管理你的个人偏好与信息</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(false)}
            aria-label="关闭设置"
            className="w-8 h-8 rounded-lg hover:bg-surface-subtle flex items-center justify-center text-content-tertiary hover:text-content-primary transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          {/* 头像设置 */}
          <div>
            <label className="block text-xs font-medium text-content-secondary mb-2">
              个人头像
            </label>
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-line bg-brand text-content-inverse flex items-center justify-center font-bold text-lg select-none shadow-xs">
                {avatar ? (
                  <img src={avatar} alt="个人头像" className="w-full h-full object-cover" />
                ) : (
                  displayAvatarLetter
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line bg-surface hover:bg-surface-subtle text-xs font-medium text-content-primary cursor-pointer transition-colors">
                    <ImageIcon className="w-3.5 h-3.5 text-content-tertiary" />
                    <span>更换头像</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="sr-only"
                      onChange={handleAvatarUpload}
                    />
                  </label>
                  {avatar && (
                    <button
                      type="button"
                      onClick={() => setAvatar('')}
                      className="px-2.5 py-1.5 text-xs text-semantic-error hover:bg-semantic-error-light rounded-lg transition-colors cursor-pointer"
                    >
                      移除
                    </button>
                  )}
                </div>
                <span className="text-[11px] text-content-tertiary">支持 JPG、PNG、WebP，最大 2MB</span>
              </div>
            </div>
          </div>

          {/* 昵称 */}
          <div>
            <label htmlFor="settings-nickname-input" className="block text-xs font-medium text-content-secondary mb-1.5">
              用户昵称
            </label>
            <input
              id="settings-nickname-input"
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="请输入自定义昵称"
              maxLength={30}
              className="w-full px-3 py-2 rounded-xl border border-line bg-surface text-sm text-content-primary placeholder:text-content-tertiary focus:outline-hidden focus:ring-2 focus:ring-brand/20 focus:border-brand transition-all"
            />
          </div>

          {/* 账号信息展示 */}
          <div className="rounded-xl border border-line bg-surface p-3.5 space-y-2 text-xs">
            <div className="flex justify-between items-center">
              <span className="text-content-secondary">绑定邮箱</span>
              <span className="font-medium text-content-primary">{user?.email || '未绑定'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-content-secondary">知乎连接状态</span>
              <span className={`font-medium ${zhihuStatus?.authorized ? 'text-brand' : 'text-content-tertiary'}`}>
                {zhihuStatus?.authorized ? (zhihuStatus.profile?.name ? `已连接 (${zhihuStatus.profile.name})` : '已连接') : '未连接'}
              </span>
            </div>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="mt-6 pt-4 border-t border-line flex items-center gap-3">
          <button
            type="button"
            onClick={handleSaveProfile}
            className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-4 rounded-xl bg-brand hover:bg-brand-hover text-content-inverse text-xs font-medium transition-colors shadow-xs cursor-pointer"
          >
            {saved ? (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>已保存</span>
              </>
            ) : (
              <span>保存个人信息</span>
            )}
          </button>
          <button
            type="button"
            onClick={async () => {
              setSettingsOpen(false);
              await logout();
            }}
            className="inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-line hover:border-semantic-error/40 hover:bg-semantic-error-light text-content-secondary hover:text-semantic-error text-xs font-medium transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>退出</span>
          </button>
        </div>
      </div>
    </div>
  ) : null;

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
          className="flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-full border border-line bg-surface-elevated hover:bg-surface-subtle transition-colors shadow-xs text-xs text-content-primary cursor-pointer"
          aria-expanded={dropdownOpen}
          aria-haspopup="true"
        >
          <span className="w-6 h-6 rounded-full overflow-hidden bg-brand text-content-inverse flex items-center justify-center font-bold text-[11px] select-none">
            {avatar ? (
              <img src={avatar} alt="个人头像" className="w-full h-full object-cover" />
            ) : (
              displayAvatarLetter
            )}
          </span>
          {!compact && (
            <span className="font-medium truncate max-w-[100px] text-content-primary">{displayName}</span>
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
            className="absolute right-0 mt-1.5 w-52 rounded-xl border border-line bg-surface-elevated shadow-lg p-2 z-50 animate-in fade-in zoom-in-95 duration-100"
          >
            <div className="px-2.5 py-2 border-b border-line mb-1">
              <div className="flex items-center justify-between gap-1 mb-0.5">
                <span className="text-xs font-semibold text-content-primary truncate">{displayName}</span>
                <span className="px-1.5 py-0.5 text-[9px] font-medium bg-semantic-success-light text-semantic-success border border-semantic-success/20 rounded">
                  已登录
                </span>
              </div>
              <p className="text-[11px] text-content-tertiary truncate">{user.email}</p>
              {zhihuStatus?.authorized && (
                <p className="mt-1 text-[11px] text-brand truncate">已连接知乎{zhihuStatus.profile?.name ? `：${zhihuStatus.profile.name}` : ''}</p>
              )}
            </div>

            <button
              id="user-settings-btn"
              type="button"
              onClick={() => {
                setDropdownOpen(false);
                setSettingsOpen(true);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-content-secondary hover:text-content-primary hover:bg-surface-subtle rounded-lg transition-colors text-left cursor-pointer"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>个人设置</span>
            </button>

            <button
              id="user-logout-btn"
              type="button"
              onClick={async () => {
                setDropdownOpen(false);
                await logout();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-content-secondary hover:text-semantic-error hover:bg-semantic-error-light rounded-lg transition-colors text-left cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>退出登录</span>
            </button>
          </div>
        )}
        {settingsModal}
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
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-line bg-surface-elevated hover:bg-surface-subtle text-xs font-medium text-content-primary shadow-xs transition-colors cursor-pointer"
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
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line bg-surface-elevated hover:bg-surface-subtle text-xs font-medium text-content-primary shadow-xs hover:border-line-strong transition-colors cursor-pointer"
      >
        <LogIn className="w-3.5 h-3.5 text-content-tertiary" />
        <span>账号登录</span>
      </button>
      <button
        id="user-register-btn"
        type="button"
        onClick={() => openAuthModal('register')}
        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand hover:bg-brand-hover text-content-inverse text-xs font-medium shadow-xs transition-colors cursor-pointer"
      >
        <Sparkles className="w-3.5 h-3.5 text-accent" />
        <span>注册 / 一键转正</span>
      </button>
    </div>
  );
}
