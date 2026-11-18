import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, can, userHasPermission } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { broadcast } from '@/lib/sse';
import { sendMail } from '@/lib/mailer';
import { normalizeMonthInput } from '@/lib/fees-helpers';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatPaymentDate(d: unknown): string {
  // payment_date is a `timestamp` column (no @db.Date), so $queryRaw
  // returns it as a JS Date object in the normal case -- NOT a string.
  // The old version only handled the string case (regex match on
  // 'YYYY-MM-DD...') and silently fell back to *today's* date for any
  // Date object input, which meant every receipt email showed today's
  // date instead of the actual payment date whenever a payment used the
  // default (non-custom) payment_date. Handle Date objects directly,
  // using UTC components since the column has no timezone and Postgres
  // returns midnight-UTC for date-only inserts (e.g. the ::DATE cast
  // used for customPaymentDate).
  if (d instanceof Date && !isNaN(d.getTime())) {
    return `${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }
  const match = d ? String(d).match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
  if (match) {
    const [, y, mo, day] = match;
    return `${Number(day)} ${MONTH_NAMES[Number(mo) - 1]} ${y}`;
  }
  // Only reached if payment_date is genuinely null/unparseable.
  const now = new Date();
  return `${now.getDate()} ${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
}

function formatAcademicMonth(d: unknown): string {
  // academic_month is a `DATE` column ($db.Date, no time component), so
  // $queryRaw returns it as a JS Date object -- NOT a "YYYY-MM" string.
  // The old code did String(d).split('-'), which on a Date object's
  // default toString() (e.g. "Mon Jun 01 2026 05:00:00 GMT+0500 ...")
  // produced garbage ("undefined <that whole string>") in receipt
  // emails. Use UTC components directly, same convention as
  // formatPaymentDate above, and support a raw "YYYY-MM"/"YYYY-MM-DD"
  // string as a fallback in case a caller ever passes one directly.
  if (d instanceof Date && !isNaN(d.getTime())) {
    return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }
  const match = d ? String(d).match(/^(\d{4})-(\d{2})/) : null;
  if (match) {
    const [, y, mo] = match;
    return `${MONTH_NAMES[Number(mo) - 1]} ${y}`;
  }
  const now = new Date();
  return `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
}

function formatCurrency(value: unknown): string {
  return new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    minimumFractionDigits: 0,
  }).format(Number(value || 0));
}

/* ─────────────────────────────────────────
   POST /api/fees
   Ported from routes/fees.js `POST /`.

   Uses a raw-SQL transaction ($transaction with a callback + $queryRaw /
   $executeRaw) rather than the query-builder throughout, because:
     - pg_advisory_xact_lock has no Prisma equivalent
     - the "does a fee record already exist for this month" check, the
       joined-with-student-info receipt re-fetch (with a derived
       month_totals subquery), and the conditional receipt insert are all
       easiest to keep byte-for-byte identical to the original this way,
       which matters a lot for a route this financially sensitive.
───────────────────────────────────────── */
export async function POST(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = await can(auth.user, 'fees.add');
  if (denied) return denied;

  try {
    const body = await req.json();
    const { student_id, payment_date } = body;

    // One submission can cover several months. Either send the original
    // single-month shape (academic_month / amount_due / amount_paid) or a
    // `payments: [{ academic_month, amount_due, amount_paid }, ...]` list.
    // Every month becomes its own fee_payments row + its own receipt row,
    // all sharing ONE receipt_no.
    const rawItems: any[] =
      Array.isArray(body.payments) && body.payments.length
        ? body.payments
        : [{ academic_month: body.academic_month, amount_due: body.amount_due, amount_paid: body.amount_paid }];

    if (!student_id) {
      return NextResponse.json({ error: 'student_id is required.' }, { status: 400 });
    }
    if (rawItems.length > 12) {
      return NextResponse.json({ error: 'You can record at most 12 months on one receipt.' }, { status: 400 });
    }
    const seenMonths = new Set<string>();
    for (const it of rawItems) {
      if (!it || !it.academic_month || it.amount_due == null) {
        return NextResponse.json(
          { error: 'academic_month and amount_due are required for every month.' },
          { status: 400 }
        );
      }
      if (!/^\d{4}-\d{2}(-\d{2})?$/.test(String(it.academic_month).trim())) {
        return NextResponse.json({ error: 'academic_month must be YYYY-MM or YYYY-MM-DD.' }, { status: 400 });
      }
      if (Number(it.amount_paid || 0) < 0 || Number(it.amount_due) < 0) {
        return NextResponse.json({ error: 'Amounts cannot be negative.' }, { status: 400 });
      }
      const key = String(it.academic_month).trim().slice(0, 7);
      if (seenMonths.has(key)) {
        return NextResponse.json({ error: 'The same month appears more than once on this receipt.' }, { status: 400 });
      }
      seenMonths.add(key);
    }
    const items = rawItems.map((it) => ({
      academic_month: String(it.academic_month).trim().length === 7
        ? `${String(it.academic_month).trim()}-01`
        : String(it.academic_month).trim(),
      amount_due: it.amount_due,
      amount_paid: it.amount_paid,
    }));

    // Optional "deposit on a different day" override, gated by its own
    // permission — see original comment (preserved conceptually above).
    let customPaymentDate: string | null = null;
    if (payment_date != null && payment_date !== '') {
      const isValidDate =
        /^\d{4}-\d{2}-\d{2}$/.test(String(payment_date).trim()) &&
        !isNaN(new Date(payment_date).getTime());
      if (!isValidDate) {
        return NextResponse.json({ error: 'payment_date must be in YYYY-MM-DD format.' }, { status: 400 });
      }
      const allowed = await userHasPermission(auth.user.role, 'fees.custom_date');
      if (!allowed) {
        return NextResponse.json(
          { error: "Access denied. You don't have permission to set a custom deposit date (fees.custom_date)." },
          { status: 403 }
        );
      }
      customPaymentDate = String(payment_date).trim();
    }

    const printMode = body.print_mode === 'thermal' ? 'thermal' : 'paper';
    const issuedBy = auth.user.username || null;

    const result = await prisma.$transaction(async (tx) => {
      // Serialize concurrent submissions for the same student — see
      // original comment. pg_advisory_xact_lock is auto-released on
      // commit/rollback of this transaction.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BigInt(student_id)}::bigint)`;

      const studentCheck = await tx.$queryRaw<{ student_id: number }[]>`
        SELECT student_id FROM students WHERE student_id = ${student_id}
      `;
      if (studentCheck.length === 0) {
        return { notFound: true as const };
      }

      // ONE receipt number for the whole submission, taken from the same
      // sequence that auto-numbered receipts before. Every month's receipt
      // row below is inserted with this explicit number.
      const seqRow = await tx.$queryRaw<{ n: bigint }[]>`
        SELECT nextval(pg_get_serial_sequence('payment_receipts', 'receipt_no')) AS n
      `;
      const receiptNo = Number(seqRow[0].n);

      const paymentRows: any[] = [];
      for (const item of items) {
        const academic_month = item.academic_month;
        const amount_due = item.amount_due;
        const amount_paid = item.amount_paid;

        const existingMonth = await tx.$queryRaw<{ x: number }[]>`
          SELECT 1 AS x FROM fee_payments
          WHERE student_id = ${student_id}
            AND academic_month >= DATE_TRUNC('month', ${academic_month}::DATE)
            AND academic_month <  DATE_TRUNC('month', ${academic_month}::DATE) + INTERVAL '1 month'
          LIMIT 1
        `;
        const insertedDue = existingMonth.length ? 0 : amount_due;
        const insertedPaid = amount_paid || 0;

        const inserted = customPaymentDate
          ? await tx.$queryRaw<{ payment_id: number }[]>`
              INSERT INTO fee_payments (student_id, academic_month, amount_due, amount_paid, payment_date)
              VALUES (
                ${student_id},
                ${academic_month}::DATE,
                ${insertedDue},
                ${insertedPaid},
                -- "Deposit on a different day" only overrides the DATE
                -- portion — the time-of-day should still be when this
                -- request was actually submitted, not midnight. Combine
                -- the chosen date with the current time-of-day.
                (${customPaymentDate}::DATE + CURRENT_TIME)
              )
              RETURNING *
            `
          : await tx.$queryRaw<{ payment_id: number }[]>`
              INSERT INTO fee_payments (student_id, academic_month, amount_due, amount_paid)
              VALUES (${student_id}, ${academic_month}::DATE, ${insertedDue}, ${insertedPaid})
              RETURNING *
            `;
        const paymentId = inserted[0].payment_id;

        // Re-fetch joined with student info + month totals — amount_due /
        // amount_paid / balance are MONTH TOTALS for THIS month, not just
        // this row, so each month's receipt is correct on its own.
        const receiptRows = await tx.$queryRaw<any[]>`
          SELECT fp.payment_id, fp.student_id, fp.academic_month, fp.payment_date,
                 fp.amount_paid AS this_payment_amount,
                 month_totals.amount_due, month_totals.amount_paid,
                 (month_totals.amount_due - month_totals.amount_paid) AS balance,
                 s.roll_no, s.first_name, s.last_name, s.class, s.section,
                 s.father_name, s.contact_1, s.contact_2, s.address, s.email, s.photo_url
          FROM fee_payments fp
          JOIN students s ON s.student_id = fp.student_id
          JOIN (
            SELECT student_id,
                   DATE_TRUNC('month', academic_month) AS month,
                   SUM(amount_due)  AS amount_due,
                   SUM(amount_paid) AS amount_paid
            FROM fee_payments
            WHERE student_id = ${student_id}
              AND academic_month >= DATE_TRUNC('month', ${academic_month}::DATE)
              AND academic_month <  DATE_TRUNC('month', ${academic_month}::DATE) + INTERVAL '1 month'
            GROUP BY student_id, DATE_TRUNC('month', academic_month)
          ) month_totals ON month_totals.student_id = fp.student_id
          WHERE fp.payment_id = ${paymentId}
        `;

        const paymentRow = receiptRows[0];
        if (!paymentRow) continue;
        const studentName = `${paymentRow.first_name || ''} ${paymentRow.last_name || ''}`.trim();
        if (customPaymentDate) {
          await tx.$executeRaw`
            INSERT INTO payment_receipts
              (receipt_no, payment_id, student_id, roll_no, student_name, class, section, academic_month, amount_due, amount_paid, print_mode, issued_by, issued_at)
            VALUES (${receiptNo}, ${paymentId}, ${student_id}, ${paymentRow.roll_no}, ${studentName},
                    ${paymentRow.class}, ${paymentRow.section}, ${academic_month}::DATE,
                    ${paymentRow.amount_due}, ${paymentRow.this_payment_amount},
                    ${printMode}, ${issuedBy}, ${customPaymentDate}::DATE)
          `;
        } else {
          await tx.$executeRaw`
            INSERT INTO payment_receipts
              (receipt_no, payment_id, student_id, roll_no, student_name, class, section, academic_month, amount_due, amount_paid, print_mode, issued_by)
            VALUES (${receiptNo}, ${paymentId}, ${student_id}, ${paymentRow.roll_no}, ${studentName},
                    ${paymentRow.class}, ${paymentRow.section}, ${academic_month}::DATE,
                    ${paymentRow.amount_due}, ${paymentRow.this_payment_amount},
                    ${printMode}, ${issuedBy})
          `;
        }
        paymentRows.push({ ...paymentRow, receipt_no: receiptNo });
      }

      return { notFound: false as const, payments: paymentRows, receiptNo };
    });

    if (result.notFound) {
      return NextResponse.json({ error: 'Student not found.' }, { status: 404 });
    }

    const payments = result.payments;
    const payment = payments[0];

    if (payment && payment.email) {
      const paymentDate = formatPaymentDate(payment.payment_date);

      // Mirror the printed receipt's Total Fee / Discount logic exactly
      // (see normalizeReceiptData in app/(app)/fees/page.tsx): the class's
      // configured total_fee minus each month's amount_due (never negative).
      // class_fees.class is stored section-less (e.g. "5", "Nursery"), but
      // payment.class can carry a "-<section>" suffix in some paths, so
      // strip it before looking up the class's total_fee.
      const baseClass = String(payment.class || '').replace(/-[^-]*$/, '');
      const classFeeRow = baseClass
        ? await prisma.$queryRaw<{ total_fee: any }[]>`
            SELECT total_fee FROM class_fees WHERE class = ${baseClass} LIMIT 1
          `
        : [];
      const totalFee = classFeeRow.length ? Number(classFeeRow[0].total_fee) : null;

      const cell = 'padding:8px;border:1px solid #ddd;';
      const monthBlocks = payments.map((p: any) => {
        const m = formatAcademicMonth(p.academic_month);
        const due = Number(p.amount_due) || 0;
        const discount = totalFee != null ? Math.max(0, totalFee - due) : null;
        const hasDiscount = discount != null && discount > 0;
        return {
          m, due, discount, hasDiscount,
          html: `
          <h3 style="margin:18px 0 0;color:#2b6cb0;">${m}</h3>
          <table style="width:100%;border-collapse:collapse;margin-top:8px;">
            ${totalFee != null ? `<tr><td style="${cell}">Total Fee</td><td style="${cell}">${formatCurrency(totalFee)}</td></tr>` : ''}
            ${hasDiscount ? `<tr><td style="${cell}">Discount</td><td style="${cell}color:#2d7a4f;">-${formatCurrency(discount)}</td></tr>` : ''}
            <tr><td style="${cell}">${hasDiscount ? 'Payable after Discount' : `Amount Due (${m})`}</td><td style="${cell}">${formatCurrency(p.amount_due)}</td></tr>
            <tr><td style="${cell}">This Payment</td><td style="${cell}">${formatCurrency(p.this_payment_amount)}</td></tr>
            <tr><td style="${cell}">Total Paid (${m})</td><td style="${cell}">${formatCurrency(p.amount_paid)}</td></tr>
            <tr><td style="${cell}">Balance</td><td style="${cell}">${formatCurrency(p.balance)}</td></tr>
          </table>`,
          text: [
            `${m}`,
            totalFee != null ? `  Total Fee: ${formatCurrency(totalFee)}` : null,
            hasDiscount ? `  Discount: -${formatCurrency(discount)}` : null,
            `  ${hasDiscount ? 'Payable after Discount' : `Amount Due (${m})`}: ${formatCurrency(p.amount_due)}`,
            `  This Payment: ${formatCurrency(p.this_payment_amount)}`,
            `  Total Paid (${m}): ${formatCurrency(p.amount_paid)}`,
            `  Balance: ${formatCurrency(p.balance)}`,
          ].filter((l) => l !== null).join('\n'),
        };
      });
      const monthsLabel = monthBlocks.map((b) => b.m).join(', ');
      const anyDiscount = monthBlocks.some((b) => b.hasDiscount);

      const subject = `Fee Payment Receipt — ${payment.first_name} ${payment.last_name}`;
      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.5;">
          <h2 style="color:#2b6cb0;">Fee Payment Receipt</h2>
          <p>Dear ${payment.first_name} ${payment.last_name},</p>
          <p>Thank you for your fee payment. Below are the details for the payment recorded for <strong>${monthsLabel}</strong>:</p>
          <table style="width:100%;border-collapse:collapse;margin-top:16px;">
            <tr><td style="${cell}">Receipt No.</td><td style="${cell}">${result.receiptNo ?? '—'}</td></tr>
            <tr><td style="${cell}">Student Name</td><td style="${cell}">${payment.first_name} ${payment.last_name}</td></tr>
            <tr><td style="${cell}">Roll No.</td><td style="${cell}">${payment.roll_no}</td></tr>
            <tr><td style="${cell}">Class / Section</td><td style="${cell}">${payment.class} / ${payment.section}</td></tr>
            <tr><td style="${cell}">Father's Name</td><td style="${cell}">${payment.father_name || '—'}</td></tr>
            <tr><td style="${cell}">Contact</td><td style="${cell}">${payment.contact_1 || '—'}</td></tr>
            <tr><td style="${cell}">Payment Date</td><td style="${cell}">${paymentDate}</td></tr>
          </table>
          ${monthBlocks.map((b) => b.html).join('')}
          ${anyDiscount ? '<p style="margin-top:8px;font-size:12px;color:#b3261e;font-style:italic;">* This discount is valid for 1 year only.</p>' : ''}
          <p style="margin-top:16px;">If you have any questions or need further assistance, please contact the school office.</p>
          <p style="margin-top:8px;">Sincerely,<br/>School Administration</p>
          <p style="text-align:center;font-size:9px;color:#999;margin-top:24px;">Software provided by alixtech.vercel.app &nbsp;|&nbsp; 0310-5203080</p>
        </div>`;
      const text = [
        'Fee Payment Receipt',
        '',
        `Receipt No: ${result.receiptNo ?? '—'}`,
        `Student: ${payment.first_name} ${payment.last_name}`,
        `Roll No: ${payment.roll_no}`,
        `Class/Section: ${payment.class} / ${payment.section}`,
        `Father's Name: ${payment.father_name || '—'}`,
        `Contact: ${payment.contact_1 || '—'}`,
        `Payment Date: ${paymentDate}`,
        '',
        monthBlocks.map((b) => b.text).join('\n\n'),
        '',
        'Thank you for your payment.',
        '',
        'Software provided by alixtech.vercel.app | 0310-5203080',
      ].join('\n');

      sendMail({ to: payment.email, subject, text, html }).catch((err) =>
        console.warn('Email send failed:', err.message)
      );
    }

    broadcast('fees.changed', { action: 'added', payment_id: payment?.payment_id });
    return NextResponse.json(
      { message: 'Fee payment recorded.', payment, payments, receipt_no: result.receiptNo },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err, 'POST');
  }
}

