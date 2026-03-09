import Dexie, { type EntityTable } from 'dexie';

export interface Transaction {
  id?: number;
  amount: number;
  description: string;
  category: string;
  type: 'income' | 'expense';
  date: string;
}

const db = new Dexie('BudgetApp') as Dexie & {
  transactions: EntityTable<Transaction, 'id'>;
};

db.version(1).stores({
  transactions: '++id, type, category, date',
});

export { db };
