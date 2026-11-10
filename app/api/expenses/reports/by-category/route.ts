import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';

/* ─────────────────────────────────────────
   GET /api/expenses/reports/by-category — ?month=YYYY-MM (or ?from=&to=)
   Ported from routes/expenses.js `GET /reports/by-category`.
   month takes precedence; from/to only applies if BOTH are supplied
   (matches original's `else if (from && to)` — a lone from or to is
   silently ignored, same as before).
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const { searchParams } = req.nextUrl;
    const month = searchParams.get('month');
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    let dateFilter: Prisma.Sql = Prisma.empty;
    if (month) {
      // Perf: rewritten from DATE_TRUNC(...) = DATE_TRUNC(...) to a
      // sargable half-open range so the new expenses(created_at) index
      // can be used instead of a full table scan.
      const monthStart = `${month}-01`;
      dateFilter = Prisma.sql`AND e.created_at >= ${monthStart}::DATE AND e.created_at < ${monthStart}::DATE + INTERVAL '1 month'`;
    } else if (from && to) {
      dateFilter = Prisma.sql`AND e.created_at >= ${from}::DATE AND e.created_at < (${to}::DATE + INTERVAL '1 day')`;
    }

    const rows = await prisma.$queryRaw<any[]>`
      SELECT
        ec.category_name,
        COUNT(*) AS transaction_count,
        SUM(e.amount) AS total_amount
      FROM expenses e
      LEFT JOIN expense_categories ec ON ec.category_id = e.category_id
      WHERE 1=1 ${dateFilter}
      GROUP BY ec.category_name
      ORDER BY total_amount DESC
    `;

    const shaped = rows.map((r) => ({
      ...r,
      transaction_count: parseInt(r.transaction_count.toString(), 10),
    }));

    return NextResponse.json(shaped);
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}
