import { invoke } from '@tauri-apps/api/core';

export interface Category {
  id: number;
  name: string;
}

export interface CategoryRule {
  id: number;
  matchType: 'exact' | 'contains';
  pattern: string;
  categoryId: number;
}

export interface Budget {
  id: number;
  month: string;
  categoryId: number;
  targetAmount: number;
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
}

export interface AppData {
  nextId: number;
  categories: Category[];
  categoryRules: CategoryRule[];
  budgets: Budget[];
  transactions: Transaction[];
  transactionSplits: TransactionSplit[];
  savingsBuckets: SavingsBucket[];
  savingsEntries: SavingsEntry[];
  savingsSchedules: SavingsSchedule[];
  recurringTemplates: RecurringTemplate[];
}

function emptyData(): AppData {
  return {
    nextId: 1,
    categories: [],
    categoryRules: [],
    budgets: [],
    transactions: [],
    transactionSplits: [],
    savingsBuckets: [],
    savingsEntries: [],
    savingsSchedules: [],
    recurringTemplates: [],
  };
}

let data: AppData = emptyData();
let filePath: string | null = null;
let listeners: Array<() => void> = [];

function nextId(): number {
  return data.nextId++;
}

async function persist() {
  if (!filePath) return;
  const json = JSON.stringify(data, null, 2);
  await invoke('save_data', { path: filePath, data: json });
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

export async function loadFromFile(path: string): Promise<void> {
  const raw = await invoke<string>('load_data', { path });
  const parsed = JSON.parse(raw);
  data = { ...emptyData(), ...parsed };
  if (!data.recurringTemplates) data.recurringTemplates = [];
  filePath = path;
  await invoke('set_file_path', { path });
  for (const fn of listeners) fn();
}

export async function createNewFile(path: string): Promise<void> {
  data = emptyData();
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

// --- Categories ---
export async function addCategory(name: string): Promise<number> {
  const id = nextId();
  data.categories.push({ id, name });
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

export async function deleteCategoryRule(id: number): Promise<void> {
  data.categoryRules = data.categoryRules.filter((r) => r.id !== id);
  await persist();
}

// --- Budgets ---
export async function upsertBudget(month: string, categoryId: number, targetAmount: number): Promise<void> {
  const existing = data.budgets.find((b) => b.month === month && b.categoryId === categoryId);
  if (existing) {
    existing.targetAmount = targetAmount;
  } else {
    data.budgets.push({ id: nextId(), month, categoryId, targetAmount });
  }
  await persist();
}

export async function deleteBudget(month: string, categoryId: number): Promise<void> {
  data.budgets = data.budgets.filter((b) => !(b.month === month && b.categoryId === categoryId));
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

export async function addSavingsSchedule(sched: Omit<SavingsSchedule, 'id'>): Promise<void> {
  data.savingsSchedules.push({ id: nextId(), ...sched });
  await persist();
}

export async function updateSavingsSchedule(id: number, updates: Partial<SavingsSchedule>): Promise<void> {
  const s = data.savingsSchedules.find((x) => x.id === id);
  if (s) Object.assign(s, updates);
  await persist();
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

// --- Utility: persist without generating new data (for logic modules) ---
export async function persistData(): Promise<void> {
  await persist();
}
