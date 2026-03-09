import { getData, addSavingsEntry } from '../db';

function getCurrentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export async function processSchedules(): Promise<number> {
  const { savingsSchedules, savingsEntries } = getData();
  const currentMonth = getCurrentMonth();
  let created = 0;

  for (const sched of savingsSchedules) {
    if (!sched.active) continue;
    if (sched.startMonth > currentMonth) continue;

    const alreadyExists = savingsEntries.some(
      (e) => e.scheduleId === sched.id && e.entryDate.startsWith(currentMonth),
    );
    if (alreadyExists) continue;

    const day = Math.min(sched.dayOfMonth, 28);
    const entryDate = `${currentMonth}-${String(day).padStart(2, '0')}`;

    await addSavingsEntry({
      entryDate,
      bucketId: sched.bucketId,
      amount: sched.amount,
      notes: 'Auto-contribution (schedule)',
      source: 'auto_schedule',
      scheduleId: sched.id,
    });
    created++;
  }

  return created;
}

export function getBucketBalance(bucketId: number): number {
  const { savingsEntries } = getData();
  return savingsEntries
    .filter((e) => e.bucketId === bucketId)
    .reduce((sum, e) => sum + e.amount, 0);
}
