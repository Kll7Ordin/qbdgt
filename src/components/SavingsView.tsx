import { useState, useEffect } from 'react';
import { db, type SavingsBucket, type SavingsEntry, type SavingsSchedule } from '../db';
import { processSchedules, getBucketBalance } from '../logic/savings';

interface BucketData {
  bucket: SavingsBucket;
  balance: number;
  entries: SavingsEntry[];
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
  const [rev, setRev] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      await processSchedules();
      const allBuckets = await db.savingsBuckets.toArray();
      const data: BucketData[] = [];
      for (const b of allBuckets) {
        if (b.id === undefined) continue;
        const balance = await getBucketBalance(b.id);
        const entries = await db.savingsEntries
          .where('bucketId').equals(b.id)
          .reverse()
          .toArray();
        const schedules = await db.savingsSchedules
          .where('bucketId').equals(b.id)
          .toArray();
        data.push({ bucket: b, balance, entries, schedules });
      }
      if (!cancelled) setBuckets(data);
    })();

    return () => { cancelled = true; };
  }, [rev]);

  function reload() { setRev((r) => r + 1); }

  async function addBucket() {
    if (!newName.trim()) return;
    await db.savingsBuckets.add({ name: newName.trim() });
    setNewName('');
    reload();
  }

  async function deleteBucket(id: number) {
    await db.savingsEntries.where('bucketId').equals(id).delete();
    await db.savingsSchedules.where('bucketId').equals(id).delete();
    await db.savingsBuckets.delete(id);
    reload();
  }

  async function addEntry() {
    if (entryBucket === null || !entryAmount) return;
    const amt = parseFloat(entryAmount);
    if (isNaN(amt) || amt <= 0) return;
    await db.savingsEntries.add({
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
    reload();
  }

  async function addSchedule() {
    if (schedBucket === null || !schedAmount) return;
    await db.savingsSchedules.add({
      bucketId: schedBucket,
      dayOfMonth: parseInt(schedDay),
      amount: parseFloat(schedAmount),
      startMonth: schedStart,
      active: true,
    });
    setSchedAmount('');
    setSchedBucket(null);
    reload();
  }

  async function toggleSchedule(id: number, active: boolean) {
    await db.savingsSchedules.update(id, { active: !active });
    reload();
  }

  return (
    <div>
      <h1 className="view-title">Savings</h1>

      {buckets.length === 0 && <p className="empty">No savings buckets yet</p>}

      {buckets.map(({ bucket, balance, entries, schedules }) => (
        <div className="bucket-card" key={bucket.id}>
          <div
            className="bucket-header"
            onClick={() => setExpanded(expanded === bucket.id! ? null : bucket.id!)}
          >
            <span className="bucket-name">{bucket.name}</span>
            <span className={`bucket-balance ${balance >= 0 ? 'positive' : 'negative'}`}>
              ${balance.toFixed(2)}
            </span>
          </div>

          {expanded === bucket.id && (
            <div className="bucket-details">
              {schedules.length > 0 && (
                <>
                  <div className="section-title">Schedules</div>
                  {schedules.map((s) => (
                    <div key={s.id} style={{ fontSize: '0.8rem', display: 'flex', justifyContent: 'space-between', padding: '0.2rem 0' }}>
                      <span>${s.amount} on day {s.dayOfMonth} (from {s.startMonth})</span>
                      <button
                        className={`btn btn-sm ${s.active ? 'btn-success' : 'btn-ghost'}`}
                        onClick={() => toggleSchedule(s.id!, s.active)}
                      >
                        {s.active ? 'Active' : 'Paused'}
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
                    <tr key={e.id}>
                      <td>{e.entryDate}</td>
                      <td className={`num ${e.amount >= 0 ? 'positive' : 'negative'}`}>
                        {e.amount >= 0 ? '+' : ''}${e.amount.toFixed(2)}
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
                onClick={() => deleteBucket(bucket.id!)}
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
          <div className="field">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Bucket name" />
          </div>
          <button className="btn btn-primary" onClick={addBucket}>Add</button>
        </div>
      </div>

      {buckets.length > 0 && (
        <>
          <div className="card">
            <div className="section-title">Add manual entry</div>
            <div className="row">
              <div className="field">
                <label>Bucket</label>
                <select value={entryBucket ?? ''} onChange={(e) => setEntryBucket(Number(e.target.value))}>
                  <option value="">Select...</option>
                  {buckets.map(({ bucket }) => (
                    <option key={bucket.id} value={bucket.id}>{bucket.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Type</label>
                <select value={entryType} onChange={(e) => setEntryType(e.target.value as 'deposit' | 'withdrawal')}>
                  <option value="deposit">Deposit</option>
                  <option value="withdrawal">Withdrawal</option>
                </select>
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
            <button className="btn btn-primary" onClick={addEntry} style={{ marginTop: '0.5rem' }}>Add Entry</button>
          </div>

          <div className="card">
            <div className="section-title">Add schedule</div>
            <div className="row">
              <div className="field">
                <label>Bucket</label>
                <select value={schedBucket ?? ''} onChange={(e) => setSchedBucket(Number(e.target.value))}>
                  <option value="">Select...</option>
                  {buckets.map(({ bucket }) => (
                    <option key={bucket.id} value={bucket.id}>{bucket.name}</option>
                  ))}
                </select>
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
            <button className="btn btn-primary" onClick={addSchedule} style={{ marginTop: '0.5rem' }}>Add Schedule</button>
          </div>
        </>
      )}
    </div>
  );
}
