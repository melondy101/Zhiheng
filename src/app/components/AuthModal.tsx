'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, Mail, Lock, User, ShieldCheck, CheckCircle2, AlertCircle, ArrowRight, Loader2 } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  initialTab?: 'login' | 'register';
  onClose: () => void;
  onLogin: (email: string, password: string, migrateCurrentGuest?: boolean) => Promise<{ ok: boolean; error?: string }>;
  onRegister: (email: string, password: string, code: string, name?: string) => Promise<{ ok: boolean; error?: string }>;
  onSendCode: (email: string) => Promise<{ ok: boolean; error?: string; message?: string }>;
  isGuest: boolean;
}

export function AuthModal({
  isOpen,
  initialTab = 'register',
  onClose,
  onLogin,
  onRegister,
  onSendCode,
  isGuest,
}: AuthModalProps) {
  const [tab, setTab] = useState<'login' | 'register'>(initialTab);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [migrateGuest, setMigrateGuest] = useState(true);

  const [countdown, setCountdown] = useState(0);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    setTab(initialTab);
    setErrorMsg(null);
    setSuccessMsg(null);
  }, [initialTab, isOpen]);

  // Handle countdown timer
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSendCode = async () => {
    if (!email || !email.includes('@')) {
      setErrorMsg('请输入正确的邮箱地址');
      return;
    }
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsSendingCode(true);

    try {
      const res = await onSendCode(email);
      if (res.ok) {
        setSuccessMsg(res.message || '验证码已发送至您的邮箱');
        setCountdown(60);
      } else {
        setErrorMsg(res.error || '验证码发送失败');
      }
    } catch {
      setErrorMsg('网络异常，请稍后再试');
    } finally {
      setIsSendingCode(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsSubmitting(true);

    try {
      if (tab === 'register') {
        if (!email || !email.includes('@')) {
          setErrorMsg('请输入正确的邮箱地址');
          setIsSubmitting(false);
          return;
        }
        if (!code || code.length !== 6) {
          setErrorMsg('请输入 6 位数字验证码');
          setIsSubmitting(false);
          return;
        }
        if (!password || password.length < 6) {
          setErrorMsg('密码长度不能少于 6 位');
          setIsSubmitting(false);
          return;
        }

        const res = await onRegister(email, password, code, name);
        if (!res.ok) {
          setErrorMsg(res.error || '注册失败');
        }
      } else {
        if (!email || !password) {
          setErrorMsg('请输入邮箱和密码');
          setIsSubmitting(false);
          return;
        }

        const res = await onLogin(email, password, migrateGuest);
        if (!res.ok) {
          setErrorMsg(res.error || '登录失败，请检查账号密码');
        }
      }
    } catch {
      setErrorMsg('网络异常，请稍后重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      id="auth-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="auth-modal-card"
        className="relative w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 p-6 md:p-8 overflow-hidden text-zinc-900 dark:text-zinc-100 transition-all scale-100"
      >
        {/* Close Button */}
        <button
          id="auth-modal-close-btn"
          type="button"
          onClick={onClose}
          className="absolute top-5 right-5 p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          aria-label="关闭弹窗"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-600/10 text-blue-600 dark:text-blue-400 font-bold text-lg">
              研
            </span>
            <h2 className="text-xl font-bold tracking-tight">
              {tab === 'register' ? (isGuest ? '转正注册 · 保留数据' : '注册知研账号') : '登录知研账号'}
            </h2>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {tab === 'register'
              ? isGuest
                ? '注册后自动接管当前访客的所有思辨记录、认知图谱与生成报告，跨设备不丢失。'
                : '开启属于您的深度思辨与批判性思维陪练之旅。'
              : '登录后即可访问您名下的完整思维轨迹与深度追问档案。'}
          </p>
        </div>

        {/* Tabs */}
        <div className="flex rounded-lg bg-zinc-100 dark:bg-zinc-800 p-1 mb-6">
          <button
            id="auth-tab-register-btn"
            type="button"
            onClick={() => {
              setTab('register');
              setErrorMsg(null);
            }}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
              tab === 'register'
                ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'
            }`}
          >
            {isGuest ? '注册 / 一键转正' : '注册新账号'}
          </button>
          <button
            id="auth-tab-login-btn"
            type="button"
            onClick={() => {
              setTab('login');
              setErrorMsg(null);
            }}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
              tab === 'login'
                ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'
            }`}
          >
            账号登录
          </button>
        </div>

        {/* Alert Messages */}
        {errorMsg && (
          <div className="mb-4 flex items-start gap-2.5 p-3 rounded-lg bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 text-xs border border-red-200 dark:border-red-900/50">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="flex-1 leading-relaxed">{errorMsg}</span>
          </div>
        )}
        {successMsg && (
          <div className="mb-4 flex items-start gap-2.5 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 text-xs border border-emerald-200 dark:border-emerald-900/50">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="flex-1 leading-relaxed">{successMsg}</span>
          </div>
        )}

        {/* Auth Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email field */}
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              电子邮箱
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                id="auth-input-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full pl-9 pr-3 py-2 text-xs bg-white dark:bg-zinc-800/80 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 transition"
              />
            </div>
          </div>

          {/* Register-only: Name and Verification Code */}
          {tab === 'register' && (
            <>
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  用户昵称 <span className="text-zinc-400 font-normal">(选填)</span>
                </label>
                <div className="relative">
                  <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input
                    id="auth-input-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="如：苏格拉底的学徒"
                    className="w-full pl-9 pr-3 py-2 text-xs bg-white dark:bg-zinc-800/80 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  邮箱验证码
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <ShieldCheck className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input
                      id="auth-input-code"
                      type="text"
                      maxLength={6}
                      required
                      value={code}
                      onChange={(e) => setCode(e.target.value.trim())}
                      placeholder="6 位验证码"
                      className="w-full pl-9 pr-3 py-2 text-xs bg-white dark:bg-zinc-800/80 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 font-mono tracking-wider transition"
                    />
                  </div>
                  <button
                    id="auth-btn-send-code"
                    type="button"
                    disabled={isSendingCode || countdown > 0}
                    onClick={handleSendCode}
                    className="px-3 py-2 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/40 disabled:opacity-50 disabled:cursor-not-allowed border border-blue-200 dark:border-blue-800/60 rounded-lg shrink-0 transition"
                  >
                    {isSendingCode ? (
                      <span className="flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> 发送中
                      </span>
                    ) : countdown > 0 ? (
                      `${countdown}s 后重发`
                    ) : (
                      '获取验证码'
                    )}
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Password field */}
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              {tab === 'register' ? '设置密码 (至少 6 位)' : '账号密码'}
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                id="auth-input-password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-9 pr-3 py-2 text-xs bg-white dark:bg-zinc-800/80 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 transition"
              />
            </div>
          </div>

          {/* Login tab: merge guest checkbox */}
          {tab === 'login' && isGuest && (
            <div className="flex items-center gap-2 pt-1">
              <input
                id="auth-checkbox-migrate"
                type="checkbox"
                checked={migrateGuest}
                onChange={(e) => setMigrateGuest(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-zinc-300 text-blue-600 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800"
              />
              <label htmlFor="auth-checkbox-migrate" className="text-xs text-zinc-600 dark:text-zinc-400 select-none">
                将当前访客思辨记录合并到该账号
              </label>
            </div>
          )}

          {/* Submit button */}
          <button
            id="auth-btn-submit"
            type="submit"
            disabled={isSubmitting}
            className="w-full mt-2 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs rounded-lg shadow-sm hover:shadow transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> 处理中...
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                {tab === 'register' ? (isGuest ? '确认转正并保留数据' : '完成注册') : '立即登录'}
                <ArrowRight className="w-3.5 h-3.5" />
              </span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
