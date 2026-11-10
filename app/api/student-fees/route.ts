import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, can } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { broadcast } from '@/lib/sse';

/* ─────────────────────────────────────────
   GET /api/student-fees
   Returns every student's individual total-fee override, used by the
   Fees > Students Fee sub-page, by the Record Payment form (to show
   the student's Total Fee next to Father's Name), and by receipt
   printing (student override wins over the class-wide class_fees
   amount, see normalizeReceiptData in the Fees page).
   Readable by anyone authenticated — only add/edit/delete are gated.
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const rows = await prisma.studentFee.findMany({
      orderBy: { student_fee_id: 'asc' },
      include: {
        student: {
          select: { student_id: true, roll_no: true, class: true, section: true, first_name: true, last_name: true },
        },
      },
    });
    return NextResponse.json(rows);
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}

/* ─────────────────────────────────────────
   POST /api/student-fees
   Body: { student_id, total_fee }
   Creates (or, if the student already has a row, updates) that
   student's total fee override — idempotent for the same reason as
   POST /api/class-fees: "one row per student" is the whole point.
───────────────────────────────────────── */
export async function POST(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = await can(auth.user, 'student-fees.add');
  if (denied) return denied;

  try {
    const body = await req.json();
    const studentId = parseInt(body.student_id, 10);
    const totalFee = Number(body.total_fee);

    if (!Number.isFinite(studentId)) {
      return NextResponse.json({ error: 'student_id is required.' }, { status: 400 });
    }
    if (!Number.isFinite(totalFee) || totalFee < 0) {
      return NextResponse.json({ error: 'total_fee must be a non-negative number.' }, { status: 400 });
    }

    const student = await prisma.student.findUnique({ where: { student_id: studentId } });
    if (!student) {
      return NextResponse.json({ error: 'Student not found.' }, { status: 404 });
    }

    const row = await prisma.studentFee.upsert({
      where: { student_id: studentId },
      update: { total_fee: totalFee, updated_by: auth.user.username || null },
      create: { student_id: studentId, total_fee: totalFee, updated_by: auth.user.username || null },
    });

    broadcast('student-fees.changed', { action: 'saved', id: row.student_fee_id });
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    return handleApiError(err, 'POST');
  }
}
