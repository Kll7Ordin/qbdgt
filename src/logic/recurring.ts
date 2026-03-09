import { getData, addTransaction } from '../db';

function getCurrentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export async function processRecurringTemplates(): Promise<number> {
  const { recurringTemplates, transactions } = getData();
  const currentMonth = getCurrentMonth();
  let created = 0;

  for (const tmpl of recurringTemplates) {
    if (!tmpl.active) continue;

    const alreadyExists = transactions.some(
      (t) => t.source === 'recurring' && t.sourceRef === String(tmpl.id) && t.txnDate.startsWith(currentMonth),
    );
    if (alreadyExists) continue;

    const day = Math.min(tmpl.dayOfMonth, 28);
    const txnDate = `${currentMonth}-${String(day).padStart(2, '0')}`;

    await addTransaction({
      source: 'recurring',
      sourceRef: String(tmpl.id),
      txnDate,
      amount: tmpl.amount,
      instrument: tmpl.instrument,
      descriptor: tmpl.descriptor,
      categoryId: tmpl.categoryId,
      linkedTransactionId: null,
      ignoreInBudget: false,
      comment: null,
    });
    created++;
  }

  return created;
}
