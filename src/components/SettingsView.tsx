import { useState, useEffect, useRef, type FormEvent } from 'react';
import { db, type CategoryRule } from '../db';
import { recategorizeAll } from '../logic/categorize';
import { encrypt, decrypt } from '../crypto';

export function SettingsView() {
  const [categories, setCategories] = useState<import('../db').Category[]>([]);
  const [rules, setRules] = useState<(CategoryRule & { catName: string })[]>([]);
  const [newCat, setNewCat] = useState('');
  const [newPattern, setNewPattern] = useState('');
  const [newMatchType, setNewMatchType] = useState<'exact' | 'contains'>('contains');
  const [newRuleCat, setNewRuleCat] = useState<number | ''>('');
  const [passphrase, setPassphrase] = useState('');
  const [syncStatus, setSyncStatus] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [rev, setRev] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cats = await db.categories.toArray();
      if (cancelled) return;
      setCategories(cats);
      const catMap = new Map(cats.map((c) => [c.id!, c.name]));
      const allRules = await db.categoryRules.toArray();
      if (!cancelled) setRules(allRules.map((r) => ({ ...r, catName: catMap.get(r.categoryId) ?? '?' })));
    })();
    return () => { cancelled = true; };
  }, [rev]);

  function reload() { setRev((r) => r + 1); }

  async function addCategory() {
    if (!newCat.trim()) return;
    await db.categories.add({ name: newCat.trim() });
    setNewCat('');
    reload();
  }

  async function deleteCategory(id: number) {
    await db.categories.delete(id);
    await db.categoryRules.where('categoryId').equals(id).delete();
    reload();
  }

  async function addRule() {
    if (!newPattern || !newRuleCat) return;
    await db.categoryRules.add({
      matchType: newMatchType,
      pattern: newPattern.toLowerCase(),
      categoryId: newRuleCat as number,
    });
    setNewPattern('');
    reload();
  }

  async function deleteRule(id: number) {
    await db.categoryRules.delete(id);
    reload();
  }

  async function runRecategorize() {
    const count = await recategorizeAll();
    alert(`Re-categorized ${count} transactions.`);
  }

  function clearSyncStatus() {
    setTimeout(() => setSyncStatus(null), 4000);
  }

  async function handleExport(e: FormEvent) {
    e.preventDefault();
    if (!passphrase) return;
    setBusy(true);
    try {
      const data = {
        categories: await db.categories.toArray(),
        categoryRules: await db.categoryRules.toArray(),
        budgets: await db.budgets.toArray(),
        transactions: await db.transactions.toArray(),
        transactionSplits: await db.transactionSplits.toArray(),
        savingsBuckets: await db.savingsBuckets.toArray(),
        savingsEntries: await db.savingsEntries.toArray(),
        savingsSchedules: await db.savingsSchedules.toArray(),
      };
      const json = JSON.stringify(data);
      const encrypted = await encrypt(json, passphrase);
      const blob = new Blob([encrypted], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `budget-full-${new Date().toISOString().split('T')[0]}.budget`;
      a.click();
      URL.revokeObjectURL(url);
      setSyncStatus({ type: 'ok', msg: 'Full backup exported' });
    } catch {
      setSyncStatus({ type: 'err', msg: 'Export failed' });
    } finally {
      setBusy(false);
      clearSyncStatus();
    }
  }

  async function handleImport(e: FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file || !passphrase) return;
    setBusy(true);
    try {
      const buffer = await file.arrayBuffer();
      const json = await decrypt(buffer, passphrase);
      const data = JSON.parse(json);

      await db.categories.clear();
      await db.categoryRules.clear();
      await db.budgets.clear();
      await db.transactions.clear();
      await db.transactionSplits.clear();
      await db.savingsBuckets.clear();
      await db.savingsEntries.clear();
      await db.savingsSchedules.clear();

      const stripId = (obj: Record<string, unknown>) => {
        const copy = { ...obj };
        delete copy.id;
        return copy;
      };
      if (data.categories) await db.categories.bulkAdd(data.categories.map(stripId));
      if (data.categoryRules) await db.categoryRules.bulkAdd(data.categoryRules.map(stripId));
      if (data.budgets) await db.budgets.bulkAdd(data.budgets.map(stripId));
      if (data.transactions) await db.transactions.bulkAdd(data.transactions.map(stripId));
      if (data.transactionSplits) await db.transactionSplits.bulkAdd(data.transactionSplits.map(stripId));
      if (data.savingsBuckets) await db.savingsBuckets.bulkAdd(data.savingsBuckets.map(stripId));
      if (data.savingsEntries) await db.savingsEntries.bulkAdd(data.savingsEntries.map(stripId));
      if (data.savingsSchedules) await db.savingsSchedules.bulkAdd(data.savingsSchedules.map(stripId));

      setSyncStatus({ type: 'ok', msg: 'Full backup restored' });
      if (fileRef.current) fileRef.current.value = '';
      window.location.reload();
    } catch {
      setSyncStatus({ type: 'err', msg: 'Import failed — wrong passphrase or bad file' });
    } finally {
      setBusy(false);
      clearSyncStatus();
    }
  }

  return (
    <div>
      <h1 className="view-title">Settings</h1>

      {/* Categories */}
      <div className="section-title">Categories</div>
      <div className="card">
        {categories.map((c) => (
          <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.3rem 0', borderBottom: '1px solid var(--border-color)' }}>
            <span>{c.name}</span>
            <button className="btn btn-danger btn-sm" onClick={() => deleteCategory(c.id!)}>
              &times;
            </button>
          </div>
        ))}
        {categories.length === 0 && <p className="empty">No categories</p>}
        <div className="row" style={{ marginTop: '0.5rem' }}>
          <div className="field">
            <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="New category" />
          </div>
          <button className="btn btn-primary" onClick={addCategory}>Add</button>
        </div>
      </div>

      {/* Rules */}
      <div className="section-title">Category Rules</div>
      <div className="card">
        <table className="data-table">
          <thead>
            <tr><th>Pattern</th><th>Match</th><th>Category</th><th></th></tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td>{r.pattern}</td>
                <td><span className="chip">{r.matchType}</span></td>
                <td>{r.catName}</td>
                <td><button className="btn btn-danger btn-sm" onClick={() => deleteRule(r.id!)}>&times;</button></td>
              </tr>
            ))}
            {rules.length === 0 && <tr><td colSpan={4} className="empty">No rules</td></tr>}
          </tbody>
        </table>

        <div className="row" style={{ marginTop: '0.5rem' }}>
          <div className="field">
            <label>Pattern</label>
            <input value={newPattern} onChange={(e) => setNewPattern(e.target.value)} placeholder="keyword" />
          </div>
          <div className="field">
            <label>Match</label>
            <select value={newMatchType} onChange={(e) => setNewMatchType(e.target.value as 'exact' | 'contains')}>
              <option value="contains">Contains</option>
              <option value="exact">Exact</option>
            </select>
          </div>
          <div className="field">
            <label>Category</label>
            <select value={newRuleCat} onChange={(e) => setNewRuleCat(Number(e.target.value))}>
              <option value="">Select...</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary" onClick={addRule}>Add</button>
        </div>

        <button className="btn btn-ghost" onClick={runRecategorize} style={{ marginTop: '0.5rem' }}>
          Re-categorize uncategorized
        </button>
      </div>

      {/* Data Sync */}
      <div className="section-title">Data Sync</div>
      <div className="card sync-card">
        <div className="field">
          <label>Passphrase</label>
          <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder="Encryption passphrase" />
        </div>
        <div className="sync-actions">
          <button className="btn btn-primary" onClick={handleExport} disabled={busy || !passphrase}>
            Export Full Backup
          </button>
          <form className="import-form" onSubmit={handleImport}>
            <input ref={fileRef} type="file" accept=".budget" id="sync-file" className="file-input" />
            <label htmlFor="sync-file" className="btn btn-ghost file-label">Choose file</label>
            <button type="submit" className="btn btn-ghost" disabled={busy || !passphrase}>Import</button>
          </form>
        </div>
        {syncStatus && <p className={`sync-status ${syncStatus.type}`}>{syncStatus.msg}</p>}
      </div>
    </div>
  );
}
