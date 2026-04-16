import { useState, useEffect, useSyncExternalStore } from 'react';
import { PasswordPrompt } from './PasswordPrompt';
import { open, save } from '@tauri-apps/plugin-dialog';
import {
  getData,
  subscribe,
  getFilePath,
  loadFromFile,
  addCategory,
  deleteCategory,
  addCategoryRule,
  deleteCategoryRule,
  addRecurringTemplate,
  deleteRecurringTemplate,
  updateRecurringTemplate,
  purgeTransactionsByMonth,
  updateCategoryColor,
  getAISettings,
  updateAISettings,
  isCurrentFileEncrypted,
  enableEncryption,
  changeEncryptionPassword,
  disableEncryption,
  type RecurringTemplate,
  type Transaction,
} from '../db';
import { recategorizeAll } from '../logic/categorize';
import { createReadableArchive } from '../utils/export';
import { encryptData } from '../utils/crypto';
import { confirmPaypalMatch, discardPaypalTransactions, type PaypalMatchCandidate } from '../logic/matching';
import { checkOllama, listModels, pullModel, RECOMMENDED_MODELS } from '../logic/llm';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ParserGenerator } from './ParserGenerator';
import { SearchableSelect } from './SearchableSelect';
import { formatAmount } from '../utils/format';

interface Props {
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  search?: string;
}

