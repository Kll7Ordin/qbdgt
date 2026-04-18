import { useState, useEffect, useRef, useCallback, useSyncExternalStore } from 'react';
import { FileSetup } from './components/FileSetup';
import { BudgetView } from './components/BudgetView';
import { TransactionView } from './components/TransactionView';
import { YearView } from './components/YearView';
import { SavingsView } from './components/SavingsView';
import { ImportView } from './components/ImportView';
import { SettingsView } from './components/SettingsView';
import { AIPanel } from './components/AIPanel';
import { ExperimentalBudgetsView } from './components/ExperimentalBudgetsView';
import { processRecurringTemplates } from './logic/recurring';
import { processSchedules } from './logic/savings';
import { startupCleanup, getAISettings, getData, undo, canUndo, subscribeUndo, type AppData } from './db';
import { checkOllama } from './logic/llm';
import { invoke } from '@tauri-apps/api/core';
import './App.css';

type Tab = 'budget' | 'transactions' | 'year' | 'savings' | 'import' | 'experimental' | 'settings';

export interface NavFilter {
  month?: string;
  categoryId?: number;
  scope?: 'overall' | 'categories';
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'budget', label: 'Budget' },
  { key: 'transactions', label: 'Txns' },
  { key: 'year', label: 'Year' },
  { key: 'savings', label: 'Savings' },
  { key: 'import', label: 'Import' },
  { key: 'experimental', label: 'Exp. Budgets' },
];

const ZOOM_KEY = 'budget-app-zoom';
const DARK_KEY = 'budget-app-dark';
const BACKUP_ENABLED_KEY = 'budget-app-backup-enabled';
const BACKUP_COUNT_KEY = 'budget-app-backup-count';
const BACKUP_DIR_KEY = 'budget-app-backup-dir';

async function runStartupBackup(getDataFn: () => AppData) {
  try {
    const enabled = localStorage.getItem(BACKUP_ENABLED_KEY) === 'true';
    if (!enabled) return;
    const dir = localStorage.getItem(BACKUP_DIR_KEY);
    if (!dir) return;
    const maxCount = parseInt(localStorage.getItem(BACKUP_COUNT_KEY) ?? '3', 10);

    // Get unencrypted JSON of current data
    const data = getDataFn();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const json = JSON.stringify({ ...data, _backupCreatedAt: new Date().toISOString() }, null, 2);

    // List existing backup files
    type FileInfo = { path: string; modified_secs: number };
    const existing: FileInfo[] = await invoke('list_dir_files', { dir, ext: '.json' });
    const backupFiles = existing
      .filter((f) => f.path.split('/').pop()?.startsWith('qbdgt-backup-') || f.path.split('\\').pop()?.startsWith('qbdgt-backup-'))
      .sort((a, b) => a.modified_secs - b.modified_secs);

    let savePath: string;
    const sep = dir.includes('\\') ? '\\' : '/';
    if (backupFiles.length >= maxCount && backupFiles.length > 0) {
      // Overwrite oldest
      savePath = backupFiles[0].path;
    } else {
      savePath = `${dir}${sep}qbdgt-backup-${timestamp}.json`;
    }

    await invoke('save_data', { path: savePath, data: json });
  } catch {
    // Backup failure is non-fatal
  }
}

function applyDarkMode(dark: boolean) {
  if (dark) {
    document.documentElement.classList.add('dark');
    document.documentElement.classList.remove('light');
  } else {
    document.documentElement.classList.remove('dark');
    document.documentElement.classList.add('light');
  }
}

