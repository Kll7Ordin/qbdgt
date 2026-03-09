import { useState, useSyncExternalStore } from 'react';
import {
  getData,
  subscribe,
  addTransaction,
  updateTransaction,
  addCategoryRule,
  type Transaction,
  type TransactionSplit,
} from '../db';
import { bulkCategorizeByDescriptor } from '../logic/categorize';
import { findRefundCandidates, applyRefundToOriginalMonth, type RefundCandidate } from '../logic/refunds';
import { SplitEditor } from './SplitEditor';

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function useAppData() {
  const snapshot = useSyncExternalStore(subscribe, getData, getData);
  return snapshot;
}

export function TransactionView() {
  const appData = useAppData();
  const categories = appData.categories;
  const allTransactions = appData.transactions;
  const allSplits = appData.transactionSplits;

  const [month, setMonth] = useState(currentMonth());
  const [ruleModal, setRuleModal] = useState<Transaction | null>(null);
  const [rulePattern, setRulePattern] = useState('');
  const [ruleType, setRuleType] = useState<'exact' | 'contains'>('contains');
  const [ruleCatId, setRuleCatId] = useState<number | ''>('');
  const [splitTxn, setSplitTxn] = useState<Transaction | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [refundPrompts, setRefundPrompts] = useState<RefundCandidate[]>([]);
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');

  // Manual transaction form state
  const [mDate, setMDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [mAmount, setMAmount] = useState('');
  const [mDescriptor, setMDescriptor] = useState('');
  const [mInstrument, setMInstrument] = useState('');
  const [mCategoryId, setMCategoryId] = useState<number | ''>('');
  const [mType, setMType] = useState<'expense' | 'credit'>('expense');
  const [mComment, setMComment] = useState('');

  const monthStart = `${month}-01`;
  const monthEnd = `${month}-31`;
  const txns = allTransactions
    .filter((t) => t.txnDate >= monthStart && t.txnDate <= monthEnd)
    .sort((a, b) => (b.txnDate > a.txnDate ? 1 : b.txnDate < a.txnDate ? -1 : b.id - a.id));

  const splitsMap = new Map<number, TransactionSplit[]>();
  for (const s of allSplits) {
    const arr = splitsMap.get(s.transactionId) ?? [];
    arr.push(s);
    splitsMap.set(s.transactionId, arr);
  }

  const uncatCount = allTransactions.filter((t) => t.categoryId === null).length;

  const catMap = new Map(categories.map((c) => [c.id!, c.name]));

  async function assignCategory(txnId: number, categoryId: number | null) {
    await updateTransaction(txnId, { categoryId });
  }

  function openRuleModal(txn: Transaction) {
    setRuleModal(txn);
    setRulePattern(txn.descriptor);
    setRuleType('contains');
    setRuleCatId(txn.categoryId ?? '');
  }

  async function createRule() {
    if (!rulePattern || !ruleCatId) return;
    await addCategoryRule({
      matchType: ruleType,
      pattern: rulePattern.toLowerCase(),
      categoryId: ruleCatId as number,
    });
    const count = await bulkCategorizeByDescriptor(rulePattern, ruleCatId as number, ruleType);
    setRuleModal(null);
    alert(`Rule created. ${count} transactions categorized.`);
  }

  function startEditComment(txn: Transaction) {
    setEditingCommentId(txn.id);
    setEditingCommentText(txn.comment ?? '');
  }

  async function saveComment() {
    if (editingCommentId === null) return;
    await updateTransaction(editingCommentId, {
      comment: editingCommentText.trim() || null,
    });
    setEditingCommentId(null);
    setEditingCommentText('');
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
      comment: mComment.trim() || null,
    };

    const id = await addTransaction(txn);

    if (isCredit && id !== undefined) {
      const candidates = findRefundCandidates([id]);
      if (candidates.length > 0) {
        setRefundPrompts(candidates);
      }
    }

    setMAmount('');
    setMDescriptor('');
    setMInstrument('');
    setMCategoryId('');
    setMComment('');
    setShowAddForm(false);
  }

  async function handleRefundChoice(candidate: RefundCandidate, applyToOriginal: boolean) {
    if (applyToOriginal && candidate.refundTxn.id && candidate.originalTxn.id) {
      await applyRefundToOriginalMonth(candidate.refundTxn.id, candidate.originalTxn.id);
    }
    setRefundPrompts((prev) => prev.filter((r) => r.refundTxn.id !== candidate.refundTxn.id));
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
          <div className="field">
            <label>Comment</label>
            <textarea
              value={mComment}
              onChange={(e) => setMComment(e.target.value)}
              placeholder="Optional comment"
              rows={2}
              style={{ resize: 'vertical' }}
            />
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
                    {t.comment && (
                      <span
                        title={t.comment}
                        onClick={() => startEditComment(t)}
                        style={{ marginLeft: '4px', cursor: 'pointer', opacity: 0.6 }}
                      >
                        💬
                      </span>
                    )}
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
                    {t.categoryId !== null && !(splits && splits.length > 0) && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => openRuleModal(t)}
                        title="Make rule from this category"
                        style={{ fontSize: '0.65rem', padding: '0.1rem 0.3rem', marginRight: '2px' }}
                      >
                        Make rule
                      </button>
                    )}
                    <button className="btn btn-ghost btn-sm" onClick={() => openRuleModal(t)} title="Create rule">
                      R
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setSplitTxn(t)} title="Split" style={{ marginLeft: '2px' }}>
                      S
                    </button>
                    {!t.comment && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => startEditComment(t)}
                        title="Add comment"
                        style={{ marginLeft: '2px' }}
                      >
                        💬
                      </button>
                    )}
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

      {editingCommentId !== null && (
        <div className="modal-overlay" onClick={() => setEditingCommentId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Edit Comment</h3>
            <div className="field">
              <textarea
                value={editingCommentText}
                onChange={(e) => setEditingCommentText(e.target.value)}
                placeholder="Enter comment..."
                rows={3}
                style={{ resize: 'vertical', width: '100%' }}
                autoFocus
              />
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setEditingCommentId(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveComment}>Save</button>
            </div>
          </div>
        </div>
      )}

      {splitTxn && (
        <SplitEditor
          transaction={splitTxn}
          categories={categories}
          onClose={() => { setSplitTxn(null); }}
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
