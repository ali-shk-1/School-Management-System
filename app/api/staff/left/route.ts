import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { withDateOnlyFields } from '@/lib/date-format';

/* ─────────────────────────────────────────
   GET /api/staff/left
   Ported from routes/staff.js `GET /left`.
   NOTE: this route must be registered before /api/staff/[id] would
   otherwise swallow it — in Next.js App Router this is automatic since
   /left is a static segment and takes priority over [id], no ordering
   trick needed (unlike the original Express router).
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    // Perf: same pagination as GET /api/students/left — low volume today
    // (staff turnover is slow), but the list only grows and had no cap.
    const { searchParams } = req.nextUrl;
    const DEFAULT_LIMIT = 100;
    const MAX_LIMIT = 1000;
    const rawLimit = searchParams.get('limit');
    const rawPage = searchParams.get('page');
    const unbounded = rawLimit === '0';
    const limit = unbounded
      ? undefined
      : Math.min(Math.max(parseInt(rawLimit || '', 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const page = Math.max(parseInt(rawPage || '1', 10) || 1, 1);

    const [total, formerStaff] = await Promise.all([
      prisma.leftStaff.count(),
      prisma.leftStaff.findMany({
        orderBy: [{ left_date: 'desc' }, { name: 'asc' }],
        ...(limit != null ? { take: limit, skip: (page - 1) * limit } : {}),
      }),
    ]);
    const shaped = formerStaff.map((s) =>
      withDateOnlyFields(
        { ...s, salary: s.salary == null ? null : Number(s.salary) },
        ['left_date']
      )
    );
    return NextResponse.json({
      count: shaped.length,
      total,
      page,
      limit: limit ?? total,
      totalPages: limit != null ? Math.max(Math.ceil(total / limit), 1) : 1,
      former_staff: shaped,
    });
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}
