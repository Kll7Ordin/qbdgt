import type { Transaction } from '../db';

interface TransactionListProps {
  transactions: Transaction[];
  onDelete: (id: number) => Promise<void>;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function TransactionList({ transactions, onDelete }: TransactionListProps) {
  if (transactions.length === 0) {
    return (
      <div className="empty-state">
        <p>No transactions yet</p>
        <p className="empty-hint">Add your first income or expense above</p>
      </div>
    );
  }

  return (
    <ul className="transaction-list">
      {transactions.map((t) => (
        <li key={t.id} className={`transaction-item ${t.type}`}>
          <div className="transaction-info">
            <span className="transaction-category">{t.category}</span>
            <span className="transaction-description">{t.description}</span>
            <span className="transaction-date">{formatDate(t.date)}</span>
          </div>
          <div className="transaction-actions">
            <span className={`transaction-amount ${t.type}`}>
              {t.type === 'income' ? '+' : '-'}${t.amount.toFixed(2)}
            </span>
            <button
              className="delete-btn"
              onClick={() => t.id !== undefined && onDelete(t.id)}
              aria-label="Delete transaction"
            >
              &times;
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
