import { useState, useSyncExternalStore } from 'react';
import {
  getData,
  subscribe,
  getFilePath,
  addCategory,
  deleteCategory,
  addCategoryRule,
  deleteCategoryRule,
  addRecurringTemplate,
  deleteRecurringTemplate,
  updateRecurringTemplate,
  type RecurringTemplate,
} from '../db';
import { recategorizeAll } from '../logic/categorize';

export function SettingsView() {
  const data = useSyncExternalStore(subscribe, getData);
  const categories = data.categories;
  const catMap = new Map(categories.map((c) => [c.id, c.name]));
  const rules = data.categoryRules.map((r) => ({ ...r, catName: catMap.get(r.categoryId) ?? '?' }));
  const templates = data.recurringTemplates;

  const [newCat, setNewCat] = useState('');
  const [newPattern, setNewPattern] = useState('');
  const [newMatchType, setNewMatchType] = useState<'exact' | 'contains'>('contains');
  const [newRuleCat, setNewRuleCat] = useState<number | ''>('');

  const [tmplDescriptor, setTmplDescriptor] = useState('');
  const [tmplAmount, setTmplAmount] = useState('');
  const [tmplInstrument, setTmplInstrument] = useState('');
  const [tmplCategory, setTmplCategory] = useState<number | ''>('');
  const [tmplDay, setTmplDay] = useState('1');

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
    await addCategoryRule({
      matchType: newMatchType,
      pattern: newPattern.toLowerCase(),
      categoryId: newRuleCat as number,
    });
    setNewPattern('');
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

  const filePath = getFilePath();

  return (
    <div>
      <h1 className="view-title">Settings</h1>

      {filePath && (
        <div className="card" style={{ marginBottom: '1rem', fontSize: '0.8rem', opacity: 0.7 }}>
          Data file: <code>{filePath}</code>
        </div>
      )}

      {/* Categories */}
      <div className="section-title">Categories</div>
      <div className="card">
        {categories.map((c) => (
          <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.3rem 0', borderBottom: '1px solid var(--border-color)' }}>
            <span>{c.name}</span>
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
                <td><button className="btn btn-danger btn-sm" onClick={() => handleDeleteRule(r.id)}>&times;</button></td>
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
          <button className="btn btn-primary" onClick={handleAddRule}>Add</button>
        </div>

        <button className="btn btn-ghost" onClick={runRecategorize} style={{ marginTop: '0.5rem' }}>
          Re-categorize uncategorized
        </button>
      </div>

      {/* Recurring Templates */}
      <div className="section-title">Recurring Templates</div>
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
              return (
                <tr key={t.id}>
                  <td>{t.descriptor}</td>
                  <td className="num">${t.amount.toFixed(2)}</td>
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
                  <td>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDeleteTemplate(t.id)}>&times;</button>
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
            <select value={tmplCategory} onChange={(e) => setTmplCategory(e.target.value ? Number(e.target.value) : '')}>
              <option value="">None</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Day of month</label>
            <input type="number" min="1" max="31" value={tmplDay} onChange={(e) => setTmplDay(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={handleAddTemplate} style={{ alignSelf: 'flex-end' }}>Add Template</button>
        </div>
      </div>
    </div>
  );
}
