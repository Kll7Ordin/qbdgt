import { useRef } from 'react';
import { getData, addCategory, saveExperimentalBudget } from '../db';
import { parseWorkbook } from '../parsers/xlsx';
import * as XLSX from 'xlsx';

interface Props {
  /** compact = just buttons, no title/description (for inline use in BudgetView / ExperimentalBudgets) */
  compact?: boolean;
  onImported?: () => void;
}

function downloadTemplate() {
  const wb = XLSX.utils.book_new();
  const budgetSheet = XLSX.utils.aoa_to_sheet([
    ['Category', 'Monthly Target'],
    ['Groceries', 800],
    ['Gas', 200],
    ['Dining', 300],
    ['Subscriptions', 50],
    ['Personal Care', 100],
  ]);
  const rulesSheet = XLSX.utils.aoa_to_sheet([
    ['Pattern', 'Category'],
    ['netflix', 'Subscriptions'],
    ['spotify', 'Subscriptions'],
    ['loblaws', 'Groceries'],
  ]);
  XLSX.utils.book_append_sheet(wb, budgetSheet, 'Budget');
  XLSX.utils.book_append_sheet(wb, rulesSheet, 'Rules');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'budget-template.xlsx'; a.click();
  URL.revokeObjectURL(url);
}

async function handleFile(file: File, onImported?: () => void) {
  try {
    const buf = await file.arrayBuffer();
    const { budgetLines } = parseWorkbook(buf);
    if (budgetLines.length === 0) { alert('No budget lines found in Sheet 1.'); return; }
    const { categories } = getData();
    const existingNames = new Set(categories.map((c) => c.name.toLowerCase()));
    for (const line of budgetLines) {
      if (!existingNames.has(line.categoryName.toLowerCase())) {
        await addCategory(line.categoryName);
      }
    }
    const { categories: allCats } = getData();
    const catMap = new Map(allCats.map((c) => [c.name.toLowerCase(), c.id!]));
    const items = budgetLines
      .filter((l) => catMap.has(l.categoryName.toLowerCase()))
      .map((l) => ({
        categoryId: catMap.get(l.categoryName.toLowerCase())!,
        categoryName: l.categoryName,
        groupId: null,
        groupName: null,
        targetAmount: l.targetAmount,
      }));
    await saveExperimentalBudget({
      name: file.name.replace(/\.[^.]+$/, ''),
      createdAt: new Date().toISOString(),
      items,
    });
    alert(`Imported ${items.length} budget lines as an Experimental Budget. Go to Exp. Budgets to review and apply.`);
    onImported?.();
  } catch (err) {
    alert(`Import failed: ${String(err)}`);
  }
}

export function ImportBudgetCard({ compact = false, onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    handleFile(file, onImported);
    e.target.value = '';
  }

  if (compact) {
    return (
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={onChange} />
        <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
          Import Budget from XLSX
        </button>
        <button className="btn btn-ghost btn-sm" onClick={downloadTemplate}>↓ Template</button>
      </div>
    );
  }

  return (
    <div>
      <p style={{ fontSize: '0.85rem', opacity: 0.8, marginBottom: '0.75rem' }}>
        Upload a budget spreadsheet to create a draft in <strong>Experimental Budgets</strong>. From there you can review it and apply it to a live month manually.
      </p>
      <p style={{ fontSize: '0.8rem', opacity: 0.65, marginBottom: '0.75rem' }}>
        Format: Sheet 1 — two columns: <code>Category</code>, <code>Monthly Target</code>. Sheet 2 (optional) — <code>Pattern</code>, <code>Category</code> (keyword rules).
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <button className="btn btn-ghost btn-sm" onClick={downloadTemplate}>↓ Download sample template</button>
      </div>
      <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={onChange} />
      <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
        Choose XLSX file…
      </button>
    </div>
  );
}
