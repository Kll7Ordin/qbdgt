import { useState, useRef, type FormEvent } from 'react';
import { db, type Transaction } from '../db';
import { encrypt, decrypt } from '../crypto';

export function DataSync() {
  const [passphrase, setPassphrase] = useState('');
  const [status, setStatus] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function clearStatus() {
    setTimeout(() => setStatus(null), 4000);
  }

  async function handleExport(e: FormEvent) {
    e.preventDefault();
    if (!passphrase) return;
    setBusy(true);
    try {
      const transactions = await db.transactions.toArray();
      const json = JSON.stringify(transactions);
      const encrypted = await encrypt(json, passphrase);

      const blob = new Blob([encrypted], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `budget-${new Date().toISOString().split('T')[0]}.budget`;
      a.click();
      URL.revokeObjectURL(url);

      setStatus({ type: 'ok', msg: `Exported ${transactions.length} transactions` });
    } catch {
      setStatus({ type: 'err', msg: 'Export failed' });
    } finally {
      setBusy(false);
      clearStatus();
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
      const transactions: Transaction[] = JSON.parse(json);

      if (!Array.isArray(transactions)) throw new Error('Invalid data');

      await db.transactions.clear();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const clean = transactions.map(({ id, ...rest }) => rest);
      await db.transactions.bulkAdd(clean);

      setStatus({ type: 'ok', msg: `Imported ${clean.length} transactions` });
      if (fileRef.current) fileRef.current.value = '';
      window.location.reload();
    } catch {
      setStatus({ type: 'err', msg: 'Import failed — wrong passphrase or bad file' });
    } finally {
      setBusy(false);
      clearStatus();
    }
  }

  return (
    <section className="data-sync">
      <h2>Sync</h2>
      <div className="sync-card">
        <div className="form-field">
          <label htmlFor="passphrase">Passphrase</label>
          <input
            id="passphrase"
            type="password"
            placeholder="Enter encryption passphrase"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
        </div>

        <div className="sync-actions">
          <button
            className="sync-btn export"
            onClick={handleExport}
            disabled={busy || !passphrase}
          >
            Export
          </button>

          <form className="import-form" onSubmit={handleImport}>
            <input
              ref={fileRef}
              type="file"
              accept=".budget"
              id="import-file"
              className="file-input"
            />
            <label htmlFor="import-file" className="sync-btn import file-label">
              Choose file
            </label>
            <button
              type="submit"
              className="sync-btn import"
              disabled={busy || !passphrase}
            >
              Import
            </button>
          </form>
        </div>

        {status && (
          <p className={`sync-status ${status.type}`}>{status.msg}</p>
        )}
      </div>
    </section>
  );
}
