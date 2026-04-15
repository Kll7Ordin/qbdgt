import { useState, useEffect, useRef, useCallback, useSyncExternalStore } from 'react';
import { FileSetup } from './components/FileSetup';
import { BudgetView } from './components/BudgetView';
import { TransactionView } from './components/TransactionView';
import { YearView } from './components/YearView';
import { SavingsView } from './components/SavingsView';
import { ImportView } from './components/ImportView';
import { SettingsView } from './components/SettingsView';
import { AIPanel } from './components/AIPanel';
import { processRecurringTemplates } from './logic/recurring';
import { processSchedules } from './logic/savings';
import { startupCleanup, getAISettings, undo, canUndo, subscribeUndo } from './db';
import { checkOllama } from './logic/llm';
import { invoke } from '@tauri-apps/api/core';
import './App.css';

type Tab = 'budget' | 'transactions' | 'year' | 'savings' | 'import' | 'settings';

const TABS: { key: Tab; label: string }[] = [
  { key: 'budget', label: 'Budget' },
  { key: 'transactions', label: 'Txns' },
  { key: 'year', label: 'Year' },
  { key: 'savings', label: 'Savings' },
  { key: 'import', label: 'Import' },
];

const ZOOM_KEY = 'budget-app-zoom';

function App() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('import');
  const [zoom, setZoom] = useState(() => {
    const stored = localStorage.getItem(ZOOM_KEY);
    const val = stored ? parseFloat(stored) : 1;
    // Clamp to new valid range (0.5–1.5); reset if outside (e.g. old stored 1.5 from pre-resize era)
    return Number.isFinite(val) && val >= 0.5 && val <= 1.5 ? val : 1;
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [aiOpen, setAiOpen] = useState(false);
  const [ollamaPrompt, setOllamaPrompt] = useState<{ model: string; binaryPath: string } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const undoAvailable = useSyncExternalStore(subscribeUndo, canUndo, canUndo);

  useEffect(() => {
    localStorage.setItem(ZOOM_KEY, String(zoom));
  }, [zoom]);

  useEffect(() => {
    if (ready) {
      startupCleanup();
      processRecurringTemplates();
      processSchedules();
      // Check if Ollama is configured but not running → prompt to start
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

  if (!ready) {
    return <FileSetup onReady={() => setReady(true)} />;
  }

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
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`tab-btn ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
        <button
          className={`ai-toggle-btn ${aiOpen ? 'active' : ''}`}
          onClick={() => setAiOpen((o) => !o)}
          title={aiOpen ? 'Close AI assistant' : 'Open AI assistant'}
          style={{ marginLeft: 'auto', flexShrink: 0 }}
        >
          <span style={{ fontSize: '1.6rem', lineHeight: 1 }}>🦙</span> AI Assistant
        </button>
        <button
          className="ai-toggle-btn"
          onClick={() => undo()}
          disabled={!undoAvailable}
          title="Undo last action (Ctrl+Z)"
          style={{ flexShrink: 0, opacity: undoAvailable ? 1 : 0.35 }}
        >
          ↩ Undo
        </button>
        <button
          className={`ai-toggle-btn ${tab === 'settings' ? 'active' : ''}`}
          onClick={() => setTab(tab === 'settings' ? 'budget' : 'settings')}
          title="Settings"
          style={{ flexShrink: 0, fontSize: '1.2rem', padding: '0.35rem 0.6rem' }}
        >
          ⚙
        </button>
        <span className="app-version">v1.0</span>
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
        {tab === 'budget' && <BudgetView search={searchTerm} />}
        {tab === 'transactions' && <TransactionView search={searchTerm} />}
        {tab === 'year' && <YearView />}
        {tab === 'savings' && <SavingsView />}
        {tab === 'import' && <ImportView />}
        {tab === 'settings' && <SettingsView zoom={zoom} onZoomChange={setZoom} search={searchTerm} />}
      </main>
      {aiOpen && <AIPanel onClose={() => setAiOpen(false)} />}
    </div>
  );
}

export default App;
