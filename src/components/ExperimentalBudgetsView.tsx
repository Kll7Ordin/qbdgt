import { useState, useSyncExternalStore } from 'react';
import { getData, subscribe, saveExperimentalBudget, deleteExperimentalBudget, type ExperimentalBudget, type ExperimentalBudgetItem } from '../db';
import { SearchableSelect } from './SearchableSelect';
import { formatAmount } from '../utils/format';

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function ExperimentalBudgetsView() {
  const appData = useSyncExternalStore(subscribe, getData);
  const { categories, budgets, budgetGroups, experimentalBudgets = [] } = appData;

  const catMap = new Map(categories.map((c) => [c.id, c.name]));
  const groupMap = new Map((budgetGroups ?? []).map((g) => [g.id, g.name]));

  // Months that have budget data
  const budgetMonths = [...new Set(budgets.map((b) => b.month))].sort().reverse();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createFromMonth, setCreateFromMonth] = useState(currentMonth());

  // Edit item inline
  const [editItemKey, setEditItemKey] = useState<string | null>(null); // `${budgetId}-${catId}`
  const [editTarget, setEditTarget] = useState('');

  // Rename
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Add item
  const [showAddItem, setShowAddItem] = useState<number | null>(null); // budgetId
  const [addCatId, setAddCatId] = useState<number | ''>('');
  const [addTarget, setAddTarget] = useState('');

  async function handleCreate() {
    const name = createName.trim();
    if (!name) return;

    const monthBudgets = budgets.filter((b) => b.month === createFromMonth);
    const items: ExperimentalBudgetItem[] = monthBudgets.map((b) => ({
      categoryId: b.categoryId,
      categoryName: catMap.get(b.categoryId) ?? '?',
      groupId: b.groupId ?? null,
      groupName: b.groupId != null ? (groupMap.get(b.groupId) ?? null) : null,
      targetAmount: b.targetAmount,
      sortOrder: b.sortOrder,
    }));

    const saved = await saveExperimentalBudget({ name, createdAt: new Date().toISOString(), items });
    setSelectedId(saved.id);
    setShowCreate(false);
    setCreateName('');
  }

  async function handleDelete(id: number) {
    await deleteExperimentalBudget(id);
    if (selectedId === id) setSelectedId(null);
    setConfirmDeleteId(null);
  }

  async function saveItemEdit(budget: ExperimentalBudget, catId: number) {
    const amount = parseFloat(editTarget);
    if (isNaN(amount)) { setEditItemKey(null); return; }
    const updatedItems = budget.items.map((item) =>
      item.categoryId === catId ? { ...item, targetAmount: amount } : item
    );
    await saveExperimentalBudget({ ...budget, items: updatedItems });
    setEditItemKey(null);
  }

  async function deleteItem(budget: ExperimentalBudget, catId: number) {
    const updatedItems = budget.items.filter((item) => item.categoryId !== catId);
    await saveExperimentalBudget({ ...budget, items: updatedItems });
  }

  async function handleAddItem(budget: ExperimentalBudget) {
    if (addCatId === '' || !addTarget) return;
    const catId = addCatId as number;
    if (budget.items.some((i) => i.categoryId === catId)) return;
    const amount = parseFloat(addTarget);
    if (isNaN(amount)) return;
    const newItem: ExperimentalBudgetItem = {
      categoryId: catId,
      categoryName: catMap.get(catId) ?? '?',
      groupId: null,
      groupName: null,
      targetAmount: amount,
    };
    await saveExperimentalBudget({ ...budget, items: [...budget.items, newItem] });
    setAddCatId('');
    setAddTarget('');
    setShowAddItem(null);
  }

  async function handleRename(budget: ExperimentalBudget) {
    const name = renameValue.trim();
    if (!name) return;
    await saveExperimentalBudget({ ...budget, name });
    setRenamingId(null);
  }

  const selectedBudget = experimentalBudgets.find((b) => b.id === selectedId) ?? null;

  return (
    <div>
      <h1 className="view-title">Experimental Budgets</h1>
      <p style={{ fontSize: '0.85rem', opacity: 0.7, marginBottom: '1rem' }}>
        Create named budget snapshots to try out different budget plans. Apply them to any month from the Budget view.
      </p>

      <div className="card" style={{ marginBottom: '1rem' }}>
        {!showCreate ? (
          <button className="btn btn-primary" onClick={() => { setShowCreate(true); setCreateName(''); setCreateFromMonth(budgetMonths[0] ?? currentMonth()); }}>
            + Create New Experimental Budget
          </button>
        ) : (
          <div>
            <div className="section-title" style={{ marginTop: 0 }}>New Experimental Budget</div>
            <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div className="field">
                <label>Name</label>
                <input value={createName} onChange={(e) => setCreateName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  placeholder="e.g. Tight Budget, Vacation Month" autoFocus />
              </div>
              <div className="field">
                <label>Copy from month</label>
                <select value={createFromMonth} onChange={(e) => setCreateFromMonth(e.target.value)}
                  style={{ padding: '0.35rem 0.5rem', fontSize: '0.9rem' }}>
                  {budgetMonths.map((m) => <option key={m} value={m}>{m}</option>)}
                  {budgetMonths.length === 0 && <option value={currentMonth()}>{currentMonth()} (empty)</option>}
                </select>
              </div>
              <button className="btn btn-primary" onClick={handleCreate} disabled={!createName.trim()}>Create</button>
              <button className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
            <p style={{ fontSize: '0.82rem', opacity: 0.65 }}>
              Creates a snapshot of that month's budget items. You can edit the amounts after creating.
            </p>
          </div>
        )}
      </div>

      {experimentalBudgets.length === 0 && !showCreate && (
        <div className="card" style={{ textAlign: 'center', color: 'var(--text-3)', padding: '2rem' }}>
          No experimental budgets yet. Create one above to get started.
        </div>
      )}

      {experimentalBudgets.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div className="section-title" style={{ marginTop: 0 }}>Saved Budgets</div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="num">Items</th>
                <th className="num">Total ($)</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {[...experimentalBudgets].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((eb, i) => (
                <tr key={eb.id} className={i % 2 === 0 ? 'budget-row-even' : 'budget-row-odd'}>
                  <td>
                    {renamingId === eb.id ? (
                      <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => handleRename(eb)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleRename(eb); if (e.key === 'Escape') setRenamingId(null); }}
                        autoFocus style={{ fontSize: '0.9rem', padding: '0.2rem 0.4rem' }} />
                    ) : (
                      <button className="btn btn-ghost btn-sm" style={{ fontWeight: 600, textAlign: 'left' }}
                        onClick={() => setSelectedId(selectedId === eb.id ? null : eb.id)}>
                        {eb.name}
                      </button>
                    )}
                  </td>
                  <td className="num">{eb.items.length}</td>
                  <td className="num">${formatAmount(eb.items.reduce((s, it) => s + it.targetAmount, 0), 0)}</td>
                  <td style={{ fontSize: '0.82rem', color: 'var(--text-3)' }}>{eb.createdAt.slice(0, 10)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'flex-end' }}>
                      <button className="btn btn-ghost btn-sm" title="Rename"
                        onClick={() => { setRenamingId(eb.id); setRenameValue(eb.name); }}>✎</button>
                      {confirmDeleteId === eb.id ? (
                        <>
                          <button className="btn btn-danger btn-sm" onClick={() => handleDelete(eb.id)}>Delete</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                        </>
                      ) : (
                        <button className="btn btn-danger btn-sm" onClick={() => setConfirmDeleteId(eb.id)}>&times;</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedBudget && (
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>{selectedBudget.name} — Items</div>
          <table className="data-table budget-table" style={{ marginBottom: '0.75rem' }}>
            <thead>
              <tr>
                <th>Category</th>
                <th>Group</th>
                <th className="num">Target ($)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {selectedBudget.items.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-3)', padding: '1rem' }}>No items yet. Add one below.</td>
                </tr>
              )}
              {selectedBudget.items.map((item, i) => {
                const key = `${selectedBudget.id}-${item.categoryId}`;
                return (
                  <tr key={item.categoryId} className={i % 2 === 0 ? 'budget-row-even' : 'budget-row-odd'}>
                    <td>{item.categoryName}</td>
                    <td style={{ color: 'var(--text-3)', fontSize: '0.85rem' }}>{item.groupName ?? '—'}</td>
                    <td className="num budget-num">
                      {editItemKey === key ? (
                        <input type="number" value={editTarget}
                          onChange={(e) => setEditTarget(e.target.value)}
                          onBlur={() => saveItemEdit(selectedBudget, item.categoryId)}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveItemEdit(selectedBudget, item.categoryId); if (e.key === 'Escape') setEditItemKey(null); }}
                          style={{ width: 80, fontSize: '0.88rem' }} autoFocus />
                      ) : (
                        <span style={{ cursor: 'pointer' }} onClick={() => { setEditItemKey(key); setEditTarget(String(item.targetAmount)); }}>
                          ${formatAmount(item.targetAmount, 0)}
                        </span>
                      )}
                    </td>
                    <td>
                      <button className="btn btn-danger btn-sm" onClick={() => deleteItem(selectedBudget, item.categoryId)}>&times;</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {showAddItem === selectedBudget.id ? (
            <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end', gap: '0.5rem' }}>
              <div className="field">
                <label>Category</label>
                <SearchableSelect
                  options={categories
                    .filter((c) => !selectedBudget.items.some((it) => it.categoryId === c.id))
                    .map((c) => ({ value: c.id, label: c.name }))}
                  value={addCatId}
                  onChange={(v) => setAddCatId(v === '' ? '' : Number(v))}
                  placeholder="Select category…" />
              </div>
              <div className="field">
                <label>Target ($)</label>
                <input type="number" value={addTarget} onChange={(e) => setAddTarget(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddItem(selectedBudget)}
                  placeholder="0" style={{ width: 80 }} />
              </div>
              <button className="btn btn-primary" onClick={() => handleAddItem(selectedBudget)}
                disabled={addCatId === '' || !addTarget}>Add</button>
              <button className="btn btn-ghost" onClick={() => setShowAddItem(null)}>Cancel</button>
            </div>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => { setShowAddItem(selectedBudget.id); setAddCatId(''); setAddTarget(''); }}>
              + Add item
            </button>
          )}
        </div>
      )}
    </div>
  );
}
