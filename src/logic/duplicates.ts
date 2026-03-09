import { getData, type Transaction } from '../db';

function normalize(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

export interface DuplicateResult {
  duplicates: Omit<Transaction, 'id'>[];
  unique: Omit<Transaction, 'id'>[];
}

export function detectDuplicates(incoming: Omit<Transaction, 'id'>[]): DuplicateResult {
  const { transactions } = getData();
  const existingSet = new Set(
    transactions.map(
      (t) => `${normalize(t.instrument)}|${t.txnDate}|${normalize(t.descriptor)}|${t.amount}`,
    ),
  );

  const duplicates: Omit<Transaction, 'id'>[] = [];
  const unique: Omit<Transaction, 'id'>[] = [];

  for (const txn of incoming) {
    const key = `${normalize(txn.instrument)}|${txn.txnDate}|${normalize(txn.descriptor)}|${txn.amount}`;
    if (existingSet.has(key)) {
      duplicates.push(txn);
    } else {
      unique.push(txn);
      existingSet.add(key);
    }
  }

  return { duplicates, unique };
}
