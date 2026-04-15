import { useState, useRef } from 'react';
import {
  getData,
  bulkAddTransactions,
  updateTransaction,
  addCategory,
  upsertBudget,
  addCategoryRule,
  addAmazonOrders,
  getCustomParsers,
  executeCustomParser,
  type Transaction,
  type AmazonOrder,
} from '../db';
import { parseBankCsv } from '../parsers/csv';
import { parseWorkbook, toBudgets, toRules } from '../parsers/xlsx';
import { parseAmazonOrders } from '../parsers/amazon';
import { parsePaypalPaste } from '../parsers/paypal';
import { detectDuplicates } from '../logic/duplicates';
import { categorizeTransactionsInPlace } from '../logic/categorize';
import { matchPaypalTransactions, confirmPaypalMatch, discardPaypalTransactions, type PaypalMatchCandidate } from '../logic/matching';
import { findRefundCandidates, applyRefundToOriginalMonth, type RefundCandidate } from '../logic/refunds';
import { formatAmount } from '../utils/format';

type ImportType = 'csv' | 'xlsx' | 'amazon' | 'paypal' | 'custom';

interface ImportResult {
  parsed: number;
  inserted: number;
  duplicates: number;
  matched?: number;
  refundCandidates?: number;
  linkedOrders?: number;
}

