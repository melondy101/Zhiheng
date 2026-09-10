import { NextResponse } from 'next/server';
import { getUserStore } from '@/lib/auth';
import { sendVerificationEmail } from '@/lib/auth/email';

export const runtime = 'nodejs';

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generateNumericCode(length: number = 6): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += Math.floor(Math.random() * 10).toString();
  }
  return code;
}

export async function POST(request: Request) {
  try {
    const clientIp =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      '127.0.0.1';

    let body: { email?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: '无效的 JSON 请求体' }, { status: 400 });
    }

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ error: '请输入有效的邮箱地址' }, { status: 400 });
    }

    const store = await getUserStore();

    // 1. IP rate limiting (max 5 requests per 60s)
    const ipAllowed = await store.checkRateLimit(clientIp, 'send_code', 60, 5);
    if (!ipAllowed) {
      return NextResponse.json(
        { error: '请求过于频繁，请 60 秒后再试' },
        { status: 429 }
      );
    }
    await store.recordAuthAttempt(clientIp, 'send_code');

    // 2. Email cooldown (60s)
    const existing = await store.getVerificationCode(email);
    if (existing) {
      const timeElapsed = Date.now() - existing.createdAt;
      if (timeElapsed < 60_000) {
        const remainingSeconds = Math.ceil((60_000 - timeElapsed) / 1000);
        return NextResponse.json(
          { error: `发送过于频繁，请等待 ${remainingSeconds} 秒后再试` },
          { status: 429 }
        );
      }
    }

    // 3. Generate 6-digit code with 10-min expiration
    const code = generateNumericCode(6);
    const expiresAt = Date.now() + 10 * 60 * 1000;
    await store.saveVerificationCode(email, code, expiresAt);

    // 4. Send email
    const emailResult = await sendVerificationEmail({ to: email, code });
    if (!emailResult.success) {
      return NextResponse.json({ error: emailResult.error || '验证码邮件发送失败' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      message: emailResult.message || '验证码已发送至您的邮箱，10 分钟内有效',
    });
  } catch (err) {
    console.error('[auth/send-code] error:', err);
    return NextResponse.json({ error: '服务繁忙，请稍后再试' }, { status: 500 });
  }
}
