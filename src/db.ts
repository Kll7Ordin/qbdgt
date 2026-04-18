import { invoke } from '@tauri-apps/api/core';
import { buildSeedData, DEFAULT_BUDGET_ITEMS, DEFAULT_SAVINGS, DEFAULT_SAVINGS_BALANCES, DEFAULT_SPLIT_TEMPLATES, INCOME_CATEGORY_NAMES } from './seed';
import { isEncryptedFile, encryptData, decryptData } from './utils/crypto';

export interface Category {
  id: number;
  name: string;
  isIncome?: boolean; // if true, shown in Income section and excluded from expense remaining calc
  color?: string;     // hex color for UI chips
  note?: string;      // optional hover tooltip shown in budget view
  savingsBucketId?: number | null; // if set, transactions categorized here fill this savings bucket
}

// Palette: 30 visually distinct colors via golden-angle hue spread
export const CATEGORY_PALETTE: string[] = [
  '#d64141','#4dcb71','#7f28bd','#cbbb4d','#41bdd6','#b13377',
  '#66d641','#524dcb','#bd5a28','#4dcb9c','#ca41d6','#97b133',
  '#418cd6','#cb4d67','#28bd34','#7c4dcb','#d6a541','#33b1ac',
  '#d641b1','#86cb4d','#2840bd','#cb5d4d','#41d680','#8d33b1',
  '#cbcb4d','#41a8d6','#d6416e','#4dbd99','#bd9128','#6441d6',
];

function pickDistinctColor(existingCategories: Category[]): string {
  const used = new Set(existingCategories.map((c) => c.color).filter(Boolean));
  const unused = CATEGORY_PALETTE.find((c) => !used.has(c));
  if (unused) return unused;
  return CATEGORY_PALETTE[existingCategories.length % CATEGORY_PALETTE.length];
}

export async function updateCategoryColor(id: number, color: string): Promise<void> {
  const cat = data.categories.find((c) => c.id === id);
  if (cat) { cat.color = color; await persist(); }
}

export async function updateCategoryNote(id: number, note: string): Promise<void> {
  const cat = data.categories.find((c) => c.id === id);
  if (cat) { cat.note = note || undefined; await persist(); }
}

export async function updateCategoryBucket(id: number, bucketId: number | null): Promise<void> {
  const cat = data.categories.find((c) => c.id === id);
  if (cat) { cat.savingsBucketId = bucketId ?? undefined; await persist(); }
}

export async function updateCategoryIsIncome(id: number, isIncome: boolean): Promise<void> {
  const cat = data.categories.find((c) => c.id === id);
  if (cat) { cat.isIncome = isIncome || undefined; await persist(); }
}

export interface SplitRuleItem {
  categoryId: number;
  amount?: number;   // fixed $ amount
  percent?: number;  // percentage 0-100 (takes precedence if set)
}

export interface CategoryRule {
  id: number;
  matchType: 'exact' | 'contains';
  pattern: string;
  categoryId: number;
  amountMatch?: number | null; // optional: rule only applies if txn amount equals this (within 0.01)
  splits?: SplitRuleItem[];    // if set, transaction is split into these categories instead
}

export interface BudgetGroup {
  id: number;
  name: string;
  sortOrder: number;
  note?: string;
}

export interface Budget {
  id: number;
  month: string;
  categoryId: number;
  targetAmount: number;
  groupId?: number | null;
  sortOrder?: number;
}

export interface Transaction {
  id: number;
  source: string;
  sourceRef: string;
  txnDate: string;
  amount: number;
  instrument: string;
  descriptor: string;
  categoryId: number | null;
  linkedTransactionId: number | null;
  ignoreInBudget: boolean;
  comment: string | null;
}

export interface TransactionSplit {
  id: number;
  transactionId: number;
  categoryId: number;
  amount: number;
  txnDate?: string; // optional override — counts this portion in a different month
}

export interface SavingsBucket {
  id: number;
  name: string;
}

export interface SavingsEntry {
  id: number;
  entryDate: string;
  bucketId: number;
  amount: number;
  notes: string;
  source: 'manual' | 'auto_schedule';
  scheduleId: number | null;
}

export interface SavingsSchedule {
  id: number;
  bucketId: number;
  dayOfMonth: number;
  amount: number;
  startMonth: string;
  active: boolean;
}

export interface RecurringTemplate {
  id: number;
  descriptor: string;
  amount: number;
  instrument: string;
  categoryId: number | null;
  dayOfMonth: number;
  active: boolean;
  ignoreInBudget?: boolean; // true = income/credit transaction
}

export interface SplitTemplate {
  id: number;
  name: string;
  items: { categoryName: string; amount: number }[];
}

export interface AmazonOrder {
  orderNum: string;
  itemName: string;
  orderDate: string;
  amount: number;
  status: 'delivered' | 'returned' | 'cancelled';
}

export interface AISettings {
  ollamaUrl: string;
  model: string;
}

export interface CustomParser {
  id: string;
  name: string;
  instrument: string;
  code: string;        // TypeScript function body — evaled at runtime
  sampleLines: string; // First few lines of sample file, for reference
  createdAt: string;
}

