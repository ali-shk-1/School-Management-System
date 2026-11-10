/**
 * scripts/seed-student-fees-from-last-payment.ts
 *
 * ONE-TIME, run-it-once script. Not part of the app — nothing imports
 * this. Sets every student's `student_fees.total_fee` (the per-student
 * "Total Fee" override, see Fees > Students Fee) to the amount_due of
 * their most recent fee_payments row (by academic_month).
 *
 * i.e. "3000 was due for August" -> that student's Total Fee becomes
 * 3000, exactly as described (uses the due/expected amount, not
 * whatever was actually paid — so a partial payment doesn't understate
 * the student's real fee).
 *
 * WHAT IT DOES
 *  - For every student with at least one fee_payments row, finds the
 *    row with the latest academic_month (ties broken by payment_id, so
 *    the most-recently-entered one wins).
 *  - Upserts student_fees for that student: total_fee = that row's
 *    amount_due.
 *  - Students with zero fee_payments rows are skipped and reported —
 *    there is nothing to seed from for them, so they're printed at the
 *    end so you can review whether they need manual figures instead.
 *  - Idempotent: safe to re-run, it upserts by student_id.
 *  - --dry-run: prints exactly what it *would* write, writes nothing.
 *
 * HOW TO RUN
 *   npx tsx scripts/seed-student-fees-from-last-payment.ts --dry-run
 *   npx tsx scripts/seed-student-fees-from-last-payment.ts
 *
 * (needs `npx prisma generate` already run once, same as the rest of
 * the app, so the Prisma client matches schema.prisma)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const students = await prisma.student.findMany({
    select: { student_id: true, roll_no: true, class: true, section: true, first_name: true, last_name: true },
    orderBy: { student_id: 'asc' },
  });

  const skippedNoPayments: string[] = [];
  let wouldUpdate = 0;
  let updated = 0;

  for (const s of students) {
    const lastPayment = await prisma.feePayment.findFirst({
      where: { student_id: s.student_id },
      orderBy: [{ academic_month: 'desc' }, { payment_id: 'desc' }],
      select: { academic_month: true, amount_due: true },
    });

    const label = `#${s.student_id} ${s.first_name} ${s.last_name || ''} (${s.class}-${s.section}, roll ${s.roll_no})`.trim();

    if (!lastPayment) {
      skippedNoPayments.push(label);
      continue;
    }

    const amount = Number(lastPayment.amount_due ?? 0);
    const monthLabel = lastPayment.academic_month.toISOString().slice(0, 7); // YYYY-MM

    if (dryRun) {
      console.log(`[dry-run] ${label} -> total_fee = ${amount} (from ${monthLabel})`);
      wouldUpdate++;
      continue;
    }

    await prisma.studentFee.upsert({
      where: { student_id: s.student_id },
      update: { total_fee: amount, updated_by: 'seed-script' },
      create: { student_id: s.student_id, total_fee: amount, updated_by: 'seed-script' },
    });
    console.log(`${label} -> total_fee = ${amount} (from ${monthLabel})`);
    updated++;
  }

  console.log('');
  if (dryRun) {
    console.log(`Dry run complete. Would update ${wouldUpdate} student(s).`);
  } else {
    console.log(`Done. Updated ${updated} student(s).`);
  }
  if (skippedNoPayments.length) {
    console.log(`\nSkipped ${skippedNoPayments.length} student(s) with no fee_payments rows at all:`);
    skippedNoPayments.forEach((l) => console.log(`  - ${l}`));
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
