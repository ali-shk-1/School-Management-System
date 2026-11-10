import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, authorizeRoles } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { broadcast } from '@/lib/sse';
import { MANAGEABLE_ROLES } from '@/lib/permissions';

/* ─────────────────────────────────────────
   PUT /api/permissions/role/:role/name — ali only
   Body: { display_name }

   Renames the display label shown for a role on the Permissions page
   (and anywhere else that reads roles.display_name) without touching
   role_name — the stable slug used everywhere else in the schema
   (role_permissions.role_name, role_page_visibility.role_name, the
   user's role relation, JWT claims, etc). This is purely cosmetic:
   "accountant" can be relabeled "Finance Officer" while every
   permission/visibility row and every authorize('accountant') check
   in the codebase keeps working unchanged.

   Pass an empty/blank display_name to clear the override and fall back
   to the built-in default label again.
───────────────────────────────────────── */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ role: string }> }) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = authorizeRoles(auth.user, 'ali');
  if (denied) return denied;

  try {
    const { role: roleParam } = await params;
    const role = String(roleParam || '').toLowerCase();
    const body = await req.json();
    const raw = body?.display_name;

    if (!MANAGEABLE_ROLES.includes(role)) {
      return NextResponse.json({ error: `role must be one of: ${MANAGEABLE_ROLES.join(', ')}.` }, { status: 400 });
    }
    if (raw !== undefined && raw !== null && typeof raw !== 'string') {
      return NextResponse.json({ error: 'display_name must be a string.' }, { status: 400 });
    }

    const trimmed = String(raw || '').trim();
    if (trimmed.length > 50) {
      return NextResponse.json({ error: 'display_name must be 50 characters or fewer.' }, { status: 400 });
    }

    const roleRow = await prisma.role.upsert({
      where: { role_name: role },
      create: { role_name: role, display_name: trimmed || null },
      update: { display_name: trimmed || null },
      select: { role_name: true, display_name: true },
    });

    broadcast('permissions.changed', { action: 'role_renamed', role });
    return NextResponse.json({
      message: trimmed ? 'Role name updated.' : 'Role name reset to default.',
      role: roleRow.role_name,
      display_name: roleRow.display_name,
    });
  } catch (err) {
    return handleApiError(err, 'PUT');
  }
}
