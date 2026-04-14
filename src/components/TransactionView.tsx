import { useState, useCallback, useSyncExternalStore, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  getData,
  subscribe,
  addTransaction,
  updateTransaction,
  addCategoryRule,
  getAISettings,
  getAICategoryFeedback,
  logAICategoryFeedback,
  type Transaction,
  type TransactionSplit,
} from '../db';
import { bulkCategorizeByDescriptor } from '../logic/categorize';
import { findRefundCandidates, applyRefundToOriginalMonth, type RefundCandidate } from '../logic/refunds';
import { SplitEditor } from './SplitEditor';
import { SearchableSelect } from './SearchableSelect';
import { TransactionLookup } from './TransactionLookup';
import { formatAmount } from '../utils/format';
import { suggestCategories, type CategorySuggestion } from '../logic/llm';

// Normalize descriptor for fuzzy matching (strips phone numbers, long digit sequences)
function normalizeDesc(desc: string): string {
  return desc.toLowerCase()
    .replace(/\d{4,}/g, '')       // remove long digit sequences
    .replace(/[^a-z\s]/g, ' ')    // non-alpha → space
    .replace(/\s+/g, ' ').trim()
    .split(' ').slice(0, 5).join(' '); // first 5 significant words
}

// Module-level Ollama cache so suggestions persist across tab switches
const _ollamaCache = new Map<number, CategorySuggestion>();
let _suggestionFetchInProgress = false;
let _suggestionFetchStartedAt = 0;

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function useAppData() {
  const snapshot = useSyncExternalStore(subscribe, getData, getData);
  return snapshot;
}