export interface AICategoryFeedback {
  descriptor: string;       // lowercased descriptor
  suggestedCategoryId: number;
  acceptedCategoryId: number | null; // null = rejected (user chose different)
  outcome: 'accepted' | 'rejected';
}

export interface ExperimentalBudgetItem {
  categoryId: number;
  categoryName: string;
  groupId: number | null;
  groupName: string | null;
  targetAmount: number;
  sortOrder?: number;
  isIncome?: boolean;
}

export interface ExperimentalBudget {
  id: number;
  name: string;
  createdAt: string;
  items: ExperimentalBudgetItem[];
}

export interface AppData {
  nextId: number;
  categories: Category[];
  categoryRules: CategoryRule[];
  budgetGroups: BudgetGroup[];
  budgets: Budget[];
  transactions: Transaction[];
  transactionSplits: TransactionSplit[];
  savingsBuckets: SavingsBucket[];
  savingsEntries: SavingsEntry[];
  savingsSchedules: SavingsSchedule[];
  recurringTemplates: RecurringTemplate[];
  splitTemplates?: SplitTemplate[];
  savingsLoanAmount?: number;
  amazonOrders?: AmazonOrder[];
  aiSettings?: AISettings;
  customParsers?: CustomParser[];
  aiCategoryFeedback?: AICategoryFeedback[];
  experimentalBudgets?: ExperimentalBudget[];
  completedMigrations?: string[];
}

function emptyData(): AppData {
  return {
    nextId: 1,
    categories: [],
    categoryRules: [],
    budgetGroups: [],
    budgets: [],
    transactions: [],
    transactionSplits: [],
    savingsBuckets: [],
    savingsEntries: [],
    savingsSchedules: [],
    recurringTemplates: [],
    splitTemplates: [],
    experimentalBudgets: [],
  };
}

let data: AppData = emptyData();
let filePath: string | null = null;
let listeners: Array<() => void> = [];
let sessionPassword: string | null = null; // never written to disk

// Undo stack — up to 3 pre-mutation snapshots (JSON strings)
const _undoStack: string[] = [];
let _undoListeners: Array<() => void> = [];

export function pushUndoSnapshot(): void {
  _undoStack.push(JSON.stringify(data));
  if (_undoStack.length > 3) _undoStack.shift();
  for (const fn of _undoListeners) fn();
}

export async function undo(): Promise<boolean> {
  const snap = _undoStack.pop();
  if (!snap) return false;
  const parsed = JSON.parse(snap);
  data = { ...emptyData(), ...parsed };
  if (filePath) {
    const json = JSON.stringify(data, null, 2);
    const fileContent = sessionPassword ? await encryptData(json, sessionPassword) : json;
    await invoke('save_data', { path: filePath, data: fileContent });
  }
  data = { ...data };
  for (const fn of listeners) fn();
  for (const fn of _undoListeners) fn();
  return true;
}

export function canUndo(): boolean { return _undoStack.length > 0; }

export function subscribeUndo(fn: () => void): () => void {
  _undoListeners = [..._undoListeners, fn];
  return () => { _undoListeners = _undoListeners.filter((l) => l !== fn); };
}

function nextId(): number {
  return data.nextId++;
}

async function persist() {
  if (!filePath) return;
  const json = JSON.stringify(data, null, 2);
  const fileContent = sessionPassword ? await encryptData(json, sessionPassword) : json;
  await invoke('save_data', { path: filePath, data: fileContent });
  // Create a new reference so useSyncExternalStore detects the change
  data = { ...data };
  for (const fn of listeners) fn();
}

export function subscribe(fn: () => void): () => void {
  listeners = [...listeners, fn];
  return () => { listeners = listeners.filter((l) => l !== fn); };
}

export function getData(): AppData {
  return data;
}

export async function getLastFilePath(): Promise<string | null> {
  return invoke<string | null>('get_last_file_path');
}

export async function loadFromFile(path: string, password?: string): Promise<void> {
  const raw = await invoke<string>('load_data', { path });
  let jsonStr = raw;
  if (isEncryptedFile(raw)) {
    if (!password) throw new Error('FILE_ENCRYPTED');
    jsonStr = await decryptData(raw, password);
    sessionPassword = password;
  } else {
    sessionPassword = null;
  }
  const parsed = JSON.parse(jsonStr);
  data = { ...emptyData(), ...parsed };
  if (!data.recurringTemplates) data.recurringTemplates = [];
  if (!data.splitTemplates) data.splitTemplates = [];
  if (!data.budgetGroups) data.budgetGroups = [];
  if (!data.experimentalBudgets) data.experimentalBudgets = [];
  // Normalize transaction fields that may be missing in older records
  for (const t of data.transactions) {
    if (t.instrument == null) t.instrument = '';
    if (t.descriptor == null) t.descriptor = '';
    if (t.source == null) t.source = '';
    if (t.sourceRef == null) t.sourceRef = '';
  }
  filePath = path;
  await invoke('set_file_path', { path });
  for (const fn of listeners) fn();
}

