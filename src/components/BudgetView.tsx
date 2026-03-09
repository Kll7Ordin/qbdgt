import { useState, useEffect } from 'react';
import Dexie from 'dexie';
import { db, type Category, type TransactionSplit } from '../db';

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function prevMonths(month: string, n: number): string[] {
  const [y, m] = month.split('-').map(Number);
  const result: string[] = [];
  let cy = y, cm = m;
  for (let i = 0; i < n; i++) {
    cm--;
    if (cm < 1) { cm = 12; cy--; }
    result.push(`${cy}-${String(cm).padStart(2, '0')}`);
  }
  return result;
}

interface BudgetRow {
  categoryId: number;
  categoryName: string;
  target: number;
  spent: number;
  avg3: number;
  avgDiff: number;
}

export function BudgetView() {
  const [month, setMonth] = useState(currentMonth());
  const [rows, setRows] = useState<BudgetRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [newCatId, setNewCatId] = useState<number | ''>('');
  const [newTarget, setNewTarget] = useState('');
  const [editId, setEditId] = useState<number | null>(null);
  const [editTarget, setEditTarget] = useState('');
  const [rev, setRev] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const cats = await db.categories.toArray();
      if (cancelled) return;
      setCategories(cats);

      const budgets = await db.budgets
        .where('[month+categoryId]')
        .between([month, Dexie.minKey], [month, Dexie.maxKey])
        .toArray();

      const prev3 = prevMonths(month, 3);
      const monthStart = `${month}-01`;
      const monthEnd = `${month}-31`;

      const txns = await db.transactions
        .where('txnDate')
        .between(monthStart, monthEnd, true, true)
        .toArray();

      const splits = await db.transactionSplits.toArray();
      const splitsByTxn = new Map<number, TransactionSplit[]>();
      for (const s of splits) {
        const arr = splitsByTxn.get(s.transactionId) ?? [];
        arr.push(s);
        splitsByTxn.set(s.transactionId, arr);
      }

      const spendByCategory = new Map<number, number>();
      for (const t of txns) {
        if (t.ignoreInBudget || t.id === undefined) continue;
        const txnSplits = splitsByTxn.get(t.id);
        if (txnSplits && txnSplits.length > 0) {
          for (const s of txnSplits) {
            spendByCategory.set(s.categoryId, (spendByCategory.get(s.categoryId) ?? 0) + s.amount);
          }
        } else if (t.categoryId) {
          spendByCategory.set(t.categoryId, (spendByCategory.get(t.categoryId) ?? 0) + t.amount);
        }
      }

      const avg3Map = new Map<number, number>();
      for (const pm of prev3) {
        const pmStart = `${pm}-01`;
        const pmEnd = `${pm}-31`;
        const pmTxns = await db.transactions
          .where('txnDate')
          .between(pmStart, pmEnd, true, true)
          .toArray();
        for (const t of pmTxns) {
          if (t.ignoreInBudget || t.id === undefined) continue;
          const txnSplits = splitsByTxn.get(t.id);
          if (txnSplits && txnSplits.length > 0) {
            for (const s of txnSplits) {
              avg3Map.set(s.categoryId, (avg3Map.get(s.categoryId) ?? 0) + s.amount);
            }
          } else if (t.categoryId) {
            avg3Map.set(t.categoryId, (avg3Map.get(t.categoryId) ?? 0) + t.amount);
          }
        }
      }

      const catMap = new Map(cats.map((c) => [c.id!, c.name]));
      const result: BudgetRow[] = budgets.map((b) => {
        const spent = spendByCategory.get(b.categoryId) ?? 0;
        const avg3 = (avg3Map.get(b.categoryId) ?? 0) / Math.max(prev3.length, 1);
        return {
          categoryId: b.categoryId,
          categoryName: catMap.get(b.categoryId) ?? '?',
          target: b.targetAmount,
          spent,
          avg3,
          avgDiff: avg3 - b.targetAmount,
        };
      });

      if (!cancelled) setRows(result);
    })();

    return () => { cancelled = true; };
  }, [month, rev]);

  function reload() { setRev((r) => r + 1); }

  async function addBudgetItem() {
    if (!newCatId || !newTarget) return;
    const existing = await db.budgets
      .where('[month+categoryId]')
      .equals([month, newCatId])
      .first();
    if (existing) {
      await db.budgets.update(existing.id!, { targetAmount: parseFloat(newTarget) });
    } else {
      await db.budgets.add({
        month,
        categoryId: newCatId as number,
        targetAmount: parseFloat(newTarget),
      });
    }
    setNewCatId('');
    setNewTarget('');
    reload();
  }

  async function removeBudgetItem(categoryId: number) {
    const item = await db.budgets
      .where('[month+categoryId]')
      .equals([month, categoryId])
      .first();
    if (item?.id) await db.budgets.delete(item.id);
    reload();
  }

  async function saveEdit(categoryId: number) {
    const item = await db.budgets
      .where('[month+categoryId]')
      .equals([month, categoryId])
      .first();
    if (item?.id) {
      await db.budgets.update(item.id, { targetAmount: parseFloat(editTarget) });
    }
    setEditId(null);
    reload();
  }

  const totalTarget = rows.reduce((s, r) => s + r.target, 0);
  const totalSpent = rows.reduce((s, r) => s + r.spent, 0);

  return (
    <div>
      <h1 className="view-title">Monthly Budget</h1>

      <div className="month-nav">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>

      <div className="summary-row">
        <div className="summary-card">
          <span className="summary-label">Planned</span>
          <span className="summary-value">${totalTarget.toFixed(2)}</span>
        </div>
        <div className="summary-card">
          <span className="summary-label">Spent</span>
          <span className="summary-value">${totalSpent.toFixed(2)}</span>
        </div>
        <div className="summary-card">
          <span className="summary-label">Remaining</span>
          <span className={`summary-value ${totalTarget - totalSpent >= 0 ? 'positive' : 'negative'}`}>
            ${(totalTarget - totalSpent).toFixed(2)}
          </span>
        </div>
      </div>

      <div className="card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Category</th>
              <th className="num">Target</th>
              <th className="num">Spent</th>
              <th className="num">Left</th>
              <th className="num">3m Avg</th>
              <th className="num">Avg vs Target</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.categoryId}>
                <td>{r.categoryName}</td>
                <td className="num">
                  {editId === r.categoryId ? (
                    <input
                      type="number"
                      value={editTarget}
                      onChange={(e) => setEditTarget(e.target.value)}
                      onBlur={() => saveEdit(r.categoryId)}
                      onKeyDown={(e) => e.key === 'Enter' && saveEdit(r.categoryId)}
                      style={{ width: '70px', fontSize: '0.8rem' }}
                      autoFocus
                    />
                  ) : (
                    <span
                      onClick={() => { setEditId(r.categoryId); setEditTarget(String(r.target)); }}
                      style={{ cursor: 'pointer' }}
                    >
                      ${r.target.toFixed(0)}
                    </span>
                  )}
                </td>
                <td className="num">${r.spent.toFixed(2)}</td>
                <td className={`num ${r.target - r.spent >= 0 ? 'positive' : 'negative'}`}>
                  ${(r.target - r.spent).toFixed(2)}
                </td>
                <td className="num">${r.avg3.toFixed(0)}</td>
                <td className={`num ${r.avgDiff <= 0 ? 'positive' : 'negative'}`}>
                  {r.avgDiff >= 0 ? '+' : ''}${r.avgDiff.toFixed(0)}
                </td>
                <td>
                  <button className="btn btn-danger btn-sm" onClick={() => removeBudgetItem(r.categoryId)}>
                    &times;
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="empty">No budget items for this month</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="section-title">Add budget item</div>
        <div className="row">
          <div className="field">
            <label>Category</label>
            <select value={newCatId} onChange={(e) => setNewCatId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Select...</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Target</label>
            <input type="number" value={newTarget} onChange={(e) => setNewTarget(e.target.value)} placeholder="0" />
          </div>
          <button className="btn btn-primary" onClick={addBudgetItem}>Add</button>
        </div>
      </div>
    </div>
  );
}
