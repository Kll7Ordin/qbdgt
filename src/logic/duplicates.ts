import { getData, type Transaction } from '../db';

function normalize(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

export interface DuplicateResult {
  duplicates: Omit<Transaction, 'id'>[];
  unique: Omit<Transaction, 'id'>[];
}

/**
 * Duplicate detection:
 * 1. Exact: same date + descriptor + amount (re-import of same file)
 * 2. SourceRef: same date + sourceRef + amount (PayPal linking changes descriptors)
 * 3. Pending→Captured: same date + amount + instrument from bank_csv
 *    Credit cards show a pending transaction with one descriptor, then when it
 *    settles it appears in the next statement with a different descriptor.
 *    We treat same date + amount + same instrument as a duplicate for bank_csv.
 */
export function detectDuplicates(incoming: Omit<Transaction, 'id'>[]): DuplicateResult {
  const { transactions } = getData();

  const descKeys = new Set(
    transactions.map((t) => `${t.txnDate}|${normalize(t.descriptor)}|${t.amount}`),
  );
  const sourceKeys = new Set(
    transactions
      .filter((t) => t.sourceRef)
      .map((t) => `${t.txnDate}|${t.sourceRef}|${t.amount}`),
  );
  // For bank CSV: same date + amount + instrument is enough to catch pending→captured
  const cardKeys = new Set(
    transactions
      .filter((t) => t.source === 'bank_csv' && t.instrument)
      .map((t) => `${t.txnDate}|${t.amount}|${t.instrument}`),
  );

  const duplicates: Omit<Transaction, 'id'>[] = [];
  const unique: Omit<Transaction, 'id'>[] = [];

  for (const txn of incoming) {
    const descKey = `${txn.txnDate}|${normalize(txn.descriptor)}|${txn.amount}`;
    const srcKey = `${txn.txnDate}|${txn.sourceRef}|${txn.amount}`;
    const cardKey = `${txn.txnDate}|${txn.amount}|${txn.instrument}`;

    const isPendingCaptureDup =
      txn.source === 'bank_csv' &&
      txn.instrument &&
      cardKeys.has(cardKey);

    if (descKeys.has(descKey) || sourceKeys.has(srcKey) || isPendingCaptureDup) {
      duplicates.push(txn);
    } else {
      unique.push(txn);
      // Add to in-memory sets so duplicates within the same incoming batch are also caught
      descKeys.add(descKey);
      if (txn.sourceRef) sourceKeys.add(srcKey);
      if (txn.source === 'bank_csv' && txn.instrument) cardKeys.add(cardKey);
    }
  }

  return { duplicates, unique };
}
