import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, can } from '@/lib/auth';
import { handleApiError } from '@/lib/apiHandler';
import { broadcast } from '@/lib/sse';
import { withDateOnlyFields } from '@/lib/date-format';
import {
  allowedClasses,
  normalizeMonthInput,
  normalizeGenderInput,
  getClassRollStart,
  isValidEmail,
  normalizePhoneInput,
  normalizeSectionInput,
} from '@/lib/students-helpers';

/* ─────────────────────────────────────────
   GET /api/students
   Query params: class, section, search (name/roll_no), gender
───────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;

  try {
    const { searchParams } = req.nextUrl;
    const cls = searchParams.get('class');
    const section = searchParams.get('section');
    const search = searchParams.get('search');
    const gender = searchParams.get('gender');
    const countOnly = searchParams.get('countOnly') === '1';

    // Perf: the students list has no natural upper bound (grows every
    // admission, never shrinks except on withdrawal) and was previously
    // fetched in full on every page load/filter change — fine for a few
    // hundred rows, but every extra year of admissions makes the
    // unfiltered "all students" view slower to query, transfer, parse,
    // and render. Default page size mirrors the other paginated list
    // endpoints (receipts, left-students); ?limit=0 (or a very large
    // explicit limit) still allows callers that genuinely need
    // everything (e.g. CSV export) to opt out of paging.
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

    // Perf: search used to be pushed only halfway into SQL (name via
    // Prisma's `contains`, then the WHOLE matching set re-filtered in
    // JS just to also match a partial roll_no) — meaning every search
    // request pulled every row for the class/section into Node before
    // filtering. Now everything (class/section/gender AND search,
    // including the partial roll_no match) is done in one SQL query,
    // backed by the students(class, section) index.
    const conditions: Prisma.Sql[] = [];
    if (cls) conditions.push(Prisma.sql`AND class = ${cls}`);
    if (section) conditions.push(Prisma.sql`AND section = ${section}`);
    if (gender) conditions.push(Prisma.sql`AND gender = ${gender}`);
    if (search) {
      const like = `%${search.toLowerCase()}%`;
      conditions.push(Prisma.sql`AND (
        LOWER(first_name) LIKE ${like} OR
        LOWER(last_name) LIKE ${like} OR
        CAST(roll_no AS TEXT) LIKE ${like}
      )`);
    }
    const whereExtra = conditions.length ? Prisma.join(conditions, ' ', ' ') : Prisma.empty;

    // Perf: callers that only need the headcount (e.g. the Dashboard's
    // "Total Students" stat card) used to pull every column of every
    // row over the network just to read `.length` — full student
    // roster, including photo_url/contact/address, on every dashboard
    // load and every month-picker change. `?countOnly=1` runs a plain
    // COUNT(*) in Postgres and returns just the number, skipping the
    // row fetch and serialization entirely.
    if (countOnly) {
      const [{ count }] = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) AS count FROM students WHERE 1=1 ${whereExtra}
      `;
      return NextResponse.json({ count: Number(count) });
    }

    // Perf: total count for pagination UI, computed alongside the page
    // of rows (same WHERE) rather than pulling every row to derive it
    // from .length like the old unpaginated version did.
    const [totalRow, students] = await Promise.all([
      prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) AS count FROM students WHERE 1=1 ${whereExtra}
      `,
      prisma.$queryRaw<any[]>`
        SELECT * FROM students
        WHERE 1=1
        ${whereExtra}
        ORDER BY class ASC, section ASC, roll_no ASC
        ${limit != null ? Prisma.sql`LIMIT ${limit} OFFSET ${offset}` : Prisma.empty}
      `,
    ]);
    const total = Number(totalRow[0].count);

    return NextResponse.json({
      count: students.length,
      total,
      page,
      limit: limit ?? total,
      totalPages: limit != null ? Math.max(Math.ceil(total / limit), 1) : 1,
      students: students.map((s) => withDateOnlyFields(s, ['admission_date', 'fee_start_month'])),
    });
  } catch (err) {
    return handleApiError(err, 'GET');
  }
}

/* ─────────────────────────────────────────
   POST /api/students
───────────────────────────────────────── */
export async function POST(req: NextRequest) {
  const auth = authenticate(req);
  if ('error' in auth) return auth.error;
  const denied = await can(auth.user, 'students.add');
  if (denied) return denied;

  try {
    const body = await req.json();
    const {
      roll_no, section, class: cls, first_name, last_name,
      father_name, contact_1, contact_2, email, photo_url, address,
      admission_date, fee_start_month, gender,
    } = body;

    if (!section || !cls || !first_name) {
      return NextResponse.json({ error: 'section, class, and first_name are required.' }, { status: 400 });
    }
    const normalizedClass = String(cls).trim().toLowerCase();
    if (!allowedClasses.has(normalizedClass)) {
      return NextResponse.json({ error: 'Class must be one of playgroup, nursery, prep, or 1 through 10.' }, { status: 400 });
    }
    const normalizedSection = normalizeSectionInput(section);
    if (!normalizedSection) {
      return NextResponse.json(
        { error: 'Section must be a single letter (A, B, C) or a stream + letter like Csc-A, Bio-B, Arts-A.' },
        { status: 400 },
      );
    }
    let explicitRollNo = roll_no != null && roll_no !== '' ? parseInt(roll_no, 10) : null;
    if (explicitRollNo != null && (!Number.isInteger(explicitRollNo) || explicitRollNo <= 0)) {
      return NextResponse.json({ error: 'Roll No must be a positive integer if provided.' }, { status: 400 });
    }
    if (email && !isValidEmail(email)) {
      return NextResponse.json({ error: 'Invalid email address.' }, { status: 400 });
    }
    if (photo_url && !/^(?:https?:\/\/|\/uploads\/)/i.test(photo_url)) {
      return NextResponse.json({ error: 'Photo URL must begin with http://, https://, or /uploads or /uploads/.' }, { status: 400 });
    }
    const normalizedFeeStart = normalizeMonthInput(fee_start_month);
    if (fee_start_month && !normalizedFeeStart) {
      return NextResponse.json({ error: 'fee_start_month must be in YYYY-MM format.' }, { status: 400 });
    }
    const normalizedGender = normalizeGenderInput(gender);
    if (!normalizedGender) {
      return NextResponse.json({ error: 'Gender is required and must be "male" or "female".' }, { status: 400 });
    }

    // Roll numbers assigned per class+section+gender. Retry on collision
    // (unique index enforces it at the DB level) — mirrors original.
    const MAX_ATTEMPTS = 5;
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let rollNo = explicitRollNo;
      if (rollNo == null) {
        const classStart = getClassRollStart(normalizedClass);
        const maxRow = await prisma.student.aggregate({
          _max: { roll_no: true },
          where: {
            class: normalizedClass,
            section: normalizedSection,
            gender: normalizedGender ?? null,
          },
        });
        const maxRoll = maxRow._max.roll_no;
        rollNo = maxRoll != null && maxRoll >= classStart ? maxRoll + 1 : classStart;
      }

      try {
        const student = await prisma.student.create({
          data: {
            roll_no: rollNo,
            section: normalizedSection,
            class: normalizedClass,
            first_name,
            last_name: last_name || null,
            father_name: father_name || null,
            contact_1: contact_1 ? normalizePhoneInput(contact_1) : null,
            contact_2: contact_2 ? normalizePhoneInput(contact_2) : null,
            email: email || null,
            photo_url: photo_url || null,
            address: address || null,
            admission_date: admission_date ? new Date(admission_date) : new Date(),
            fee_start_month: normalizedFeeStart ? new Date(normalizedFeeStart) : null,
            gender: normalizedGender || null,
          },
        });

        broadcast('students.changed', { action: 'added', student_id: student.student_id });
        return NextResponse.json(
          { message: 'Student added.', student: withDateOnlyFields(student, ['admission_date', 'fee_start_month']) },
          { status: 201 }
        );
      } catch (err) {
        const isRollNoCollision =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          (((err.meta?.target as string[] | undefined) ?? []).some((t) => /roll_no/i.test(t)));
        if (isRollNoCollision && explicitRollNo == null && attempt < MAX_ATTEMPTS - 1) {
          lastErr = err;
          continue;
        }
        if (isRollNoCollision && explicitRollNo != null) {
          return NextResponse.json(
            { error: 'That Roll No is already in use for this class, section, and gender.' },
            { status: 409 }
          );
        }
        throw err;
      }
    }
    throw lastErr;
  } catch (err) {
    return handleApiError(err, 'POST');
  }
}
