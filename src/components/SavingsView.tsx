import { useState, useEffect, useCallback } from 'react';
import {
  getData,
  subscribe,
  addSavingsBucket,
  deleteSavingsBucket,
  addSavingsEntry,
  addSavingsSchedule,
  updateSavingsSchedule,
  setSavingsLoanAmount,
  clearAutoScheduleEntries,
  deleteSavingsSchedule,
  deleteAllSavingsSchedules,
  type SavingsBucket,
  type SavingsEntry,
  type SavingsSchedule,
} from '../db';
import { processSchedules, getBucketBalance } from '../logic/savings';
import { SearchableSelect } from './SearchableSelect';
import { formatAmount } from '../utils/format';

interface DisplayEntry {
  key: string;
  date: string;
  amount: number;
  notes: string;
  source: string;
}

interface BucketData {
  bucket: SavingsBucket;
  balance: number;
  entries: DisplayEntry[];
  schedules: SavingsSchedule[];
}

export function SavingsView() {
  const [buckets, setBuckets] = useState<BucketData[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [newName, setNewName] = useState('');

  const [entryBucket, setEntryBucket] = useState<number | null>(null);
  const [entryAmount, setEntryAmount] = useState('');
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [entryNotes, setEntryNotes] = useState('');
  const [entryType, setEntryType] = useState<'deposit' | 'withdrawal'>('deposit');

  const [schedBucket, setSchedBucket] = useState<number | null>(null);
  const [schedDay, setSchedDay] = useState('1');
  const [schedAmount, setSchedAmount] = useState('');
  const [schedStart, setSchedStart] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [loanAmount, setLoanAmount] = useState('');
  const [editingSchedDay, setEditingSchedDay] = useState<number | null>(null);
  const [editingSchedDayVal, setEditingSchedDayVal] = useState('');

  const [initialized, setInitialized] = useState(false);

  const compute = useCallback(() => {
    const { savingsBuckets, savingsEntries, savingsSchedules, categories, transactions, transactionSplits } = getData();

    const splitsByTxn = new Map<number, typeof transactionSplits>();
    for (const s of transactionSplits) {
      const arr = splitsByTxn.get(s.transactionId) ?? [];
      arr.push(s);
      splitsByTxn.set(s.transactionId, arr);
    }

    const result: BucketData[] = savingsBuckets.map((b) => {
      // Manual/scheduled savings entries
      const manualEntries: DisplayEntry[] = savingsEntries
        .filter((e) => e.bucketId === b.id)
        .map((e) => ({ key: `e-${e.id}`, date: e.entryDate, amount: e.amount, notes: e.notes ?? '', source: e.source }));

      // Real transaction contributions via linked categories
      const linkedCatIds = new Set(categories.filter((c) => c.savingsBucketId === b.id).map((c) => c.id));
      const txnEntries: DisplayEntry[] = [];
      if (linkedCatIds.size > 0) {
        for (const t of transactions) {
          if (t.ignoreInBudget) continue;
          const splits = splitsByTxn.get(t.id);
          if (splits && splits.length > 0) {
            for (const s of splits) {
              if (linkedCatIds.has(s.categoryId)) {
                txnEntries.push({ key: `t-${t.id}-${s.categoryId}`, date: t.txnDate, amount: s.amount, notes: t.descriptor, source: 'transaction' });
              }
            }
          } else if (t.categoryId && linkedCatIds.has(t.categoryId)) {
            txnEntries.push({ key: `t-${t.id}`, date: t.txnDate, amount: t.amount, notes: t.descriptor, source: 'transaction' });
          }
        }
      }

      const allEntries = [...manualEntries, ...txnEntries]
        .sort((a, b) => b.date > a.date ? 1 : b.date < a.date ? -1 : 0);

      return {
        bucket: b,
        balance: getBucketBalance(b.id),
        entries: allEntries,
        schedules: savingsSchedules.filter((s) => s.bucketId === b.id),
      };
    });
    setBuckets(result);
  }, []);

  useEffect(() => {
    processSchedules().then(() => {
      compute();
      setInitialized(true);
    });
    return subscribe(compute);
  }, [compute]);

  if (!initialized) return null;

  async function handleAddBucket() {
    if (!newName.trim()) return;
    await addSavingsBucket(newName.trim());
    setNewName('');
  }

  async function handleDeleteBucket(id: number) {
    await deleteSavingsBucket(id);
  }

  async function handleAddEntry() {
    if (entryBucket === null || !entryAmount) return;
    const amt = parseFloat(entryAmount);
    if (isNaN(amt) || amt === 0) return;
    await addSavingsEntry({
      entryDate: entryDate,
      bucketId: entryBucket,
      amount: entryType === 'deposit' ? amt : -amt,
      notes: entryNotes,
      source: 'manual',
      scheduleId: null,
    });
    setEntryAmount('');
    setEntryNotes('');
    setEntryBucket(null);
  }

  async function handleAddSchedule() {
    if (schedBucket === null || !schedAmount) return;
    await addSavingsSchedule({
      bucketId: schedBucket,
      dayOfMonth: parseInt(schedDay),
      amount: parseFloat(schedAmount),
      startMonth: schedStart,
      active: true,
    });
    setSchedAmount('');
    setSchedBucket(null);
  }

  async function handleToggleSchedule(id: number, active: boolean) {
    await updateSavingsSchedule(id, { active: !active });
  }

  async function handleSaveSchedDay(sched: SavingsSchedule) {
    const day = parseInt(editingSchedDayVal, 10);
    if (day >= 1 && day <= 31) {
      await updateSavingsSchedule(sched.id, { dayOfMonth: day });
      setEditingSchedDay(null);
    }
  }

  async function handleSetLoan() {
    const amt = parseFloat(loanAmount);
    if (!isNaN(amt) && amt >= 0) {
      await setSavingsLoanAmount(amt);
    }
  }

  const totalBalance = buckets.reduce((s, b) => s + b.balance, 0);
  const loan = getData().savingsLoanAmount ?? 0;

  return (
    <div>
      <h1 className="view-title">Savings</h1>

      {buckets.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div className="section-title">Total</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>Balance</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>${formatAmount(totalBalance)}</div>
            </div>
            <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 200 }}>
              <label>Amount on loan from savings</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={loanAmount !== '' ? loanAmount : (loan > 0 ? String(loan) : '')}
                  onChange={(e) => setLoanAmount(e.target.value)}
                  placeholder="0"
                  onBlur={() => { handleSetLoan(); setLoanAmount(''); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { handleSetLoan(); setLoanAmount(''); } }}
                />
                <button className="btn btn-primary btn-sm" onClick={handleSetLoan}>Set</button>
              </div>
            </div>
          </div>
          {loan > 0 && (
            <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: '0.9rem' }}>
                <span style={{ opacity: 0.7 }}>Available (excluding loan): </span>
                <strong className="positive">${formatAmount(totalBalance - loan)}</strong>
              </div>
            </div>
          )}
        </div>
      )}

      {buckets.length === 0 && <p className="empty">No savings buckets yet</p>}

      {buckets.map(({ bucket, balance, entries, schedules }) => (
        <div className="bucket-card" key={bucket.id}>
          <div
            className="bucket-header"
            onClick={() => setExpanded(expanded === bucket.id ? null : bucket.id)}
          >
            <span className="bucket-name">{bucket.name}</span>
            <span className={`bucket-balance ${balance >= 0 ? 'positive' : 'negative'}`}>
              ${formatAmount(balance)}
            </span>
          </div>

          {expanded === bucket.id && (
            <div className="bucket-details">
              {schedules.length > 0 && (
                <>
                  <div className="section-title">Schedules</div>
                  {schedules.map((s) => (
                    <div key={s.id} style={{ fontSize: '0.9rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.3rem 0' }}>
                      <span>
                        ${formatAmount(s.amount)} on day{' '}
                        {editingSchedDay === s.id ? (
                          <input
                            type="number"
                            min={1}
                            max={31}
                            value={editingSchedDayVal}
                            onChange={(e) => setEditingSchedDayVal(e.target.value)}
                            onBlur={() => handleSaveSchedDay(s)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSaveSchedDay(s)}
                            style={{ width: 50, padding: '0.2rem', fontSize: '0.9rem' }}
                            autoFocus
                          />
                        ) : (
                          <span
                            onClick={() => { setEditingSchedDay(s.id); setEditingSchedDayVal(String(s.dayOfMonth)); }}
                            style={{ cursor: 'pointer', textDecoration: 'underline' }}
                          >
                            {s.dayOfMonth}
                          </span>
                        )}{' '}
                        (from {s.startMonth})
                      </span>
                      <button
                        className={`btn btn-sm ${s.active ? 'btn-success' : 'btn-ghost'}`}
                        onClick={() => handleToggleSchedule(s.id, s.active)}
                      >
                        {s.active ? 'Active' : 'Paused'}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--red)' }}
                        onClick={() => deleteSavingsSchedule(s.id)}
                        title="Delete schedule"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </>
              )}

              <div className="section-title">Entries</div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="num">Amount</th>
                    <th>Notes</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.key}>
                      <td>{e.date}</td>
                      <td className={`num ${e.amount >= 0 ? 'positive' : 'negative'}`}>
                        {e.amount >= 0 ? '+' : ''}${formatAmount(e.amount)}
                      </td>
                      <td>{e.notes}</td>
                      <td><span className="chip">{e.source}</span></td>
                    </tr>
                  ))}
                  {entries.length === 0 && (
                    <tr><td colSpan={4} className="empty">No entries</td></tr>
                  )}
                </tbody>
              </table>

              <button
                className="btn btn-danger btn-sm"
                style={{ marginTop: '0.5rem' }}
                onClick={() => handleDeleteBucket(bucket.id)}
              >
                Delete bucket
              </button>
            </div>
          )}
        </div>
      ))}

      <div className="card">
        <div className="section-title">Add bucket</div>
        <div className="row">
          <div className="field" style={{ flex: '1 1 160px' }}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Bucket name" />
          </div>
          <button className="btn btn-primary" style={{ flex: '0 0 auto', alignSelf: 'flex-end' }} onClick={handleAddBucket}>Add</button>
        </div>
      </div>

      {buckets.length > 0 && (
        <>
          <div className="card">
            <div className="section-title">Add manual entry</div>
            <div className="row">
              <div className="field">
                <label>Bucket</label>
                <SearchableSelect
                  options={buckets.map(({ bucket }) => ({ value: bucket.id, label: bucket.name }))}
                  value={entryBucket ?? ''}
                  onChange={(v) => setEntryBucket(v === '' ? null : Number(v))}
                  placeholder="Select..."
                />
              </div>
              <div className="field">
                <label>Type</label>
                <SearchableSelect
                  options={[
                    { value: 'deposit', label: 'Deposit' },
                    { value: 'withdrawal', label: 'Withdrawal' },
                  ]}
                  value={entryType}
                  onChange={(v) => setEntryType(v as 'deposit' | 'withdrawal')}
                  placeholder="Type"
                />
              </div>
            </div>
            <div className="row">
              <div className="field">
                <label>Amount</label>
                <input type="number" value={entryAmount} onChange={(e) => setEntryAmount(e.target.value)} placeholder="0" />
              </div>
              <div className="field">
                <label>Date</label>
                <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label>Notes</label>
              <input value={entryNotes} onChange={(e) => setEntryNotes(e.target.value)} placeholder="Optional notes" />
            </div>
            <button className="btn btn-primary" onClick={handleAddEntry} style={{ marginTop: '0.5rem' }}>Add Entry</button>
          </div>

          <div className="card">
            <div className="section-title">Add schedule</div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-3)', margin: '0 0 0.75rem' }}>
              ⚠ Only use schedules if there is no real transaction to categorize. If a category is linked to this bucket, real transactions will count automatically — using a schedule on top will double-count contributions.
            </p>
            <div className="row">
              <div className="field">
                <label>Bucket</label>
                <SearchableSelect
                  options={buckets.map(({ bucket }) => ({ value: bucket.id, label: bucket.name }))}
                  value={schedBucket ?? ''}
                  onChange={(v) => setSchedBucket(v === '' ? null : Number(v))}
                  placeholder="Select..."
                />
              </div>
              <div className="field">
                <label>Day</label>
                <input type="number" min="1" max="31" value={schedDay} onChange={(e) => setSchedDay(e.target.value)} />
              </div>
            </div>
            <div className="row">
              <div className="field">
                <label>Amount</label>
                <input type="number" value={schedAmount} onChange={(e) => setSchedAmount(e.target.value)} placeholder="0" />
              </div>
              <div className="field">
                <label>Start month</label>
                <input type="month" value={schedStart} onChange={(e) => setSchedStart(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={handleAddSchedule}>Add Schedule</button>
              <button
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--red)' }}
                onClick={async () => {
                  const n = await clearAutoScheduleEntries();
                  alert(n > 0 ? `Cleared ${n} scheduled entries. Balances now reflect real transactions only.` : 'No scheduled entries to clear.');
                  compute();
                }}
              >
                Clear all scheduled entries
              </button>
              <button
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--red)' }}
                onClick={async () => {
                  const n = await deleteAllSavingsSchedules();
                  alert(n > 0 ? `Deleted ${n} schedule${n !== 1 ? 's' : ''}.` : 'No schedules to delete.');
                }}
              >
                Delete all schedules
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
