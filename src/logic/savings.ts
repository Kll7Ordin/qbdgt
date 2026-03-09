import { db } from '../db';

function getCurrentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export async function processSchedules(): Promise<number> {
  const schedules = await db.savingsSchedules.where('active').equals(1).toArray();
  const currentMonth = getCurrentMonth();
  let created = 0;

  for (const sched of schedules) {
    if (sched.id === undefined) continue;
    if (sched.startMonth > currentMonth) continue;

    const existing = await db.savingsEntries
      .where('scheduleId')
      .equals(sched.id)
      .filter((e) => e.entryDate.startsWith(currentMonth))
      .count();

    if (existing > 0) continue;

    const day = Math.min(sched.dayOfMonth, 28);
    const entryDate = `${currentMonth}-${String(day).padStart(2, '0')}`;

    await db.savingsEntries.add({
      entryDate,
      bucketId: sched.bucketId,
      amount: sched.amount,
      notes: `Auto-contribution (schedule)`,
      source: 'auto_schedule',
      scheduleId: sched.id,
    });
    created++;
  }

  return created;
}

export async function getBucketBalance(bucketId: number): Promise<number> {
  const entries = await db.savingsEntries
    .where('bucketId')
    .equals(bucketId)
    .toArray();
  return entries.reduce((sum, e) => sum + e.amount, 0);
}