export function SettingsView({ zoom = 1, onZoomChange, search = '' }: Props) {
  const data = useSyncExternalStore(subscribe, getData);
  const categories = data.categories;
  const catMap = new Map(categories.map((c) => [c.id, c.name]));
  const sq = search.trim().toLowerCase();
  const rules = data.categoryRules
    .map((r) => ({ ...r, catName: catMap.get(r.categoryId) ?? '?' }))
    .filter((r) => !sq || r.pattern.includes(sq) || r.catName.toLowerCase().includes(sq));
  const templates = data.recurringTemplates
    .filter((t) => !sq || t.descriptor.toLowerCase().includes(sq) || (t.categoryId && (catMap.get(t.categoryId) ?? '').toLowerCase().includes(sq)));

  const [pendingEncryptedPath, setPendingEncryptedPath] = useState<string | null>(null);
  const [newCat, setNewCat] = useState('');
  const [newPattern, setNewPattern] = useState('');
  const [newMatchType, setNewMatchType] = useState<'exact' | 'contains'>('exact');
  const [newRuleCat, setNewRuleCat] = useState<number | ''>('');
  const [newRuleAmount, setNewRuleAmount] = useState('');
  const [newRuleAmountRequired, setNewRuleAmountRequired] = useState(false);

  const [tmplDescriptor, setTmplDescriptor] = useState('');
  const [tmplAmount, setTmplAmount] = useState('');
  const [tmplInstrument, setTmplInstrument] = useState('');
  const [tmplCategory, setTmplCategory] = useState<number | ''>('');
  const [tmplDay, setTmplDay] = useState('1');

  const [editTmplId, setEditTmplId] = useState<number | null>(null);
  const [editTmplDescriptor, setEditTmplDescriptor] = useState('');
  const [editTmplAmount, setEditTmplAmount] = useState('');
  const [editTmplInstrument, setEditTmplInstrument] = useState('');
  const [editTmplCategory, setEditTmplCategory] = useState<number | ''>('');
  const [editTmplDay, setEditTmplDay] = useState('1');

  const [purgeYear, setPurgeYear] = useState('');
  const [purgeMonthNum, setPurgeMonthNum] = useState('');
  const [purgeInstrument, setPurgeInstrument] = useState('');
  const [purgeConfirm, setPurgeConfirm] = useState<{ month: string; label: string; count: number; instrument: string } | null>(null);
  const [paypalFuzzy, setPaypalFuzzy] = useState<PaypalMatchCandidate[]>([]);
  const [paypalUnmatched, setPaypalUnmatched] = useState<Transaction[]>([]);

  // --- AI settings state ---
  const [aiStatus, setAiStatus] = useState<'idle' | 'checking' | 'connected' | 'disconnected'>('idle');
  const [aiModels, setAiModels] = useState<string[]>([]);
  const savedAI = getAISettings();
  const [aiUrl, setAiUrl] = useState(savedAI.ollamaUrl);
  const [aiModel, setAiModel] = useState(savedAI.model);
  const [pullStatus, setPullStatus] = useState<string | null>(null);
  const [pullPct, setPullPct] = useState<number | null>(null);
  const [pulling, setPulling] = useState(false);

  useEffect(() => {
    // Auto-check Ollama on mount
    checkAiConnection(savedAI.ollamaUrl, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkAiConnection(url: string, save: boolean) {
    setAiStatus('checking');
    const ok = await checkOllama(url);
    setAiStatus(ok ? 'connected' : 'disconnected');
    if (ok) {
      const models = await listModels(url);
      setAiModels(models);
    }
    if (save) {
      await updateAISettings({ ollamaUrl: url, model: aiModel });
    }
  }


  // --- Ollama install state ---
  const [installing, setInstalling] = useState(false);
  const [installStatus, setInstallStatus] = useState<string | null>(null);
  const [installPct, setInstallPct] = useState<number | null>(null);

  async function handleInstallOllama() {
    setInstalling(true);
    setInstallStatus('Starting download…');
    setInstallPct(0);
    const unlisten = await listen<{ status: string; percent: number }>('ollama_progress', (e) => {
      setInstallStatus(e.payload.status);
      setInstallPct(e.payload.percent);
    });
    try {
      const binaryPath = await invoke<string>('install_ollama');
      setInstallStatus(`Installed at ${binaryPath}. Click Start to launch it.`);
    } catch (e) {
      setInstallStatus(`Error: ${String(e)}`);
    } finally {
      unlisten();
      setInstalling(false);
    }
  }

  async function handleStartOllama() {
    try {
      const binaryPath = await invoke<string | null>('find_ollama');
      if (!binaryPath) { setInstallStatus('Ollama binary not found. Try downloading first.'); return; }
      await invoke('start_ollama', { binaryPath });
      setInstallStatus('Ollama started. Checking connection…');
      await new Promise((r) => setTimeout(r, 2000));
      await checkAiConnection(aiUrl, false);
    } catch (e) {
      setInstallStatus(`Error: ${String(e)}`);
    }
  }

  // --- Encryption state ---
  const encEnabled = isCurrentFileEncrypted();
  const [encAction, setEncAction] = useState<'enable' | 'change' | 'disable' | null>(null);
  const [encPwd1, setEncPwd1] = useState('');
  const [encPwd2, setEncPwd2] = useState('');
  const [encOldPwd, setEncOldPwd] = useState('');
  const [encMsg, setEncMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function handleEnableEncryption() {
    if (encPwd1 !== encPwd2) { setEncMsg({ text: 'Passwords do not match', ok: false }); return; }
    if (encPwd1.length < 6) { setEncMsg({ text: 'Password must be at least 6 characters', ok: false }); return; }
    try {
      await enableEncryption(encPwd1);
      setEncMsg({ text: 'Encryption enabled. File is now encrypted.', ok: true });
      setEncAction(null); setEncPwd1(''); setEncPwd2('');
    } catch (e) { setEncMsg({ text: String(e), ok: false }); }
  }

  async function handleChangePassword() {
    if (encPwd1 !== encPwd2) { setEncMsg({ text: 'New passwords do not match', ok: false }); return; }
    if (encPwd1.length < 6) { setEncMsg({ text: 'Password must be at least 6 characters', ok: false }); return; }
    try {
      await changeEncryptionPassword(encOldPwd, encPwd1);
      setEncMsg({ text: 'Password changed successfully.', ok: true });
      setEncAction(null); setEncPwd1(''); setEncPwd2(''); setEncOldPwd('');
    } catch (e) { setEncMsg({ text: String(e), ok: false }); }
  }

  async function handleDisableEncryption() {
    try {
      await disableEncryption();
      setEncMsg({ text: 'Encryption disabled. File is now stored as plain JSON.', ok: true });
      setEncAction(null);
    } catch (e) { setEncMsg({ text: String(e), ok: false }); }
  }

  async function handlePullModel() {
    setPulling(true);
    setPullStatus('Starting…');
    setPullPct(0);
    const ok = await pullModel(aiUrl, aiModel, (status, pct) => {
      setPullStatus(status);
      if (pct !== undefined) setPullPct(pct);
    });
    setPulling(false);
    if (ok) {
      setPullStatus('Download complete!');
      setPullPct(100);
      await checkAiConnection(aiUrl, false);
      // Auto-save the model as active
      await updateAISettings({ ollamaUrl: aiUrl, model: aiModel });
      setTimeout(() => { setPullStatus(null); setPullPct(null); }, 4000);
    } else {
      setPullStatus('Download failed — make sure Ollama is running first.');
    }
  }

  async function handleAddCategory() {
    if (!newCat.trim()) return;
    await addCategory(newCat.trim());
    setNewCat('');
  }

  async function handleDeleteCategory(id: number) {
    await deleteCategory(id);
  }

  async function handleAddRule() {
    if (!newPattern || !newRuleCat) return;
    const amountVal = newRuleAmountRequired && newRuleAmount.trim() ? parseFloat(newRuleAmount) : null;
    await addCategoryRule({
      matchType: newMatchType,
      pattern: newPattern.toLowerCase(),
      categoryId: newRuleCat as number,
      amountMatch: amountVal,
    });
    setNewPattern('');
    setNewRuleAmount('');
    setNewRuleAmountRequired(false);
  }

  async function handleDeleteRule(id: number) {
    await deleteCategoryRule(id);
  }

  async function runRecategorize() {
    const count = await recategorizeAll();
    alert(`Re-categorized ${count} transactions.`);
  }

  async function handleAddTemplate() {
    if (!tmplDescriptor.trim() || !tmplAmount) return;
    await addRecurringTemplate({
      descriptor: tmplDescriptor.trim(),
      amount: parseFloat(tmplAmount),
      instrument: tmplInstrument.trim(),
      categoryId: tmplCategory ? (tmplCategory as number) : null,
      dayOfMonth: parseInt(tmplDay),
      active: true,
    });
    setTmplDescriptor('');
    setTmplAmount('');
    setTmplInstrument('');
    setTmplCategory('');
    setTmplDay('1');
  }

  async function handleDeleteTemplate(id: number) {
    await deleteRecurringTemplate(id);
  }

  async function handleToggleTemplate(t: RecurringTemplate) {
    await updateRecurringTemplate(t.id, { active: !t.active });
  }

  function startEditTemplate(t: RecurringTemplate) {
    setEditTmplId(t.id);
    setEditTmplDescriptor(t.descriptor);
    setEditTmplAmount(String(t.amount));
    setEditTmplInstrument(t.instrument ?? '');
    setEditTmplCategory(t.categoryId ?? '');
    setEditTmplDay(String(t.dayOfMonth));
  }

  async function saveEditTemplate() {
    if (!editTmplId || !editTmplDescriptor.trim() || !editTmplAmount) return;
    await updateRecurringTemplate(editTmplId, {
      descriptor: editTmplDescriptor.trim(),
      amount: parseFloat(editTmplAmount),
      instrument: editTmplInstrument.trim(),
      categoryId: editTmplCategory ? (editTmplCategory as number) : null,
      dayOfMonth: parseInt(editTmplDay),
    });
    setEditTmplId(null);
  }

  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [jsonExportStatus, setJsonExportStatus] = useState<string | null>(null);
  const [showEncryptArchiveModal, setShowEncryptArchiveModal] = useState(false);
  const [archivePassword, setArchivePassword] = useState('');
  const [archivePasswordConfirm, setArchivePasswordConfirm] = useState('');

  async function handleExport() {
    setExportStatus('Building archive…');
    try {
      const savedPath = await createReadableArchive(data);
      // Show just the filename portion so the message isn't too long
      const fileName = savedPath.split('/').pop() ?? savedPath;
      setExportStatus(`Saved: ${fileName}`);
    } catch (e) {
      setExportStatus(`Error: ${String(e)}`);
    }
    setTimeout(() => setExportStatus(null), 8000);
  }

  async function handleExportUnencryptedJson() {
    setJsonExportStatus('Saving…');
    try {
      const json = JSON.stringify(getData(), null, 2);
      let savePath: string | null = null;
      try {
        savePath = await save({
          defaultPath: 'budget-data.json',
          filters: [{ name: 'JSON File', extensions: ['json'] }],
        });
      } catch (_e) {}
      if (!savePath) {
        const home = await invoke<string>('get_home_dir');
        const date = new Date().toISOString().slice(0, 10);
        savePath = `${home}/budget-data-${date}.json`;
      }
      await invoke('save_data', { path: savePath, data: json });
      setJsonExportStatus(`Saved: ${savePath.split('/').pop()}`);
    } catch (e) {
      setJsonExportStatus(`Error: ${String(e)}`);
    }
    setTimeout(() => setJsonExportStatus(null), 8000);
  }

  async function doEncryptedExport() {
    if (!archivePassword || archivePassword !== archivePasswordConfirm) return;
    setShowEncryptArchiveModal(false);
    setJsonExportStatus('Encrypting…');
    try {
      const json = JSON.stringify(getData(), null, 2);
      const encrypted = await encryptData(json, archivePassword);
      let savePath: string | null = null;
      try {
        savePath = await save({
          defaultPath: 'budget-data-encrypted.json',
          filters: [{ name: 'JSON File', extensions: ['json'] }],
        });
      } catch (_e) {}
      if (!savePath) {
        const home = await invoke<string>('get_home_dir');
        const date = new Date().toISOString().slice(0, 10);
        savePath = `${home}/budget-data-encrypted-${date}.json`;
      }
      await invoke('save_data', { path: savePath, data: encrypted });
      setJsonExportStatus(`Encrypted archive saved: ${savePath.split('/').pop()}`);
    } catch (e) {
      setJsonExportStatus(`Error: ${String(e)}`);
    }
    setArchivePassword('');
    setArchivePasswordConfirm('');
    setTimeout(() => setJsonExportStatus(null), 8000);
  }

  const filePath = getFilePath();

  const sections = [
    { id: 'settings-display', label: 'Display' },
    { id: 'settings-purge', label: 'Purge' },
    { id: 'settings-paypal', label: 'PayPal' },
    { id: 'settings-categories', label: 'Categories' },
    { id: 'settings-rules', label: 'Rules' },
    { id: 'settings-recurring', label: 'Recurring' },
    { id: 'settings-encryption', label: 'Encryption' },
    { id: 'settings-ai', label: 'AI' },
    { id: 'settings-parsers', label: 'Parsers' },
    { id: 'settings-export', label: 'Export' },
  ];

  if (pendingEncryptedPath) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--bg)' }}>
        <PasswordPrompt
          filePath={pendingEncryptedPath}
          onSubmit={async (password) => {
            await loadFromFile(pendingEncryptedPath, password);
            setPendingEncryptedPath(null);
          }}
          onCancel={() => setPendingEncryptedPath(null)}
        />
      </div>
    );
  }

  return (
    <div>
      <h1 className="view-title">Settings</h1>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1rem' }}>
        {sections.map((s) => (
          <button
            key={s.id}
            className="btn btn-ghost btn-sm"
            onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div id="settings-display" className="card" style={{ marginBottom: '1rem' }}>
        <div className="section-title">Display</div>
        <div className="field">
          <label>Zoom</label>
          <select
            value={zoom}
            onChange={(e) => onZoomChange?.(parseFloat(e.target.value))}
            style={{ padding: '0.6rem 0.75rem', maxWidth: 200 }}
          >
            {[0.67, 0.76, 0.86, 1, 1.1, 1.2].map((z) => (
              <option key={z} value={z}>{Math.round(z * 100)}%</option>
            ))}
          </select>
        </div>
      </div>

      {filePath && (
        <div className="card" style={{ marginBottom: '1rem', fontSize: '0.9rem' }}>
          Data file: <code style={{ wordBreak: 'break-all' }}>{filePath}</code>
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginTop: '0.5rem', display: 'block' }}
            onClick={async () => {
              try {
                const selected = await open({
                  filters: [{ name: 'Budget Data', extensions: ['json'] }],
                  multiple: false,
                  directory: false,
                });
                if (!selected) return;
                const path = selected;
                try {
                  await loadFromFile(path);
                } catch (e) {
                  if (String(e).includes('FILE_ENCRYPTED')) {
                    setPendingEncryptedPath(path);
                  } else {
                    alert(String(e));
                  }
                }
              } catch (e) {
                alert(String(e));
              }
            }}
          >
            Open different file
          </button>
        </div>
      )}

      <div id="settings-purge" className="card" style={{ marginBottom: '1rem', borderColor: '#ef4444', borderWidth: 2 }}>
        <div className="section-title">Purge transactions by month</div>
        <p style={{ fontSize: '0.85rem', opacity: 0.9, marginBottom: '0.75rem' }}>
          Permanently delete transactions for a specific month, optionally filtered by type. Category rules are kept. This cannot be undone.
        </p>
        <div className="row" style={{ alignItems: 'flex-end', gap: '0.5rem', flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '0 1 auto', minWidth: 100 }}>
            <label>Month</label>
            <select
              value={purgeMonthNum}
              onChange={(e) => setPurgeMonthNum(e.target.value)}
              style={{ padding: '0.5rem 0.75rem' }}
            >
              <option value="">Select...</option>
              {['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'].map((m, i) => (
                <option key={m} value={m}>
                  {new Date(2000, i, 1).toLocaleDateString('en-US', { month: 'long' })}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: '0 1 auto', minWidth: 90 }}>
            <label>Year</label>
            <select
              value={purgeYear}
              onChange={(e) => setPurgeYear(e.target.value)}
              style={{ padding: '0.5rem 0.75rem' }}
            >
              <option value="">Select...</option>
              {(() => {
                const yrs = new Set(data.transactions.map((t) => t.txnDate.slice(0, 4)));
                const arr = [...yrs].sort((a, b) => Number(b) - Number(a));
                return arr.length ? arr : [new Date().getFullYear().toString()];
              })().map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: '0 1 auto', minWidth: 120 }}>
            <label>Type</label>
            <select
              value={purgeInstrument}
              onChange={(e) => setPurgeInstrument(e.target.value)}
              style={{ padding: '0.5rem 0.75rem' }}
            >
              <option value="">All types</option>
              {[...new Set([
                'Card', 'Chequing', 'Amazon', 'PayPal',
                ...data.transactions.map((t) => t.instrument),
              ])].filter(Boolean).sort().map((instr) => (
                <option key={instr} value={instr}>{instr}</option>
              ))}
            </select>
          </div>
          <button
            className="btn btn-danger"
            disabled={!purgeYear || !purgeMonthNum}
            onClick={() => {
              const purgeMonth = `${purgeYear}-${purgeMonthNum}`;
              const monthLabel = new Date(parseInt(purgeYear), parseInt(purgeMonthNum) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
              const inMonth = data.transactions.filter((t) => t.txnDate.slice(0, 7) === purgeMonth);
              const count = purgeInstrument === 'PayPal'
                ? inMonth.filter((t) => t.linkedTransactionId === -1 || t.instrument === 'PayPal').length
                : inMonth.filter((t) => !purgeInstrument || t.instrument === purgeInstrument).length;
              setPurgeConfirm({ month: purgeMonth, label: monthLabel, count, instrument: purgeInstrument });
            }}
          >
            Purge transactions
          </button>
        </div>
      </div>

      {purgeConfirm && (
        <div className="modal-overlay" onClick={() => setPurgeConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Confirm Purge</h3>
            {purgeConfirm.instrument === 'PayPal' ? (
              <>
                <p>
                  This will affect <strong>{purgeConfirm.count}</strong> PayPal transaction(s) from <strong>{purgeConfirm.label}</strong>:
                </p>
                <ul style={{ fontSize: '0.85rem', margin: '0.5rem 0' }}>
                  <li>PayPal-linked bank transactions will be <strong>reverted</strong> to their original state (descriptor restored, link removed).</li>
                  <li>Standalone PayPal transactions will be <strong>deleted</strong>.</li>
                </ul>
              </>
            ) : (
              <p>
                Are you sure you want to permanently delete <strong>{purgeConfirm.count}</strong>
                {purgeConfirm.instrument ? <> <strong>{purgeConfirm.instrument}</strong></> : ''} transaction(s) from <strong>{purgeConfirm.label}</strong>?
              </p>
            )}
            <p style={{ fontSize: '0.85rem', opacity: 0.8 }}>
              Category rules will NOT be affected.
            </p>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setPurgeConfirm(null)}>Cancel</button>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  const { month, label, instrument } = purgeConfirm;
                  setPurgeConfirm(null);
                  const deleted = await purgeTransactionsByMonth(month, instrument || undefined);
                  setPurgeYear('');
                  setPurgeMonthNum('');
                  setPurgeInstrument('');
                  const verb = instrument === 'PayPal' ? 'Reverted/deleted' : 'Deleted';
                  alert(`${verb} ${deleted} transaction(s) from ${label}${instrument ? ` (${instrument})` : ''}.`);
                }}
              >
                Purge {purgeConfirm.count} transaction(s)
              </button>
            </div>
          </div>
        </div>
      )}


      {paypalFuzzy.length > 0 && (
        <div className="modal-overlay" onClick={() => setPaypalFuzzy([])}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Confirm PayPal Matches</h3>
            <p style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
              These PayPal transactions have close but not exact amounts. Confirm each match or skip.
            </p>
            {paypalFuzzy.map((m) => {
              const diff = Math.abs(m.paypalTxn.amount - m.cardTxn.amount);
              return (
                <div key={m.paypalTxn.id} style={{ marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>
                  <div className="card" style={{ marginBottom: '0.5rem', borderLeft: '3px solid #8b5cf6' }}>
                    <div style={{ fontWeight: 600 }}>{m.paypalTxn.descriptor}</div>
                    <div style={{ fontSize: '0.85rem' }}>
                      ${formatAmount(m.paypalTxn.amount)} on {m.paypalTxn.txnDate}
                    </div>
                  </div>
                  <div className="card" style={{ marginBottom: '0.5rem', borderLeft: '3px solid #3b82f6' }}>
                    <div style={{ fontWeight: 600 }}>{m.cardTxn.descriptor}</div>
                    <div style={{ fontSize: '0.85rem' }}>
                      ${formatAmount(m.cardTxn.amount)} on {m.cardTxn.txnDate}
                    </div>
                  </div>
                  <div style={{ fontSize: '0.8rem', opacity: 0.7, marginBottom: '0.5rem' }}>
                    Difference: ${formatAmount(diff)} ({(diff / Math.max(m.paypalTxn.amount, 0.01) * 100).toFixed(1)}%)
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={async () => {
                      await confirmPaypalMatch(m.paypalTxn.id!, m.cardTxn.id);
                      setPaypalFuzzy((prev) => prev.filter((x) => x.paypalTxn.id !== m.paypalTxn.id));
                    }}>Link these</button>
                    <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() =>
                      setPaypalFuzzy((prev) => prev.filter((x) => x.paypalTxn.id !== m.paypalTxn.id))
                    }>Skip</button>
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
            <p style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
              These PayPal transactions could not be matched to any existing bank debit.
              You can keep them as standalone transactions or discard them.
            </p>
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              {paypalUnmatched.map((t) => (
                <div key={t.id} style={{ marginBottom: '0.75rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>
                  <div className="card" style={{ marginBottom: '0.5rem', borderLeft: '3px solid #f59e0b' }}>
                    <div style={{ fontWeight: 600 }}>{t.descriptor}</div>
                    <div style={{ fontSize: '0.85rem' }}>
                      ${formatAmount(t.amount)} on {t.txnDate}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={async () => {
                      await discardPaypalTransactions([t.id]);
                      setPaypalUnmatched((prev) => prev.filter((x) => x.id !== t.id));
                    }}>Discard</button>
                    <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() =>
                      setPaypalUnmatched((prev) => prev.filter((x) => x.id !== t.id))
                    }>Keep</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="modal-actions" style={{ marginTop: '0.75rem' }}>
              <button className="btn btn-danger" onClick={async () => {
                await discardPaypalTransactions(paypalUnmatched.map((t) => t.id));
                setPaypalUnmatched([]);
              }}>Discard all {paypalUnmatched.length}</button>
              <button className="btn btn-primary" onClick={() => setPaypalUnmatched([])}>
                Keep all {paypalUnmatched.length}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Categories */}
      <div id="settings-categories" className="section-title">Categories</div>
      <div className="card">
        {categories.map((c) => (
          <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.3rem 0', borderBottom: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                type="color"
                value={c.color ?? '#888888'}
                onChange={(e) => updateCategoryColor(c.id, e.target.value)}
                title="Category color"
                style={{ width: 28, height: 28, border: 'none', borderRadius: 6, cursor: 'pointer', padding: 0, background: 'none' }}
              />
              <span style={{ fontWeight: 500 }}>{c.name}</span>
            </div>
            <button className="btn btn-danger btn-sm" onClick={() => handleDeleteCategory(c.id)}>
              &times;
            </button>
          </div>
        ))}
        {categories.length === 0 && <p className="empty">No categories</p>}
        <div className="row" style={{ marginTop: '0.5rem' }}>
          <div className="field">
            <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="New category" />
          </div>
          <button className="btn btn-primary" onClick={handleAddCategory}>Add</button>
        </div>
      </div>

      {/* Rules */}
      <div id="settings-rules" className="section-title">Category Rules</div>
      <div className="card">
        <table className="data-table">
          <thead>
            <tr><th>Pattern</th><th>Match</th><th>Amount</th><th>Category</th><th></th></tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td>{r.pattern}</td>
                <td><span className="chip">{r.matchType}</span></td>
                <td>{r.amountMatch != null ? `$${formatAmount(r.amountMatch)}` : '—'}</td>
                <td>{r.catName}</td>
                <td><button className="btn btn-danger btn-sm" onClick={() => handleDeleteRule(r.id)}>&times;</button></td>
              </tr>
            ))}
            {rules.length === 0 && <tr><td colSpan={5} className="empty">No rules</td></tr>}
          </tbody>
        </table>

        <div className="row" style={{ marginTop: '0.5rem' }}>
          <div className="field">
            <label>Pattern</label>
            <input value={newPattern} onChange={(e) => setNewPattern(e.target.value)} placeholder="keyword" />
          </div>
          <div className="field">
            <label>Match</label>
            <SearchableSelect
              options={[
                { value: 'contains', label: 'Contains' },
                { value: 'exact', label: 'Exact' },
              ]}
              value={newMatchType}
              onChange={(v) => setNewMatchType(v as 'exact' | 'contains')}
              placeholder="Match"
            />
          </div>
          <div className="field">
            <label>Category</label>
            <SearchableSelect
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
              value={newRuleCat}
              onChange={(v) => setNewRuleCat(v === '' ? '' : Number(v))}
              placeholder="Select..."
            />
          </div>
          <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
            <input type="checkbox" id="rule-amount-cb" checked={!!newRuleAmountRequired} onChange={(e) => { setNewRuleAmountRequired(e.target.checked); if (!e.target.checked) setNewRuleAmount(''); }} />
            <label htmlFor="rule-amount-cb" style={{ marginBottom: 0 }}>Require amount</label>
            {newRuleAmountRequired && (
              <input type="number" step="0.01" value={newRuleAmount} onChange={(e) => setNewRuleAmount(e.target.value)} placeholder="0" style={{ width: '100px' }} />
            )}
          </div>
          <button className="btn btn-primary" onClick={handleAddRule}>Add</button>
        </div>

        <button className="btn btn-ghost" onClick={runRecategorize} style={{ marginTop: '0.5rem' }}>
          Re-categorize uncategorized
        </button>
      </div>

      {/* Recurring Templates */}
      <div id="settings-recurring" className="section-title">Recurring Templates</div>
      <p style={{ fontSize: '0.85rem', opacity: 0.8, marginBottom: '0.5rem' }}>
        Templates for expected recurring transactions (e.g. Netflix, mortgage). Each month, if no matching transaction exists, one is auto-created. <strong>Category rules</strong> instead assign categories to imported transactions by matching descriptors.
      </p>
      <div className="card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Descriptor</th>
              <th className="num">Amount</th>
              <th>Instrument</th>
              <th>Category</th>
              <th>Day</th>
              <th>Active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => {
              const cat = categories.find((c) => c.id === t.categoryId);
              if (editTmplId === t.id) {
                return (
                  <tr key={t.id} style={{ background: 'var(--accent-muted)' }}>
                    <td><input value={editTmplDescriptor} onChange={(e) => setEditTmplDescriptor(e.target.value)} style={{ width: '100%', fontSize: '0.85rem' }} /></td>
                    <td><input type="number" value={editTmplAmount} onChange={(e) => setEditTmplAmount(e.target.value)} style={{ width: 72, fontSize: '0.85rem' }} /></td>
                    <td><input value={editTmplInstrument} onChange={(e) => setEditTmplInstrument(e.target.value)} style={{ width: 80, fontSize: '0.85rem' }} /></td>
                    <td>
                      <SearchableSelect
                        options={categories.map((c) => ({ value: c.id, label: c.name }))}
                        value={editTmplCategory}
                        onChange={(v) => setEditTmplCategory(v === '' ? '' : Number(v))}
                        placeholder="None"
                      />
                    </td>
                    <td><input type="number" min="1" max="31" value={editTmplDay} onChange={(e) => setEditTmplDay(e.target.value)} style={{ width: 48, fontSize: '0.85rem' }} /></td>
                    <td colSpan={2} style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-primary btn-sm" onClick={saveEditTemplate}>Save</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditTmplId(null)} style={{ marginLeft: 4 }}>Cancel</button>
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={t.id}>
                  <td>{t.descriptor}</td>
                  <td className="num">${formatAmount(t.amount)}</td>
                  <td>{t.instrument}</td>
                  <td>{cat?.name ?? '—'}</td>
                  <td>{t.dayOfMonth}</td>
                  <td>
                    <button
                      className={`btn btn-sm ${t.active ? 'btn-success' : 'btn-ghost'}`}
                      onClick={() => handleToggleTemplate(t)}
                    >
                      {t.active ? 'Active' : 'Paused'}
                    </button>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => startEditTemplate(t)} title="Edit">✎</button>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDeleteTemplate(t.id)} style={{ marginLeft: 2 }}>&times;</button>
                  </td>
                </tr>
              );
            })}
            {templates.length === 0 && <tr><td colSpan={7} className="empty">No recurring templates</td></tr>}
          </tbody>
        </table>

        <div className="row" style={{ marginTop: '0.5rem' }}>
          <div className="field">
            <label>Descriptor</label>
            <input value={tmplDescriptor} onChange={(e) => setTmplDescriptor(e.target.value)} placeholder="Netflix, etc." />
          </div>
          <div className="field">
            <label>Amount</label>
            <input type="number" value={tmplAmount} onChange={(e) => setTmplAmount(e.target.value)} placeholder="0" />
          </div>
          <div className="field">
            <label>Instrument</label>
            <input value={tmplInstrument} onChange={(e) => setTmplInstrument(e.target.value)} placeholder="Visa, etc." />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>Category</label>
            <SearchableSelect
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
              value={tmplCategory}
              onChange={(v) => setTmplCategory(v === '' ? '' : Number(v))}
              placeholder="None"
            />
          </div>
          <div className="field">
            <label>Day of month</label>
            <input type="number" min="1" max="31" value={tmplDay} onChange={(e) => setTmplDay(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={handleAddTemplate} style={{ alignSelf: 'flex-end' }}>Add Template</button>
        </div>
      </div>

      {/* ── File Encryption ── */}
      <div id="settings-encryption" className="card" style={{ marginBottom: '1rem' }}>
        <div className="section-title">File Encryption</div>
        <p style={{ fontSize: '0.85rem', opacity: 0.8, marginBottom: '0.75rem' }}>
          Encrypt your data file with a password. The file is decrypted in-memory only — nothing unencrypted is ever written to disk.
          Safe to store on cloud drives or shared folders.
        </p>

        <div className="row" style={{ alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <span>
            <span className={`ai-status-dot ${encEnabled ? 'connected' : 'disconnected'}`} />
            {encEnabled ? 'Encryption enabled' : 'Not encrypted'}
          </span>
          {encEnabled && encAction === null && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => { setEncAction('change'); setEncMsg(null); }}>
                Change password
              </button>
              <button className="btn btn-danger btn-sm" onClick={() => { setEncAction('disable'); setEncMsg(null); }}>
                Disable encryption
              </button>
            </>
          )}
          {!encEnabled && encAction === null && (
            <button className="btn btn-primary btn-sm" onClick={() => { setEncAction('enable'); setEncMsg(null); }}>
              Enable encryption
            </button>
          )}
        </div>

        {encMsg && (
          <div style={{
            padding: '0.5rem 0.75rem', borderRadius: 6, fontSize: '0.85rem', marginBottom: '0.5rem',
            background: encMsg.ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            border: `1px solid ${encMsg.ok ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
            color: encMsg.ok ? '#22c55e' : '#ef4444',
          }}>
            {encMsg.text}
          </div>
        )}

        {encAction === 'enable' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div className="field">
              <label>New password</label>
              <input type="password" value={encPwd1} onChange={(e) => setEncPwd1(e.target.value)} placeholder="At least 6 characters" />
            </div>
            <div className="field">
              <label>Confirm password</label>
              <input type="password" value={encPwd2} onChange={(e) => setEncPwd2(e.target.value)} placeholder="Repeat password" />
            </div>
            <div className="row" style={{ gap: '0.5rem' }}>
              <button className="btn btn-primary btn-sm" onClick={handleEnableEncryption}>Enable</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setEncAction(null); setEncPwd1(''); setEncPwd2(''); }}>Cancel</button>
            </div>
          </div>
        )}

        {encAction === 'change' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div className="field">
              <label>Current password</label>
              <input type="password" value={encOldPwd} onChange={(e) => setEncOldPwd(e.target.value)} />
            </div>
            <div className="field">
              <label>New password</label>
              <input type="password" value={encPwd1} onChange={(e) => setEncPwd1(e.target.value)} />
            </div>
            <div className="field">
              <label>Confirm new password</label>
              <input type="password" value={encPwd2} onChange={(e) => setEncPwd2(e.target.value)} />
            </div>
            <div className="row" style={{ gap: '0.5rem' }}>
              <button className="btn btn-primary btn-sm" onClick={handleChangePassword}>Change</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setEncAction(null); setEncPwd1(''); setEncPwd2(''); setEncOldPwd(''); }}>Cancel</button>
            </div>
          </div>
        )}

        {encAction === 'disable' && (
          <div>
            <p style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              This will save the file as plain unencrypted JSON. Are you sure?
            </p>
            <div className="row" style={{ gap: '0.5rem' }}>
              <button className="btn btn-danger btn-sm" onClick={handleDisableEncryption}>Yes, disable encryption</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEncAction(null)}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* ── AI Assistant Setup ── */}
      <div id="settings-ai" className="card" style={{ marginBottom: '1rem' }}>
        <div className="section-title">AI Assistant</div>
        <p style={{ fontSize: '0.85rem', opacity: 0.75, marginBottom: '1rem' }}>
          Runs a local AI model on your computer — no data leaves your machine.
          Enables transaction lookup, budget Q&amp;A, and smart categorization.
        </p>

        {/* Step 1: Ollama */}
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-3)', marginBottom: '0.5rem' }}>
            Step 1 — AI Engine
          </div>
          <div className="row" style={{ alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <span className={`ai-status-dot ${aiStatus === 'connected' ? 'connected' : aiStatus === 'disconnected' ? 'disconnected' : 'checking'}`} />
            <span style={{ fontSize: '0.875rem' }}>
              {aiStatus === 'idle' && 'Not checked yet'}
              {aiStatus === 'checking' && 'Checking…'}
              {aiStatus === 'connected' && 'Ollama is running'}
              {aiStatus === 'disconnected' && 'Ollama is not running'}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => checkAiConnection(aiUrl, false)}>Recheck</button>
          </div>

          {aiStatus === 'disconnected' && (
            <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.75rem', fontSize: '0.85rem' }}>
              <div style={{ marginBottom: '0.6rem', opacity: 0.85 }}>
                Ollama is the engine that runs AI models locally.
                {installing ? ' Downloading…' : ' Click below to install it automatically, or start it if already installed.'}
              </div>
              <div className="row" style={{ gap: '0.5rem' }}>
                <button className="btn btn-primary btn-sm" onClick={handleInstallOllama} disabled={installing}>
                  {installing ? 'Downloading…' : 'Download & Install Ollama'}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={handleStartOllama} disabled={installing}>
                  Start Ollama
                </button>
              </div>
              {(installStatus || installing) && (
                <div style={{ marginTop: '0.6rem' }}>
                  <div style={{ fontSize: '0.8rem', opacity: 0.9, marginBottom: '0.3rem' }}>{installStatus || 'Connecting…'}</div>
                  <div style={{ background: 'var(--border)', borderRadius: 4, height: 6 }}>
                    <div style={{ background: 'var(--accent)', borderRadius: 4, height: '100%', width: `${installPct ?? 0}%`, transition: 'width 0.3s' }} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* URL (advanced, collapsed by default) */}
          <details style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
            <summary style={{ cursor: 'pointer', opacity: 0.6 }}>Custom Ollama URL</summary>
            <div className="field" style={{ marginTop: '0.4rem' }}>
              <input value={aiUrl} onChange={(e) => setAiUrl(e.target.value)} placeholder="http://localhost:11434" />
            </div>
          </details>
        </div>

        {/* Step 2: Model */}
        <div style={{ marginBottom: '0.75rem' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-3)', marginBottom: '0.5rem' }}>
            Step 2 — AI Model
          </div>

          {(() => {
            // Fuzzy match: model is "installed" if any installed model name starts with the selected name prefix
            const modelInstalled = aiModels.some((m) => m === aiModel || m.startsWith(aiModel.split(':')[0]));
            return (
              <>
                <div className="field" style={{ marginBottom: '0.5rem' }}>
                  <label>Select model</label>
                  <select
                    value={aiModel}
                    onChange={async (e) => {
                      setAiModel(e.target.value);
                      await updateAISettings({ ollamaUrl: aiUrl, model: e.target.value });
                    }}
                    style={{ padding: '0.5rem 0.75rem', width: '100%' }}
                  >
                    {aiModels.length > 0 && (
                      <optgroup label="✓ Installed on this machine">
                        {aiModels.map((m) => <option key={m} value={m}>{m}</option>)}
                      </optgroup>
                    )}
                    <optgroup label="Recommended — not yet downloaded">
                      {RECOMMENDED_MODELS.filter((m) => !aiModels.some((im) => im.startsWith(m.name.split(':')[0]))).map((m) => (
                        <option key={m.name} value={m.name}>{m.label}</option>
                      ))}
                    </optgroup>
                  </select>
                </div>

                {!modelInstalled && !pulling && !pullStatus && (
                  <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.75rem', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                    <div style={{ marginBottom: '0.5rem', opacity: 0.85 }}>
                      <strong>{aiModel}</strong> is not downloaded yet. Click below to download it (~4–8 GB).
                    </div>
                    <button className="btn btn-primary btn-sm" onClick={handlePullModel} disabled={aiStatus !== 'connected'}>
                      Download {aiModel}
                    </button>
                    {aiStatus !== 'connected' && (
                      <span style={{ fontSize: '0.78rem', opacity: 0.6, marginLeft: '0.5rem' }}>Start Ollama first (Step 1)</span>
                    )}
                  </div>
                )}

                {(pulling || pullStatus) && (
                  <div style={{ marginBottom: '0.5rem' }}>
                    <div style={{ fontSize: '0.82rem', marginBottom: '0.3rem', opacity: 0.9 }}>{pullStatus || 'Connecting…'}</div>
                    <div style={{ background: 'var(--border)', borderRadius: 4, height: 6 }}>
                      <div style={{
                        background: pulling && (pullPct ?? 0) === 0 ? 'var(--accent)' : '#3b82f6',
                        borderRadius: 4,
                        height: '100%',
                        width: pulling && (pullPct ?? 0) === 0 ? '100%' : `${pullPct ?? 0}%`,
                        transition: pulling && (pullPct ?? 0) === 0 ? 'none' : 'width 0.3s',
                        opacity: pulling && (pullPct ?? 0) === 0 ? 0.4 : 1,
                        animation: pulling && (pullPct ?? 0) === 0 ? 'pulse 1.5s ease-in-out infinite' : 'none',
                      }} />
                    </div>
                  </div>
                )}

                {modelInstalled && aiStatus === 'connected' && (
                  <div style={{ fontSize: '0.82rem', color: 'var(--green)', marginBottom: '0.25rem' }}>
                    ✓ Ready — use the <strong>AI</strong> button (top right) to chat, or <strong>?</strong> on any transaction.
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </div>

      {/* ── Custom Import Parsers ── */}
      <div id="settings-parsers" className="card" style={{ marginBottom: '1rem' }}>
        <div className="section-title">Custom Import Parsers</div>
        <p style={{ fontSize: '0.85rem', opacity: 0.8, marginBottom: '0.75rem' }}>
          Upload a sample export file from your bank and the AI will generate a custom parser for it.
          Requires the AI assistant to be connected.
        </p>
        <ParserGenerator />
      </div>

      {/* ── Export ── */}
      <div id="settings-export" className="card" style={{ marginBottom: '1rem' }}>
        <div className="section-title">Export</div>

        <div style={{ marginBottom: '1.25rem' }}>
          <p style={{ fontSize: '0.85rem', opacity: 0.8, marginBottom: '0.75rem' }}>
            Creates an Excel file with two tabs per month (budget + transactions), a year summary tab, and a savings tab.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button className="btn btn-primary" onClick={handleExport} disabled={!!exportStatus}>
              {exportStatus ?? 'Create Readable Archive'}
            </button>
            {exportStatus && <span style={{ fontSize: '0.85rem', opacity: 0.7 }}>{exportStatus}</span>}
          </div>
        </div>

        <div style={{ marginBottom: '1.25rem' }}>
          <p style={{ fontSize: '0.85rem', opacity: 0.8, marginBottom: '0.75rem' }}>
            Save a copy of your data as a JSON file. Use the unencrypted version for backups you can read directly, or create an encrypted copy with a separate password.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" onClick={handleExportUnencryptedJson} disabled={!!jsonExportStatus}>
              Create Unencrypted JSON Archive
            </button>
            <button className="btn btn-ghost" onClick={() => { setShowEncryptArchiveModal(true); setArchivePassword(''); setArchivePasswordConfirm(''); }} disabled={!!jsonExportStatus}>
              Create Encrypted JSON Archive
            </button>
            {jsonExportStatus && <span style={{ fontSize: '0.85rem', opacity: 0.7 }}>{jsonExportStatus}</span>}
          </div>
        </div>

      </div>

      {showEncryptArchiveModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 360 }}>
            <h3 style={{ marginTop: 0 }}>Encrypt Archive</h3>
            <p style={{ fontSize: '0.85rem', opacity: 0.8 }}>Set a password for this archive. This does not affect your current file.</p>
            <div className="field" style={{ marginBottom: '0.75rem' }}>
              <label>Password</label>
              <input type="password" value={archivePassword} onChange={(e) => setArchivePassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && doEncryptedExport()} autoFocus />
            </div>
            <div className="field" style={{ marginBottom: '1rem' }}>
              <label>Confirm password</label>
              <input type="password" value={archivePasswordConfirm} onChange={(e) => setArchivePasswordConfirm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && doEncryptedExport()} />
            </div>
            {archivePassword && archivePasswordConfirm && archivePassword !== archivePasswordConfirm && (
              <p style={{ color: 'var(--red)', fontSize: '0.82rem', marginBottom: '0.5rem' }}>Passwords do not match.</p>
            )}
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={doEncryptedExport}
                disabled={!archivePassword || archivePassword !== archivePasswordConfirm}>
                Save Encrypted Archive
              </button>
              <button className="btn btn-ghost" onClick={() => setShowEncryptArchiveModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


