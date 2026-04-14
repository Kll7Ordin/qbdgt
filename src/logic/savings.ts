import { getData, addSavingsEntry } from '../db';
import { monthRange } from './dateUtils';

/**
 * Generate savings auto-contributions from each schedule's startMonth
 * through the current month, backfilling any gaps.
 * Skips months where the entry already exists.
 */
export async function processSchedules(): Promise<number> {
  const { savingsSchedules, savingsEntries, transactions } = getData();
  const months = monthRange(transactions);
  let created = 0;

  for (const month of months) {
    for (const sched of savingsSchedules) {
      if (!sched.active) continue;
      if (sched.startMonth > month) continue;

      const alreadyExists = savingsEntries.some(
        (e) => e.scheduleId === sched.id && e.entryDate.startsWith(month),
      );
      if (alreadyExists) continue;

      const day = Math.min(sched.dayOfMonth, 28);
      const entryDate = `${month}-${String(day).padStart(2, '0')}`;

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
  }

  return created;
}

export function getBucketBalance(bucketId: number): number {
  const { savingsEntries } = getData();
  return savingsEntries
    .filter((e) => e.bucketId === bucketId)
    .reduce((sum, e) => sum + e.amount, 0);
}
