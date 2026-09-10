export interface SendEmailOptions {
  to: string;
  code: string;
}

export async function sendVerificationEmail({ to, code }: SendEmailOptions): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const fromEmail = process.env.RESEND_FROM_EMAIL?.trim() || 'auth@zhiyan.app';

  if (!apiKey) {
    // Development / Demo fallback: log code to server console
    console.log(`\n========================================`);
    console.log(`[Zhiyan Auth] Verification Code for ${to}: ${code}`);
    console.log(`========================================\n`);
    return { success: true };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [to],
        subject: `【知研】您的验证码是 ${code}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px;">
            <div style="margin-bottom: 24px;">
              <h2 style="margin: 0; color: #111827; font-size: 20px; font-weight: 600;">知研 · AI 思辨陪练</h2>
              <p style="margin: 4px 0 0 0; color: #6b7280; font-size: 14px;">让每一个观点经得起深度追问</p>
            </div>
            <div style="padding: 24px; background: #f9fafb; border-radius: 8px; text-align: center; margin-bottom: 24px;">
              <p style="margin: 0 0 12px 0; color: #374151; font-size: 15px;">您正在注册或绑定知研账号，您的验证码为：</p>
              <div style="font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #1d4ed8; font-family: monospace;">${code}</div>
              <p style="margin: 12px 0 0 0; color: #9ca3af; font-size: 13px;">验证码 10 分钟内有效，请勿泄露给他人。</p>
            </div>
            <p style="margin: 0; color: #9ca3af; font-size: 12px; border-top: 1px solid #f3f4f6; padding-top: 16px;">如果您未发起此操作，请忽略本邮件。</p>
          </div>
        `,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[Zhiyan Auth] Resend email failed:', errText);
      return { success: false, error: 'Failed to send email via Resend' };
    }

    return { success: true };
  } catch (err) {
    console.error('[Zhiyan Auth] Email send exception:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
