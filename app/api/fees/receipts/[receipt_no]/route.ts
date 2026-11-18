import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';

/* ─────────────────────────────────────────
   GET /api/fees/receipts/:receipt_no
   Ported from routes/fees.js `GET /receipts/:receipt_no`.
   Single-receipt lookup — "is this receipt number legit" verification.
───────────────────────────────────────── */
export async function GET(req: NextRequest, { params }: { params: Promise<{ receipt_no: string }> }) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const { receipt_no } = await params;
    const rows = await prisma.$queryRaw<any[]>`
      SELECT pr.*, fp.payment_date
      FROM payment_receipts pr
      LEFT JOIN fee_payments fp ON fp.payment_id = pr.payment_id
      WHERE pr.receipt_no = ${parseInt(receipt_no, 10)}
      ORDER BY pr.academic_month ASC, pr.receipt_id ASC
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: 'No receipt found with that number.', valid: false }, { status: 404 });
    }

    // One receipt number can now cover several months (one row each):
    // `receipt` stays the first row for compatibility, `receipts` has all.
    return NextResponse.json({ valid: true, receipt: rows[0], receipts: rows });
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}
