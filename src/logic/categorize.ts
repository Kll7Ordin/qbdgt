import { getData, addCategoryRule, persistData, type Transaction, type CategoryRule } from '../db';

function normalize(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function categorizeTransactionsInPlace(txns: Omit<Transaction, 'id'>[]): void {
  const { categoryRules } = getData();
  const exact = categoryRules
    .filter((r) => r.matchType === 'exact')
    .sort((a, b) => b.pattern.length - a.pattern.length);
  const contains = categoryRules
    .filter((r) => r.matchType === 'contains')
    .sort((a, b) => b.pattern.length - a.pattern.length);

  for (const txn of txns) {
    if (txn.categoryId) continue;
    const norm = normalize(txn.descriptor);
    const exactMatch = exact.find((r) => normalize(r.pattern) === norm);
    if (exactMatch) { txn.categoryId = exactMatch.categoryId; continue; }
    const containsMatch = contains.find((r) => norm.includes(normalize(r.pattern)));
    if (containsMatch) { txn.categoryId = containsMatch.categoryId; }
  }
}

export async function recategorizeAll(): Promise<number> {
  const { transactions, categoryRules } = getData();
  const exact = categoryRules
    .filter((r) => r.matchType === 'exact')
    .sort((a, b) => b.pattern.length - a.pattern.length);
  const contains = categoryRules
    .filter((r) => r.matchType === 'contains')
    .sort((a, b) => b.pattern.length - a.pattern.length);

  let count = 0;
  for (const txn of transactions) {
    if (txn.categoryId !== null) continue;
    const norm = normalize(txn.descriptor);
    let matched: CategoryRule | undefined;
    matched = exact.find((r) => normalize(r.pattern) === norm);
    if (!matched) matched = contains.find((r) => norm.includes(normalize(r.pattern)));
    if (matched) {
      txn.categoryId = matched.categoryId;
      count++;
    }
  }
  if (count > 0) await persistData();
  return count;
}

export async function bulkCategorizeByDescriptor(
  pattern: string,
  categoryId: number,
  matchType: 'exact' | 'contains',
): Promise<number> {
  const { transactions } = getData();
  const norm = normalize(pattern);
  let count = 0;
  for (const txn of transactions) {
    const txnNorm = normalize(txn.descriptor);
    const isMatch = matchType === 'exact' ? txnNorm === norm : txnNorm.includes(norm);
    if (isMatch) {
      txn.categoryId = categoryId;
      count++;
    }
  }
  if (count > 0) await persistData();
  return count;
}

export async function createRuleAndApply(
  pattern: string,
  categoryId: number,
  matchType: 'exact' | 'contains',
): Promise<number> {
  await addCategoryRule({ matchType, pattern: pattern.toLowerCase(), categoryId });
  return bulkCategorizeByDescriptor(pattern, categoryId, matchType);
}
