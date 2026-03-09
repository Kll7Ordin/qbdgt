import { useState, useEffect } from 'react';
import { db, type Transaction, type Category, type TransactionSplit } from '../db';
import { bulkCategorizeByDescriptor } from '../logic/categorize';
import { findRefundCandidates, applyRefundToOriginalMonth, type RefundCandidate } from '../logic/refunds';
import { SplitEditor } from './SplitEditor';

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function TransactionView() {
  const [month, setMonth] = useState(currentMonth());
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [splitsMap, setSplitsMap] = useState<Map<number, TransactionSplit[]>>(new Map());
  const [uncatCount, setUncatCount] = useState(0);
  const [ruleModal, setRuleModal] = useState<Transaction | null>(null);
  const [rulePattern, setRulePattern] = useState('');
  const [ruleType, setRuleType] = useState<'exact' | 'contains'>('contains');
  const [ruleCatId, setRuleCatId] = useState<number | ''>('');
  const [splitTxn, setSplitTxn] = useState<Transaction | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [refundPrompts, setRefundPrompts] = useState<RefundCandidate[]>([]);
  const [rev, setRev] = useState(0);

  // Manual transaction form state
  const [mDate, setMDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [mAmount, setMAmount] = useState('');
  const [mDescriptor, setMDescriptor] = useState('');
  const [mInstrument, setMInstrument] = useState('');
  const [mCategoryId, setMCategoryId] = useState<number | ''>('');
  const [mType, setMType] = useState<'expense' | 'credit'>('expense');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const cats = await db.categories.toArray();
      if (cancelled) return;
      setCategories(cats);

      const monthStart = `${month}-01`;
      const monthEnd = `${month}-31`;
      const list = await db.transactions
        .where('txnDate')
        .between(monthStart, monthEnd, true, true)
        .reverse()
        .toArray();
      if (cancelled) return;
      setTxns(list);

      const allSplits = await db.transactionSplits.toArray();
      const map = new Map<number, TransactionSplit[]>();
      for (const s of allSplits) {
        const arr = map.get(s.transactionId) ?? [];
        arr.push(s);
        map.set(s.transactionId, arr);
      }
      if (cancelled) return;
      setSplitsMap(map);

      const uc = await db.transactions.filter((t) => t.categoryId === null).count();
      if (!cancelled) setUncatCount(uc);
    })();

    return () => { cancelled = true; };
  }, [month, rev]);

  function reload() { setRev((r) => r + 1); }

  const catMap = new Map(categories.map((c) => [c.id!, c.name]));

  async function assignCategory(txnId: number, categoryId: number | null) {
    await db.transactions.update(txnId, { categoryId });
    reload();
  }

  function openRuleModal(txn: Transaction) {
    setRuleModal(txn);
    setRulePattern(txn.descriptor);
    setRuleType('contains');
    setRuleCatId(txn.categoryId ?? '');
  }

  async function createRule() {
    if (!rulePattern || !ruleCatId) return;
    await db.categoryRules.add({
      matchType: ruleType,
      pattern: rulePattern.toLowerCase(),
      categoryId: ruleCatId as number,
    });
    const count = await bulkCategorizeByDescriptor(rulePattern, ruleCatId as number, ruleType);
    setRuleModal(null);
    reload();
    alert(`Rule created. ${count} transactions categorized.`);
  }

  async function addManualTransaction() {
    const amount = parseFloat(mAmount);
    if (!mDate || isNaN(amount) || amount <= 0 || !mDescriptor.trim()) return;

    const isCredit = mType === 'credit';
    const txn: Omit<Transaction, 'id'> = {
      source: 'manual',
      sourceRef: 'manual',
      txnDate: mDate,
      amount,
      instrument: mInstrument.trim() || 'Manual',
      descriptor: mDescriptor.trim(),
      categoryId: mCategoryId ? (mCategoryId as number) : null,
      linkedTransactionId: null,
      ignoreInBudget: isCredit,
    };

    const id = await db.transactions.add(txn as Transaction);

    if (isCredit && id !== undefined) {
      const inserted = await db.transactions.get(id);
      if (inserted) {
        const candidates = await findRefundCandidates([inserted]);
        if (candidates.length > 0) {
          setRefundPrompts(candidates);
        }
      }
    }

    setMAmount('');
    setMDescriptor('');
    setMInstrument('');
    setMCategoryId('');
    setShowAddForm(false);
    reload();
  }

  async function handleRefundChoice(candidate: RefundCandidate, applyToOriginal: boolean) {
    if (applyToOriginal && candidate.refundTxn.id && candidate.originalTxn.id) {
      await applyRefundToOriginalMonth(candidate.refundTxn.id, candidate.originalTxn.id);
    }
    setRefundPrompts((prev) => prev.filter((r) => r.refundTxn.id !== candidate.refundTxn.id));
    reload();
  }

  return (
    <div>
      <h1 className="view-title">Transactions</h1>

      {uncatCount > 0 && (
        <div className="card" style={{ borderLeft: '3px solid #fbbf24' }}>
          <strong>{uncatCount}</strong> uncategorized transaction{uncatCount !== 1 ? 's' : ''}
        </div>
      )}

      <div className="month-nav">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        <span style={{ fontSize: '0.85rem', opacity: 0.6 }}>{txns.length} transactions</span>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setShowAddForm(!showAddForm)}
          style={{ marginLeft: 'auto' }}
        >
          {showAddForm ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {showAddForm && (
        <div className="card">
          <div className="section-title">Add transaction</div>
          <div className="row" style={{ marginBottom: '0.5rem' }}>
            <button
              className={`btn btn-sm ${mType === 'expense' ? 'btn-danger' : 'btn-ghost'}`}
              onClick={() => setMType('expense')}
            >
              Expense
            </button>
            <button
              className={`btn btn-sm ${mType === 'credit' ? 'btn-success' : 'btn-ghost'}`}
              onClick={() => setMType('credit')}
            >
              Credit / Refund
            </button>
          </div>
          <div className="row">
            <div className="field">
              <label>Date</label>
              <input type="date" value={mDate} onChange={(e) => setMDate(e.target.value)} />
            </div>
            <div className="field">
              <label>Amount</label>
              <input type="number" step="0.01" min="0.01" value={mAmount} onChange={(e) => setMAmount(e.target.value)} placeholder="0.00" />
            </div>
          </div>
          <div className="field">
            <label>Descriptor</label>
            <input value={mDescriptor} onChange={(e) => setMDescriptor(e.target.value)} placeholder="Description" />
          </div>
          <div className="row">
            <div className="field">
              <label>Instrument</label>
              <input value={mInstrument} onChange={(e) => setMInstrument(e.target.value)} placeholder="e.g. Visa, Cash" />
            </div>
            <div className="field">
              <label>Category</label>
              <select value={mCategoryId} onChange={(e) => setMCategoryId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">None</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>
          <button className="btn btn-primary" onClick={addManualTransaction} style={{ marginTop: '0.5rem' }}>
            Add {mType === 'expense' ? 'Expense' : 'Credit'}
          </button>
        </div>
      )}

      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Descriptor</th>
              <th>Instrument</th>
              <th className="num">Amount</th>
              <th>Category</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {txns.map((t) => {
              const splits = t.id !== undefined ? splitsMap.get(t.id) : undefined;
              return (
                <tr key={t.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{t.txnDate}</td>
                  <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.descriptor}
                    {t.linkedTransactionId && <span className="chip" style={{ marginLeft: '4px' }}>linked</span>}
                  </td>
                  <td>{t.instrument}</td>
                  <td className={`num ${t.ignoreInBudget ? 'positive' : 'negative'}`}>
                    {t.ignoreInBudget ? '+' : '-'}${t.amount.toFixed(2)}
                  </td>
                  <td>
                    {splits && splits.length > 0 ? (
                      <span className="chip" title={splits.map(s => `${catMap.get(s.categoryId) ?? '?'}: $${s.amount}`).join(', ')}>
                        Split ({splits.length})
                      </span>
                    ) : (
                      <select
                        value={t.categoryId ?? ''}
                        onChange={(e) => assignCategory(t.id!, e.target.value ? Number(e.target.value) : null)}
                        style={{ fontSize: '0.75rem', padding: '0.2rem' }}
                      >
                        <option value="">Uncategorized</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td>
                    <button className="btn btn-ghost btn-sm" onClick={() => openRuleModal(t)} title="Create rule">
                      R
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setSplitTxn(t)} title="Split" style={{ marginLeft: '2px' }}>
                      S
                    </button>
                  </td>
                </tr>
              );
            })}
            {txns.length === 0 && (
              <tr><td colSpan={6} className="empty">No transactions this month</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {ruleModal && (
        <div className="modal-overlay" onClick={() => setRuleModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Create Category Rule</h3>
            <div className="field">
              <label>Pattern</label>
              <input value={rulePattern} onChange={(e) => setRulePattern(e.target.value)} />
            </div>
            <div className="row">
              <div className="field">
                <label>Match type</label>
                <select value={ruleType} onChange={(e) => setRuleType(e.target.value as 'exact' | 'contains')}>
                  <option value="contains">Contains</option>
                  <option value="exact">Exact</option>
                </select>
              </div>
              <div className="field">
                <label>Category</label>
                <select value={ruleCatId} onChange={(e) => setRuleCatId(Number(e.target.value))}>
                  <option value="">Select...</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setRuleModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={createRule}>Create &amp; Apply</button>
            </div>
          </div>
        </div>
      )}

      {splitTxn && (
        <SplitEditor
          transaction={splitTxn}
          categories={categories}
          onClose={() => { setSplitTxn(null); reload(); }}
        />
      )}

      {refundPrompts.length > 0 && (
        <div className="modal-overlay" onClick={() => setRefundPrompts([])}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Possible Refund Detected</h3>
            {refundPrompts.map((r) => (
              <div key={r.refundTxn.id} style={{ marginBottom: '1rem' }}>
                <p style={{ fontSize: '0.85rem' }}>
                  This credit may be a refund for a previous transaction:
                </p>
                <div className="card" style={{ marginBottom: '0.5rem' }}>
                  <div style={{ fontSize: '0.8rem', opacity: 0.6 }}>Credit (new)</div>
                  <div><strong>{r.refundTxn.descriptor}</strong></div>
                  <div>${r.refundTxn.amount.toFixed(2)} on {r.refundTxn.txnDate}</div>
                </div>
                <div className="card" style={{ marginBottom: '0.5rem' }}>
                  <div style={{ fontSize: '0.8rem', opacity: 0.6 }}>Original expense</div>
                  <div><strong>{r.originalTxn.descriptor}</strong></div>
                  <div>${r.originalTxn.amount.toFixed(2)} on {r.originalTxn.txnDate}</div>
                  <div style={{ fontSize: '0.8rem', opacity: 0.6 }}>
                    {r.originalTxn.categoryId ? `Category: ${catMap.get(r.originalTxn.categoryId) ?? '?'}` : 'Uncategorized'}
                  </div>
                </div>
                <div className="modal-actions" style={{ justifyContent: 'stretch' }}>
                  <button
                    className="btn btn-primary btn-sm"
                    style={{ flex: 1 }}
                    onClick={() => handleRefundChoice(r, true)}
                  >
                    Count in original month ({r.originalTxn.txnDate.slice(0, 7)})
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ flex: 1 }}
                    onClick={() => handleRefundChoice(r, false)}
                  >
                    Keep as new transaction
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
