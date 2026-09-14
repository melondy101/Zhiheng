'use client';
/* eslint-disable @next/next/no-img-element -- local data URL avatar is intentionally not optimized */

import { useState, useRef, useEffect } from 'react';
import { useCurrentUser } from '../providers/UserProvider';
import { LogOut, LogIn, Sparkles, ChevronDown, User as UserIcon, Settings, X } from 'lucide-react';

interface UserNavProps {
  className?: string;
  compact?: boolean;
}

export default function UserNav({ className = '', compact = false }: UserNavProps) {
  const { user, loading, openAuthModal, logout, zhihuStatus } = useCurrentUser();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mode, setMode] = useState<'local' | 'web'>('web');
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [nickname, setNickname] = useState('');
  const [avatar, setAvatar] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNickname(localStorage.getItem('zhiyan_nickname') || user?.name || '');
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

  useEffect(() => {
    if (!settingsOpen) return;
    void fetch('/api/settings').then((r) => r.json()).then((data: { mode?: 'local' | 'web'; settings?: Record<string, string> }) => {
      setMode(data.mode === 'local' ? 'local' : 'web'); setSettings(data.settings ?? {});
    }).catch(() => undefined);
  }, [settingsOpen]);

  const saveSettings = async () => {
    localStorage.setItem('zhiyan_nickname', nickname.trim());
    localStorage.setItem('zhiyan_avatar', avatar);
    if (mode !== 'local') return;
    const payload = Object.fromEntries(Object.entries(settings).filter(([, value]) => value && !['configured', 'empty'].includes(value)));
    await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    setSaved(true); window.setTimeout(() => setSaved(false), 2200);
  };

  const settingsPanel = settingsOpen ? (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4" onClick={() => setSettingsOpen(false)}>
      <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border border-line bg-surface-elevated p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><h2 className="text-base font-semibold text-content-primary">设置</h2><button type="button" onClick={() => setSettingsOpen(false)} aria-label="关闭设置"><X className="w-4 h-4" /></button></div>
        <label className="block text-xs text-content-secondary mb-1">昵称</label><input value={nickname} onChange={(e) => setNickname(e.target.value)} className="w-full mb-4 px-3 py-2 rounded-lg border border-line bg-surface text-sm" />
        <div className="mb-4"><label className="block text-xs text-content-secondary mb-1">个人头像</label><div className="flex items-center gap-3"><div className="w-12 h-12 rounded-full overflow-hidden border border-line bg-brand text-content-inverse flex items-center justify-center font-semibold">{avatar ? <img src={avatar} alt="个人头像" className="w-full h-full object-cover" /> : (nickname.trim().charAt(0).toUpperCase() || 'U')}</div><label className="cursor-pointer px-3 py-2 rounded-lg border border-line bg-surface text-xs"><span>从本机选择图片</span><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={(e) => { const file = e.target.files?.[0]; if (!file || file.size > 2 * 1024 * 1024) return; const reader = new FileReader(); reader.onload = () => setAvatar(typeof reader.result === 'string' ? reader.result : ''); reader.readAsDataURL(file); }} /></label>{avatar && <button type="button" onClick={() => setAvatar('')} className="text-xs text-semantic-error">移除</button>}</div><p className="mt-1 text-[11px] text-content-tertiary">图片仅保存在本机浏览器，最大 2MB。</p></div>
        {mode === 'local' ? <div className="space-y-3">{[['LLM_BASE_URL','LLM URL'],['LLM_MODEL','LLM Model'],['LLM_API_KEY','LLM Key'],['ZHIHU_API_BASE_URL','知乎 API'],['ZHIHU_ACCESS_SECRET','知乎 Access Secret'],['SINK_BASE_URL','Sink API URL'],['SINK_API_KEY','Sink API Key'],['OBSIDIAN_VAULT_PATH','Obsidian Vault'],['SMTP_USER','SMTP 用户'],['SMTP_PASS','SMTP 密码'],['SMTP_HOST','SMTP 主机'],['SMTP_PORT','SMTP 端口'],['SMTP_FROM','发件地址']].map(([key,label]) => <label key={key} className="block text-xs text-content-secondary">{label}<input type={key.includes('KEY') || key.includes('SECRET') || key.includes('PASS') ? 'password' : 'text'} value={settings[key] ?? ''} onChange={(e) => setSettings((s) => ({ ...s, [key]: e.target.value }))} className="mt-1 w-full px-3 py-2 rounded-lg border border-line bg-surface text-sm" placeholder={settings[key] === 'configured' ? '已配置' : ''} /></label>)}<button type="button" onClick={() => void saveSettings()} className="w-full mt-2 py-2 rounded-lg bg-brand text-content-inverse text-sm">{saved ? '已保存' : '保存本地设置'}</button></div> : <p className="text-xs text-content-secondary">在线版仅支持账号设置；LLM、知乎、Sink、Obsidian 和邮箱配置请在本地版设置。</p>}
        <button type="button" onClick={async () => { setSettingsOpen(false); await logout(); }} className="mt-4 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-line text-xs text-semantic-error"><LogOut className="w-3.5 h-3.5" />退出登录</button>
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
          className="flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-full border border-line bg-surface-elevated hover:bg-surface-subtle transition-colors shadow-xs text-xs text-content-primary"
          aria-expanded={dropdownOpen}
          aria-haspopup="true"
        >
          <span className="w-6 h-6 rounded-full bg-brand text-content-inverse flex items-center justify-center font-bold text-[11px] select-none">
            {avatar ? <img src={avatar} alt="个人头像" className="w-full h-full object-cover rounded-full" /> : (user.name ? user.name.charAt(0).toUpperCase() : 'U')}
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
              {zhihuStatus?.authorized && (
                <p className="mt-1 text-[11px] text-brand truncate">已连接知乎{zhihuStatus.profile?.name ? `：${zhihuStatus.profile.name}` : ''}</p>
              )}
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
            <button type="button" onClick={() => { setDropdownOpen(false); setSettingsOpen(true); }} className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-content-secondary hover:bg-surface-subtle rounded-lg text-left"><Settings className="w-3.5 h-3.5" /><span>设置</span></button>
          </div>
        )}
        {settingsPanel}
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
