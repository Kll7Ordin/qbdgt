import Dexie, { type EntityTable } from 'dexie';

export interface Category {
  id?: number;
  name: string;
}

export interface CategoryRule {
  id?: number;
  matchType: 'exact' | 'contains';
  pattern: string;
  categoryId: number;
}

export interface Budget {
  id?: number;
  month: string;
  categoryId: number;
  targetAmount: number;
}

export interface Transaction {
  id?: number;
  source: string;
  sourceRef: string;
  txnDate: string;
  amount: number;
  instrument: string;
  descriptor: string;
  categoryId: number | null;
  linkedTransactionId: number | null;
  ignoreInBudget: boolean;
}

export interface TransactionSplit {
  id?: number;
  transactionId: number;
  categoryId: number;
  amount: number;
}

export interface SavingsBucket {
  id?: number;
  name: string;
}

export interface SavingsEntry {
  id?: number;
  entryDate: string;
  bucketId: number;
  amount: number;
  notes: string;
  source: 'manual' | 'auto_schedule';
  scheduleId: number | null;
}

export interface SavingsSchedule {
  id?: number;
  bucketId: number;
  dayOfMonth: number;
  amount: number;
  startMonth: string;
  active: boolean;
}

const db = new Dexie('BudgetApp') as Dexie & {
  categories: EntityTable<Category, 'id'>;
  categoryRules: EntityTable<CategoryRule, 'id'>;
  budgets: EntityTable<Budget, 'id'>;
  transactions: EntityTable<Transaction, 'id'>;
  transactionSplits: EntityTable<TransactionSplit, 'id'>;
  savingsBuckets: EntityTable<SavingsBucket, 'id'>;
  savingsEntries: EntityTable<SavingsEntry, 'id'>;
  savingsSchedules: EntityTable<SavingsSchedule, 'id'>;
};

db.version(2).stores({
  categories: '++id, &name',
  categoryRules: '++id, categoryId, matchType',
  budgets: '++id, month, categoryId, [month+categoryId]',
  transactions: '++id, source, txnDate, categoryId, instrument, descriptor, linkedTransactionId',
  transactionSplits: '++id, transactionId, categoryId',
  savingsBuckets: '++id, &name',
  savingsEntries: '++id, bucketId, entryDate, scheduleId',
  savingsSchedules: '++id, bucketId, active',
});

export { db };