export function ImportView() {
  const [importType, setImportType] = useState<ImportType>('csv');
  const [pasteText, setPasteText] = useState('');
  const [xlsxMonth, setXlsxMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dupReview, setDupReview] = useState<{
    dups: Omit<Transaction, 'id'>[];
    unique: Omit<Transaction, 'id'>[];
    source: string;
  } | null>(null);
  const [dupSelected, setDupSelected] = useState<Set<number>>(new Set());
  const [refundPrompts, setRefundPrompts] = useState<RefundCandidate[]>([]);
  const [paypalFuzzy, setPaypalFuzzy] = useState<PaypalMatchCandidate[]>([]);
  const [paypalUnmatched, setPaypalUnmatched] = useState<Transaction[]>([]);
  const [customParserId, setCustomParserId] = useState<string>('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function reset() {
    setResult(null);
    setError('');
    setDupReview(null);
  }

  async function insertAndReport(
    txns: Omit<Transaction, 'id'>[],
    source: string,
  ) {
    categorizeTransactionsInPlace(txns);
    const { duplicates, unique } = detectDuplicates(txns);

    if (duplicates.length > 0) {
      setDupSelected(new Set());
      setDupReview({ dups: duplicates, unique, source });
      return;
    }

    await finalizeImportResult({
      txnsToInsert: unique,
      source,
      parsed: txns.length,
      duplicatesDropped: duplicates.length,
    });
  }

  async function finalizeImportResult(args: {
    txnsToInsert: Omit<Transaction, 'id'>[];
    source: string;
    parsed: number;
    duplicatesDropped: number;
  }) {
    const { txnsToInsert, source, parsed, duplicatesDropped } = args;
    const ids = await bulkAddTransactions(txnsToInsert);

    let matched = 0;
    if (source === 'paypal_paste') {
      const { autoMatched, fuzzy, unmatched } = await matchPaypalTransactions(ids);
      matched = autoMatched;
      if (fuzzy.length > 0) setPaypalFuzzy(fuzzy);
      if (unmatched.length > 0) setPaypalUnmatched(unmatched);
    }

    const { transactions } = getData();
    const insertedTxns = transactions.filter((t) => ids.includes(t.id));
    const credits = insertedTxns.filter((t) => t.ignoreInBudget);
    let refundCandidateCount = 0;
    if (credits.length > 0) {
      const creditIds = credits.map((t) => t.id);
      const candidates = findRefundCandidates(creditIds);
      if (candidates.length > 0) {
        setRefundPrompts(candidates);
        refundCandidateCount = candidates.length;
      }
    }

    setResult({
      parsed,
      inserted: txnsToInsert.length,
      duplicates: duplicatesDropped,
      matched: source === 'paypal_paste' ? matched : undefined,
      refundCandidates: refundCandidateCount || undefined,
    });
  }

  async function confirmDupImportSkip() {
    if (!dupReview) return;
    await finalizeImportResult({
      txnsToInsert: dupReview.unique,
      source: dupReview.source,
      parsed: dupReview.unique.length + dupReview.dups.length,
      duplicatesDropped: dupReview.dups.length,
    });
    setDupReview(null);
  }

  async function confirmDupImportAll() {
    if (!dupReview) return;
    await finalizeImportResult({
      txnsToInsert: [...dupReview.unique, ...dupReview.dups],
      source: dupReview.source,
      parsed: dupReview.unique.length + dupReview.dups.length,
      duplicatesDropped: 0,
    });
    setDupReview(null);
  }

  async function confirmDupImportSelected() {
    if (!dupReview) return;
    const selectedDups = dupReview.dups.filter((_, i) => dupSelected.has(i));
    const skippedCount = dupReview.dups.length - selectedDups.length;
    await finalizeImportResult({
      txnsToInsert: [...dupReview.unique, ...selectedDups],
      source: dupReview.source,
      parsed: dupReview.unique.length + dupReview.dups.length,
      duplicatesDropped: skippedCount,
    });
    setDupReview(null);
  }

  function toggleDupSelected(index: number) {
    setDupSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function handleRefundChoice(candidate: RefundCandidate, applyToOriginal: boolean) {
    if (applyToOriginal && candidate.refundTxn.id && candidate.originalTxn.id) {
      await applyRefundToOriginalMonth(candidate.refundTxn.id, candidate.originalTxn.id);
    }
    setRefundPrompts((prev) => prev.filter((r) => r.refundTxn.id !== candidate.refundTxn.id));
  }

  async function handleCsvImport(fileArg?: File) {
    const file = fileArg ?? fileRef.current?.files?.[0];
    if (!file) return;
    reset();
    setBusy(true);
    try {
      const text = await file.text();
      const txns = parseBankCsv(text, file.name);
      if (txns.length === 0) throw new Error('No transactions parsed from CSV');
      await insertAndReport(txns, 'bank_csv');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleXlsxImport(fileArg?: File) {
    const file = fileArg ?? fileRef.current?.files?.[0];
    if (!file) return;
    reset();
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const { budgetLines, ruleLines } = parseWorkbook(buf);

      const catNames = new Set([
        ...budgetLines.map((l) => l.categoryName),
        ...ruleLines.map((l) => l.categoryName),
      ]);

      const { categories } = getData();
      const existingNames = new Set(categories.map((c) => c.name.toLowerCase()));
      for (const name of catNames) {
        if (!existingNames.has(name.toLowerCase())) {
          await addCategory(name);
        }
      }

      const { categories: allCats } = getData();
      const catMap = new Map(allCats.map((c) => [c.name.toLowerCase(), c.id]));

      const budgets = toBudgets(budgetLines, xlsxMonth, catMap);
      for (const b of budgets) {
        await upsertBudget(b.month, b.categoryId, b.targetAmount);
      }

      const rules = toRules(ruleLines, catMap);
      for (const r of rules) {
        await addCategoryRule(r);
      }

      setResult({
        parsed: budgetLines.length + ruleLines.length,
        inserted: budgets.length + rules.length,
        duplicates: 0,
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleAmazonOrderImport() {
    if (!pasteText.trim()) return;
    reset();
    setBusy(true);
    try {
      const orders = parseAmazonOrders(pasteText);
      if (orders.length === 0) throw new Error('No orders parsed from pasted text');

      // Store metadata for future backfills
      const amazonOrders: AmazonOrder[] = orders.map((o) => ({
        orderNum: o.orderNum,
        itemName: o.itemName,
        orderDate: o.orderDate,
        amount: o.amount,
        status: o.status,
      }));
      await addAmazonOrders(amazonOrders);

      const { transactions: existing } = getData();
      const amazonSources = new Set(['amazon_order', 'amazon_paste', 'amazon_payment']);
      const existingByOrder = new Map(
        existing
          .filter((t) => amazonSources.has(t.source) && t.sourceRef && t.sourceRef !== 'paste')
          .map((t) => [t.sourceRef, t]),
      );

      const toInsert: Omit<Transaction, 'id'>[] = [];
      let overwritten = 0;
      let skipped = 0;

      for (const o of orders) {
        if (o.amount === 0 && o.status === 'delivered') {
          skipped++;
          continue; // no price known, skip
        }
        const isReturnedOrCancelled = o.status === 'returned' || o.status === 'cancelled';
        const existingTxn = existingByOrder.get(o.orderNum);
        const descriptor = o.itemName
          ? `Amazon | ${o.itemName} | #${o.orderNum}`
          : `Amazon | #${o.orderNum}`;

        if (existingTxn) {
          if (isReturnedOrCancelled && existingTxn.amount > 0) {
            await updateTransaction(existingTxn.id!, {
              amount: 0,
              ignoreInBudget: true,
              source: 'amazon_order',
              descriptor,
            });
            overwritten++;
          } else {
            skipped++;
          }
          continue;
        }

        toInsert.push({
          source: 'amazon_order',
          sourceRef: o.orderNum,
          txnDate: o.orderDate,
          amount: isReturnedOrCancelled ? 0 : o.amount,
          instrument: 'Amazon',
          descriptor,
          categoryId: null,
          linkedTransactionId: null,
          ignoreInBudget: isReturnedOrCancelled,
          comment: null,
        });
      }

      categorizeTransactionsInPlace(toInsert);
      if (toInsert.length > 0) await bulkAddTransactions(toInsert);

      setResult({
        parsed: orders.length,
        inserted: toInsert.length,
        duplicates: skipped,
        linkedOrders: overwritten || undefined,
      });
      setPasteText('');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleCustomImport(fileArg?: File) {
    const file = fileArg ?? fileRef.current?.files?.[0];
    if (!file || !customParserId) return;
    const parsers = getCustomParsers();
    const parser = parsers.find((p) => p.id === customParserId);
    if (!parser) return;
    reset();
    setBusy(true);
    try {
      const text = await file.text();
      const txns = executeCustomParser(parser.code, text, file.name);
      if (txns.length === 0) throw new Error('No transactions parsed — check that you selected the right file and parser.');
      await insertAndReport(txns, `custom_${parser.id}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handlePasteImport(type: 'paypal') {
    if (!pasteText.trim()) return;
    reset();
    setBusy(true);
    try {
      const txns = parsePaypalPaste(pasteText);
      if (txns.length === 0) throw new Error('No transactions parsed from pasted text');
      await insertAndReport(txns, `${type}_paste`);
      setPasteText('');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="view-title">Import</h1>


      <div className="card">
        <div className="row" style={{ marginBottom: '0.75rem', flexWrap: 'wrap' }}>
          {(['csv', 'xlsx', 'amazon', 'paypal'] as ImportType[]).map((t) => (
            <button
              key={t}
              className={`btn ${importType === t ? 'btn-primary' : 'btn-ghost'} btn-sm`}
              onClick={() => { setImportType(t); reset(); }}
            >
              {t === 'csv' ? 'Bank CSV' : t === 'xlsx' ? 'Workbook' : t === 'amazon' ? 'Amazon' : 'PayPal'}
            </button>
          ))}
          {getCustomParsers().length > 0 && (
            <button
              className={`btn ${importType === 'custom' ? 'btn-primary' : 'btn-ghost'} btn-sm`}
              onClick={() => { setImportType('custom'); reset(); }}
            >
              Custom
            </button>
          )}
        </div>

        {importType === 'csv' && (
          <>
            <p style={{ fontSize: '0.8rem', opacity: 0.6 }}>
              Scotia-style CSV: Date, Description, Sub-description, Type, Amount
            </p>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer.files[0];
                if (file) handleCsvImport(file);
              }}
              onClick={() => fileRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? 'var(--accent, #14b8a6)' : 'var(--border)'}`,
                borderRadius: 'var(--radius-lg, 8px)',
                padding: '2rem 1.5rem',
                textAlign: 'center',
                background: dragOver ? 'var(--bg-2)' : 'transparent',
                transition: 'border-color 0.15s, background 0.15s',
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              <div style={{ fontSize: '1.5rem', marginBottom: '0.4rem', opacity: 0.5 }}>↓</div>
              <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
                {dragOver ? 'Drop to import' : 'Drop CSV here'}
              </div>
              <div style={{ fontSize: '0.8rem', opacity: 0.5 }}>or click to browse</div>
            </div>
            <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={() => handleCsvImport()} />
          </>
        )}

        {importType === 'xlsx' && (
          <>
            <p style={{ fontSize: '0.8rem', opacity: 0.6 }}>
              Sheet 1: budget lines (category, target). Sheet 2: keyword rules (pattern, category).
            </p>
            <div className="field">
              <label>Budget month</label>
              <input type="month" value={xlsxMonth} onChange={(e) => setXlsxMonth(e.target.value)} />
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" />
            <button className="btn btn-primary" onClick={handleXlsxImport} disabled={busy} style={{ marginTop: '0.5rem' }}>
              Import Workbook
            </button>
          </>
        )}

        {importType === 'amazon' && (
          <>
            <p style={{ fontSize: '0.8rem', opacity: 0.6 }}>
              Paste your Amazon order history. Each order creates a transaction. Returned or cancelled orders are automatically zeroed out.
            </p>
            <div className="field">
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={"Delivered March 21, 2026\nUGREEN Docking Station...\nOrder placed\nMarch 21, 2026\nTotal $72.87\nOrder # 701-2317167-3901016"}
              />
            </div>
            <button className="btn btn-primary" onClick={handleAmazonOrderImport} disabled={busy}>
              Import Orders
            </button>
          </>
        )}

        {importType === 'paypal' && (
          <>
            <p style={{ fontSize: '0.8rem', opacity: 0.6 }}>
              Paste your PayPal activity text below.
            </p>
            <div className="field">
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Feb 2026&#10;Netflix&#10;$15.99&#10;Feb 1 . Automatic Payment"
              />
            </div>
            <button className="btn btn-primary" onClick={() => handlePasteImport('paypal')} disabled={busy}>
              Import PayPal
            </button>
          </>
        )}

        {importType === 'custom' && (() => {
          const parsers = getCustomParsers();
          if (parsers.length === 0) return (
            <p style={{ fontSize: '0.85rem', opacity: 0.7 }}>
              No custom parsers yet. Go to Settings → Custom Import Parsers to create one.
            </p>
          );
          const selected = parsers.find((p) => p.id === customParserId);
          return (
            <>
              <div className="field" style={{ marginBottom: '0.5rem' }}>
                <label>Select parser</label>
                <select
                  value={customParserId}
                  onChange={(e) => setCustomParserId(e.target.value)}
                  style={{ padding: '0.5rem 0.75rem' }}
                >
                  <option value="">— choose parser —</option>
                  {parsers.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.instrument})</option>
                  ))}
                </select>
              </div>
              {selected && (
                <div style={{ fontSize: '0.8rem', opacity: 0.6, marginBottom: '0.5rem' }}>
                  Sample: <code style={{ background: 'var(--input-bg)', padding: '0 3px', borderRadius: 2 }}>
                    {selected.sampleLines.split('\n')[0].slice(0, 60)}
                  </code>
                </div>
              )}
              <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" style={{ marginBottom: '0.5rem' }} />
              <button
                className="btn btn-primary"
                onClick={handleCustomImport}
                disabled={busy || !customParserId}
                style={{ display: 'block' }}
              >
                Import with {selected?.name ?? 'selected parser'}
              </button>
            </>
          );
        })()}
      </div>

      {dupReview && (
        <div className="modal-overlay" onClick={() => setDupReview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
            <h3>Duplicate Review</h3>
            <p style={{ fontSize: '0.85rem' }}>
              Found <strong>{dupReview.dups.length}</strong> possible duplicate{dupReview.dups.length !== 1 ? 's' : ''} and{' '}
              <strong>{dupReview.unique.length}</strong> new transaction{dupReview.unique.length !== 1 ? 's' : ''}.
              Check the ones you want to import anyway.
            </p>
            <div className="section-title">Possible duplicates</div>
            <div className="dup-list" style={{ maxHeight: 300, overflowY: 'auto' }}>
              {dupReview.dups.map((d, i) => (
                <label
                  className="dup-item"
                  key={i}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', padding: '0.35rem 0', background: dupSelected.has(i) ? 'rgba(59,130,246,0.1)' : undefined, borderRadius: 4 }}
                >
                  <input
                    type="checkbox"
                    checked={dupSelected.has(i)}
                    onChange={() => toggleDupSelected(i)}
                    style={{ accentColor: '#3b82f6', width: 16, height: 16, flexShrink: 0 }}
                  />
                  <span style={{ flex: 1 }}>{d.txnDate} — {d.descriptor.slice(0, 40)}</span>
                  <span>${formatAmount(d.amount)}</span>
                </label>
              ))}
            </div>
            <div className="modal-actions" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
              <button className="btn btn-ghost" onClick={() => setDupReview(null)}>Cancel</button>
              <button className="btn btn-ghost" onClick={confirmDupImportAll}>
                Import all ({dupReview.unique.length + dupReview.dups.length})
              </button>
              {dupSelected.size > 0 && (
                <button className="btn btn-primary" onClick={confirmDupImportSelected}>
                  Import {dupReview.unique.length + dupSelected.size} ({dupSelected.size} selected + {dupReview.unique.length} new)
                </button>
              )}
              {dupSelected.size === 0 && (
                <button className="btn btn-primary" onClick={confirmDupImportSkip}>
                  Import {dupReview.unique.length} new
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {refundPrompts.length > 0 && (
        <div className="modal-overlay" onClick={() => setRefundPrompts([])}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Possible Refund{refundPrompts.length > 1 ? 's' : ''} Detected</h3>
            {refundPrompts.map((r) => (
              <div key={r.refundTxn.id} style={{ marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>
                <div className="card" style={{ marginBottom: '0.5rem', borderLeft: '3px solid #22c55e' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', background: '#22c55e', color: '#fff', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>Credit</span>
                    <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>Possible refund</span>
                  </div>
                  <div style={{ fontWeight: 600 }}>{r.refundTxn.descriptor}</div>
                  <div style={{ fontSize: '0.85rem' }}>
                    <span style={{ color: '#22c55e', fontWeight: 600 }}>+${formatAmount(r.refundTxn.amount)}</span>
                    {' '}on {r.refundTxn.txnDate}
                  </div>
                </div>
                <div className="card" style={{ marginBottom: '0.5rem', borderLeft: '3px solid #ef4444' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', background: '#ef4444', color: '#fff', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>Debit</span>
                    <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>Original expense</span>
                  </div>
                  <div style={{ fontWeight: 600 }}>{r.originalTxn.descriptor}</div>
                  <div style={{ fontSize: '0.85rem' }}>
                    <span style={{ color: '#ef4444', fontWeight: 600 }}>-${formatAmount(r.originalTxn.amount)}</span>
                    {' '}on {r.originalTxn.txnDate}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => handleRefundChoice(r, true)}>
                    Count in {r.originalTxn.txnDate.slice(0, 7)}
                  </button>
                  <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => handleRefundChoice(r, false)}>
                    Keep as new
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {paypalFuzzy.length > 0 && (
        <div className="modal-overlay" onClick={() => setPaypalFuzzy([])}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Confirm PayPal Matches</h3>
            <p style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
              These PayPal transactions have close but not exact amounts (likely due to currency conversion). Confirm each match or skip it.
            </p>
            {paypalFuzzy.map((m) => {
              const diff = Math.abs(m.paypalTxn.amount - m.cardTxn.amount);
              return (
                <div key={m.paypalTxn.id} style={{ marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>
                  <div className="card" style={{ marginBottom: '0.5rem', borderLeft: '3px solid #8b5cf6' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                      <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', background: '#8b5cf6', color: '#fff', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>PayPal</span>
                    </div>
                    <div style={{ fontWeight: 600 }}>{m.paypalTxn.descriptor}</div>
                    <div style={{ fontSize: '0.85rem' }}>
                      ${formatAmount(m.paypalTxn.amount)} on {m.paypalTxn.txnDate}
                      {m.paypalTxn.comment && <span style={{ fontSize: '0.8rem', opacity: 0.6, marginLeft: '0.5rem' }}>({m.paypalTxn.comment})</span>}
                    </div>
                  </div>
                  <div className="card" style={{ marginBottom: '0.5rem', borderLeft: '3px solid #3b82f6' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                      <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', background: '#3b82f6', color: '#fff', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>{m.cardTxn.instrument}</span>
                    </div>
                    <div style={{ fontWeight: 600 }}>{m.cardTxn.descriptor}</div>
                    <div style={{ fontSize: '0.85rem' }}>
                      ${formatAmount(m.cardTxn.amount)} on {m.cardTxn.txnDate}
                    </div>
                  </div>
                  <div style={{ fontSize: '0.8rem', opacity: 0.7, marginBottom: '0.5rem' }}>
                    Difference: ${formatAmount(diff)} ({(diff / Math.max(m.paypalTxn.amount, 0.01) * 100).toFixed(1)}%)
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      className="btn btn-primary btn-sm"
                      style={{ flex: 1 }}
                      onClick={async () => {
                        await confirmPaypalMatch(m.paypalTxn.id!, m.cardTxn.id!);
                        setPaypalFuzzy((prev) => prev.filter((x) => x.paypalTxn.id !== m.paypalTxn.id));
                      }}
                    >
                      Link these
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ flex: 1 }}
                      onClick={() => setPaypalFuzzy((prev) => prev.filter((x) => x.paypalTxn.id !== m.paypalTxn.id))}
                    >
                      Skip
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {paypalUnmatched.length > 0 && (
        <div className="modal-overlay" onClick={() => {}}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
            <h3>Unmatched PayPal Transactions</h3>
            <p style={{ fontSize: '0.85rem', marginBottom: '0.25rem' }}>
              These PayPal transactions could not be matched to any bank debit. They are most likely
              already recorded from your bank statement — keeping them will create duplicates.
            </p>
            <p style={{ fontSize: '0.85rem', opacity: 0.65, marginBottom: '0.75rem' }}>
              <strong>Recommended: discard them.</strong> Only keep if you're certain there is no matching bank entry.
            </p>
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              {paypalUnmatched.map((t) => (
                <div key={t.id} style={{ marginBottom: '0.75rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>
                  <div className="card" style={{ marginBottom: '0.5rem', borderLeft: '3px solid #f59e0b' }}>
                    <div style={{ fontWeight: 600 }}>{t.descriptor}</div>
                    <div style={{ fontSize: '0.85rem' }}>
                      ${formatAmount(t.amount)} on {t.txnDate}
                      {t.comment && <span style={{ fontSize: '0.8rem', opacity: 0.6, marginLeft: '0.5rem' }}>({t.comment})</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      className="btn btn-primary btn-sm"
                      style={{ flex: 1 }}
                      onClick={async () => {
                        await discardPaypalTransactions([t.id]);
                        setPaypalUnmatched((prev) => prev.filter((x) => x.id !== t.id));
                      }}
                    >
                      Discard
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ flex: 1, opacity: 0.6 }}
                      onClick={() => setPaypalUnmatched((prev) => prev.filter((x) => x.id !== t.id))}
                    >
                      Keep anyway
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="modal-actions" style={{ marginTop: '0.75rem' }}>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  await discardPaypalTransactions(paypalUnmatched.map((t) => t.id));
                  setPaypalUnmatched([]);
                }}
              >
                Discard all {paypalUnmatched.length}
              </button>
              <button
                className="btn btn-ghost"
                style={{ opacity: 0.6 }}
                onClick={() => setPaypalUnmatched([])}
              >
                Keep all anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {result && (
        <div className="import-status success">
          Parsed: {result.parsed} | Inserted: {result.inserted} | Duplicates dropped: {result.duplicates}
          {result.matched !== undefined && ` | PayPal matched: ${result.matched}`}
          {result.linkedOrders !== undefined && ` | Linked to orders: ${result.linkedOrders}`}
          {result.refundCandidates !== undefined && ` | Refund candidates: ${result.refundCandidates}`}
        </div>
      )}

      {error && <div className="import-status error">{error}</div>}
    </div>
  );
}
