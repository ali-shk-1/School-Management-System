import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';

/* ─────────────────────────────────────────
   GET /api/fees/receipts — optional ?from=&to=&search=
   Ported from routes/fees.js `GET /receipts`.
   Row-wise listing of every receipt ever issued — used by the Receipts
   nav page so front-desk staff can verify "is receipt #N legit?".
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const { searchParams } = req.nextUrl;
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const search = searchParams.get('search');

    // Perf: pagination, same reasoning as GET /api/students — this table
    // only ever grows (every receipt issued, forever) and had no LIMIT,
    // so an unfiltered open of the Receipts page pulled every receipt
    // ever printed, joined against students, on every request.
    const DEFAULT_LIMIT = 100;
    const MAX_LIMIT = 1000;
    const rawLimit = searchParams.get('limit');
    const rawPage = searchParams.get('page');
    const unbounded = rawLimit === '0';
    const limit = unbounded
      ? undefined
      : Math.min(Math.max(parseInt(rawLimit || '', 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const page = Math.max(parseInt(rawPage || '1', 10) || 1, 1);
    const offset = limit != null ? (page - 1) * limit : 0;

    const conditions: any[] = [];
    // Perf: DATE(pr.issued_at) >= ... wraps the column in a function,
    // which Postgres can't use the payment_receipts(issued_at) index
    // for — it forced a full table scan on every date-filtered search,
    // same anti-pattern already fixed elsewhere (see dashboard route
    // comment). Rewritten to sargable half-open ranges so the index
    // added in Migration-by-Ali/006 is actually used.
    if (from) conditions.push(Prisma.sql`AND pr.issued_at >= ${from}::DATE`);
    if (to) conditions.push(Prisma.sql`AND pr.issued_at < (${to}::DATE + INTERVAL '1 day')`);
    if (search) {
      const like = `%${search.toLowerCase()}%`;
      // Matches the same fields the page's client-side search used to
      // cover (receipt #, roll no., name, class, section, issued_by) —
      // now done in SQL so it searches the full history, not just
      // whatever page of rows happened to already be loaded.
      conditions.push(Prisma.sql`AND (
        LOWER(pr.student_name) LIKE ${like} OR
        CAST(pr.roll_no AS TEXT) LIKE ${like} OR
        CAST(pr.receipt_no AS TEXT) LIKE ${like} OR
        LOWER(pr.class) LIKE ${like} OR
        LOWER(pr.section) LIKE ${like} OR
        LOWER(pr.issued_by) LIKE ${like}
      )`);
    }
    const whereExtra = conditions.length ? Prisma.join(conditions, ' ', ' ') : Prisma.empty;

    const [totalRow, rows] = await Promise.all([
      prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) AS count
        FROM payment_receipts pr
        WHERE 1=1 ${whereExtra}
      `,
      prisma.$queryRaw<any[]>`
        SELECT pr.receipt_no, pr.payment_id, pr.student_id, pr.roll_no,
               pr.student_name, pr.class, pr.section, pr.academic_month,
               pr.amount_due, pr.amount_paid, pr.print_mode, pr.issued_at, pr.issued_by,
               s.photo_url
        FROM payment_receipts pr
        LEFT JOIN students s ON s.student_id = pr.student_id
        WHERE 1=1
        ${whereExtra}
        ORDER BY pr.receipt_no DESC
        ${limit != null ? Prisma.sql`LIMIT ${limit} OFFSET ${offset}` : Prisma.empty}
      `,
    ]);
    const total = Number(totalRow[0].count);

    return NextResponse.json({
      count: rows.length,
      total,
      page,
      limit: limit ?? total,
      totalPages: limit != null ? Math.max(Math.ceil(total / limit), 1) : 1,
      receipts: rows,
    });
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}
