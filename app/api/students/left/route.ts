import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { withDateOnlyFields } from '@/lib/date-format';

/* ─────────────────────────────────────────
   GET /api/students/left
   Perf: paginated for the same reason as GET /api/students — this list
   only grows (every withdrawal adds a row, nothing ever removes one) and
   had no LIMIT, so it got slower to fetch/render every year.
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
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

    const [total, former_students] = await Promise.all([
      prisma.leftStudent.count(),
      prisma.leftStudent.findMany({
        orderBy: [{ left_date: 'desc' }, { roll_no: 'asc' }],
        ...(limit != null ? { take: limit, skip: (page - 1) * limit } : {}),
      }),
    ]);
    const shaped = former_students.map((s) =>
      withDateOnlyFields(s, ['admission_date', 'fee_start_month', 'left_date'])
    );
    return NextResponse.json({
      count: shaped.length,
      total,
      page,
      limit: limit ?? total,
      totalPages: limit != null ? Math.max(Math.ceil(total / limit), 1) : 1,
      former_students: shaped,
    });
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}
