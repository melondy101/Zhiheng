import nodemailer from 'nodemailer';

export interface SendEmailOptions {
  to: string;
  code: string;
}

function inferSmtpHost(user: string): { host: string; port: number; secure: boolean } {
  const lower = user.toLowerCase();
  if (lower.endsWith('@qq.com') || lower.endsWith('@foxmail.com')) {
    return { host: 'smtp.qq.com', port: 465, secure: true };
  }
  if (lower.endsWith('@163.com')) {
    return { host: 'smtp.163.com', port: 465, secure: true };
  }
  if (lower.endsWith('@126.com')) {
    return { host: 'smtp.126.com', port: 465, secure: true };
  }
  if (lower.endsWith('@gmail.com')) {
    return { host: 'smtp.gmail.com', port: 465, secure: true };
  }
  if (lower.endsWith('@outlook.com') || lower.endsWith('@hotmail.com')) {
    return { host: 'smtp-mail.outlook.com', port: 587, secure: false };
  }
  return { host: 'smtp.qq.com', port: 465, secure: true };
}

export async function sendVerificationEmail({ to, code }: SendEmailOptions): Promise<{ success: boolean; error?: string; message?: string }> {
  const smtpUser = process.env.SMTP_USER?.trim();
  const smtpPass = process.env.SMTP_PASS?.trim();
  const resendApiKey = process.env.RESEND_API_KEY?.trim();

  // In test environment or synthetic test domains, or neither SMTP nor Resend configured:
  if (
    process.env.NODE_ENV === 'test' ||
    to.endsWith('@example.com') ||
    to.endsWith('@test.com') ||
    to.endsWith('.local') ||
    (!smtpUser && !resendApiKey)
  ) {
    console.log(`\n========================================`);
    console.log(`[Zhiyan Auth] Verification Code for ${to}: ${code}`);
    console.log(`========================================\n`);
    return { success: true };
  }

  const subject = `【知研】您的验证码是 ${code}`;
  const html = `
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
  `;

  // 1. SMTP Transport (No custom domain required - works with QQ/163/Gmail etc.)
  if (smtpUser && smtpPass) {
    try {
      const inferred = inferSmtpHost(smtpUser);
      const host = process.env.SMTP_HOST?.trim() || inferred.host;
      const port = Number(process.env.SMTP_PORT?.trim()) || inferred.port;
      const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465;
      const from = process.env.SMTP_FROM?.trim() || `知研 <${smtpUser}>`;

      const transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
      });

      await transporter.sendMail({
        from,
        to,
        subject,
        html,
      });

      return { success: true };
    } catch (smtpErr) {
      console.error('[Zhiyan Auth] SMTP email send failed:', smtpErr);
      return { success: false, error: smtpErr instanceof Error ? smtpErr.message : 'SMTP send failed' };
    }
  }

  // 2. Resend API Transport
  if (resendApiKey) {
    try {
      const rawFrom = process.env.RESEND_FROM_EMAIL?.trim() || 'onboarding@resend.dev';
      const fromEmail = rawFrom.includes('<') ? rawFrom : `知研 <${rawFrom}>`;

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${resendApiKey}`,
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [to],
          subject,
          html,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();

        // Graceful fallback for Resend unverified domain / sandbox limitation
        if (
          response.status === 403 &&
          (errText.includes('testing emails') || errText.includes('validation_error') || errText.includes('verify a domain'))
        ) {
          console.log(`\n========================================`);
          console.log(`[Zhiyan Auth] Resend Sandbox Mode (Unverified Domain):`);
          console.log(`Target Email: ${to}`);
          console.log(`Verification Code: ${code}`);
          console.log(`Notice: In Resend free sandbox mode, emails to unverified recipients are logged in server console.`);
          console.log(`========================================\n`);
          return {
            success: true,
            message: `测试沙盒验证码：${code}`,
          };
        }

        console.error('[Zhiyan Auth] Resend email failed:', errText);
        return { success: false, error: 'Failed to send email via Resend' };
      }

      return { success: true };
    } catch (err) {
      console.error('[Zhiyan Auth] Email send exception:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }

  return { success: true };
}
