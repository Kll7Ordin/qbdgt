import { useState } from 'react';
import { BudgetView } from './components/BudgetView';
import { TransactionView } from './components/TransactionView';
import { YearView } from './components/YearView';
import { SavingsView } from './components/SavingsView';
import { ImportView } from './components/ImportView';
import { SettingsView } from './components/SettingsView';
import './App.css';

type Tab = 'budget' | 'transactions' | 'year' | 'savings' | 'import' | 'settings';

const TABS: { key: Tab; label: string }[] = [
  { key: 'budget', label: 'Budget' },
  { key: 'transactions', label: 'Txns' },
  { key: 'year', label: 'Year' },
  { key: 'savings', label: 'Savings' },
  { key: 'import', label: 'Import' },
  { key: 'settings', label: 'Settings' },
];

function App() {
  const [tab, setTab] = useState<Tab>('budget');

  return (
    <div className="app">
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
      </nav>
      <main className="main-content">
        {tab === 'budget' && <BudgetView />}
        {tab === 'transactions' && <TransactionView />}
        {tab === 'year' && <YearView />}
        {tab === 'savings' && <SavingsView />}
        {tab === 'import' && <ImportView />}
        {tab === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}

export default App;
