import { useState, useEffect, useRef } from 'react';
import {
  getData,
  subscribe,
  bulkAddTransactions,
  addCategory,
  upsertBudget,
  addCategoryRule,
  type Transaction,
} from '../db';
import { parseBankCsv } from '../parsers/csv';
import { parseWorkbook, toBudgets, toRules } from '../parsers/xlsx';
import { parseAmazonPaste } from '../parsers/amazon';
import { parsePaypalPaste } from '../parsers/paypal';
import { detectDuplicates } from '../logic/duplicates';
import { categorizeTransactionsInPlace } from '../logic/categorize';
import { matchPaypalTransactions } from '../logic/matching';
import { findRefundCandidates, applyRefundToOriginalMonth, type RefundCandidate } from '../logic/refunds';

type ImportType = 'csv' | 'xlsx' | 'amazon' | 'paypal';

interface ImportResult {
  parsed: number;
  inserted: number;
  duplicates: number;
  matched?: number;
  refundCandidates?: number;
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
  const [refundPrompts, setRefundPrompts] = useState<RefundCandidate[]>([]);
  const [latestDate, setLatestDate] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function refresh() {
      const { transactions } = getData();
      const latest = transactions.length
        ? transactions.reduce((a, b) => (a.txnDate > b.txnDate ? a : b)).txnDate
        : null;
      setLatestDate(latest);
    }
    refresh();
    return subscribe(refresh);
  }, []);

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
      setDupReview({ dups: duplicates, unique, source });
      return;
    }

    const ids = await bulkAddTransactions(unique);

    let matched = 0;
    if (source === 'paypal_paste') {
      matched = await matchPaypalTransactions(ids);
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
      parsed: txns.length,
      inserted: unique.length,
      duplicates: duplicates.length,
      matched: source === 'paypal_paste' ? matched : undefined,
      refundCandidates: refundCandidateCount || undefined,
    });
  }

  async function confirmDupImport() {
    if (!dupReview) return;
    const ids = await bulkAddTransactions(dupReview.unique);

    let matched = 0;
    if (dupReview.source === 'paypal_paste') {
      matched = await matchPaypalTransactions(ids);
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
      parsed: dupReview.unique.length + dupReview.dups.length,
      inserted: dupReview.unique.length,
      duplicates: dupReview.dups.length,
      matched: dupReview.source === 'paypal_paste' ? matched : undefined,
      refundCandidates: refundCandidateCount || undefined,
    });
    setDupReview(null);
  }

  async function handleRefundChoice(candidate: RefundCandidate, applyToOriginal: boolean) {
    if (applyToOriginal && candidate.refundTxn.id && candidate.originalTxn.id) {
      await applyRefundToOriginalMonth(candidate.refundTxn.id, candidate.originalTxn.id);
    }
    setRefundPrompts((prev) => prev.filter((r) => r.refundTxn.id !== candidate.refundTxn.id));
  }

  async function handleCsvImport() {
    const file = fileRef.current?.files?.[0];
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

  async function handleXlsxImport() {
    const file = fileRef.current?.files?.[0];
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

  async function handlePasteImport(type: 'amazon' | 'paypal') {
    if (!pasteText.trim()) return;
    reset();
    setBusy(true);
    try {
      const txns = type === 'amazon'
        ? parseAmazonPaste(pasteText)
        : parsePaypalPaste(pasteText);
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

      {latestDate && (
        <div className="card" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: 'var(--bg-accent, #1e293b)', fontWeight: 600 }}>
          Most recent transaction in system: <span style={{ color: '#3b82f6' }}>{latestDate}</span>
        </div>
      )}

      <div className="card">
        <div className="row" style={{ marginBottom: '0.75rem' }}>
          {(['csv', 'xlsx', 'amazon', 'paypal'] as ImportType[]).map((t) => (
            <button
              key={t}
              className={`btn ${importType === t ? 'btn-primary' : 'btn-ghost'} btn-sm`}
              onClick={() => { setImportType(t); reset(); }}
            >
              {t === 'csv' ? 'Bank CSV' : t === 'xlsx' ? 'Workbook' : t === 'amazon' ? 'Amazon' : 'PayPal'}
            </button>
          ))}
        </div>

        {importType === 'csv' && (
          <>
            <p style={{ fontSize: '0.8rem', opacity: 0.6 }}>
              Scotia-style CSV: Date, Description, Sub-description, Type, Amount
            </p>
            <input ref={fileRef} type="file" accept=".csv" />
            <button className="btn btn-primary" onClick={handleCsvImport} disabled={busy} style={{ marginTop: '0.5rem' }}>
              Import CSV
            </button>
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
              Paste your Amazon order history text below.
            </p>
            <div className="field">
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Order placed&#10;January 15, 2026&#10;Total&#10;$29.99&#10;Order # 123-456..."
              />
            </div>
            <button className="btn btn-primary" onClick={() => handlePasteImport('amazon')} disabled={busy}>
              Import Amazon
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
      </div>

      {dupReview && (
        <div className="modal-overlay" onClick={() => setDupReview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Duplicate Review</h3>
            <p style={{ fontSize: '0.85rem' }}>
              Found <strong>{dupReview.dups.length}</strong> duplicate{dupReview.dups.length !== 1 ? 's' : ''} and{' '}
              <strong>{dupReview.unique.length}</strong> new transaction{dupReview.unique.length !== 1 ? 's' : ''}.
            </p>
            <div className="section-title">Duplicates (will be skipped)</div>
            <div className="dup-list">
              {dupReview.dups.map((d, i) => (
                <div className="dup-item" key={i}>
                  <span>{d.txnDate} — {d.descriptor.slice(0, 40)}</span>
                  <span>${d.amount.toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setDupReview(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={confirmDupImport}>
                Import {dupReview.unique.length} new
              </button>
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
                <div className="card" style={{ marginBottom: '0.5rem' }}>
                  <div style={{ fontSize: '0.75rem', opacity: 0.5 }}>Credit (new)</div>
                  <div style={{ fontWeight: 600 }}>{r.refundTxn.descriptor}</div>
                  <div style={{ fontSize: '0.85rem' }}>${r.refundTxn.amount.toFixed(2)} on {r.refundTxn.txnDate}</div>
                </div>
                <div className="card" style={{ marginBottom: '0.5rem' }}>
                  <div style={{ fontSize: '0.75rem', opacity: 0.5 }}>Original expense</div>
                  <div style={{ fontWeight: 600 }}>{r.originalTxn.descriptor}</div>
                  <div style={{ fontSize: '0.85rem' }}>${r.originalTxn.amount.toFixed(2)} on {r.originalTxn.txnDate}</div>
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

      {result && (
        <div className="import-status success">
          Parsed: {result.parsed} | Inserted: {result.inserted} | Duplicates dropped: {result.duplicates}
          {result.matched !== undefined && ` | PayPal matched: ${result.matched}`}
          {result.refundCandidates !== undefined && ` | Refund candidates: ${result.refundCandidates}`}
        </div>
      )}

      {error && <div className="import-status error">{error}</div>}
    </div>
  );
}
