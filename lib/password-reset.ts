import crypto from 'crypto';

export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns a normalized (trimmed, lowercase) email, or null if invalid. */
export function normalizeEmail(raw: unknown): string | null {
  const e = String(raw ?? '').trim().toLowerCase();
  if (!e || e.length > 255 || !EMAIL_RE.test(e)) return null;
  return e;
}

/** Cryptographically secure 6-digit code. */
export function generateOtp(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashOtp(userId: number, otp: string): string {
  const secret = process.env.JWT_SECRET || '';
  return crypto.createHmac('sha256', secret).update(`${userId}:${otp}`).digest('hex');
}

export function otpMatches(userId: number, otp: string, storedHash: string): boolean {
  const a = Buffer.from(hashOtp(userId, otp), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function otpEmail(username: string, otp: string) {
  const subject = 'Your password reset code';
  const text =
    `Hello ${username},\n\n` +
    `Your password reset code is: ${otp}\n\n` +
    `It expires in ${OTP_TTL_MINUTES} minutes. If you did not request this, ignore this email.`;
  const html =
    `<p>Hello <b>${escapeHtml(username)}</b>,</p>` +
    `<p>Your password reset code is:</p>` +
    `<p style="font-size:28px;letter-spacing:6px;font-weight:700">${otp}</p>` +
    `<p>It expires in ${OTP_TTL_MINUTES} minutes. If you did not request this, you can ignore this email.</p>`;
  return { subject, text, html };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
