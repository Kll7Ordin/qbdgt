import { getData, addCategoryRule, persistData, setSplits, type Transaction, type CategoryRule, type SplitRuleItem } from '../db';

function normalize(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

// ── Transaction guessing (4-tier point system) ────────────────────────────────

// Strip ID-like tokens: long digit sequences, reference codes like G150027389
function stripIds(s: string): string {
  return s
    .replace(/[A-Z]?\d{6,}/gi, '') // long digit sequences with optional letter prefix
    .replace(/[#*]\S+/g, '')        // #ref or *ref tokens
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

// Common noise words to exclude from keyword matching
const NOISE_WORDS = new Set([
  'the','a','an','and','or','for','of','to','in','at','by','with','from',
  'on','is','it','as','be','was','but','not','are','do','did','has','have',
  // Payment types
  'pos','gpos','purchase','payment','debit','credit','transfer','deposit',
  'withdrawal','auto','bill','pre','authorized',
  // Geographic noise
  'bc','ab','on','qc','mb','sk','ns','nb','nl','pe','nt','yt','nu',
  'canada','canadian','inc','ltd','llc','co','corp','company',
]);

// Compute fuzzy similarity (Dice coefficient on trigrams)
function diceSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const trigramsA = new Set<string>();
  const trigramsB = new Set<string>();
  for (let i = 0; i < a.length - 2; i++) trigramsA.add(a.slice(i, i + 3));
  for (let i = 0; i < b.length - 2; i++) trigramsB.add(b.slice(i, i + 3));
  let intersection = 0;
  for (const t of trigramsA) if (trigramsB.has(t)) intersection++;
  return (2 * intersection) / (trigramsA.size + trigramsB.size);
}

/**
 * Compute guess scores for all categories using a 4-tier point system:
 * Cat 1 = exact descriptor match (40 pts)
 * Cat 2 = match after stripping IDs/numbers (25 pts)
 * Cat 3 = fuzzy trigram match ≥ 0.6 similarity (10 pts)
 * Cat 4 = shared meaningful keywords (1 pt each)
 */
function computeGuessScores(descriptor: string, transactions: Transaction[]): Map<number, number> {
  const norm = normalize(descriptor);
  const stripped = stripIds(descriptor);
  const words = stripped.split(/\s+/).filter((w) => w.length >= 3 && !NOISE_WORDS.has(w));

  const scores = new Map<number, number>();
  const addScore = (catId: number | null, pts: number) => {
    if (catId == null) return;
    scores.set(catId, (scores.get(catId) ?? 0) + pts);
  };

  for (const t of transactions) {
    if (t.categoryId == null || t.ignoreInBudget) continue;
    const tNorm = normalize(t.descriptor);
    const tStripped = stripIds(t.descriptor);

    if (tNorm === norm) { addScore(t.categoryId, 40); continue; }
    if (tStripped === stripped && stripped.length > 2) { addScore(t.categoryId, 25); continue; }
    const sim = diceSimilarity(norm, tNorm);
    if (sim >= 0.6) { addScore(t.categoryId, 10); continue; }
    const tWords = tStripped.split(/\s+/).filter((w) => w.length >= 3 && !NOISE_WORDS.has(w));
    const shared = words.filter((w) => tWords.includes(w)).length;
    if (shared > 0) addScore(t.categoryId, shared);
  }

  return scores;
}

/** Returns the best-match categoryId, or null if no match. */
export function guessCategory(descriptor: string, transactions: Transaction[]): number | null {
  const scores = computeGuessScores(descriptor, transactions);
  if (scores.size === 0) return null;
  return [...scores.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** Returns the full score map (catId → points) for tooltip display. */
export function getGuessScores(descriptor: string, transactions: Transaction[]): Map<number, number> {
  return computeGuessScores(descriptor, transactions);
}

export interface SplitAction {
  txnIndex: number;
  splits: Array<{ categoryId: number; amount: number }>;
}

function resolveSplits(items: SplitRuleItem[], txnAmount: number): Array<{ categoryId: number; amount: number }> {
  return items.map((s) => ({
    categoryId: s.categoryId,
    amount: s.percent != null ? txnAmount * s.percent / 100 : (s.amount ?? 0),
  }));
}

export function categorizeTransactionsInPlace(txns: Omit<Transaction, 'id'>[]): SplitAction[] {
  const { categoryRules } = getData();
  const exact = categoryRules
    .filter((r) => r.matchType === 'exact')
    .sort((a, b) => b.pattern.length - a.pattern.length);
  const contains = categoryRules
    .filter((r) => r.matchType === 'contains')
    .sort((a, b) => b.pattern.length - a.pattern.length);

  const splitActions: SplitAction[] = [];

  for (let i = 0; i < txns.length; i++) {
    const txn = txns[i];
    if (txn.categoryId) continue;
    const norm = normalize(txn.descriptor);
    const amountMatch = (r: CategoryRule) =>
      r.amountMatch == null || Math.abs((r.amountMatch ?? 0) - txn.amount) < 0.01;
    const exactMatch = exact.find((r) => normalize(r.pattern) === norm && amountMatch(r));
    const match = exactMatch ?? contains.find((r) => norm.includes(normalize(r.pattern)) && amountMatch(r));
    if (!match) continue;

    if (match.splits && match.splits.length >= 2) {
      splitActions.push({ txnIndex: i, splits: resolveSplits(match.splits, txn.amount) });
    } else {
      txn.categoryId = match.categoryId;
    }
  }

  return splitActions;
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
  const amountMatch = (r: CategoryRule, txn: Transaction) =>
    r.amountMatch == null || Math.abs((r.amountMatch ?? 0) - txn.amount) < 0.01;
  for (const txn of transactions) {
    if (txn.categoryId !== null) continue;
    const norm = normalize(txn.descriptor);
    let matched: CategoryRule | undefined;
    matched = exact.find((r) => normalize(r.pattern) === norm && amountMatch(r, txn));
    if (!matched) matched = contains.find((r) => norm.includes(normalize(r.pattern)) && amountMatch(r, txn));
    if (matched) {
      if (!matched.splits || matched.splits.length < 2) {
        txn.categoryId = matched.categoryId;
      }
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
  amount?: number | null,
): Promise<number> {
  const { transactions } = getData();
  const norm = normalize(pattern);
  let count = 0;
  for (const txn of transactions) {
    const txnNorm = normalize(txn.descriptor);
    const descMatch = matchType === 'exact' ? txnNorm === norm : txnNorm.includes(norm);
    const amountOk = amount == null || Math.abs(amount - txn.amount) < 0.01;
    const isMatch = descMatch && amountOk;
    if (isMatch) {
      txn.categoryId = categoryId;
      count++;
    }
  }
  if (count > 0) await persistData();
  return count;
}

export async function bulkApplySplitRule(
  pattern: string,
  matchType: 'exact' | 'contains',
  amount: number | null,
  splits: SplitRuleItem[],
): Promise<number> {
  const { transactions } = getData();
  const norm = normalize(pattern);
  let count = 0;
  for (const txn of transactions) {
    const txnNorm = normalize(txn.descriptor);
    const descMatch = matchType === 'exact' ? txnNorm === norm : txnNorm.includes(norm);
    const amountOk = amount == null || Math.abs(amount - txn.amount) < 0.01;
    if (!descMatch || !amountOk) continue;
    const resolved = resolveSplits(splits, txn.amount);
    await setSplits(txn.id, resolved.map((s) => ({ categoryId: s.categoryId, amount: s.amount })));
    count++;
  }
  return count;
}

export async function createRuleAndApply(
  pattern: string,
  categoryId: number,
  matchType: 'exact' | 'contains',
  amount?: number | null,
): Promise<number> {
  await addCategoryRule({ matchType, pattern: pattern.toLowerCase(), categoryId, amountMatch: amount ?? null });
  return bulkCategorizeByDescriptor(pattern, categoryId, matchType, amount);
}
