import type { Transaction } from '../db';

interface SummaryProps {
  transactions: Transaction[];
}

export function Summary({ transactions }: SummaryProps) {
  const income = transactions
    .filter((t) => t.type === 'income')
    .reduce((sum, t) => sum + t.amount, 0);

  const expenses = transactions
    .filter((t) => t.type === 'expense')
    .reduce((sum, t) => sum + t.amount, 0);

  const balance = income - expenses;

  return (
    <div className="summary">
      <div className="summary-card balance">
        <span className="summary-label">Balance</span>
        <span className={`summary-amount ${balance >= 0 ? 'positive' : 'negative'}`}>
          ${balance.toFixed(2)}
        </span>
      </div>
      <div className="summary-row">
        <div className="summary-card">
          <span className="summary-label">Income</span>
          <span className="summary-amount positive">+${income.toFixed(2)}</span>
        </div>
        <div className="summary-card">
          <span className="summary-label">Expenses</span>
          <span className="summary-amount negative">-${expenses.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
