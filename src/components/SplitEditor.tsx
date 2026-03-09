import { useState, useEffect } from 'react';
import { getData, setSplits, clearSplits, subscribe, type Transaction, type Category } from '../db';

interface Props {
  transaction: Transaction;
  categories: Category[];
  onClose: () => void;
}

interface SplitLine {
  categoryId: number | '';
  amount: string;
}

export function SplitEditor({ transaction, categories, onClose }: Props) {
  const [lines, setLines] = useState<SplitLine[]>([
    { categoryId: '', amount: '' },
    { categoryId: '', amount: '' },
  ]);

  useEffect(() => {
    function load() {
      const { transactionSplits } = getData();
      const existing = transactionSplits.filter((s) => s.transactionId === transaction.id);
      if (existing.length > 0) {
        setLines(existing.map((s) => ({
          categoryId: s.categoryId,
          amount: String(s.amount),
        })));
      }
    }
    load();
    return subscribe(load);
  }, [transaction.id]);

  function updateLine(i: number, field: keyof SplitLine, value: string | number) {
    setLines((prev) => prev.map((l, j) => j === i ? { ...l, [field]: value } : l));
  }

  function addLine() {
    setLines((prev) => [...prev, { categoryId: '', amount: '' }]);
  }

  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, j) => j !== i));
  }

  const totalSplit = lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const diff = transaction.amount - totalSplit;
  const valid = Math.abs(diff) < 0.01 && lines.every((l) => l.categoryId !== '' && parseFloat(l.amount) > 0);

  async function save() {
    if (!valid) return;
    await setSplits(
      transaction.id,
      lines.map((l) => ({
        categoryId: l.categoryId as number,
        amount: parseFloat(l.amount),
      })),
    );
    onClose();
  }

  async function handleClearSplits() {
    await clearSplits(transaction.id);
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Split Transaction</h3>
        <p style={{ fontSize: '0.8rem', opacity: 0.6 }}>
          {transaction.descriptor} — ${transaction.amount.toFixed(2)}
        </p>

        {lines.map((l, i) => (
          <div className="row" key={i} style={{ marginBottom: '0.5rem' }}>
            <div className="field">
              <select
                value={l.categoryId}
                onChange={(e) => updateLine(i, 'categoryId', Number(e.target.value))}
              >
                <option value="">Category...</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <input
                type="number"
                step="0.01"
                placeholder="Amount"
                value={l.amount}
                onChange={(e) => updateLine(i, 'amount', e.target.value)}
              />
            </div>
            <button className="btn btn-danger btn-sm" onClick={() => removeLine(i)}>&times;</button>
          </div>
        ))}

        <button className="btn btn-ghost btn-sm" onClick={addLine}>+ Add line</button>

        <p style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>
          Split total: ${totalSplit.toFixed(2)} | Remaining: <span className={Math.abs(diff) < 0.01 ? 'positive' : 'negative'}>${diff.toFixed(2)}</span>
        </p>

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={handleClearSplits}>Clear splits</button>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={!valid}>Save</button>
        </div>
      </div>
    </div>
  );
}