export function isCurrentFileEncrypted(): boolean {
  return sessionPassword !== null;
}

export async function enableEncryption(password: string): Promise<void> {
  if (!password) throw new Error('Password cannot be empty');
  sessionPassword = password;
  await persist();
}

export async function changeEncryptionPassword(oldPassword: string, newPassword: string): Promise<void> {
  if (sessionPassword !== oldPassword) throw new Error('Current password is incorrect');
  if (!newPassword) throw new Error('New password cannot be empty');
  sessionPassword = newPassword;
  await persist();
}

export async function disableEncryption(): Promise<void> {
  sessionPassword = null;
  await persist();
}

export async function checkFileEncrypted(path: string): Promise<boolean> {
  try {
    const raw = await invoke<string>('load_data', { path });
    return isEncryptedFile(raw);
  } catch {
    return false;
  }
}

export async function createNewFile(path: string): Promise<void> {
  data = buildSeedData();
  filePath = path;
  await persist();
  await invoke('set_file_path', { path });
}

export async function fileExists(path: string): Promise<boolean> {
  return invoke<boolean>('file_exists', { path });
}

export function getFilePath(): string | null {
  return filePath;
}

/** Startup data cleanup — fixes known data integrity issues. */
export async function startupCleanup(): Promise<number> {
  let fixed = 0;
  const txnMap = new Map(data.transactions.map((t) => [t.id, t]));
  const seen = new Set<number>();

  for (const t of data.transactions) {
    // 1. Clear stale links (pointing to deleted transactions)
    if (t.linkedTransactionId && t.linkedTransactionId > 0) {
      const linked = txnMap.get(t.linkedTransactionId);
      if (!linked) {
        t.linkedTransactionId = null;
        fixed++;
      } else if (!seen.has(t.id) && linked.linkedTransactionId === t.id
          && t.amount > 0 && linked.amount > 0
          && Math.abs(t.amount - linked.amount) < 0.02) {
        // 2. Fix bidirectional refund links: negate the refund (higher id = later import)
        seen.add(t.id);
        seen.add(linked.id);
        const refund = t.id > linked.id ? t : linked;
        refund.amount = -Math.abs(refund.amount);
        fixed++;
      }
    }

    // 3. Fix PayPal transactions with wrong ignoreInBudget (payments marked as credits)
    if (t.instrument === 'PayPal' && t.ignoreInBudget && t.amount > 0 && t.linkedTransactionId === null) {
      t.ignoreInBudget = false;
      fixed++;
    }

    // 4. Fix recurring transactions from negative-amount templates
    if (t.source === 'recurring') {
      const tmpl = data.recurringTemplates.find((r) => String(r.id) === t.sourceRef);
      if (tmpl && tmpl.amount < 0 && t.amount > 0) {
        t.amount = -Math.abs(t.amount);
        t.ignoreInBudget = false;
        fixed++;
      }
    }
  }

  // 5. Migrate old Amazon transactions: extract order# from descriptor into sourceRef
  for (const t of data.transactions) {
    if (t.source === 'amazon_paste' && t.sourceRef === 'paste') {
      const m = t.descriptor.match(/#([\d-]+)$/);
      if (m) { t.sourceRef = m[1]; fixed++; }
    }
  }

  // 6. Migrate stale Amazon refund transactions (positive amount, ignoreInBudget, comment has 'Refund')
  // These were created as separate records; they should instead zero out the original payment.
  const staleRefundTxns = data.transactions.filter(
    (t) => t.source === 'amazon_payment' && t.amount > 0 && t.ignoreInBudget &&
      (t.comment ?? '').includes('Refund'),
  );
  const refundStaleIds = new Set<number>();
  // Group by orderNum so we process all payment-method splits together
  const refundsByOrder = new Map<string, typeof staleRefundTxns>();
  for (const r of staleRefundTxns) {
    const arr = refundsByOrder.get(r.sourceRef) ?? [];
    arr.push(r);
    refundsByOrder.set(r.sourceRef, arr);
  }
  for (const [orderNum, refunds] of refundsByOrder) {
    // Find non-stale originals (same orderNum, not in the stale set)
    const originals = data.transactions.filter(
      (t) => t.source === 'amazon_payment' && t.sourceRef === orderNum &&
        t.amount > 0 && !refunds.some((r) => r.id === t.id),
    );
    if (originals.length > 0) {
      for (const orig of originals) {
        orig.amount = 0;
        orig.ignoreInBudget = true;
        fixed++;
      }
    }
    // Delete the stale refund records regardless (original was zeroed, or no original exists → net $0)
    for (const r of refunds) refundStaleIds.add(r.id);
    fixed += refunds.length;
  }
  if (refundStaleIds.size > 0) {
    data.transactions = data.transactions.filter((t) => !refundStaleIds.has(t.id));
    data.transactionSplits = data.transactionSplits.filter((s) => !refundStaleIds.has(s.transactionId));
  }

  // 7. Remove zero-amount transactions (parsing errors, but keep intentionally-zeroed Amazon orders)
  const beforeZero = data.transactions.length;
  data.transactions = data.transactions.filter(
    (t) => t.amount !== 0 ||
      ((t.source === 'amazon_payment' || t.source === 'amazon_order') && t.ignoreInBudget),
  );
  fixed += beforeZero - data.transactions.length;

  // 7. Remove duplicate PayPal-linked re-imports (same date+amount+sourceRef, keep lowest id)
  const sourceKeys = new Map<string, number>();
  const dupIds = new Set<number>();
  for (const t of [...data.transactions].sort((a, b) => a.id - b.id)) {
    if (t.linkedTransactionId !== -1) continue; // only check PayPal-linked
    const key = `${t.txnDate}|${t.sourceRef}|${t.amount}`;
    if (sourceKeys.has(key)) {
      dupIds.add(t.id); // higher id = duplicate
    } else {
      sourceKeys.set(key, t.id);
    }
  }
  if (dupIds.size > 0) {
    const beforeDup = data.transactions.length;
    data.transactions = data.transactions.filter((t) => !dupIds.has(t.id));
    data.transactionSplits = data.transactionSplits.filter((s) => !dupIds.has(s.transactionId));
    fixed += beforeDup - data.transactions.length;
  }

  // 8. Zero out amazon_payment transactions for cancelled/returned orders
  const amazonOrders = data.amazonOrders ?? [];
  const cancelledOrderNums = new Set(
    amazonOrders
      .filter((o) => o.status === 'returned' || o.status === 'cancelled')
      .map((o) => o.orderNum),
  );
  for (const t of data.transactions) {
    if ((t.source === 'amazon_payment' || t.source === 'amazon_order') &&
        t.sourceRef && cancelledOrderNums.has(t.sourceRef) && t.amount > 0) {
      t.amount = 0;
      t.ignoreInBudget = true;
      fixed++;
    }
  }


  // 10. One-time: delete Recurring-instrument transactions except kept categories
  if (!data.completedMigrations) data.completedMigrations = [];
  if (!data.completedMigrations.includes('purgeRecurringInstrumentTxns')) {
    const keepNames = new Set(['Spotify Kathy', 'James RRSP Savings Transfer', 'James RRSP Employer Contributions']);
    const keepCatIds = new Set(data.categories.filter((c) => keepNames.has(c.name)).map((c) => c.id));
    const before = data.transactions.length;
    data.transactions = data.transactions.filter(
      (t) => t.instrument !== 'Recurring' || (t.categoryId != null && keepCatIds.has(t.categoryId))
    );
    data.transactionSplits = data.transactionSplits.filter(
      (s) => data.transactions.some((t) => t.id === s.transactionId)
    );
    fixed += before - data.transactions.length;
    data.completedMigrations.push('purgeRecurringInstrumentTxns');
  }

  // 10a. One-time: delete all savings schedules
  if (!data.completedMigrations) data.completedMigrations = [];
  if (!data.completedMigrations.includes('deleteAllSavingsSchedules')) {
    data.savingsSchedules = [];
    data.completedMigrations.push('deleteAllSavingsSchedules');
    fixed++;
  }

  // 10b. One-time: delete recurring templates and their transactions, keeping 3 categories
  if (!data.completedMigrations.includes('purgeRecurringTemplates')) {
    const keepNames = new Set(['Spotify Kathy', 'James RRSP Savings Transfer', 'James RRSP Employer Contributions']);
    const keepCatIds = new Set(data.categories.filter((c) => keepNames.has(c.name)).map((c) => c.id));
    // Delete templates not in kept categories
    data.recurringTemplates = data.recurringTemplates.filter(
      (t) => t.categoryId != null && keepCatIds.has(t.categoryId)
    );
    // Delete all Recurring-instrument transactions not in kept categories
    const beforeT = data.transactions.length;
    data.transactions = data.transactions.filter(
      (t) => t.instrument !== 'Recurring' || (t.categoryId != null && keepCatIds.has(t.categoryId))
    );
    data.transactionSplits = data.transactionSplits.filter(
      (s) => data.transactions.some((t) => t.id === s.transactionId)
    );
    fixed += beforeT - data.transactions.length;
    data.completedMigrations.push('purgeRecurringTemplates');
  }

  // 11. One-time: apply all existing split rules to matching transactions
  if (!data.completedMigrations.includes('applySplitRules')) {
    const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
    for (const rule of data.categoryRules) {
      if (!rule.splits || rule.splits.length < 2) continue;
      const ruleNorm = norm(rule.pattern);
      for (const txn of data.transactions) {
        const txnNorm = norm(txn.descriptor);
        const descMatch = rule.matchType === 'exact' ? txnNorm === ruleNorm : txnNorm.includes(ruleNorm);
        const amountOk = rule.amountMatch == null || Math.abs(rule.amountMatch - txn.amount) < 0.01;
        if (!descMatch || !amountOk) continue;
        data.transactionSplits = data.transactionSplits.filter((s) => s.transactionId !== txn.id);
        for (const s of rule.splits) {
          const amt = s.percent != null ? txn.amount * s.percent / 100 : (s.amount ?? 0);
          data.transactionSplits.push({ id: nextId(), transactionId: txn.id, categoryId: s.categoryId, amount: amt });
        }
        fixed++;
      }
    }
    data.completedMigrations.push('applySplitRules');
  }

  // 12. Backfill category colors for categories that don't have one yet
  let colorized = 0;
  for (let i = 0; i < data.categories.length; i++) {
    if (!data.categories[i].color) {
      data.categories[i].color = CATEGORY_PALETTE[i % CATEGORY_PALETTE.length];
      colorized++;
    }
  }

  if (fixed > 0 || colorized > 0) await persist();
  return fixed;
}

// --- Categories ---
export async function addCategory(name: string): Promise<number> {
  const id = nextId();
  const color = pickDistinctColor(data.categories);
  data.categories.push({ id, name, color });
  await persist();
  return id;
}

export async function deleteCategory(id: number): Promise<void> {
  data.categories = data.categories.filter((c) => c.id !== id);
  data.categoryRules = data.categoryRules.filter((r) => r.categoryId !== id);
  await persist();
}

// --- Category Rules ---
export async function addCategoryRule(rule: Omit<CategoryRule, 'id'>): Promise<number> {
  const id = nextId();
  data.categoryRules.push({ id, ...rule });
  await persist();
  return id;
}

export async function updateCategoryRule(id: number, updates: Partial<Omit<CategoryRule, 'id'>>): Promise<void> {
  const r = data.categoryRules.find((r) => r.id === id);
  if (r) { Object.assign(r, updates); await persist(); }
}

export async function deleteCategoryRule(id: number): Promise<void> {
  data.categoryRules = data.categoryRules.filter((r) => r.id !== id);
  await persist();
}

export async function setSavingsLoanAmount(amount: number): Promise<void> {
  data.savingsLoanAmount = amount;
  await persist();
}

// --- Budget Groups ---
export async function addBudgetGroup(name: string): Promise<number> {
  const maxOrder = data.budgetGroups.reduce((m, g) => Math.max(m, g.sortOrder), -1);
  const id = nextId();
  data.budgetGroups.push({ id, name, sortOrder: maxOrder + 1 });
  await persist();
  return id;
}

export async function updateBudgetGroup(id: number, updates: Partial<BudgetGroup>): Promise<void> {
  const g = data.budgetGroups.find((x) => x.id === id);
  if (g) Object.assign(g, updates);
  await persist();
}

export async function deleteBudgetGroup(id: number): Promise<void> {
  pushUndoSnapshot();
  data.budgetGroups = data.budgetGroups.filter((g) => g.id !== id);
  for (const b of data.budgets) {
    if (b.groupId === id) b.groupId = null;
  }
  await persist();
}

// --- Budgets ---
export async function upsertBudget(month: string, categoryId: number, targetAmount: number, groupId?: number | null, sortOrder?: number): Promise<void> {
  const existing = data.budgets.find((b) => b.month === month && b.categoryId === categoryId);
  if (existing) {
    existing.targetAmount = targetAmount;
    if (groupId !== undefined) existing.groupId = groupId;
    if (sortOrder !== undefined) existing.sortOrder = sortOrder;
  } else {
    const group = groupId ?? null;
    const inGroup = data.budgets.filter((b) => b.month === month && (b.groupId ?? null) === group);
    const maxOrder = inGroup.reduce((m, b) => Math.max(m, b.sortOrder ?? 0), -1);
    const order = sortOrder ?? maxOrder + 1;
    data.budgets.push({ id: nextId(), month, categoryId, targetAmount, groupId: group, sortOrder: order });
  }
  await persist();
}

export async function reorderBudgetsInGroup(month: string, groupId: number | null, categoryIdsInOrder: number[]): Promise<void> {
  pushUndoSnapshot();
  for (let i = 0; i < categoryIdsInOrder.length; i++) {
    const b = data.budgets.find((x) => x.month === month && x.categoryId === categoryIdsInOrder[i]);
    if (b) {
      b.groupId = groupId;
      b.sortOrder = i;
    }
  }
  await persist();
}

export async function deleteBudget(month: string, categoryId: number): Promise<void> {
  pushUndoSnapshot();
  data.budgets = data.budgets.filter((b) => !(b.month === month && b.categoryId === categoryId));
  await persist();
}

export async function copyBudgetToMonths(sourceMonth: string, targetMonths: string[]): Promise<void> {
  pushUndoSnapshot();
  const source = data.budgets.filter((b) => b.month === sourceMonth);
  for (const target of targetMonths) {
    // Remove all existing budget entries for the target month
    data.budgets = data.budgets.filter((b) => b.month !== target);
    // Copy each entry from the source month
    for (const b of source) {
      data.budgets.push({
        id: nextId(),
        month: target,
        categoryId: b.categoryId,
        targetAmount: b.targetAmount,
        groupId: b.groupId ?? null,
        sortOrder: b.sortOrder,
      });
    }
  }
  await persist();
}

// --- Transactions ---
export async function addTransaction(txn: Omit<Transaction, 'id'>): Promise<number> {
  const id = nextId();
  data.transactions.push({ id, ...txn });
  await persist();
  return id;
}

export async function updateTransaction(id: number, updates: Partial<Transaction>): Promise<void> {
  const txn = data.transactions.find((t) => t.id === id);
  if (txn) Object.assign(txn, updates);
  await persist();
}

export async function bulkAddTransactions(txns: Omit<Transaction, 'id'>[]): Promise<number[]> {
  const ids: number[] = [];
  for (const t of txns) {
    const id = nextId();
    data.transactions.push({ id, ...t });
    ids.push(id);
  }
  await persist();
  return ids;
}

export async function deleteTransactions(ids: number[]): Promise<void> {
  const idSet = new Set(ids);
  data.transactions = data.transactions.filter((t) => !idSet.has(t.id));
  data.transactionSplits = data.transactionSplits.filter((s) => !idSet.has(s.transactionId));
  await persist();
}

/** Permanently delete transactions (and their splits) for a given month, optionally filtered by instrument.
 *  When instrument is 'PayPal', reverts PayPal-linked bank transactions to their original state
 *  instead of deleting them, and deletes any remaining pure PayPal-instrument transactions.
 *  Does not affect category rules. */
export async function purgeTransactionsByMonth(month: string, instrument?: string): Promise<number> {
  const prefix = `${month}-`;
  let affected = 0;

  if (instrument === 'PayPal') {
    const inMonth = data.transactions.filter((t) => t.txnDate.startsWith(prefix));

    for (const t of inMonth) {
      if (t.linkedTransactionId === -1) {
        // Clear PayPal-linked state; descriptor already contains the enriched PayPal info
        t.linkedTransactionId = null;
        t.categoryId = null;
        affected++;
      } else if (t.instrument === 'PayPal') {
        data.transactions = data.transactions.filter((x) => x.id !== t.id);
        data.transactionSplits = data.transactionSplits.filter((s) => s.transactionId !== t.id);
        affected++;
      }
    }
  } else {
    const toDelete = data.transactions
      .filter((t) => t.txnDate.startsWith(prefix) && (!instrument || t.instrument === instrument))
      .map((t) => t.id);
    const ids = new Set(toDelete);
    data.transactions = data.transactions.filter((t) => !ids.has(t.id));
    data.transactionSplits = data.transactionSplits.filter((s) => !ids.has(s.transactionId));
    affected = toDelete.length;
  }

  await persist();
  return affected;
}

// --- Transaction Splits ---
export async function setSplits(transactionId: number, splits: Omit<TransactionSplit, 'id' | 'transactionId'>[]): Promise<void> {
  data.transactionSplits = data.transactionSplits.filter((s) => s.transactionId !== transactionId);
  for (const s of splits) {
    data.transactionSplits.push({ id: nextId(), transactionId, ...s });
  }
  await persist();
}

export async function clearSplits(transactionId: number): Promise<void> {
  data.transactionSplits = data.transactionSplits.filter((s) => s.transactionId !== transactionId);
  await persist();
}

// --- Savings ---
export async function addSavingsBucket(name: string): Promise<number> {
  const id = nextId();
  data.savingsBuckets.push({ id, name });
  await persist();
  return id;
}

export async function deleteSavingsBucket(id: number): Promise<void> {
  data.savingsBuckets = data.savingsBuckets.filter((b) => b.id !== id);
  data.savingsEntries = data.savingsEntries.filter((e) => e.bucketId !== id);
  data.savingsSchedules = data.savingsSchedules.filter((s) => s.bucketId !== id);
  await persist();
}

export async function addSavingsEntry(entry: Omit<SavingsEntry, 'id'>): Promise<void> {
  data.savingsEntries.push({ id: nextId(), ...entry });
  await persist();
}

export async function deleteSavingsEntry(id: number): Promise<void> {
  data.savingsEntries = data.savingsEntries.filter((e) => e.id !== id);
  await persist();
}

/** Remove all auto-generated schedule entries. Use this when switching to transaction-based contributions. */
export async function clearAutoScheduleEntries(): Promise<number> {
  const before = data.savingsEntries.length;
  data.savingsEntries = data.savingsEntries.filter((e) => e.source !== 'auto_schedule');
  const removed = before - data.savingsEntries.length;
  if (removed > 0) await persist();
  return removed;
}

export async function addSavingsSchedule(sched: Omit<SavingsSchedule, 'id'>): Promise<void> {
  data.savingsSchedules.push({ id: nextId(), ...sched });
  await persist();
}

export async function updateSavingsSchedule(id: number, updates: Partial<SavingsSchedule>): Promise<void> {
  const s = data.savingsSchedules.find((x) => x.id === id);
  if (s) Object.assign(s, updates);
  await persist();
}

export async function deleteSavingsSchedule(id: number): Promise<void> {
  data.savingsSchedules = data.savingsSchedules.filter((s) => s.id !== id);
  await persist();
}

export async function deleteAllSavingsSchedules(): Promise<number> {
  const count = data.savingsSchedules.length;
  data.savingsSchedules = [];
  if (count > 0) await persist();
  return count;
}

// --- Recurring Templates ---
export async function addRecurringTemplate(t: Omit<RecurringTemplate, 'id'>): Promise<number> {
  const id = nextId();
  data.recurringTemplates.push({ id, ...t });
  await persist();
  return id;
}

export async function deleteRecurringTemplate(id: number): Promise<void> {
  data.recurringTemplates = data.recurringTemplates.filter((t) => t.id !== id);
  await persist();
}

export async function updateRecurringTemplate(id: number, updates: Partial<RecurringTemplate>): Promise<void> {
  const t = data.recurringTemplates.find((x) => x.id === id);
  if (t) Object.assign(t, updates);
  await persist();
}

// --- Amazon Orders (reference data for product names) ---

export function getAmazonOrder(orderNum: string): AmazonOrder | undefined {
  return (data.amazonOrders ?? []).find((o) => o.orderNum === orderNum);
}

export async function addAmazonOrders(orders: AmazonOrder[]): Promise<{ added: number; linked: number }> {
  if (!data.amazonOrders) data.amazonOrders = [];
  const existingMap = new Map(data.amazonOrders.map((o) => [o.orderNum, o]));

  let added = 0;
  const toBackfill: AmazonOrder[] = [];
  const toZeroOut: AmazonOrder[] = []; // returned/cancelled orders that need existing payments zeroed

  for (const order of orders) {
    const existing = existingMap.get(order.orderNum);
    const isReturnedOrCancelled = order.status === 'returned' || order.status === 'cancelled';
    if (!existing) {
      data.amazonOrders.push(order);
      existingMap.set(order.orderNum, order);
      added++;
      if (order.itemName) toBackfill.push(order);
      if (isReturnedOrCancelled) toZeroOut.push(order);
    } else {
      if (order.itemName && order.itemName !== existing.itemName) {
        existing.itemName = order.itemName;
        toBackfill.push(existing);
      }
      if (order.status !== existing.status) {
        const wasReturned = existing.status === 'returned' || existing.status === 'cancelled';
        existing.status = order.status;
        if (isReturnedOrCancelled && !wasReturned) toZeroOut.push(existing);
      }
    }
  }

  // Backfill descriptors for added/updated orders
  let linked = 0;
  for (const order of toBackfill) {
    const txns = data.transactions.filter(
      (t) => (t.source === 'amazon_payment' || t.source === 'amazon_order') && t.sourceRef === order.orderNum,
    );
    for (const t of txns) {
      t.descriptor = `Amazon | ${order.itemName} | #${order.orderNum}`;
      linked++;
    }
  }

  // Zero out transactions for returned/cancelled orders
  for (const order of toZeroOut) {
    const txns = data.transactions.filter(
      (t) => (t.source === 'amazon_payment' || t.source === 'amazon_order') &&
        t.sourceRef === order.orderNum && t.amount > 0,
    );
    for (const t of txns) {
      t.amount = 0;
      t.ignoreInBudget = true;
    }
  }

  await persist();
  return { added, linked };
}

// --- Split Templates ---
export async function addSplitTemplate(template: Omit<SplitTemplate, 'id'>): Promise<void> {
  const id = nextId();
  data.splitTemplates = data.splitTemplates ?? [];
  data.splitTemplates.push({ id, ...template });
  await persist();
}

// --- Add default budget for a specific month (for empty months) ---
export async function addDefaultBudgetForMonth(month: string): Promise<void> {
  const catByName = new Map(data.categories.map((c) => [c.name, c.id]));
  for (const { name, amount } of DEFAULT_BUDGET_ITEMS) {
    const catId = catByName.get(name);
    if (catId != null) {
      const existing = data.budgets.find((b) => b.month === month && b.categoryId === catId);
      if (!existing) {
        data.budgets.push({ id: nextId(), month, categoryId: catId, targetAmount: amount });
      }
    }
  }
  await persist();
}

// --- Load default budget (for existing files) ---
export async function loadDefaultBudget(): Promise<void> {
  const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const budgetMonths = [month, '2026-01', '2026-02', '2026-03'];
  const existingNames = new Set(data.categories.map((c) => c.name.toLowerCase()));

  for (const { name } of DEFAULT_BUDGET_ITEMS) {
    if (!existingNames.has(name.toLowerCase())) {
      const id = nextId();
      data.categories.push({ id, name, isIncome: INCOME_CATEGORY_NAMES.has(name) });
      existingNames.add(name.toLowerCase());
    }
  }

  const catByName = new Map(data.categories.map((c) => [c.name, c.id]));
  for (const m of budgetMonths) {
    for (const { name, amount } of DEFAULT_BUDGET_ITEMS) {
      const catId = catByName.get(name);
      if (catId != null) {
        const existing = data.budgets.find((b) => b.month === m && b.categoryId === catId);
        if (existing) {
          existing.targetAmount = amount;
        } else {
          data.budgets.push({ id: nextId(), month: m, categoryId: catId, targetAmount: amount });
        }
      }
    }
  }

  if ((data.savingsBuckets?.length ?? 0) === 0) {
    data.savingsBuckets = data.savingsBuckets ?? [];
    data.savingsSchedules = data.savingsSchedules ?? [];
    data.savingsEntries = data.savingsEntries ?? [];
    const bucketIdByName = new Map<string, number>();
    const today = new Date().toISOString().slice(0, 10);
    for (const { bucket, amount } of DEFAULT_SAVINGS) {
      const bucketId = nextId();
      data.savingsBuckets.push({ id: bucketId, name: bucket });
      bucketIdByName.set(bucket, bucketId);
      data.savingsSchedules.push({
        id: nextId(),
        bucketId,
        dayOfMonth: 1,
        amount,
        startMonth: month,
        active: true,
      });
    }
    for (const { bucket, amount } of DEFAULT_SAVINGS_BALANCES) {
      const bucketId = bucketIdByName.get(bucket);
      if (bucketId != null && amount !== 0) {
        data.savingsEntries.push({
          id: nextId(),
          entryDate: today,
          bucketId,
          amount,
          notes: 'Opening balance',
          source: 'manual',
          scheduleId: null,
        });
      }
    }
  }

  if ((data.splitTemplates?.length ?? 0) === 0) {
    data.splitTemplates = data.splitTemplates ?? [];
    for (const t of DEFAULT_SPLIT_TEMPLATES) {
      data.splitTemplates.push({ id: nextId(), name: t.name, items: t.items });
    }
  }

  await persist();
}

// --- Utility: persist without generating new data (for logic modules) ---
export async function persistData(): Promise<void> {
  await persist();
}

// --- AI Settings ---
export function getAISettings(): AISettings {
  return data.aiSettings ?? { ollamaUrl: 'http://localhost:11434', model: 'qwen2.5:7b' };
}

export async function updateAISettings(settings: AISettings): Promise<void> {
  data.aiSettings = settings;
  await persist();
}

// --- AI Category Feedback ---
export function getAICategoryFeedback(): AICategoryFeedback[] {
  return data.aiCategoryFeedback ?? [];
}

export async function logAICategoryFeedback(
  descriptor: string,
  suggestedCategoryId: number,
  outcome: 'accepted' | 'rejected',
  acceptedCategoryId: number | null,
): Promise<void> {
  if (!data.aiCategoryFeedback) data.aiCategoryFeedback = [];
  // Keep last 500 feedback entries to avoid unbounded growth
  data.aiCategoryFeedback.push({
    descriptor: descriptor.toLowerCase(),
    suggestedCategoryId,
    acceptedCategoryId,
    outcome,
  });
  if (data.aiCategoryFeedback.length > 500) {
    data.aiCategoryFeedback = data.aiCategoryFeedback.slice(-500);
  }
  await persist();
}

// --- Custom Parsers ---
export function getCustomParsers(): CustomParser[] {
  return data.customParsers ?? [];
}

export async function saveCustomParser(parser: CustomParser): Promise<void> {
  if (!data.customParsers) data.customParsers = [];
  const idx = data.customParsers.findIndex((p) => p.id === parser.id);
  if (idx >= 0) data.customParsers[idx] = parser;
  else data.customParsers.push(parser);
  await persist();
}

export async function deleteCustomParser(id: string): Promise<void> {
  data.customParsers = (data.customParsers ?? []).filter((p) => p.id !== id);
  await persist();
}

/** Execute a custom parser code string against file content. */
export function executeCustomParser(
  code: string,
  text: string,
  filename: string,
): Omit<Transaction, 'id'>[] {
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('text', 'filename', `
      ${code}
      return parseTransactions(text, filename);
    `);
    const result = fn(text, filename);
    if (!Array.isArray(result)) return [];
    return result as Omit<Transaction, 'id'>[];
  } catch (e) {
    console.error('[CustomParser] Error executing parser:', e);
    throw e;
  }
}

// --- Experimental Budgets ---
export function getExperimentalBudgets(): ExperimentalBudget[] {
  return data.experimentalBudgets ?? [];
}

export async function saveExperimentalBudget(budget: Omit<ExperimentalBudget, 'id'> & { id?: number }): Promise<ExperimentalBudget> {
  if (!data.experimentalBudgets) data.experimentalBudgets = [];
  if (budget.id != null) {
    const idx = data.experimentalBudgets.findIndex((b) => b.id === budget.id);
    if (idx >= 0) {
      const updated = { ...budget, id: budget.id! } as ExperimentalBudget;
      data.experimentalBudgets[idx] = updated;
      await persist();
      return updated;
    }
  }
  const nb: ExperimentalBudget = { ...budget, id: nextId() };
  data.experimentalBudgets.push(nb);
  await persist();
  return nb;
}

export async function deleteExperimentalBudget(id: number): Promise<void> {
  if (!data.experimentalBudgets) return;
  data.experimentalBudgets = data.experimentalBudgets.filter((b) => b.id !== id);
  await persist();
}
