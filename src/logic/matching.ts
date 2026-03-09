import { db, type Transaction } from '../db';

function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((t) => t.length > 2),
  );
}

function tokenOverlap(a: Set<string>, b: Set<string>): number {
  let overlap = 0;
  for (const t of a) if (b.has(t)) overlap++;
  const total = Math.max(a.size, b.size, 1);
  return overlap / total;
}

function dateDiffDays(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00');
  const db2 = new Date(b + 'T00:00:00');
  return Math.abs((da.getTime() - db2.getTime()) / 86400000);
}

export async function matchPaypalTransactions(
  paypalTxns: Transaction[],
): Promise<number> {
  const nonPaypal = await db.transactions
    .filter((t) => t.instrument !== 'PayPal' && t.linkedTransactionId === null)
    .toArray();

  let matched = 0;
  const usedIds = new Set<number>();

  for (const pp of paypalTxns) {
    if (pp.id === undefined) continue;
    const ppTokens = tokenize(pp.descriptor);
    let bestMatch: Transaction | null = null;
    let bestScore = 0;

    for (const other of nonPaypal) {
      if (other.id === undefined || usedIds.has(other.id)) continue;
      if (Math.abs(pp.amount - other.amount) > 0.02) continue;
      if (dateDiffDays(pp.txnDate, other.txnDate) > 3) continue;

      const score = tokenOverlap(ppTokens, tokenize(other.descriptor));
      if (score > bestScore || bestMatch === null) {
        bestScore = score;
        bestMatch = other;
      }
    }

    if (bestMatch && bestMatch.id !== undefined) {
      await db.transactions.update(pp.id, { linkedTransactionId: bestMatch.id });
      await db.transactions.update(bestMatch.id, { linkedTransactionId: pp.id });
      usedIds.add(bestMatch.id);
      matched++;
    }
  }

  return matched;
}
