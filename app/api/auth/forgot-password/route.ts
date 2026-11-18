import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { handleApiError } from '@/lib/apiHandler';
import { sendMail } from '@/lib/mailer';
import {
  generateOtp,
  hashOtp,
  otpEmail,
  OTP_TTL_MINUTES,
  OTP_RESEND_COOLDOWN_SECONDS,
} from '@/lib/password-reset';

/* ─────────────────────────────────────────
   POST /api/auth/forgot-password — public
   Body: { identifier }   (username or email)
   Emails a 6-digit OTP to the account's email, if it has one.
   Always returns the same response so the endpoint can't be used to
   discover which usernames/emails exist.
───────────────────────────────────────── */
const GENERIC = {
  message: 'If an account with a registered email exists, a verification code has been sent to it.',
};

export async function POST(req: NextRequest) {
  try {
    const { identifier } = await req.json();
    const id = String(identifier || '').trim();
    if (!id) {
      return NextResponse.json({ error: 'Enter your username or email.' }, { status: 400 });
    }

    const user = await prisma.user.findFirst({
      where: { OR: [{ username: id }, { email: id.toLowerCase() }] },
      select: { user_id: true, username: true, email: true, is_active: true },
    });

    if (user && user.email && user.is_active) {
      const recent = await prisma.passwordReset.findFirst({
        where: {
          user_id: user.user_id,
          created_at: { gt: new Date(Date.now() - OTP_RESEND_COOLDOWN_SECONDS * 1000) },
        },
        select: { id: true },
      });

      if (!recent) {
        const otp = generateOtp();
        await prisma.passwordReset.deleteMany({ where: { user_id: user.user_id } });
        await prisma.passwordReset.create({
          data: {
            user_id: user.user_id,
            otp_hash: hashOtp(user.user_id, otp),
            expires_at: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
          },
        });
        try {
          await sendMail({ to: user.email, ...otpEmail(user.username, otp) });
        } catch {
          console.error('Password reset email failed for user', user.user_id);
        }
      }
    }

    return NextResponse.json(GENERIC);
  } catch (err) {
    return handleApiError(err, 'POST');
  }
}
