import { useState, useEffect, useRef } from 'react';
import { flushSync, createPortal } from 'react-dom';
import { getData, subscribe, upsertBudget, deleteBudget, addBudgetGroup, updateBudgetGroup, deleteBudgetGroup, reorderBudgetsInGroup, addCategory, updateCategoryNote, pushUndoSnapshot, type Category, type TransactionSplit, type BudgetGroup } from '../db';
import { SearchableSelect } from './SearchableSelect';
import { formatAmount } from '../utils/format';
import { INCOME_CATEGORY_NAMES } from '../seed';

function formatDiff(n: number): string {
  const r = Math.round(n);
  if (r === 0) return '—';
  return `${r > 0 ? '+' : '-'}$${formatAmount(Math.abs(n), 0)}`;
}


/** Color for YTD diff / avg diff: 0 = dark green, up to 10% over target = amber, >10% = red, under = medium green */
function budgetDiffColor(diff: number, target: number): string {
  if (Math.abs(diff) < 0.5) return '#166534'; // zero = dark green
  if (diff < 0) return '#16a34a'; // under budget = medium green
  const ratio = target > 0 ? diff / target : 1;
  if (ratio <= 0.1) return '#d97706'; // up to 10% over = amber
  return '#dc2626'; // >10% over = red
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function prevMonths(month: string, n: number): string[] {
  const [y, m] = month.split('-').map(Number);
  const result: string[] = [];
  let cy = y, cm = m;
  for (let i = 0; i < n; i++) {
    cm--;
    if (cm < 1) { cm = 12; cy--; }
    result.push(`${cy}-${String(cm).padStart(2, '0')}`);
  }
  return result;
}

interface BudgetRow {
  categoryId: number;
  categoryName: string;
  note?: string;
  target: number;
  spent: number;
  ytd: number;
  ytdTarget: number;
  ytdDiff: number;
  ytdAvgDiff: number;
  isIncome?: boolean;
  groupId?: number | null;
  sortOrder?: number;
}

const _catMap = new Map<number, string>();

function buildRows(month: string, categories: Category[], _budgetGroups: BudgetGroup[]): { rows: BudgetRow[]; priorMonthCount: number } {
  const d = getData();
  const budgets = d.budgets.filter((b) => b.month === month);
  _catMap.clear();
  for (const c of categories) _catMap.set(c.id, c.name);

  const [yearNum, monthNum] = month.split('-').map(Number);
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-31`;

  const priorMonths: string[] = [];
  for (let m = 1; m < monthNum; m++) {
    priorMonths.push(`${yearNum}-${String(m).padStart(2, '0')}`);
  }

  const splitsByTxn = new Map<number, TransactionSplit[]>();
  for (const s of d.transactionSplits) {
    const arr = splitsByTxn.get(s.transactionId) ?? [];
    arr.push(s);
    splitsByTxn.set(s.transactionId, arr);
  }

  function accumulateRange(rangeStart: string, rangeEnd: string, spendMap: Map<number, number>, incomeMap: Map<number, number>) {
    for (const t of d.transactions) {
      const txnSplits = splitsByTxn.get(t.id);
      if (txnSplits && txnSplits.length > 0) {
        for (const s of txnSplits) {
          const effectiveDate = s.txnDate ?? t.txnDate;
          if (effectiveDate < rangeStart || effectiveDate > rangeEnd) continue;
          const map = t.ignoreInBudget ? incomeMap : spendMap;
          map.set(s.categoryId, (map.get(s.categoryId) ?? 0) + s.amount);
        }
      } else if (t.categoryId) {
        if (t.txnDate < rangeStart || t.txnDate > rangeEnd) continue;
        const map = t.ignoreInBudget ? incomeMap : spendMap;
        map.set(t.categoryId, (map.get(t.categoryId) ?? 0) + t.amount);
      }
    }
  }

  const spendByCategory = new Map<number, number>();
  const incomeByCategory = new Map<number, number>();
  accumulateRange(monthStart, monthEnd, spendByCategory, incomeByCategory);

  const ytdSpendMap = new Map<number, number>();
  const ytdIncomeMap = new Map<number, number>();
  for (const pm of priorMonths) {
    accumulateRange(`${pm}-01`, `${pm}-31`, ytdSpendMap, ytdIncomeMap);
  }

  const rows = budgets.map((b) => {
    const cat = categories.find((c) => c.id === b.categoryId);
    const isIncome = cat?.isIncome === true || (cat != null && INCOME_CATEGORY_NAMES.has(cat.name));
    const grossSpent = spendByCategory.get(b.categoryId) ?? 0;
    const credits = incomeByCategory.get(b.categoryId) ?? 0;
    const ytdGross = ytdSpendMap.get(b.categoryId) ?? 0;
    const ytdCredits = ytdIncomeMap.get(b.categoryId) ?? 0;
    const ytd = isIncome ? (ytdIncomeMap.get(b.categoryId) ?? 0) : ytdGross - ytdCredits;
    const ytdTarget = b.targetAmount * priorMonths.length;
    const ytdDiff = ytd - ytdTarget;
    const ytdAvgDiff = priorMonths.length > 0 ? ytdDiff / priorMonths.length : 0;
    return {
      categoryId: b.categoryId,
      categoryName: _catMap.get(b.categoryId) ?? '?',
      note: cat?.note,
      target: b.targetAmount,
      spent: isIncome ? credits : grossSpent - credits,
      ytd, ytdTarget, ytdDiff, ytdAvgDiff, isIncome,
      groupId: b.groupId ?? null,
      sortOrder: (b as { sortOrder?: number }).sortOrder ?? 0,
    };
  });
  return { rows, priorMonthCount: priorMonths.length };
}

function groupRows(rows: BudgetRow[], groups: BudgetGroup[]): { group: BudgetGroup | null; rows: BudgetRow[] }[] {
  const ungrouped = rows.filter((r) => !r.groupId).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const byGroup = new Map<number, BudgetRow[]>();
  for (const r of rows) {
    if (r.groupId != null) {
      const arr = byGroup.get(r.groupId) ?? [];
      arr.push(r);
      byGroup.set(r.groupId, arr);
    }
  }
  for (const arr of byGroup.values()) arr.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const result: { group: BudgetGroup | null; rows: BudgetRow[] }[] = [];
  for (const g of [...groups].sort((a, b) => a.sortOrder - b.sortOrder)) {
    result.push({ group: g, rows: byGroup.get(g.id) ?? [] });
  }
  result.push({ group: null, rows: ungrouped });
  return result;
}

export function BudgetView({ search = '' }: { search?: string }) {
  const [month, setMonth] = useState(currentMonth());
  const [rows, setRows] = useState<BudgetRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [budgetGroups, setBudgetGroups] = useState<BudgetGroup[]>([]);
  const [newCatId, setNewCatId] = useState<number | ''>('');
  const [newTarget, setNewTarget] = useState('');
  const [newCatName, setNewCatName] = useState(''); // for inline category creation
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [editId, setEditId] = useState<number | null>(null);
  const [editTarget, setEditTarget] = useState('');
  const [editPastMonths, setEditPastMonths] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');
  const [priorMonthCount, setPriorMonthCount] = useState(0);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [editNoteId, setEditNoteId] = useState<number | null>(null);
  const [editNoteText, setEditNoteText] = useState('');
  const [editGroupNoteId, setEditGroupNoteId] = useState<number | null>(null);
  const [editGroupNoteText, setEditGroupNoteText] = useState('');

  // Item drag state — uses direct DOM for transforms during drag (no re-renders)
  const _moveRef = useRef<((e: MouseEvent) => void) | null>(null);
  const _upRef = useRef<((e: MouseEvent) => void) | null>(null);
  const tableBodyRef = useRef<HTMLTableSectionElement>(null);
  const budgetTableRef = useRef<HTMLTableElement>(null);
  const ghostElRef = useRef<HTMLDivElement>(null);
  const dragInfoRef = useRef<{
    catId: number;
    sourceGroupId: number | null;
    sourceIdx: number;
    hoverIdx: number;
    flatPositions: { catId: number; groupId: number | null; el: HTMLElement; centerY: number }[];
    rowEl: HTMLElement;
    rowHeight: number;
    zoom: number;
  } | null>(null);
  const [dragCatId, setDragCatId] = useState<number | null>(null);
  const [ghostInfo, setGhostInfo] = useState<{
    label: string; target: number; spent: number;
  } | null>(null);

  // Group drag state
  const [dragGroupId, setDragGroupId] = useState<number | null>(null);
  const dragGroupIdRef = useRef<number | null>(null);
  const _groupMoveRef = useRef<((e: MouseEvent) => void) | null>(null);
  const _groupUpRef = useRef<((e: MouseEvent) => void) | null>(null);
  const [groupGhostLabel, setGroupGhostLabel] = useState<string | null>(null);
  const groupGhostElRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => {
    if (_moveRef.current) document.removeEventListener('mousemove', _moveRef.current);
    if (_upRef.current) document.removeEventListener('mouseup', _upRef.current);
    if (_groupMoveRef.current) document.removeEventListener('mousemove', _groupMoveRef.current);
    if (_groupUpRef.current) document.removeEventListener('mouseup', _groupUpRef.current);
  }, []);

  const [barCapInfo, setBarCapInfo] = useState({ overflow: 600, catWidth: 400 });

  // Keep --bar-max-overflow in sync with the midpoint between YTD and YTD Target columns
  useEffect(() => {
    function measure() {
      const table = budgetTableRef.current;
      if (!table) return;
      const catTh = table.querySelector('th[data-col="category"]') as HTMLElement | null;
      const ytdTh = table.querySelector('th[data-col="ytd"]') as HTMLElement | null;
      const ytdTargetTh = table.querySelector('th[data-col="ytd-target"]') as HTMLElement | null;
      if (!catTh || !ytdTh || !ytdTargetTh) return;
      const catRect = catTh.getBoundingClientRect();
      ytdTh; // column presence check only
      const ytdTargetRect = ytdTargetTh.getBoundingClientRect();
      // Anchor = center of the YTD Target column
      const midpoint = (ytdTargetRect.left + ytdTargetRect.right) / 2;
      const overflow = Math.max(0, midpoint - catRect.right + 8);
      table.style.setProperty('--bar-max-overflow', `${overflow}px`);
      setBarCapInfo({ overflow, catWidth: catRect.width });
    }
    measure();
    const ro = new ResizeObserver(measure);
    if (budgetTableRef.current) ro.observe(budgetTableRef.current);
    return () => ro.disconnect();
  }, [priorMonthCount]);

  useEffect(() => {
    function refresh() {
      const d = getData();
      setCategories(d.categories);
      setBudgetGroups(d.budgetGroups ?? []);
      const result = buildRows(month, d.categories, d.budgetGroups ?? []);
      setRows(result.rows);
      setPriorMonthCount(result.priorMonthCount);
    }
    refresh();
    return subscribe(refresh);
  }, [month]);

  async function addBudgetItem() {
    if (!newTarget) return;
    let catId = newCatId as number;
    if (!catId) {
      if (!newCatName.trim()) return;
      catId = await addCategory(newCatName.trim());
      setNewCatName('');
    }
    await upsertBudget(month, catId, parseFloat(newTarget));
    setNewCatId(''); setNewTarget('');
  }

  async function addGroup() {
    if (!newGroupName.trim()) return;
    await addBudgetGroup(newGroupName.trim());
    setNewGroupName(''); setShowAddGroup(false);
  }

  async function saveGroupName(groupId: number) {
    if (editingGroupName.trim()) await updateBudgetGroup(groupId, { name: editingGroupName.trim() });
    setEditingGroupId(null);
  }


  async function handleDrop(draggedCategoryId: number, targetGroupId: number | null, beforeCategoryId: number | null) {
    const draggedRow = expenseRows.find((r) => r.categoryId === draggedCategoryId);
    if (!draggedRow) return;
    // Sort by sortOrder to match display order — critical for correct insertion
    const sortBySortOrder = (a: BudgetRow, b: BudgetRow) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    const targetGroupRows = (targetGroupId == null
      ? expenseRows.filter((r) => !r.groupId)
      : expenseRows.filter((r) => r.groupId === targetGroupId)
    ).sort(sortBySortOrder);
    const targetIds = targetGroupRows.map((r) => r.categoryId);
    const isSameGroup = (draggedRow.groupId ?? null) === targetGroupId;
    let newOrder: number[];
    if (isSameGroup) {
      const without = targetIds.filter((id) => id !== draggedCategoryId);
      const insertIdx = beforeCategoryId == null ? without.length : without.indexOf(beforeCategoryId);
      if (insertIdx < 0) return;
      newOrder = [...without.slice(0, insertIdx), draggedCategoryId, ...without.slice(insertIdx)];
    } else {
      const oldGroupId = draggedRow.groupId ?? null;
      const oldGroupRows = (oldGroupId == null ? expenseRows.filter((r) => !r.groupId) : expenseRows.filter((r) => r.groupId === oldGroupId)).sort(sortBySortOrder);
      const oldOrder = oldGroupRows.map((r) => r.categoryId).filter((id) => id !== draggedCategoryId);
      const insertIdx = beforeCategoryId == null ? targetIds.length : targetIds.indexOf(beforeCategoryId);
      const safeIdx = insertIdx < 0 ? targetIds.length : insertIdx;
      newOrder = [...targetIds.slice(0, safeIdx), draggedCategoryId, ...targetIds.slice(safeIdx)];
      await reorderBudgetsInGroup(month, oldGroupId, oldOrder);
    }
    await reorderBudgetsInGroup(month, targetGroupId, newOrder);
  }

  function startRowDrag(e: React.MouseEvent, row: BudgetRow, groupId: number | null) {
    e.preventDefault();
    e.stopPropagation();
    if (_moveRef.current) document.removeEventListener('mousemove', _moveRef.current);
    if (_upRef.current) document.removeEventListener('mouseup', _upRef.current);

    const rowEl = (e.currentTarget as HTMLElement).closest('tr') as HTMLElement;
    const rowRect = rowEl.getBoundingClientRect();
    const tableEl = tableBodyRef.current!;

    // Detect CSS zoom for transform calculations (transforms are in pre-zoom space)
    const appEl = rowEl.closest('.app') as HTMLElement | null;
    const zoom = appEl ? parseFloat(appEl.style.zoom || '1') : 1;

    // Capture positions of all category rows at drag start
    const allCatRows = Array.from(tableEl.querySelectorAll('tr[data-catid]')) as HTMLElement[];
    const flatPositions = allCatRows.map(el => {
      const rect = el.getBoundingClientRect();
      return {
        catId: Number(el.dataset.catid),
        groupId: el.dataset.groupid === 'null' ? null : Number(el.dataset.groupid),
        el,
        centerY: rect.top + rect.height / 2,
      };
    });
    const sourceIdx = flatPositions.findIndex(p => p.catId === row.categoryId);

    dragInfoRef.current = {
      catId: row.categoryId, sourceGroupId: groupId,
      sourceIdx, hoverIdx: sourceIdx,
      flatPositions, rowEl, rowHeight: rowRect.height, zoom,
    };

    // Prepare rows for animation
    allCatRows.forEach(el => {
      if (el !== rowEl) {
        el.style.transition = 'transform 150ms cubic-bezier(0.25, 0.1, 0.25, 1)';
        el.style.willChange = 'transform';
      }
    });

    // Prevent text selection during drag
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';

    // Use flushSync so the ghost DOM element exists immediately (no lag on first frame)
    flushSync(() => {
      setDragCatId(row.categoryId);
      setGhostInfo({
        label: row.categoryName, target: row.target, spent: row.spent,
      });
    });

    _moveRef.current = (me: MouseEvent) => {
      const dd = dragInfoRef.current;
      if (!dd) return;

      // Position ghost at cursor (portaled to body, outside zoom — use native coords directly)
      if (ghostElRef.current) {
        ghostElRef.current.style.left = `${me.clientX + 12}px`;
        ghostElRef.current.style.top = `${me.clientY - 18}px`;
      }

      // Compute hover index — centerY is in zoom-local coords, me.clientY is viewport
      const ghostCenterY = me.clientY / dd.zoom;
      let hoverIdx = dd.sourceIdx;
      for (let i = 0; i < dd.flatPositions.length; i++) {
        const pos = dd.flatPositions[i];
        const prevCY = i > 0 ? dd.flatPositions[i - 1].centerY : -Infinity;
        const nextCY = i < dd.flatPositions.length - 1 ? dd.flatPositions[i + 1].centerY : Infinity;
        if (ghostCenterY >= (prevCY + pos.centerY) / 2 && ghostCenterY < (pos.centerY + nextCY) / 2) {
          hoverIdx = i;
          break;
        }
      }

      if (hoverIdx !== dd.hoverIdx) {
        dd.hoverIdx = hoverIdx;
        const shiftPx = dd.rowHeight;
        for (let i = 0; i < dd.flatPositions.length; i++) {
          if (i === dd.sourceIdx) continue;
          let ty = 0;
          if (hoverIdx > dd.sourceIdx && i > dd.sourceIdx && i <= hoverIdx) ty = -shiftPx;
          else if (hoverIdx < dd.sourceIdx && i >= hoverIdx && i < dd.sourceIdx) ty = shiftPx;
          dd.flatPositions[i].el.style.transform = ty ? `translateY(${ty}px)` : '';
        }
      }
    };

    _upRef.current = () => {
      document.removeEventListener('mousemove', _moveRef.current!);
      document.removeEventListener('mouseup', _upRef.current!);
      _moveRef.current = null; _upRef.current = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';

      const dd = dragInfoRef.current;
      if (dd) {
        dd.flatPositions.forEach(p => { p.el.style.transform = ''; p.el.style.transition = ''; p.el.style.willChange = ''; });
        const hoverIdx = dd.hoverIdx;
        if (hoverIdx !== dd.sourceIdx) {
          const targetGroupId = dd.flatPositions[hoverIdx].groupId;
          let beforeCatId: number | null;
          if (hoverIdx > dd.sourceIdx) {
            let next: number | null = null;
            for (let i = hoverIdx + 1; i < dd.flatPositions.length; i++) {
              if (i === dd.sourceIdx) continue;
              if (dd.flatPositions[i].groupId === targetGroupId) next = dd.flatPositions[i].catId;
              break;
            }
            beforeCatId = next;
          } else {
            beforeCatId = dd.flatPositions[hoverIdx].catId;
          }
          handleDrop(dd.catId, targetGroupId, beforeCatId);
        }
      }
      setDragCatId(null);
      setGhostInfo(null);
      dragInfoRef.current = null;
    };

    document.addEventListener('mousemove', _moveRef.current);
    document.addEventListener('mouseup', _upRef.current);
  }

  function startGroupDrag(e: React.MouseEvent, group: BudgetGroup) {
    e.preventDefault();
    e.stopPropagation();
    if (_groupMoveRef.current) document.removeEventListener('mousemove', _groupMoveRef.current);
    if (_groupUpRef.current) document.removeEventListener('mouseup', _groupUpRef.current);
    dragGroupIdRef.current = group.id;
    setDragGroupId(group.id);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';

    // Render ghost (portaled to body, outside zoom) — position via ref using native mouse coords
    flushSync(() => setGroupGhostLabel(`⊞ ${group.name}`));

    _groupMoveRef.current = (me: MouseEvent) => {
      if (groupGhostElRef.current) {
        groupGhostElRef.current.style.left = `${me.clientX + 12}px`;
        groupGhostElRef.current.style.top = `${me.clientY - 10}px`;
      }
    };
    _groupUpRef.current = async (ue: MouseEvent) => {
      document.removeEventListener('mousemove', _groupMoveRef.current!);
      document.removeEventListener('mouseup', _groupUpRef.current!);
      _groupMoveRef.current = null; _groupUpRef.current = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      setGroupGhostLabel(null);
      const draggingId = dragGroupIdRef.current;
      dragGroupIdRef.current = null;
      setDragGroupId(null);
      if (!draggingId) return;
      const el = document.elementFromPoint(ue.clientX, ue.clientY);
      const targetRow = el?.closest('[data-grouphdr-id]') as HTMLElement | null;
      if (!targetRow) return;
      const targetId = Number(targetRow.dataset.grouphdrId);
      if (isNaN(targetId) || targetId === draggingId) return;
      // Reorder: move dragging group to target's position
      const sorted = [...budgetGroups].sort((a, b) => a.sortOrder - b.sortOrder);
      const fromIdx = sorted.findIndex((g) => g.id === draggingId);
      const toIdx = sorted.findIndex((g) => g.id === targetId);
      if (fromIdx < 0 || toIdx < 0) return;
      const reordered = [...sorted];
      const [moved] = reordered.splice(fromIdx, 1);
      reordered.splice(toIdx, 0, moved);
      for (let i = 0; i < reordered.length; i++) {
        if (reordered[i].sortOrder !== i) await updateBudgetGroup(reordered[i].id, { sortOrder: i });
      }
    };
    document.addEventListener('mousemove', _groupMoveRef.current);
    document.addEventListener('mouseup', _groupUpRef.current);
  }

  async function removeBudgetItem(categoryId: number) { await deleteBudget(month, categoryId); }

  async function saveEdit(categoryId: number) {
    const row = rows.find((r) => r.categoryId === categoryId);
    const newTarget = parseFloat(editTarget);
    pushUndoSnapshot();
    await upsertBudget(month, categoryId, newTarget, row?.groupId);
    if (editPastMonths) {
      const d = getData();
      const pastBudgets = d.budgets.filter((b) => b.month < month && b.categoryId === categoryId);
      for (const b of pastBudgets) {
        await upsertBudget(b.month, categoryId, newTarget, b.groupId);
      }
    }
    setEditId(null);
    setEditPastMonths(false);
  }

  async function copyFromLastMonth() {
    const d = getData();
    const candidates = prevMonths(month, 12);
    let prevBudgets: typeof d.budgets = [];
    let sourceMonth = '';
    for (const m of candidates) {
      const b = d.budgets.filter((x) => x.month === m);
      if (b.length > 0) { prevBudgets = b; sourceMonth = m; break; }
    }
    for (const b of prevBudgets) await upsertBudget(month, b.categoryId, b.targetAmount, b.groupId);
    if (prevBudgets.length > 0) {
      const label = sourceMonth ? new Date(sourceMonth + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'previous month';
      alert(`Copied ${prevBudgets.length} budget items from ${label}.`);
    } else {
      alert('No budget data found in previous 12 months to copy from.');
    }
  }

  const sq = search.trim().toLowerCase();
  const searchFilter = (r: BudgetRow) => !sq || r.categoryName.toLowerCase().includes(sq);
  const expenseRows = rows.filter((r) => !r.isIncome && searchFilter(r));
  const incomeRows = rows.filter((r) => r.isIncome && searchFilter(r));

  // Identify "Occasional" group (case-insensitive name match)
  const occasionalGroup = budgetGroups.find((g) => g.name.toLowerCase().includes('occasional')) ?? null;
  const occasionalGroupId = occasionalGroup?.id ?? null;
  const savingsRows = occasionalGroupId != null ? expenseRows.filter((r) => r.groupId === occasionalGroupId) : [];
  const regularRows = expenseRows.filter((r) => r.groupId !== occasionalGroupId);

  const totalTarget = regularRows.reduce((s, r) => s + r.target, 0);
  const totalSpent = regularRows.reduce((s, r) => s + r.spent, 0);
  const spentFromSavings = savingsRows.reduce((s, r) => s + r.spent, 0);
  const totalIncome = incomeRows.reduce((s, r) => s + r.target, 0);
  const totalReceived = incomeRows.reduce((s, r) => s + r.spent, 0);
  const yetToReceive = totalIncome - totalReceived;
  const net = totalIncome - totalTarget;
  const grouped = groupRows(expenseRows, budgetGroups);

  const COLS = 10;
  const [y, mon] = month.split('-').map(Number);
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const curYear = new Date().getFullYear();

  return (
    <div>
      <h1 className="view-title">Monthly Budget</h1>

      {/* Month navigation */}
      <div className="month-nav">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
          const d = new Date(y, mon - 2, 1);
          setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        }}>‹</button>
        <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
          <select value={String(mon).padStart(2, '0')} onChange={(e) => setMonth(`${y}-${e.target.value}`)}
            style={{ fontWeight: 600, fontSize: '0.95rem', padding: '0.25rem 0.3rem' }}>
            {MONTH_NAMES.map((name, idx) => (
              <option key={idx} value={String(idx + 1).padStart(2, '0')}>{name}</option>
            ))}
          </select>
          <select value={String(y)} onChange={(e) => setMonth(`${e.target.value}-${String(mon).padStart(2, '0')}`)}
            style={{ fontWeight: 600, fontSize: '0.95rem', padding: '0.25rem 0.3rem' }}>
            {[curYear - 2, curYear - 1, curYear, curYear + 1].map((yr) => (
              <option key={yr} value={String(yr)}>{yr}</option>
            ))}
          </select>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
          const d = new Date(y, mon, 1);
          setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        }}>›</button>
      </div>

      {/* Summary bubbles */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {/* Budget */}
        <div style={{ flex: 1, minWidth: 220, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '0.875rem 1rem' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', marginBottom: '0.6rem' }}>Budget</div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${incomeRows.length > 0 ? 3 : 2}, 1fr)`, gap: '0.5rem' }}>
            <div className="summary-card">
              <span className="summary-label">Expenses</span>
              <span className="summary-value negative">${formatAmount(totalTarget, 0)}</span>
            </div>
            {incomeRows.length > 0 && (
              <div className="summary-card">
                <span className="summary-label">Income</span>
                <span className="summary-value" style={{ color: '#16a34a' }}>${formatAmount(totalIncome, 0)}</span>
              </div>
            )}
            <div className="summary-card">
              <span className="summary-label">Net</span>
              <span className="summary-value" style={{ color: net >= 0 ? '#16a34a' : '#dc2626' }}>${formatAmount(net, 0)}</span>
            </div>
          </div>
        </div>

        {/* Month to Date */}
        <div style={{ flex: 1, minWidth: 220, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '0.875rem 1rem' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', marginBottom: '0.6rem' }}>Month to Date</div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${spentFromSavings > 0 ? (incomeRows.length > 0 ? 5 : 3) : (incomeRows.length > 0 ? 4 : 2)}, 1fr)`, gap: '0.5rem' }}>
            <div className="summary-card">
              <span className="summary-label">Spent</span>
              <span className="summary-value" style={{ color: 'var(--text)' }}>${formatAmount(totalSpent, 0)}</span>
            </div>
            <div className="summary-card">
              <span className="summary-label">Remaining</span>
              <span className="summary-value" style={{ color: 'var(--text)' }}>${formatAmount(totalTarget - totalSpent, 0)}</span>
            </div>
            {occasionalGroupId != null && (
              <div className="summary-card">
                <span className="summary-label">Spent Savings</span>
                <span className="summary-value" style={{ color: 'var(--text)' }}>${formatAmount(spentFromSavings, 0)}</span>
              </div>
            )}
            {incomeRows.length > 0 && (
              <div className="summary-card">
                <span className="summary-label">Received</span>
                <span className="summary-value" style={{ color: 'var(--text)' }}>${formatAmount(totalReceived, 0)}</span>
              </div>
            )}
            {incomeRows.length > 0 && (
              <div className="summary-card">
                <span className="summary-label">Yet to Receive</span>
                <span className="summary-value" style={{ color: 'var(--text)' }}>${formatAmount(yetToReceive, 0)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Expense table — single table so columns align across all groups */}
      <div className="card">
        {expenseRows.length === 0 && (
          <div style={{ marginBottom: '1rem', textAlign: 'center' }}>
            <button className="btn btn-primary" onClick={copyFromLastMonth}>Copy budget from last month</button>
          </div>
        )}
        <div className="section-title" style={{ marginTop: 0 }}>Expenses</div>
        <table className="data-table budget-table" ref={budgetTableRef}>
          <thead>
            <tr>
              <th style={{ width: 24 }}></th>
              <th data-col="category">Category</th>
              <th className="num">Target</th>
              <th className="num">Spent</th>
              <th className="num">Left</th>
              <th className="num" data-col="ytd">YTD</th>
              <th className="num" data-col="ytd-target">YTD Target</th>
              <th className="num">YTD Diff</th>
              <th className="num">Avg ±/mo</th>
              <th style={{ width: 36 }}></th>
            </tr>
          </thead>
          <tbody ref={tableBodyRef}>
            {grouped.flatMap(({ group, rows: grpRows }) => {
              const thisGroupId = group?.id ?? null;
              const isOccasional = occasionalGroupId != null && thisGroupId === occasionalGroupId;
              const groupSpent = grpRows.reduce((s, r) => s + r.spent, 0);
              const groupTarget = grpRows.reduce((s, r) => s + r.target, 0);
              // Hide ungrouped section entirely when empty and not dragging
              if (group === null && grpRows.length === 0 && !ghostInfo) return [];

              const result: React.ReactNode[] = [];

              result.push(
                // Group header row
                <tr key={`hdr-${group?.id ?? 'ug'}`} className="budget-group-header"
                    data-grouphdr-id={group?.id ?? undefined}
                    style={{ opacity: dragGroupId === group?.id ? 0.4 : 1 }}>
                  <td
                    style={{ width: 24, paddingLeft: 4, paddingRight: 4, background: 'var(--bg-3)', borderTop: '1px solid var(--border)',
                      cursor: group ? 'grab' : 'default', userSelect: 'none', WebkitUserSelect: 'none' } as React.CSSProperties}
                    onMouseDown={group ? (e) => startGroupDrag(e, group) : undefined}
                    title={group ? 'Drag to reorder group' : undefined}
                  >
                    {group && (
                      <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" style={{ display: 'block', opacity: 0.4, pointerEvents: 'none' }}>
                        {([2,7,12] as number[]).map(cy => ([1,6] as number[]).map(cx => (
                          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={1.4} />
                        )))}
                      </svg>
                    )}
                  </td>
                  <td colSpan={COLS - 1} style={{ padding: '0.4rem 0.75rem', background: 'var(--bg-3)', borderTop: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        {group && editingGroupId === group.id ? (
                          <input value={editingGroupName} onChange={(e) => setEditingGroupName(e.target.value)}
                            onBlur={() => saveGroupName(group.id)} onKeyDown={(e) => e.key === 'Enter' && saveGroupName(group.id)}
                            onClick={(e) => e.stopPropagation()} autoFocus
                            style={{ maxWidth: 200, padding: '0.2rem 0.4rem', fontSize: '0.9rem' }} />
                        ) : group ? (
                          <strong style={{ cursor: 'pointer', fontSize: '0.88rem' }}
                            onClick={() => { setEditingGroupId(group.id); setEditingGroupName(group.name); }}>
                            {group.name}
                          </strong>
                        ) : (
                          <span style={{ opacity: 0.6, fontSize: '0.88rem' }}>Ungrouped</span>
                        )}
                        {group && (editGroupNoteId === group.id ? (
                          <input
                            autoFocus
                            type="text"
                            value={editGroupNoteText}
                            onChange={(e) => setEditGroupNoteText(e.target.value)}
                            onBlur={() => { updateBudgetGroup(group.id, { note: editGroupNoteText || undefined }); setEditGroupNoteId(null); }}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { if (e.key === 'Enter') updateBudgetGroup(group.id, { note: editGroupNoteText || undefined }); setEditGroupNoteId(null); } }}
                            onClick={(e) => e.stopPropagation()}
                            placeholder="Add note..."
                            style={{ fontSize: '0.78rem', width: 140, padding: '1px 4px' }}
                          />
                        ) : (
                          <span
                            title={group.note ? `Note: ${group.note}` : 'Add note'}
                            style={{ cursor: 'pointer', opacity: group.note ? 0.8 : 0.25, fontSize: '0.75rem' }}
                            onClick={(e) => { e.stopPropagation(); setEditGroupNoteId(group.id); setEditGroupNoteText(group.note ?? ''); }}
                          >
                            {group.note ? '📝' : '＋'}
                          </span>
                        ))}
                        <span style={{ fontSize: '0.88rem', fontWeight: 600 }}>
                          ${formatAmount(groupTarget, 0)}
                          {groupSpent > 0 && (
                            <span style={{ fontWeight: 400, color: groupSpent > groupTarget ? 'var(--red)' : 'var(--text-2)', marginLeft: 6, fontSize: '0.78rem' }}>
                              (spent ${formatAmount(groupSpent, 0)})
                            </span>
                          )}
                        </span>
                        {isOccasional && (
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-3)', fontStyle: 'italic' }}>
                            expenses come from savings — not counted in monthly Spent or Year totals
                          </span>
                        )}
                      </div>
                      {group && (
                        <span style={{ display: 'flex', gap: 2 }}>
                          <button className="btn btn-danger btn-sm" onClick={() => deleteBudgetGroup(group.id)}>&times;</button>
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );

              // Data rows
              grpRows.forEach((r, rowIdx) => {
                const isDragged = dragCatId === r.categoryId;

                result.push(
                  <tr key={r.categoryId}
                    data-catid={r.categoryId}
                    data-groupid={thisGroupId ?? 'null'}
                    className={rowIdx % 2 === 0 ? 'budget-row-even' : 'budget-row-odd'}
                    style={{ opacity: isDragged ? 0 : 1 }}>
                      {/* Drag handle */}
                      <td style={{ cursor: 'grab', userSelect: 'none', WebkitUserSelect: 'none', width: 24, paddingLeft: 4, paddingRight: 4 } as React.CSSProperties}
                        onMouseDown={(e) => startRowDrag(e, r, thisGroupId)}>
                        <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" style={{ display: 'block', opacity: 0.4, pointerEvents: 'none' }}>
                          {([2,7,12] as number[]).map(y => ([1,6] as number[]).map(x => (
                            <circle key={`${x}-${y}`} cx={x} cy={y} r={1.4} />
                          )))}
                        </svg>
                      </td>
                      {/* Category + progress bar */}
                      <td style={{ position: 'relative', overflow: 'visible' }}>
                        <div style={{ fontSize: '0.9rem', paddingBottom: r.target > 0 ? 10 : 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span title={r.note || undefined}>{r.categoryName}</span>
                          {editNoteId === r.categoryId ? (
                            <input
                              autoFocus
                              type="text"
                              value={editNoteText}
                              onChange={(e) => setEditNoteText(e.target.value)}
                              onBlur={() => { updateCategoryNote(r.categoryId, editNoteText); setEditNoteId(null); }}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { if (e.key === 'Enter') updateCategoryNote(r.categoryId, editNoteText); setEditNoteId(null); } }}
                              placeholder="Add note..."
                              style={{ fontSize: '0.78rem', width: 140, padding: '1px 4px' }}
                            />
                          ) : (
                            <span
                              title={r.note ? `Note: ${r.note}` : 'Add note'}
                              style={{ cursor: 'pointer', opacity: r.note ? 0.8 : 0.25, fontSize: '0.75rem', flexShrink: 0 }}
                              onClick={() => { setEditNoteId(r.categoryId); setEditNoteText(r.note ?? ''); }}
                            >
                              {r.note ? '📝' : '＋'}
                            </span>
                          )}
                        </div>
                        {r.target > 0 && (() => {
                          const ratio = r.spent / r.target;
                          const barColor = ratio > 1.1 ? '#dc2626' : ratio > 1.0 ? '#d97706' : ratio === 1.0 ? '#166534' : '#16a34a';
                          const barWidth = ratio > 1
                            ? `min(${(ratio * 100).toFixed(1)}%, calc(100% + var(--bar-max-overflow, 600px)))`
                            : `${(ratio * 100).toFixed(1)}%`;
                          const trackWidth = Math.max(100, barCapInfo.catWidth - 16);
                          const isCapped = ratio > 1 && (ratio - 1) * trackWidth > barCapInfo.overflow;
                          return (
                            <div style={{ position: 'absolute', bottom: 4, left: 8, right: 8, height: 4, background: 'var(--border-2)', borderRadius: 99, overflow: 'visible' }}>
                              <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: barWidth, borderRadius: 99, background: barColor, transform: 'translateZ(0)', overflow: 'visible' }}>
                                {isCapped && (
                                  <div style={{
                                    position: 'absolute', right: -8, top: '50%', transform: 'translateY(-50%)',
                                    width: 0, height: 0,
                                    borderTop: '5px solid transparent',
                                    borderBottom: '5px solid transparent',
                                    borderLeft: `7px solid ${barColor}`,
                                    opacity: 0.55,
                                  }} />
                                )}
                              </div>
                            </div>
                          );
                        })()}
                      </td>
                      {/* Target */}
                      <td className="num budget-num">
                        {editId === r.categoryId ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
                            <input type="number" value={editTarget} onChange={(e) => setEditTarget(e.target.value)}
                              onBlur={(e) => { if (!e.relatedTarget || !(e.relatedTarget as HTMLElement).closest('.edit-past-check')) saveEdit(r.categoryId); }}
                              onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(r.categoryId); if (e.key === 'Escape') { setEditId(null); setEditPastMonths(false); } }}
                              style={{ width: 72, fontSize: '0.88rem' }} autoFocus />
                            <label className="edit-past-check" style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: '0.7rem', color: 'var(--text-2)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                              <input type="checkbox" checked={editPastMonths} onChange={(e) => setEditPastMonths(e.target.checked)} style={{ width: 11, height: 11 }} />
                              Past months too
                            </label>
                          </div>
                        ) : (
                          <span onClick={() => { setEditId(r.categoryId); setEditTarget(String(r.target)); setEditPastMonths(false); }} style={{ cursor: 'pointer' }}>
                            ${formatAmount(r.target, 0)}
                          </span>
                        )}
                      </td>
                      {/* Spent */}
                      <td className="num budget-num" style={{ color: budgetDiffColor(r.spent - r.target, r.target) }}>
                        ${formatAmount(r.spent, 0)}
                      </td>
                      {/* Left */}
                      <td className="num budget-num" style={{ color: budgetDiffColor(r.spent - r.target, r.target) }}>
                        ${formatAmount(r.target - r.spent, 0)}
                      </td>
                      {/* YTD columns */}
                      {priorMonthCount > 0 ? (
                        <>
                          <td className="num budget-num" style={{ color: budgetDiffColor(r.ytd - r.ytdTarget, r.ytdTarget) }}>${formatAmount(r.ytd, 0)}</td>
                          <td className="num budget-num">${formatAmount(r.ytdTarget, 0)}</td>
                          <td className="num budget-num" style={{ color: budgetDiffColor(r.ytdDiff, r.ytdTarget) }}>{formatDiff(r.ytdDiff)}</td>
                          <td className="num budget-num" style={{ color: budgetDiffColor(r.ytdAvgDiff, r.ytdTarget / Math.max(priorMonthCount, 1)) }}>{formatDiff(r.ytdAvgDiff)}</td>
                        </>
                      ) : (
                        <td colSpan={4} style={{ color: 'var(--text-3)', fontSize: '0.75rem', textAlign: 'center' }}>—</td>
                      )}
                      <td>
                        {confirmDeleteId === r.categoryId ? (
                          <span style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-2)' }}>Delete?</span>
                            <button className="btn btn-danger btn-sm" onClick={() => { removeBudgetItem(r.categoryId); setConfirmDeleteId(null); }}>Yes</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDeleteId(null)}>No</button>
                          </span>
                        ) : (
                          <button className="btn btn-danger btn-sm" onClick={() => setConfirmDeleteId(r.categoryId)}>&times;</button>
                        )}
                      </td>
                  </tr>
                );
              });

              // Empty group message (named groups only)
              if (grpRows.length === 0 && group !== null) {
                result.push(
                  <tr key={`empty-${thisGroupId}`}>
                    <td colSpan={COLS} style={{ textAlign: 'center', padding: '0.6rem', color: 'var(--text-3)', fontSize: '0.8rem' }}>
                      Drag items here or add above
                    </td>
                  </tr>
                );
              }

              return result;
            })}
          </tbody>
        </table>
      </div>

      {/* Income table */}
      {incomeRows.length > 0 && (
        <div className="card" style={{ marginBottom: '0.75rem' }}>
          <div className="section-title" style={{ marginTop: 0 }}>Income</div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Category</th>
                <th className="num">Expected</th>
                <th className="num">Received</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {incomeRows.map((r) => (
                <tr key={r.categoryId}>
                  <td>{r.categoryName}</td>
                  <td className="num">
                    {editId === r.categoryId ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
                        <input type="number" value={editTarget} onChange={(e) => setEditTarget(e.target.value)}
                          onBlur={(e) => { if (!e.relatedTarget || !(e.relatedTarget as HTMLElement).closest('.edit-past-check')) saveEdit(r.categoryId); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(r.categoryId); if (e.key === 'Escape') { setEditId(null); setEditPastMonths(false); } }}
                          style={{ width: 72, fontSize: '0.88rem' }} autoFocus />
                        <label className="edit-past-check" style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: '0.7rem', color: 'var(--text-2)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                          <input type="checkbox" checked={editPastMonths} onChange={(e) => setEditPastMonths(e.target.checked)} style={{ width: 11, height: 11 }} />
                          Past months too
                        </label>
                      </div>
                    ) : (
                      <span onClick={() => { setEditId(r.categoryId); setEditTarget(String(r.target)); setEditPastMonths(false); }} style={{ cursor: 'pointer' }}>
                        ${formatAmount(r.target, 0)}
                      </span>
                    )}
                  </td>
                  <td className={`num ${r.spent > 0 && r.spent >= r.target ? 'positive' : ''}`}>${formatAmount(r.spent, 0)}</td>
                  <td>
                    {confirmDeleteId === r.categoryId ? (
                      <span style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-2)' }}>Delete?</span>
                        <button className="btn btn-danger btn-sm" onClick={() => { removeBudgetItem(r.categoryId); setConfirmDeleteId(null); }}>Yes</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDeleteId(null)}>No</button>
                      </span>
                    ) : (
                      <button className="btn btn-danger btn-sm" onClick={() => setConfirmDeleteId(r.categoryId)}>&times;</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Manage groups + add item */}
      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>Budget groups</div>
        <div style={{ marginBottom: '1rem' }}>
          {showAddGroup ? (
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <div className="field">
                <label>Group name</label>
                <input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addGroup()} placeholder="Enter name" autoFocus />
              </div>
              <button className="btn btn-primary" onClick={addGroup}>Create</button>
              <button className="btn btn-ghost" onClick={() => { setShowAddGroup(false); setNewGroupName(''); }}>Cancel</button>
            </div>
          ) : (
            <button className="btn btn-ghost" onClick={() => setShowAddGroup(true)}>+ Add group</button>
          )}
        </div>
        <div className="section-title">Add budget item</div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <div className="field">
            <label>Existing category</label>
            <SearchableSelect options={categories.map((c) => ({ value: c.id, label: c.name }))}
              value={newCatId}
              onChange={(v) => { setNewCatId(v === '' ? '' : Number(v)); if (v !== '') setNewCatName(''); }}
              placeholder="Select..." />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', padding: '0 0.25rem', opacity: 0.4, alignSelf: 'flex-end', paddingBottom: '0.5rem', fontSize: '0.8rem' }}>or</div>
          <div className="field">
            <label>New category name</label>
            <input
              value={newCatName}
              onChange={(e) => { setNewCatName(e.target.value); if (e.target.value) setNewCatId(''); }}
              placeholder="Type to create new…"
              onKeyDown={(e) => e.key === 'Enter' && addBudgetItem()}
            />
          </div>
          <div className="field">
            <label>Target ($)</label>
            <input type="number" value={newTarget} onChange={(e) => setNewTarget(e.target.value)} placeholder="0"
              onKeyDown={(e) => e.key === 'Enter' && addBudgetItem()} />
          </div>
          <button className="btn btn-primary" onClick={addBudgetItem}
            disabled={!newTarget || (!newCatId && !newCatName.trim())}
            style={{ alignSelf: 'flex-end' }}>
            Add
          </button>
        </div>
      </div>

      {/* Item drag ghost — portaled to body (outside zoom), positioned via ref */}
      {ghostInfo && createPortal(
        <div ref={ghostElRef} style={{
          position: 'fixed',
          left: -9999,
          top: -9999,
          pointerEvents: 'none',
          zIndex: 9999,
          background: '#ffffff',
          border: '2px solid #1a9e8b',
          borderRadius: 8,
          padding: '0.45rem 0.85rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          boxShadow: '0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10)',
          color: '#1a2332',
          userSelect: 'none',
          whiteSpace: 'nowrap',
        }}>
          <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" style={{ opacity: 0.3, flexShrink: 0 }}>
            {([2,7,12] as number[]).map(cy => ([1,6] as number[]).map(cx => (
              <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={1.4} />
            )))}
          </svg>
          <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{ghostInfo.label}</span>
          <span style={{ fontSize: '0.85rem', color: '#666' }}>
            ${formatAmount(ghostInfo.target, 0)}
          </span>
          <span style={{ fontSize: '0.82rem', color: ghostInfo.spent > ghostInfo.target ? '#dc2626' : '#16a34a' }}>
            spent ${formatAmount(ghostInfo.spent, 0)}
          </span>
        </div>,
        document.body,
      )}

      {/* Group drag ghost — portaled to body (outside zoom), positioned via ref */}
      {groupGhostLabel && createPortal(
        <div ref={groupGhostElRef} style={{
          position: 'fixed',
          left: -9999,
          top: -9999,
          pointerEvents: 'none',
          zIndex: 9999,
          background: '#ffffff',
          border: '2px solid #1a9e8b',
          borderRadius: 8,
          padding: '0.3rem 0.75rem',
          fontSize: '0.88rem',
          fontWeight: 600,
          boxShadow: '0 6px 24px rgba(0,0,0,0.22)',
          color: '#1a2332',
          whiteSpace: 'nowrap',
          transform: 'rotate(1.5deg)',
          opacity: 0.92,
          userSelect: 'none',
        }}>
          {groupGhostLabel}
        </div>,
        document.body,
      )}
    </div>
  );
}
