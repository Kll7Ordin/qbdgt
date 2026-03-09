import { useSyncExternalStore, useCallback } from 'react';
import { db, type Transaction } from '../db';

let transactions: Transaction[] = [];
let listeners: Array<() => void> = [];

function emitChange() {
  for (const listener of listeners) listener();
}

async function load() {
  transactions = await db.transactions.orderBy('date').reverse().toArray();
  emitChange();
}

load();

function subscribe(listener: () => void) {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

function getSnapshot() {
  return transactions;
}

export function useTransactions() {
  const txns = useSyncExternalStore(subscribe, getSnapshot);

  const addTransaction = useCallback(async (t: Omit<Transaction, 'id'>) => {
    await db.transactions.add(t);
    await load();
  }, []);

  const deleteTransaction = useCallback(async (id: number) => {
    await db.transactions.delete(id);
    await load();
  }, []);

  return { transactions: txns, addTransaction, deleteTransaction };
}
