import { db, type Transaction } from '../db';

function normalize(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

function tokenize(s: string): string[] {
  return normalize(s).replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((t) => t.length > 2);
}

function tokenOverlap(a: string[], b: string[]): number {
  const setB = new Set(b);
  let overlap = 0;
  for (const t of a) if (setB.has(t)) overlap++;
  return overlap / Math.max(a.length, b.length, 1);
}

export interface RefundCandidate {
  refundTxn: Transaction;
  originalTxn: Transaction;
  score: number;
}

export async function findRefundCandidates(
  creditTxns: Transaction[],
): Promise<RefundCandidate[]> {
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const cutoff = threeMonthsAgo.toISOString().split('T')[0];

  const historicalExpenses = await db.transactions
    .where('txnDate')
    .aboveOrEqual(cutoff)
    .filter((t) => !t.ignoreInBudget && t.linkedTransactionId === null)
    .toArray();

  const results: RefundCandidate[] = [];

  for (const credit of creditTxns) {
    const creditTokens = tokenize(credit.descriptor);
    let bestMatch: Transaction | null = null;
    let bestScore = 0;

    for (const expense of historicalExpenses) {
      if (expense.id === credit.id) continue;
      if (Math.abs(expense.amount - credit.amount) > 0.02) continue;
      if (expense.txnDate > credit.txnDate) continue;

      const score = tokenOverlap(creditTokens, tokenize(expense.descriptor));
      const finalScore = score + (expense.instrument === credit.instrument ? 0.2 : 0);

      if (finalScore > bestScore) {
        bestScore = finalScore;
        bestMatch = expense;
      }
    }

    if (bestMatch && bestScore >= 0.1) {
      results.push({ refundTxn: credit, originalTxn: bestMatch, score: bestScore });
    }
  }

  return results;
}

export async function applyRefundToOriginalMonth(
  refundId: number,
  originalId: number,
): Promise<void> {
  const original = await db.transactions.get(originalId);
  if (!original) return;

  await db.transactions.update(refundId, {
    txnDate: original.txnDate,
    linkedTransactionId: originalId,
    categoryId: original.categoryId,
    ignoreInBudget: false,
  });
  await db.transactions.update(originalId, {
    linkedTransactionId: refundId,
  });
}
