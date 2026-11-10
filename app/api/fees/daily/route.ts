import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';

/* ─────────────────────────────────────────
   GET /api/fees/daily?date=YYYY-MM-DD
   Ported from routes/fees.js `GET /daily`.
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const date = req.nextUrl.searchParams.get('date') || new Date().toISOString().slice(0, 10);

    // Perf: DATE(fp.payment_date) = ... wraps the column and blocks
    // index use; rewritten to a sargable half-open range instead.
    // father_name added for the daily-collection print sheet (Student /
    // Father / Class-Section / Month / Amount Due / Paid / Balance on
    // paper) — it was already on `students` but not previously selected
    // here. `balance` is computed in SQL rather than left for the
    // client to derive, matching the convention used elsewhere (e.g.
    // app/api/fees/route.ts's `month_totals.amount_due - month_totals.
    // amount_paid`) so the printed sheet's numbers can never drift from
    // what the rest of the app considers the balance for that row.
    const rows = await prisma.$queryRaw<any[]>`
      SELECT fp.payment_id, fp.student_id, fp.academic_month, fp.amount_due, fp.amount_paid,
             (fp.amount_due - fp.amount_paid) AS balance,
             fp.payment_date, s.first_name, s.last_name, s.class, s.section, s.gender, s.photo_url,
             s.father_name,
             pr.receipt_no
      FROM fee_payments fp
      JOIN students s ON s.student_id = fp.student_id
      LEFT JOIN payment_receipts pr ON pr.payment_id = fp.payment_id
      WHERE fp.payment_date >= ${date}::DATE
        AND fp.payment_date <  ${date}::DATE + INTERVAL '1 day'
      ORDER BY fp.payment_date DESC
    `;

    return NextResponse.json({ count: rows.length, payments: rows });
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}
