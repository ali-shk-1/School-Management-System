import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';

/* ─────────────────────────────────────────
   GET /api/dashboard
   Ported from routes/dashboard.js `GET /`.

   Runs all KPI/chart queries concurrently (Promise.all), same as the
   original's parallel pool.query calls. Kept as raw SQL throughout since
   every query here is an aggregate (COUNT/SUM with conditional
   DATE_TRUNC filters) that the query builder can't express cleanly, and
   consistency with the /api/fees defaulters logic (see comment below)
   matters more than query-builder purity.
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const currentMonth = `${new Date().toISOString().slice(0, 7)}-01`;
    const currentYear = new Date().getFullYear();
    const yearStart = `${currentYear}-01-01`;
    const yearEndExclusive = `${currentYear + 1}-01-01`;

    const [
      studentsRes,
      staffRes,
      feesMonthRes,
      expensesMonthRes,
      defaultersRes,
      feesYearRes,
      expensesYearRes,
    ] = await Promise.all([
      prisma.$queryRaw<{ total: bigint }[]>`SELECT COUNT(*) AS total FROM students`,
      prisma.$queryRaw<{ total: bigint }[]>`SELECT COUNT(*) AS total FROM staff`,
      // "Fee Collected (Month)" is tied to payment_date (falling back to
      // academic_month for legacy rows with no payment_date) — i.e. money
      // actually DEPOSITED this calendar month, regardless of which
      // month's bill it was for.
      //
      // Perf: rewritten from DATE_TRUNC(...) = DATE_TRUNC(...) (blocks
      // index use entirely) to sargable half-open ranges split across
      // the two COALESCE branches, same technique as /api/fees GET, so
      // the fee_payments(academic_month) index can actually be used.
      prisma.$queryRaw<{ total_due: string; total_paid: string }[]>`
        SELECT COALESCE((
                 SELECT SUM(amount_due) FROM fee_payments
                 WHERE (payment_date >= ${currentMonth}::DATE AND payment_date < ${currentMonth}::DATE + INTERVAL '1 month')
                    OR (payment_date IS NULL AND academic_month >= ${currentMonth}::DATE AND academic_month < ${currentMonth}::DATE + INTERVAL '1 month')
               ), 0) AS total_due,
               COALESCE((
                 SELECT SUM(amount_paid) FROM fee_payments
                 WHERE (payment_date >= ${currentMonth}::DATE AND payment_date < ${currentMonth}::DATE + INTERVAL '1 month')
                    OR (payment_date IS NULL AND academic_month >= ${currentMonth}::DATE AND academic_month < ${currentMonth}::DATE + INTERVAL '1 month')
               ), 0) AS total_paid
      `,
      prisma.$queryRaw<{ total_expenses: string }[]>`
        SELECT COALESCE(SUM(amount), 0) AS total_expenses
        FROM expenses
        WHERE created_at >= ${currentMonth}::DATE AND created_at < ${currentMonth}::DATE + INTERVAL '1 month'
      `,
      // Matches the /api/fees/defaulters logic exactly (see that route).
      prisma.$queryRaw<{ total: bigint }[]>`
        SELECT COUNT(*) AS total
        FROM fee_payments fp
        WHERE fp.academic_month >= ${currentMonth}::DATE AND fp.academic_month < ${currentMonth}::DATE + INTERVAL '1 month'
          AND fp.amount_due > 0
          AND fp.amount_paid < fp.amount_due
      `,
      // "monthly_fees" chart: fee DEPOSITED per calendar month
      // (payment_date, falling back to academic_month for legacy rows).
      // Perf: EXTRACT(YEAR FROM ...) wraps the column and forces a full
      // scan of the whole table regardless of year requested; rewritten
      // to a sargable range on the calendar year.
      prisma.$queryRaw<{ month: string; collected: string }[]>`
        SELECT TO_CHAR(COALESCE(payment_date, academic_month), 'Mon') AS month,
               SUM(amount_paid) AS collected
        FROM fee_payments
        WHERE COALESCE(payment_date, academic_month) >= ${yearStart}::DATE
          AND COALESCE(payment_date, academic_month) <  ${yearEndExclusive}::DATE
        GROUP BY DATE_TRUNC('month', COALESCE(payment_date, academic_month)), TO_CHAR(COALESCE(payment_date, academic_month), 'Mon')
        ORDER BY DATE_TRUNC('month', COALESCE(payment_date, academic_month))
      `,
      prisma.$queryRaw<{ month: string; spent: string }[]>`
        SELECT TO_CHAR(created_at, 'Mon') AS month,
               SUM(amount) AS spent
        FROM expenses
        WHERE created_at >= ${yearStart}::DATE AND created_at < ${yearEndExclusive}::DATE
        GROUP BY DATE_TRUNC('month', created_at), TO_CHAR(created_at, 'Mon')
        ORDER BY DATE_TRUNC('month', created_at)
      `,
    ]);

    const totalDue = parseFloat(feesMonthRes[0].total_due);
    const totalPaid = parseFloat(feesMonthRes[0].total_paid);

    return NextResponse.json({
      kpis: {
        total_students: parseInt(studentsRes[0].total.toString(), 10),
        total_staff: parseInt(staffRes[0].total.toString(), 10),
        fees_due: totalDue,
        fees_collected: totalPaid,
        fees_balance: totalDue - totalPaid,
        expenses_month: parseFloat(expensesMonthRes[0].total_expenses),
        fee_defaulters: parseInt(defaultersRes[0].total.toString(), 10),
      },
      charts: {
        monthly_fees: feesYearRes,
        monthly_expenses: expensesYearRes,
      },
    });
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}
