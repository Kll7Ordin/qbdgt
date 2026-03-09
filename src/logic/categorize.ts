import { db, type CategoryRule, type Transaction } from '../db';

function normalize(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

export async function categorizeTransactions(txns: Omit<Transaction, 'id'>[]): Promise<void> {
  const rules = await db.categoryRules.toArray();
  const exact = rules
    .filter((r) => r.matchType === 'exact')
    .sort((a, b) => b.pattern.length - a.pattern.length);
  const contains = rules
    .filter((r) => r.matchType === 'contains')
    .sort((a, b) => b.pattern.length - a.pattern.length);

  for (const txn of txns) {
    if (txn.categoryId) continue;
    const norm = normalize(txn.descriptor);

    const exactMatch = exact.find((r) => normalize(r.pattern) === norm);
    if (exactMatch) {
      txn.categoryId = exactMatch.categoryId;
      continue;
    }

    const containsMatch = contains.find((r) => norm.includes(normalize(r.pattern)));
    if (containsMatch) {
      txn.categoryId = containsMatch.categoryId;
    }
  }
}

export async function recategorizeAll(): Promise<number> {
  const rules = await db.categoryRules.toArray();
  const exact = rules
    .filter((r) => r.matchType === 'exact')
    .sort((a, b) => b.pattern.length - a.pattern.length);
  const contains = rules
    .filter((r) => r.matchType === 'contains')
    .sort((a, b) => b.pattern.length - a.pattern.length);

  const uncategorized = await db.transactions
    .where('categoryId')
    .equals(0)
    .or('categoryId')
    .equals('')
    .toArray();

  const allTxns = uncategorized.length > 0
    ? uncategorized
    : (await db.transactions.toArray()).filter((t) => t.categoryId === null);

  let count = 0;
  for (const txn of allTxns) {
    const norm = normalize(txn.descriptor);
    let matched: CategoryRule | undefined;

    matched = exact.find((r) => normalize(r.pattern) === norm);
    if (!matched) {
      matched = contains.find((r) => norm.includes(normalize(r.pattern)));
    }

    if (matched && txn.id !== undefined) {
      await db.transactions.update(txn.id, { categoryId: matched.categoryId });
      count++;
    }
  }
  return count;
}

export async function bulkCategorizeByDescriptor(
  pattern: string,
  categoryId: number,
  matchType: 'exact' | 'contains',
): Promise<number> {
  const all = await db.transactions.toArray();
  const norm = normalize(pattern);
  let count = 0;

  for (const txn of all) {
    const txnNorm = normalize(txn.descriptor);
    const isMatch = matchType === 'exact'
      ? txnNorm === norm
      : txnNorm.includes(norm);

    if (isMatch && txn.id !== undefined) {
      await db.transactions.update(txn.id, { categoryId });
      count++;
    }
  }
  return count;
}
