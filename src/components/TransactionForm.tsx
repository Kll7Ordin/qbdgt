import { useState, type FormEvent } from 'react';
import type { Transaction } from '../db';

const CATEGORIES = {
  income: ['Salary', 'Freelance', 'Investment', 'Gift', 'Other'],
  expense: ['Food', 'Transport', 'Housing', 'Entertainment', 'Shopping', 'Bills', 'Health', 'Other'],
};

interface TransactionFormProps {
  onAdd: (t: Omit<Transaction, 'id'>) => Promise<void>;
}

export function TransactionForm({ onAdd }: TransactionFormProps) {
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(CATEGORIES.expense[0]);
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);

  function handleTypeChange(newType: 'income' | 'expense') {
    setType(newType);
    setCategory(CATEGORIES[newType][0]);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0) return;

    await onAdd({
      type,
      amount: parsed,
      description: description.trim() || category,
      category,
      date,
    });

    setAmount('');
    setDescription('');
  }

  return (
    <form className="transaction-form" onSubmit={handleSubmit}>
      <div className="type-toggle">
        <button
          type="button"
          className={`toggle-btn ${type === 'expense' ? 'active expense' : ''}`}
          onClick={() => handleTypeChange('expense')}
        >
          Expense
        </button>
        <button
          type="button"
          className={`toggle-btn ${type === 'income' ? 'active income' : ''}`}
          onClick={() => handleTypeChange('income')}
        >
          Income
        </button>
      </div>

      <div className="form-row">
        <div className="form-field">
          <label htmlFor="amount">Amount</label>
          <input
            id="amount"
            type="number"
            step="0.01"
            min="0.01"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </div>
        <div className="form-field">
          <label htmlFor="date">Date</label>
          <input
            id="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </div>
      </div>

      <div className="form-field">
        <label htmlFor="category">Category</label>
        <select
          id="category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {CATEGORIES[type].map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div className="form-field">
        <label htmlFor="description">Note (optional)</label>
        <input
          id="description"
          type="text"
          placeholder="What was this for?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <button type="submit" className={`submit-btn ${type}`}>
        Add {type === 'income' ? 'Income' : 'Expense'}
      </button>
    </form>
  );
}
