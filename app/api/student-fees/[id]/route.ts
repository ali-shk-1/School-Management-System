import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, can } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { broadcast } from '@/lib/sse';

/* ─────────────────────────────────────────
   PUT /api/student-fees/:id
   :id is the student_fee_id (not the student_id).
   Body: { total_fee }
───────────────────────────────────────── */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = await can(auth.user, 'student-fees.edit');
  if (denied) return denied;

  try {
    const { id } = await params;
    const body = await req.json();
    const totalFee = Number(body.total_fee);
    if (!Number.isFinite(totalFee) || totalFee < 0) {
      return NextResponse.json({ error: 'total_fee must be a non-negative number.' }, { status: 400 });
    }

    let row;
    try {
      row = await prisma.studentFee.update({
        where: { student_fee_id: parseInt(id, 10) },
        data: { total_fee: totalFee, updated_by: auth.user.username || null },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return NextResponse.json({ error: 'Student fee record not found.' }, { status: 404 });
      }
      throw err;
    }

    broadcast('student-fees.changed', { action: 'edited', id: row.student_fee_id });
    return NextResponse.json(row);
  } catch (err) {
    return handleApiError(err, 'PUT');
  }
}

/* ─────────────────────────────────────────
   DELETE /api/student-fees/:id
───────────────────────────────────────── */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = await can(auth.user, 'student-fees.delete');
  if (denied) return denied;

  try {
    const { id } = await params;
    let row;
    try {
      row = await prisma.studentFee.delete({
        where: { student_fee_id: parseInt(id, 10) },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return NextResponse.json({ error: 'Student fee record not found.' }, { status: 404 });
      }
      throw err;
    }

    broadcast('student-fees.changed', { action: 'deleted', id: row.student_fee_id });
    return NextResponse.json({ message: 'Student fee record deleted.' });
  } catch (err) {
    return handleApiError(err, 'DELETE');
  }
}
