import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';

/* ─────────────────────────────────────────
   GET /api/fees/balance-sheet/yearly?year=YYYY
   Ported from routes/fees.js `GET /balance-sheet/yearly`.
   One row per MONTH; each month's totals are independent (do NOT
   accumulate across months, same as monthly view resetting each month).

   Fee income here is on the DEPOSITED basis (payment_date, falling back
   to academic_month for legacy rows with no payment_date) — real cash
   received that month, not which month's bill it was for.
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const year = req.nextUrl.searchParams.get('year') || String(new Date().getFullYear());
    const yearInt = parseInt(year, 10);
    const yearStart = `${yearInt}-01-01`;
    const yearEndExclusive = `${yearInt + 1}-01-01`;

    // Perf: rewritten from EXTRACT(YEAR FROM ...) = ... (blocks index
    // use entirely) to sargable ranges on the calendar year, split
    // across the payment_date/academic_month COALESCE branches for
    // fee_payments so the academic_month index can still be used.
    const rows = await prisma.$queryRaw<any[]>`
      WITH months AS (
        SELECT generate_series(
          MAKE_DATE(${yearInt}::int, 1, 1),
          MAKE_DATE(${yearInt}::int, 12, 1),
          INTERVAL '1 month'
        )::date AS month_date
      ),
      fee_by_month AS (
        SELECT DATE_TRUNC('month', COALESCE(payment_date, academic_month))::date AS month_date,
               SUM(amount_paid) AS fee
        FROM fee_payments
        WHERE (payment_date >= ${yearStart}::DATE AND payment_date < ${yearEndExclusive}::DATE)
           OR (payment_date IS NULL AND academic_month >= ${yearStart}::DATE AND academic_month < ${yearEndExclusive}::DATE)
        GROUP BY DATE_TRUNC('month', COALESCE(payment_date, academic_month))
      ),
      expense_by_month AS (
        SELECT DATE_TRUNC('month', created_at)::date AS month_date,
               SUM(amount) AS expense
        FROM expenses
        WHERE created_at >= ${yearStart}::DATE AND created_at < ${yearEndExclusive}::DATE
        GROUP BY DATE_TRUNC('month', created_at)
      )
      SELECT
        TO_CHAR(m.month_date, 'Mon YYYY') AS month_label,
        m.month_date,
        COALESCE(f.fee, 0)      AS fee,
        COALESCE(e.expense, 0)  AS expense,
        COALESCE(f.fee, 0)      AS total_fee,
        COALESCE(e.expense, 0)  AS total_expense,
        (COALESCE(f.fee, 0) - COALESCE(e.expense, 0)) AS balance,
        (COALESCE(f.fee, 0) - COALESCE(e.expense, 0)) AS t_balance
      FROM months m
      LEFT JOIN fee_by_month f ON f.month_date = m.month_date
      LEFT JOIN expense_by_month e ON e.month_date = m.month_date
      ORDER BY m.month_date
    `;

    const totals = rows.reduce(
      (acc, r) => {
        acc.fee += Number(r.fee) || 0;
        acc.expense += Number(r.expense) || 0;
        return acc;
      },
      { fee: 0, expense: 0 }
    );
    (totals as any).balance = totals.fee - totals.expense;

    return NextResponse.json({ year: yearInt, months: rows, totals });
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}
