import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import { prisma } from '@/lib/prisma';
import { authenticate, authorizeRoles } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { broadcast } from '@/lib/sse';
import { MANAGEABLE_ROLES } from '@/lib/permissions';
import { normalizeEmail } from '@/lib/password-reset';

/* ─────────────────────────────────────────
   POST /api/permissions/users/:role — ali only
   Body: { username, password, email? }
   Ported from routes/permissions.js `POST /users/:role`.

   Creates a new login account for a manageable role (admin, principal,
   vice_principal, accountant, viewer). Roles are no longer capped at
   one account each — ali can create as many accounts under a role as
   needed; every account for a role shares that role's permission and
   page-visibility settings, since those are keyed by role_name, not
   by user.

   NOTE: this route's dynamic segment is named [user_id] on disk (shared
   with the PUT handler below) purely because Next.js's App Router
   requires every route file at the same URL position to use the same
   param name — the original Express app has no such restriction
   (`router.post('/users/:role', ...)` and `router.put('/users/:user_id',
   ...)` coexisted fine as separate routers). The value received here is
   still a role slug (e.g. "admin"), not a numeric id; renamed to
   `roleParam` immediately below to avoid confusion. No behavior change.
───────────────────────────────────────── */
export async function POST(req: NextRequest, { params }: { params: Promise<{ user_id: string }> }) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = authorizeRoles(auth.user, 'ali');
  if (denied) return denied;

  try {
    const { user_id: roleParam } = await params;
    const role = String(roleParam || '').toLowerCase();
    const body = await req.json();
    const { username, password } = body;
    const rawEmail = body.email;

    if (!MANAGEABLE_ROLES.includes(role)) {
      return NextResponse.json({ error: `role must be one of: ${MANAGEABLE_ROLES.join(', ')}.` }, { status: 400 });
    }
    if (!username || !String(username).trim()) {
      return NextResponse.json({ error: 'username is required.' }, { status: 400 });
    }
    if (!password || password.length < 6) {
      return NextResponse.json(
        { error: 'password is required and must be at least 6 characters.' },
        { status: 400 }
      );
    }

    const dupe = await prisma.user.findUnique({ where: { username: username.trim() } });
    if (dupe) {
      return NextResponse.json({ error: `Username "${username}" is already taken.` }, { status: 409 });
    }

    // Optional email (used for OTP password reset).
    let email: string | null = null;
    if (rawEmail !== undefined && rawEmail !== null && String(rawEmail).trim() !== '') {
      email = normalizeEmail(rawEmail);
      if (!email) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
      const emailTaken = await prisma.user.findUnique({ where: { email }, select: { user_id: true } });
      if (emailTaken) return NextResponse.json({ error: 'That email is already used by another account.' }, { status: 409 });
    }

    // Make sure the role exists (roles for vice_principal/accountant were
    // added by later migrations; no-op if it's already there).
    const roleRow = await prisma.role.upsert({
      where: { role_name: role },
      create: { role_name: role },
      update: {},
    });

    const hash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        username: username.trim(),
        password_hash: hash,
        role_id: roleRow.role_id,
        email,
        is_active: true,
      },
      select: { user_id: true, username: true, email: true, is_active: true },
    });

    broadcast('permissions.changed', { action: 'user_created', role });
    return NextResponse.json({ message: 'Account created.', user }, { status: 201 });
  } catch (err) {
    return handleApiError(err, 'POST');
  }
}

/* ─────────────────────────────────────────
   PUT /api/permissions/users/:user_id — ali only
   Body: { username }
   Ported from routes/permissions.js `PUT /users/:user_id`.

   ali renames an existing admin/principal/vice_principal/accountant/
   viewer account's username. Each manageable role corresponds to
   exactly one login account, so this is a rename, not account creation
   — the role itself is the identity. Password changes go through
   POST /users/:user_id/password instead.
───────────────────────────────────────── */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ user_id: string }> }) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = authorizeRoles(auth.user, 'ali');
  if (denied) return denied;

  try {
    const { user_id } = await params;
    const userId = parseInt(user_id, 10);
    const body = await req.json();
    const { username } = body;
    const rawEmail = body.email; // undefined = leave unchanged, '' = remove

    if (!username || !String(username).trim()) {
      return NextResponse.json({ error: 'username is required.' }, { status: 400 });
    }

    const target = await prisma.user.findUnique({
      where: { user_id: userId },
      select: { user_id: true, role: { select: { role_name: true } } },
    });
    if (!target) return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    if (!target.role || !MANAGEABLE_ROLES.includes(String(target.role.role_name).toLowerCase())) {
      return NextResponse.json({ error: 'Can only edit admin, principal, or viewer accounts.' }, { status: 403 });
    }

    const dupe = await prisma.user.findFirst({
      where: { username: username.trim(), user_id: { not: userId } },
      select: { user_id: true },
    });
    if (dupe) {
      return NextResponse.json({ error: `Username "${username}" is already taken.` }, { status: 409 });
    }

    const data: { username: string; email?: string | null } = { username: username.trim() };
    if (rawEmail !== undefined) {
      if (rawEmail === null || String(rawEmail).trim() === '') {
        data.email = null;
      } else {
        const email = normalizeEmail(rawEmail);
        if (!email) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
        const emailTaken = await prisma.user.findFirst({
          where: { email, user_id: { not: userId } },
          select: { user_id: true },
        });
        if (emailTaken) return NextResponse.json({ error: 'That email is already used by another account.' }, { status: 409 });
        data.email = email;
      }
    }

    const user = await prisma.user.update({
      where: { user_id: userId },
      data,
      select: { user_id: true, username: true, email: true, role_id: true, is_active: true },
    });

    broadcast('permissions.changed', { action: 'user_updated', user_id: userId });
    return NextResponse.json({ message: 'Username updated.', user });
  } catch (err) {
    return handleApiError(err, 'PUT');
  }
}