function App() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('budget');
  const [tabHistory, setTabHistory] = useState<Tab[]>([]);
  const [zoom, setZoom] = useState(() => {
    const stored = localStorage.getItem(ZOOM_KEY);
    const val = stored ? parseFloat(stored) : 1;
    return Number.isFinite(val) && val >= 0.5 && val <= 1.5 ? val : 1;
  });
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem(DARK_KEY) === 'true';
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [aiOpen, setAiOpen] = useState(false);
  const [ollamaPrompt, setOllamaPrompt] = useState<{ model: string; binaryPath: string } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const undoAvailable = useSyncExternalStore(subscribeUndo, canUndo, canUndo);

  // Nav filters for cross-tab navigation
  const [transactionNavFilter, setTransactionNavFilter] = useState<NavFilter | null>(null);
  const [yearNavFilter, setYearNavFilter] = useState<NavFilter | null>(null);

  useEffect(() => {
    localStorage.setItem(ZOOM_KEY, String(zoom));
  }, [zoom]);

  useEffect(() => {
    localStorage.setItem(DARK_KEY, String(darkMode));
    applyDarkMode(darkMode);
  }, [darkMode]);

  // Apply dark mode on initial load
  useEffect(() => {
    applyDarkMode(darkMode);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ready) {
      startupCleanup();
      processRecurringTemplates();
      processSchedules();
      runStartupBackup(getData);
      const ai = getAISettings();
      if (ai.model) {
        checkOllama(ai.ollamaUrl).then((running) => {
          if (!running) {
            invoke<string | null>('find_ollama').then((binaryPath) => {
              if (binaryPath) {
                setOllamaPrompt({ model: ai.model, binaryPath });
              }
            });
          }
        });
      }
    }
  }, [ready]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      e.stopPropagation();
      setSearchOpen(true);
      setTimeout(() => searchRef.current?.focus(), 0);
    }
    if (e.key === 'Escape' && searchOpen) {
      setSearchOpen(false);
      setSearchTerm('');
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault();
      undo();
    }
  }, [searchOpen]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [handleKeyDown]);

  function navigateTo(newTab: Tab, filter?: NavFilter) {
    setTabHistory((h) => [...h, tab]);
    setTab(newTab);
    if (newTab === 'transactions' && filter) setTransactionNavFilter(filter);
    if (newTab === 'year' && filter) setYearNavFilter(filter);
  }

  const [customBackHandler, setCustomBackHandler] = useState<(() => void) | null>(null);

  function navigateBack() {
    if (customBackHandler) {
      customBackHandler();
      setCustomBackHandler(null);
      return;
    }
    const prev = tabHistory[tabHistory.length - 1];
    if (prev == null) return;
    setTabHistory((h) => h.slice(0, -1));
    setTab(prev);
  }

  function changeTab(newTab: Tab) {
    if (newTab === tab) return;
    setTabHistory((h) => [...h, tab]);
    setTab(newTab);
    setCustomBackHandler(null);
  }

  if (!ready) {
    return <FileSetup onReady={() => setReady(true)} />;
  }

  const canGoBack = tabHistory.length > 0 || customBackHandler != null;

  return (
    <div className="app" style={{ zoom }}>
      {ollamaPrompt && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 380 }}>
            <h3 style={{ marginTop: 0 }}>Start Ollama?</h3>
            <p>Model <strong>{ollamaPrompt.model}</strong> is configured but Ollama is not running.</p>
            <div className="modal-actions">
              <button
                className="btn btn-primary"
                onClick={() => {
                  invoke('start_ollama', { binaryPath: ollamaPrompt.binaryPath });
                  setOllamaPrompt(null);
                }}
              >
                Start Ollama
              </button>
              <button className="btn btn-ghost" onClick={() => setOllamaPrompt(null)}>
                Not now
              </button>
            </div>
          </div>
        </div>
      )}
      <nav className="tab-bar">
        {/* Left: Back */}
        <div className="tab-bar-left">
          <button
            className="ai-toggle-btn"
            onClick={navigateBack}
            title="Go back"
            disabled={!canGoBack}
            style={{ opacity: canGoBack ? 1 : 0.35 }}
          >
            ← Back
          </button>
        </div>

        {/* Center: Tabs */}
        <div className="tab-bar-center">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`tab-btn ${tab === t.key ? 'active' : ''}`}
              onClick={() => changeTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Right: Undo + Settings + AI + version */}
        <div className="tab-bar-right">
          <button
            className="ai-toggle-btn"
            onClick={() => undo()}
            disabled={!undoAvailable}
            title="Undo last action (Ctrl+Z)"
            style={{ opacity: undoAvailable ? 1 : 0.35 }}
          >
            ↩ Undo
          </button>
          <button
            className={`ai-toggle-btn ${tab === 'settings' ? 'active' : ''}`}
            onClick={() => changeTab(tab === 'settings' ? 'budget' : 'settings')}
            title="Settings"
            style={{ fontSize: '1.2rem', padding: '0.35rem 0.6rem' }}
          >
            ⚙
          </button>
          <button
            className={`ai-toggle-btn ${aiOpen ? 'active' : ''}`}
            onClick={() => setAiOpen((o) => !o)}
            title={aiOpen ? 'Close AI assistant' : 'Open AI assistant'}
          >
            <span style={{ fontSize: '1.4rem', lineHeight: 1 }}>🦙</span>
          </button>
          <span className="app-version">v1.3</span>
        </div>
      </nav>
      {searchOpen && (
        <div className="search-bar">
          <input
            ref={searchRef}
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search in tab..."
            autoFocus
          />
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { setSearchOpen(false); setSearchTerm(''); }}
          >
            &times;
          </button>
        </div>
      )}
      <main className="main-content">
        {tab === 'budget' && (
          <BudgetView
            search={searchTerm}
            onNavigateToTransactions={(month, categoryId) => navigateTo('transactions', { month, categoryId })}
            onNavigateToYear={(categoryId) => navigateTo('year', { categoryId, scope: 'categories' })}
          />
        )}
        {tab === 'transactions' && (
          <TransactionView
            search={searchTerm}
            navFilter={transactionNavFilter}
            onNavConsumed={() => setTransactionNavFilter(null)}
          />
        )}
        {tab === 'year' && (
          <YearView
            navFilter={yearNavFilter}
            onNavConsumed={() => setYearNavFilter(null)}
            darkMode={darkMode}
          />
        )}
        {tab === 'savings' && <SavingsView />}
        {tab === 'import' && <ImportView />}
        {tab === 'experimental' && <ExperimentalBudgetsView />}
        {tab === 'settings' && (
          <SettingsView
            zoom={zoom}
            onZoomChange={setZoom}
            search={searchTerm}
            darkMode={darkMode}
            onDarkModeChange={setDarkMode}
            onRegisterBack={(handler) => setCustomBackHandler(handler ? () => handler : null)}
          />
        )}
      </main>
      {aiOpen && <AIPanel onClose={() => setAiOpen(false)} />}
    </div>
  );
}

export default App;