export function TransactionView({ search = '' }: { search?: string }) {
  const appData = useAppData();
  const categories = appData.categories;
  const allTransactions = appData.transactions;
  const allSplits = appData.transactionSplits;

  const [monthFilter, setMonthFilter] = useState<string | 'all'>(currentMonth());
  const month = monthFilter === 'all' ? currentMonth() : monthFilter;
  const [ruleModal, setRuleModal] = useState<Transaction | null>(null);
  const [rulePattern, setRulePattern] = useState('');
  const [ruleType, setRuleType] = useState<'exact' | 'contains'>('exact');
  const [ruleCatId, setRuleCatId] = useState<number | ''>('');
  const [ruleAmount, setRuleAmount] = useState('');
  const [ruleAmountRequired, setRuleAmountRequired] = useState(false);
  const [splitTxn, setSplitTxn] = useState<Transaction | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [refundPrompts, setRefundPrompts] = useState<RefundCandidate[]>([]);
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');
  const [moveMonthTxn, setMoveMonthTxn] = useState<Transaction | null>(null);
  const [moveMonthYear, setMoveMonthYear] = useState('');
  const [moveMonthNum, setMoveMonthNum] = useState('');
  const [lookupTxn, setLookupTxn] = useState<Transaction | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{ text: string; top: number; left: number; flipUp: boolean } | null>(null);
  // Ollama cache state (async, supplements history matching)
  const [ollamaSuggestions, setOllamaSuggestions] = useState<Map<number, CategorySuggestion>>(() => new Map(_ollamaCache));

  // History-based suggestions computed inline every render — guaranteed fresh, no timing issues.
  // Uses exact normalized-descriptor match first, then word-level fallback (catches
  // "walmart.ca" matching "walmart Victoria Bc", phone-number variants, etc.)
  const _descFreq = new Map<string, Map<number, number>>();
  const _wordFreq = new Map<string, Map<number, number>>();
  for (const t of allTransactions) {
    if (t.categoryId == null || t.ignoreInBudget) continue;
    const key = normalizeDesc(t.descriptor);
    if (!key) continue;
    if (!_descFreq.has(key)) _descFreq.set(key, new Map());
    const dm = _descFreq.get(key)!;
    dm.set(t.categoryId, (dm.get(t.categoryId) ?? 0) + 1);
    for (const w of key.split(' ').filter((w) => w.length >= 4)) {
      if (!_wordFreq.has(w)) _wordFreq.set(w, new Map());
      const wm = _wordFreq.get(w)!;
      wm.set(t.categoryId, (wm.get(t.categoryId) ?? 0) + 1);
    }
  }
  const historyMap = new Map<number, CategorySuggestion>();
  for (const t of allTransactions) {
    if (t.categoryId != null || t.ignoreInBudget) continue;
    const key = normalizeDesc(t.descriptor);
    // 1. Exact normalized match
    const freq = _descFreq.get(key);
    if (freq && freq.size > 0) {
      const bestCatId = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const cat = categories.find((c) => c.id === bestCatId);
      if (cat) { historyMap.set(t.id, { txnId: t.id, categoryId: bestCatId, categoryName: cat.name }); continue; }
    }
    // 2. Word-level fallback
    const combined = new Map<number, number>();
    for (const w of key.split(' ').filter((w) => w.length >= 4)) {
      const wf = _wordFreq.get(w);
      if (!wf) continue;
      for (const [catId, cnt] of wf) combined.set(catId, (combined.get(catId) ?? 0) + cnt);
    }
    if (combined.size > 0) {
      const bestCatId = [...combined.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const cat = categories.find((c) => c.id === bestCatId);
      if (cat) historyMap.set(t.id, { txnId: t.id, categoryId: bestCatId, categoryName: cat.name });
    }
  }
  // Merge: history is base, Ollama can override
  const allSuggestions = new Map(historyMap);
  for (const [k, v] of ollamaSuggestions) allSuggestions.set(k, v);

  // Ollama AI suggestions for any transactions history couldn't match
  useEffect(() => {
    const ai = getAISettings();
    if (_suggestionFetchInProgress && Date.now() - _suggestionFetchStartedAt > 90000) _suggestionFetchInProgress = false;
    if (!ai.model || _suggestionFetchInProgress) return;
    const toFetch = allTransactions.filter(
      (t) => t.categoryId == null && !t.ignoreInBudget && !historyMap.has(t.id) && !_ollamaCache.has(t.id),
    );
    if (toFetch.length === 0) return;
    _suggestionFetchInProgress = true;
    _suggestionFetchStartedAt = Date.now();
    const batch = toFetch.slice(0, 50).map((t) => ({ id: t.id, descriptor: t.descriptor, amount: t.amount, txnDate: t.txnDate }));
    const cats = categories.filter((c) => !c.isIncome).map((c) => ({ id: c.id, name: c.name }));
    suggestCategories(batch, cats, ai, getAICategoryFeedback()).then((suggestions) => {
      _suggestionFetchInProgress = false;
      if (suggestions.length === 0) return;
      for (const s of suggestions) _ollamaCache.set(s.txnId, s);
      setOllamaSuggestions(new Map(_ollamaCache));
    }).catch(() => { _suggestionFetchInProgress = false; });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTransactions.length]);

  const showTooltip = useCallback((e: React.MouseEvent<HTMLTableCellElement>) => {
    const cell = e.currentTarget;
    const text = cell.getAttribute('data-tooltip') || '';
    if (!text) return;
    const rect = cell.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const flipUp = spaceBelow < 80;
    const top = flipUp ? rect.top - 4 : rect.bottom + 4;
    setTooltip({ text, top, left: rect.left, flipUp });
  }, []);

  const hideTooltip = useCallback(() => {
    setTooltip(null);
  }, []);

  // Manual transaction form state
  const [mDate, setMDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [mAmount, setMAmount] = useState('');
  const [mDescriptor, setMDescriptor] = useState('');
  const [mInstrument, setMInstrument] = useState('');
  const [mCategoryId, setMCategoryId] = useState<number | ''>('');
  const [mType, setMType] = useState<'expense' | 'credit'>('expense');
  const [mComment, setMComment] = useState('');

  const [catFilter, setCatFilter] = useState<'all' | 'categorized' | 'uncategorized'>('all');
  const [categoryFilter, setCategoryFilter] = useState<number | ''>('');

  const splitsMap = new Map<number, TransactionSplit[]>();
  for (const s of allSplits) {
    const arr = splitsMap.get(s.transactionId) ?? [];
    arr.push(s);
    splitsMap.set(s.transactionId, arr);
  }

  const catMap = new Map(categories.map((c) => [c.id!, c.name]));
  const catColorMap = new Map(categories.map((c) => [c.id!, c.color ?? '#888']));

  const monthStart = `${month}-01`;
  const monthEnd = `${month}-31`;
  let txns = allTransactions
    .filter((t) => monthFilter === 'all' || (t.txnDate >= monthStart && t.txnDate <= monthEnd))
    .sort((a, b) => (b.txnDate > a.txnDate ? 1 : b.txnDate < a.txnDate ? -1 : b.id - a.id));
  if (catFilter === 'categorized') txns = txns.filter((t) => {
    const splits = splitsMap.get(t.id);
    return t.categoryId != null || (splits && splits.length > 0);
  });
  if (catFilter === 'uncategorized') txns = txns.filter((t) => {
    const splits = splitsMap.get(t.id);
    return t.categoryId == null && (!splits || splits.length === 0);
  });
  if (categoryFilter !== '') txns = txns.filter((t) => {
    const splits = splitsMap.get(t.id);
    if (splits && splits.length > 0) return splits.some((s) => s.categoryId === categoryFilter);
    return t.categoryId === categoryFilter;
  });
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    txns = txns.filter((t) => {
      const catName = t.categoryId ? (catMap.get(t.categoryId) ?? '') : '';
      return t.descriptor.toLowerCase().includes(q)
        || (t.instrument ?? '').toLowerCase().includes(q)
        || t.txnDate.includes(q)
        || String(t.amount).includes(q)
        || catName.toLowerCase().includes(q)
        || (t.comment ?? '').toLowerCase().includes(q);
    });
  }

  const monthTxns = allTransactions.filter((t) => monthFilter === 'all' || (t.txnDate >= monthStart && t.txnDate <= monthEnd));
  const uncatCount = monthTxns.filter((t) => {
    const splits = splitsMap.get(t.id);
    return t.categoryId == null && (!splits || splits.length === 0);
  }).length;

  async function assignCategory(txnId: number, categoryId: number | null) {
    await updateTransaction(txnId, { categoryId });
  }

  function openRuleModal(txn: Transaction) {
    setRuleModal(txn);
    setRulePattern(txn.descriptor);
    setRuleType('exact');
    setRuleCatId(txn.categoryId ?? '');
    setRuleAmount(txn.amount ? String(txn.amount) : '');
    setRuleAmountRequired(false);
  }

  async function createRule() {
    if (!rulePattern || !ruleCatId) return;
    const amountVal = ruleAmountRequired && ruleAmount.trim() ? parseFloat(ruleAmount) : null;
    await addCategoryRule({
      matchType: ruleType,
      pattern: rulePattern.toLowerCase(),
      categoryId: ruleCatId as number,
      amountMatch: amountVal,
    });
    const count = await bulkCategorizeByDescriptor(rulePattern, ruleCatId as number, ruleType, amountVal ?? undefined);
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

  function openMoveMonth(txn: Transaction) {
    setMoveMonthTxn(txn);
    const y = txn.txnDate.slice(0, 4);
    const m = txn.txnDate.slice(5, 7);
    setMoveMonthYear(y);
    setMoveMonthNum(m);
  }

  async function confirmMoveMonth() {
    if (!moveMonthTxn || !moveMonthYear || !moveMonthNum) return;
    const oldDay = moveMonthTxn.txnDate.slice(8, 10);
    const newDate = `${moveMonthYear}-${moveMonthNum}-${oldDay}`;
    await updateTransaction(moveMonthTxn.id, { txnDate: newDate });
    setMoveMonthTxn(null);
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

      <div className="month-nav" style={{ flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              if (monthFilter === 'all') setMonthFilter(currentMonth());
              else {
                const [y, m] = monthFilter.split('-').map(Number);
                const d = new Date(y, m - 2, 1);
                setMonthFilter(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
              }
            }}
            title="Previous month"
          >
            ‹
          </button>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonthFilter(e.target.value)}
            style={{ minWidth: 130 }}
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              if (monthFilter === 'all') setMonthFilter(currentMonth());
              else {
                const [y, m] = monthFilter.split('-').map(Number);
                const d = new Date(y, m, 1);
                setMonthFilter(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
              }
            }}
            title="Next month"
          >
            ›
          </button>
          <button
            type="button"
            className={`btn btn-sm ${monthFilter === 'all' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setMonthFilter(monthFilter === 'all' ? currentMonth() : 'all')}
            title={monthFilter === 'all' ? 'Showing all months (click to filter by month)' : 'Show all months'}
          >
            All months
          </button>
        </div>
        <button
          className={`btn btn-sm ${catFilter === 'uncategorized' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setCatFilter(catFilter === 'uncategorized' ? 'all' : 'uncategorized')}
        >
          Uncategorized
        </button>
        <SearchableSelect
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          value={categoryFilter}
          onChange={(v) => setCategoryFilter(v === '' ? '' : Number(v))}
          placeholder="All categories"
          style={{ minWidth: 160 }}
        />
        <span style={{ fontSize: '0.9rem', opacity: 0.6 }}>{txns.length} transactions</span>
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
              <SearchableSelect
                options={categories.map((c) => ({ value: c.id, label: c.name }))}
                value={mCategoryId}
                onChange={(v) => setMCategoryId(v === '' ? '' : Number(v))}
                placeholder="None"
              />
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
            {(() => {
              let catIdx = 0, uncatIdx = 0;
              return txns.map((t) => {
              const splits = t.id !== undefined ? splitsMap.get(t.id) : undefined;
              const isCategorized = t.categoryId != null || (splits != null && splits.length > 0);
              const rowClass = isCategorized
                ? `txn-row-categorized ${catIdx++ % 2 === 0 ? '' : 'txn-row-categorized-alt'}`
                : `${uncatIdx++ % 2 === 0 ? '' : 'txn-row-uncat-alt'}`;
              return (
                <tr key={t.id} className={rowClass}>
                  <td style={{ whiteSpace: 'nowrap' }}>{t.txnDate}</td>
                  <td className="descriptor-cell" data-tooltip={t.descriptor} onMouseEnter={showTooltip} onMouseLeave={hideTooltip}>
                    <span className="descriptor-text">{t.descriptor}</span>
                    {t.linkedTransactionId === -1 && <span className="chip" style={{ marginLeft: '4px', background: '#8b5cf6', color: '#fff' }}>PayPal</span>}
                    {t.linkedTransactionId && t.linkedTransactionId !== -1 && <span className="chip" style={{ marginLeft: '4px' }}>linked</span>}
                  </td>
                  <td>{t.instrument}</td>
                  <td className={`num budget-num ${t.ignoreInBudget || t.amount < 0 ? 'positive' : ''}`}>
                    {t.amount === 0 ? '' : t.ignoreInBudget || t.amount < 0 ? '+' : '-'}${formatAmount(Math.abs(t.amount))}
                  </td>
                  <td>
                    {splits && splits.length > 0 ? (
                      <span className="chip" title={splits.map(s => `${catMap.get(s.categoryId) ?? '?'}: $${formatAmount(s.amount)}`).join(', ')}>
                        Split ({splits.length})
                      </span>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                        {/* Actual category — chip if assigned, dropdown if uncategorized or editing */}
                        {t.categoryId != null && editingCategoryId !== t.id ? (
                          <span
                            className="chip"
                            style={{ cursor: 'pointer', background: catColorMap.get(t.categoryId) ?? '#888', color: '#fff', whiteSpace: 'nowrap', fontWeight: 600 }}
                            title="Click to change category"
                            onClick={() => setEditingCategoryId(t.id)}
                          >
                            {catMap.get(t.categoryId) ?? '?'}
                          </span>
                        ) : (
                          <SearchableSelect
                            options={categories.map((c) => ({ value: c.id, label: c.name }))}
                            value={t.categoryId ?? ''}
                            onChange={(v) => {
                              assignCategory(t.id, v === '' ? null : Number(v));
                              setEditingCategoryId(null);
                              if (v !== '') {
                                const s = allSuggestions.get(t.id);
                                if (s) logAICategoryFeedback(t.descriptor, s.categoryId, 'rejected', Number(v));
                                _ollamaCache.delete(t.id);
                                setOllamaSuggestions((prev) => { const m = new Map(prev); m.delete(t.id); return m; });
                              }
                            }}
                            placeholder="Uncategorized"
                            style={{ fontSize: '0.85rem', minWidth: 120 }}
                          />
                        )}
                        {/* AI suggestion chip — to the RIGHT, faded, with 🦙? prefix */}
                        {t.categoryId == null && allSuggestions.has(t.id) && (() => {
                          const s = allSuggestions.get(t.id)!;
                          const baseColor = catColorMap.get(s.categoryId) ?? '#888';
                          return (
                            <span
                              className="chip"
                              style={{
                                cursor: 'pointer',
                                background: baseColor + '33',
                                color: baseColor,
                                border: `1px solid ${baseColor}66`,
                                whiteSpace: 'nowrap',
                                fontSize: '0.78rem',
                                fontWeight: 500,
                              }}
                              title="AI suggestion — click to accept"
                              onClick={() => {
                                assignCategory(t.id, s.categoryId);
                                logAICategoryFeedback(t.descriptor, s.categoryId, 'accepted', s.categoryId);
                                _ollamaCache.delete(t.id);
                                setOllamaSuggestions((prev) => { const m = new Map(prev); m.delete(t.id); return m; });
                              }}
                            >
                              🦙? {s.categoryName}
                            </span>
                          );
                        })()}
                      </div>
                    )}
                  </td>
                  <td>
                    <button className="btn btn-ghost btn-sm" onClick={() => openRuleModal(t)} title="Create rule">
                      Create Rule
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setSplitTxn(t)} title="Split transaction" style={{ marginLeft: '2px' }}>
                      Split Txn
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => openMoveMonth(t)}
                      title="Count in different month"
                      style={{ marginLeft: '2px' }}
                    >
                      📅
                    </button>
                    <button
                      className={`btn btn-sm ${t.comment ? 'btn-warning' : 'btn-ghost'}`}
                      onClick={() => startEditComment(t)}
                      title={t.comment ? 'View/edit comment' : 'Add comment'}
                      style={{ marginLeft: '2px', fontWeight: t.comment ? 'bold' : 'normal' }}
                    >
                      💬
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setLookupTxn(t)}
                      title="Identify this transaction with AI - WARNING: This will perform an internet search on the transaction descriptor"
                      style={{ marginLeft: '2px', fontWeight: 600, opacity: 0.7 }}
                    >
                      ?
                    </button>
                  </td>
                </tr>
              );
            });
            })()}
            {txns.length === 0 && (
              <tr><td colSpan={6} className="empty">{monthFilter === 'all' ? 'No transactions' : 'No transactions this month'}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {ruleModal && (
        <div className="modal-overlay" onClick={() => setRuleModal(null)}>
          <div className="modal modal--rule" onClick={(e) => e.stopPropagation()}>
            <h3>Create Category Rule</h3>
            <div className="field">
              <label>Pattern</label>
              <input value={rulePattern} onChange={(e) => setRulePattern(e.target.value)} />
            </div>
            <div className="row">
              <div className="field">
                <label>Match type</label>
                <SearchableSelect
                  options={[
                    { value: 'contains', label: 'Contains' },
                    { value: 'exact', label: 'Exact' },
                  ]}
                  value={ruleType}
                  onChange={(v) => setRuleType(v as 'exact' | 'contains')}
                  placeholder="Match type"
                />
              </div>
              <div className="field">
                <label>Category</label>
                <SearchableSelect
                  options={categories.map((c) => ({ value: c.id, label: c.name }))}
                  value={ruleCatId}
                  onChange={(v) => setRuleCatId(v === '' ? '' : Number(v))}
                  placeholder="Select..."
                />
              </div>
            </div>
            <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
              <input type="checkbox" id="rule-amt-cb" checked={ruleAmountRequired} onChange={(e) => { setRuleAmountRequired(e.target.checked); if (!e.target.checked) setRuleAmount(''); }} />
              <label htmlFor="rule-amt-cb" style={{ marginBottom: 0 }}>Require amount</label>
              {ruleAmountRequired && (
                <input type="number" step="0.01" value={ruleAmount} onChange={(e) => setRuleAmount(e.target.value)} placeholder="0" style={{ width: '100px' }} />
              )}
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
            <h3>{editingCommentText.trim() ? 'View / Edit Comment' : 'Add Comment'}</h3>
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
            <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
              <div>
                {editingCommentText.trim() && (
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={async () => {
                      await updateTransaction(editingCommentId, { comment: null });
                      setEditingCommentId(null);
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn btn-ghost" onClick={() => setEditingCommentId(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={saveComment}>Save</button>
              </div>
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

      {moveMonthTxn && (
        <div className="modal-overlay" onClick={() => setMoveMonthTxn(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Count in Different Month</h3>
            <div className="card" style={{ marginBottom: '0.75rem' }}>
              <div style={{ fontWeight: 600 }}>{moveMonthTxn.descriptor}</div>
              <div style={{ fontSize: '0.85rem' }}>
                {moveMonthTxn.ignoreInBudget ? '+' : '-'}${formatAmount(moveMonthTxn.amount)} — currently {moveMonthTxn.txnDate}
              </div>
            </div>
            <div className="row" style={{ gap: '0.5rem' }}>
              <div className="field">
                <label>Month</label>
                <select
                  value={moveMonthNum}
                  onChange={(e) => setMoveMonthNum(e.target.value)}
                  style={{ padding: '0.5rem 0.75rem' }}
                >
                  {['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'].map((m, i) => (
                    <option key={m} value={m}>
                      {new Date(2000, i, 1).toLocaleDateString('en-US', { month: 'long' })}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Year</label>
                <select
                  value={moveMonthYear}
                  onChange={(e) => setMoveMonthYear(e.target.value)}
                  style={{ padding: '0.5rem 0.75rem' }}
                >
                  {(() => {
                    const cur = new Date().getFullYear();
                    return [cur - 1, cur, cur + 1];
                  })().map((y) => (
                    <option key={y} value={String(y)}>{y}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setMoveMonthTxn(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={!moveMonthYear || !moveMonthNum}
                onClick={confirmMoveMonth}
              >
                Move to {moveMonthYear}-{moveMonthNum}
              </button>
            </div>
          </div>
        </div>
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
                  <div>${formatAmount(r.refundTxn.amount)} on {r.refundTxn.txnDate}</div>
                </div>
                <div className="card" style={{ marginBottom: '0.5rem' }}>
                  <div style={{ fontSize: '0.8rem', opacity: 0.6 }}>Original expense</div>
                  <div><strong>{r.originalTxn.descriptor}</strong></div>
                  <div>${formatAmount(r.originalTxn.amount)} on {r.originalTxn.txnDate}</div>
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
      {tooltip && createPortal(
        <div className="descriptor-tooltip" style={{
          top: tooltip.top,
          left: tooltip.left,
          transform: tooltip.flipUp ? 'translateY(-100%)' : undefined,
        }}>
          {tooltip.text}
        </div>,
        document.body,
      )}

      {lookupTxn && (
        <TransactionLookup
          transaction={lookupTxn}
          onClose={() => setLookupTxn(null)}
        />
      )}
    </div>
  );
}
