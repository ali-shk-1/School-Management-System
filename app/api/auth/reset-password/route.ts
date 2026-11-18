import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import { prisma } from '@/lib/prisma';
import { handleApiError } from '@/lib/apiHandler';
import { otpMatches, OTP_MAX_ATTEMPTS } from '@/lib/password-reset';

/* ─────────────────────────────────────────
   POST /api/auth/reset-password — public
   Body: { identifier, otp, new_password }
   Verifies the emailed OTP (10 min expiry, max 5 wrong tries) and sets
   the new password. Every failure returns the same generic message.
───────────────────────────────────────── */
export async function POST(req: NextRequest) {
  try {
    const { identifier, otp, new_password } = await req.json();
    const id = String(identifier || '').trim();
    const code = String(otp || '').trim();

    if (!id || !code || !new_password) {
      return NextResponse.json({ error: 'Username/email, code and new password are required.' }, { status: 400 });
    }
    if (String(new_password).length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
    }

    const bad = () => NextResponse.json({ error: 'Invalid or expired code.' }, { status: 400 });

    const user = await prisma.user.findFirst({
      where: { OR: [{ username: id }, { email: id.toLowerCase() }] },
      select: { user_id: true, is_active: true },
    });
    if (!user || !user.is_active) return bad();

    const reset = await prisma.passwordReset.findFirst({
      where: { user_id: user.user_id },
      orderBy: { created_at: 'desc' },
    });
    if (!reset) return bad();

    if (reset.expires_at.getTime() < Date.now() || reset.attempts >= OTP_MAX_ATTEMPTS) {
      await prisma.passwordReset.deleteMany({ where: { user_id: user.user_id } });
      return bad();
    }

    if (!/^\d{6}$/.test(code) || !otpMatches(user.user_id, code, reset.otp_hash)) {
      await prisma.passwordReset.update({ where: { id: reset.id }, data: { attempts: { increment: 1 } } });
      return bad();
    }

    const hash = await bcrypt.hash(String(new_password), 12);
    await prisma.$transaction([
      prisma.user.update({ where: { user_id: user.user_id }, data: { password_hash: hash } }),
      prisma.passwordReset.deleteMany({ where: { user_id: user.user_id } }),
    ]);

    return NextResponse.json({ message: 'Password reset successfully. You can now sign in.' });
  } catch (err) {
    return handleApiError(err, 'POST');
  }
}