/* ─────────────────────────────────────────
   GET /api/fees — optional ?month=&class=&search=&gender=
   Ported from routes/fees.js `GET /` (near bottom of file).
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const { searchParams } = req.nextUrl;
    const month = searchParams.get('month');
    const cls = searchParams.get('class');
    const search = searchParams.get('search');
    const gender = searchParams.get('gender');

    const conditions: Prisma.Sql[] = [];
    if (month) {
      const normalizedMonth = normalizeMonthInput(month) || month;
      // Monthly Records is on the DEPOSITED basis (payment_date, falling
      // back to academic_month for legacy rows with no payment_date) —
      // "money that came in this month", not "bills for this month".
      // Perf: rewritten from DATE_TRUNC(...) = DATE_TRUNC(...) (which
      // wraps the columns and blocks index use entirely) to a sargable
      // half-open range split across the two COALESCE branches, so
      // Postgres can use the fee_payments(academic_month) index for
      // legacy rows and a plain range scan on payment_date otherwise.
      conditions.push(Prisma.sql`AND (
        (fp.payment_date IS NOT NULL
          AND fp.payment_date >= DATE_TRUNC('month', ${normalizedMonth}::DATE)
          AND fp.payment_date <  DATE_TRUNC('month', ${normalizedMonth}::DATE) + INTERVAL '1 month')
        OR
        (fp.payment_date IS NULL
          AND fp.academic_month >= DATE_TRUNC('month', ${normalizedMonth}::DATE)
          AND fp.academic_month <  DATE_TRUNC('month', ${normalizedMonth}::DATE) + INTERVAL '1 month')
      )`);
    }
    if (cls) conditions.push(Prisma.sql`AND s.class = ${cls}`);
    if (gender) conditions.push(Prisma.sql`AND s.gender = ${gender}`);
    if (search) {
      const like = `%${search.toLowerCase()}%`;
      conditions.push(Prisma.sql`AND (
        LOWER(s.first_name) LIKE ${like} OR
        LOWER(s.last_name) LIKE ${like} OR
        CAST(s.roll_no AS TEXT) LIKE ${like}
      )`);
    }

    const whereExtra = conditions.length
      ? Prisma.join(conditions, ' ', ' ')
      : Prisma.empty;

    // Grouped by the deposited month (payment_date, falling back to
    // academic_month) rather than the bill month, so a payment made in
    // July for June's bill is grouped — and filtered — under July.
    // academic_month is still returned per group (a student could in
    // theory have paid for more than one bill-month within the same
    // deposited month, so it's kept in the GROUP BY to avoid collapsing
    // those into one misleading row).
    const rows = await prisma.$queryRaw<any[]>`
      SELECT
        MAX(fp.payment_id) AS payment_id,
        -- Real receipt number of that latest payment, so printing a receipt
        -- from the Monthly Records tab shows the correct receipt no. (it
        -- used to fall back to showing the payment_id instead).
        (SELECT pr.receipt_no FROM payment_receipts pr
          WHERE pr.payment_id = MAX(fp.payment_id) LIMIT 1) AS receipt_no,
        fp.student_id,
        DATE_TRUNC('month', fp.academic_month)::date AS academic_month,
        SUM(fp.amount_due)  AS amount_due,
        SUM(fp.amount_paid) AS amount_paid,
        MAX(fp.payment_date) AS payment_date,
        COUNT(*) AS payment_count,
        s.roll_no, s.first_name, s.last_name, s.class, s.section, s.photo_url, s.gender
      FROM fee_payments fp
      JOIN students s ON s.student_id = fp.student_id
      WHERE 1=1
      ${whereExtra}
      GROUP BY fp.student_id, DATE_TRUNC('month', fp.academic_month), s.roll_no,
               s.first_name, s.last_name, s.class, s.section, s.photo_url, s.gender
      ORDER BY MAX(COALESCE(fp.payment_date, fp.academic_month)) DESC, s.class, s.section, s.roll_no
    `;

    const shaped = rows.map((r) => ({
      ...r,
      payment_count: parseInt(r.payment_count.toString(), 10),
    }));

    return NextResponse.json({ count: shaped.length, payments: shaped });
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}