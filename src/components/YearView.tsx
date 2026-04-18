import { useState, useMemo, useRef, useSyncExternalStore, useEffect } from 'react';
import { getData, subscribe } from '../db';
import { INCOME_CATEGORY_NAMES } from '../seed';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  Filler,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line, Pie } from 'react-chartjs-2';
import { formatAmount } from '../utils/format';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, ArcElement, Filler, Title, Tooltip, Legend);

const PIE_COLORS = [
  '#3b82f6', '#ef4444', '#16a34a', '#d97706', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f59e0b', '#10b981', '#6366f1',
  '#f43f5e', '#84cc16', '#0ea5e9', '#a855f7', '#fb923c',
];

function mostRecentCompletedMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthsOfYear(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) =>
    `${year}-${String(i + 1).padStart(2, '0')}`
  );
}

interface MonthData {
  month: string;
  planned: number;
  actual: number;
  income: number;
  savings: number; // Occasional group spending
}

interface YearNavFilter {
  categoryId?: number;
  scope?: 'overall' | 'categories';
}

interface YearViewProps {
  navFilter?: YearNavFilter | null;
  onNavConsumed?: () => void;
  darkMode?: boolean;
}

export function YearView({ navFilter, onNavConsumed, darkMode = false }: YearViewProps) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [selectedCats, setSelectedCats] = useState<number[]>([]);
  const [scope, setScope] = useState<'overall' | 'categories'>('overall');
  const [pieScope, setPieScope] = useState<'ytd' | 'month'>('ytd');
  const [piePeriod, setPiePeriod] = useState<string>(mostRecentCompletedMonth);
  const [pieGrouping, setPieGrouping] = useState<'group' | 'category'>('group');
  const chartRef = useRef(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const appData = useSyncExternalStore(subscribe, getData);
  const categories = appData.categories;
  const navFilterApplied = useRef(false);

  // Apply nav filter from external navigation (e.g. clicking chart icon in Budget view)
  useEffect(() => {
    if (navFilter && !navFilterApplied.current) {
      navFilterApplied.current = true;
      if (navFilter.scope) setScope(navFilter.scope);
      if (navFilter.categoryId != null) setSelectedCats([navFilter.categoryId]);
      onNavConsumed?.();
      // Scroll to line chart after React re-renders with new category selection
      setTimeout(() => {
        const el = chartContainerRef.current;
        if (el) {
          const rect = el.getBoundingClientRect();
          const scrollTop = window.scrollY + rect.top - 70;
          window.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' });
        }
      }, 500);
    }
    if (!navFilter) navFilterApplied.current = false;
  }, [navFilter, onNavConsumed]);

  const data: MonthData[] = useMemo(() => {
    const { budgets: allBudgets, transactions: allTxns, transactionSplits: allSplits } = appData;
    const months = monthsOfYear(year);

    const splitsByTxn = new Map<number, typeof allSplits>();
    for (const s of allSplits) {
      const arr = splitsByTxn.get(s.transactionId) ?? [];
      arr.push(s);
      splitsByTxn.set(s.transactionId, arr);
    }

    const filterCats = scope === 'categories' && selectedCats.length > 0
      ? new Set(selectedCats)
      : null;

    // Income categories
    const incomeCatIds = new Set(
      categories
        .filter((c) => c.isIncome || INCOME_CATEGORY_NAMES.has(c.name))
        .map((c) => c.id),
    );

    // Occasional group categories (Savings spending — excluded from regular Actual)
    const occasionalGroupId = appData.budgetGroups?.find((g) => g.name === 'Occasional')?.id;
    const occasionalCatIds = new Set(
      occasionalGroupId != null
        ? allBudgets.filter((b) => b.groupId === occasionalGroupId).map((b) => b.categoryId)
        : [],
    );

    return months.map((m) => {
      const mBudgets = allBudgets.filter((b) =>
        b.month === m && (!filterCats || filterCats.has(b.categoryId))
      );
      const budgetedExpenseCatIds = new Set(
        mBudgets.filter((b) => !incomeCatIds.has(b.categoryId)).map((b) => b.categoryId)
      );
      // Planned excludes Occasional (savings spending) so variance reflects regular budget
      const planned = mBudgets
        .filter((b) => !incomeCatIds.has(b.categoryId) && !occasionalCatIds.has(b.categoryId))
        .reduce((s, b) => s + b.targetAmount, 0);

      let actual = 0;
      let income = 0;
      let savings = 0;
      for (const t of allTxns) {
        const splits = splitsByTxn.get(t.id);
        if (splits && splits.length > 0) {
          for (const s of splits) {
            const effectiveDate = s.txnDate ?? t.txnDate;
            if (!effectiveDate.startsWith(m)) continue;
            if (incomeCatIds.has(s.categoryId)) {
              if (t.ignoreInBudget) income += s.amount;
            } else if (budgetedExpenseCatIds.has(s.categoryId)) {
              if (occasionalCatIds.has(s.categoryId)) {
                if (!t.ignoreInBudget) savings += s.amount;
              } else if (!t.ignoreInBudget) {
                actual += s.amount;
              }
            }
          }
        } else if (t.categoryId) {
          if (!t.txnDate.startsWith(m)) continue;
          if (incomeCatIds.has(t.categoryId)) {
            if (t.ignoreInBudget) income += t.amount;
          } else if (budgetedExpenseCatIds.has(t.categoryId)) {
            if (occasionalCatIds.has(t.categoryId)) {
              if (!t.ignoreInBudget) savings += t.amount;
            } else if (!t.ignoreInBudget) {
              actual += t.amount;
            }
          }
        }
      }

      return { month: m, planned, actual, income, savings };
    });
  }, [appData, year, scope, selectedCats]);

  const monthLabels = data.map((d) => d.month.split('-')[1]);

  const todayMonth = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
  const isCompleted = (m: string) => m < todayMonth;

  // Determine if selected cats are savings (occasional) categories
  const occasionalGroupId2 = appData.budgetGroups?.find((g) => g.name.toLowerCase().includes('occasional'))?.id;
  const occasionalCatIds2 = new Set(
    occasionalGroupId2 != null
      ? appData.budgets.filter((b) => b.groupId === occasionalGroupId2).map((b) => b.categoryId)
      : [],
  );
  const categoryFilterActive = scope === 'categories' && selectedCats.length > 0;
  const selectedAreSavings = categoryFilterActive && selectedCats.every((id) => occasionalCatIds2.has(id));
  const selectedIncludeSavings = categoryFilterActive && selectedCats.some((id) => occasionalCatIds2.has(id));

  // Last month with actual data
  const lastDataIdx = data.reduce((best, d, i) => (isCompleted(d.month) && d.actual > 0 ? i : best), -1);

  // Cap planned: only show through the last month with actual data
  const cappedPlanned = data.map((d, i) => {
    if (i > lastDataIdx) return null;
    return d.planned;
  });

  const pieChartData = useMemo(() => {
    const { budgets: allBudgets, transactions: allTxns, transactionSplits: allSplits, budgetGroups } = appData;

    const months = pieScope === 'ytd'
      ? monthsOfYear(year).filter((m) => m < todayMonth)
      : [piePeriod];
    const monthSet = new Set(months);
    if (monthSet.size === 0) return { labels: [], values: [] };

    const incomeCatIds = new Set(
      categories.filter((c) => c.isIncome || INCOME_CATEGORY_NAMES.has(c.name)).map((c) => c.id),
    );

    const splitsByTxn = new Map<number, typeof allSplits>();
    for (const s of allSplits) {
      const arr = splitsByTxn.get(s.transactionId) ?? [];
      arr.push(s);
      splitsByTxn.set(s.transactionId, arr);
    }

    const spendByCat = new Map<number, number>();
    for (const t of allTxns) {
      if (t.ignoreInBudget) continue;
      const splits = splitsByTxn.get(t.id);
      if (splits && splits.length > 0) {
        for (const s of splits) {
          const effectiveDate = s.txnDate ?? t.txnDate;
          if (!monthSet.has(effectiveDate.slice(0, 7))) continue;
          if (incomeCatIds.has(s.categoryId)) continue;
          spendByCat.set(s.categoryId, (spendByCat.get(s.categoryId) ?? 0) + s.amount);
        }
      } else if (t.categoryId) {
        if (!monthSet.has(t.txnDate.slice(0, 7))) continue;
        if (incomeCatIds.has(t.categoryId)) continue;
        spendByCat.set(t.categoryId, (spendByCat.get(t.categoryId) ?? 0) + t.amount);
      }
    }

    if (pieGrouping === 'category') {
      const entries = [...spendByCat.entries()]
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1]);
      return {
        labels: entries.map(([catId]) => categories.find((c) => c.id === catId)?.name ?? '?'),
        values: entries.map(([, v]) => v),
      };
    } else {
      const groupIdToName = new Map<number, string>((budgetGroups ?? []).map((g: { id: number; name: string }) => [g.id, g.name]));
      const catToGroup = new Map<number, number | null>();
      for (const b of allBudgets) {
        if (!catToGroup.has(b.categoryId)) {
          catToGroup.set(b.categoryId, b.groupId ?? null);
        }
      }
      const spendByGroup = new Map<string, number>();
      for (const [catId, amount] of spendByCat) {
        const groupId = catToGroup.get(catId);
        const groupName = groupId != null ? (groupIdToName.get(groupId) ?? 'Other') : 'Other';
        spendByGroup.set(groupName, (spendByGroup.get(groupName) ?? 0) + amount);
      }
      const entries = [...spendByGroup.entries()]
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1]);
      return {
        labels: entries.map(([name]) => name),
        values: entries.map(([, v]) => v),
      };
    }
  }, [appData, year, pieScope, piePeriod, pieGrouping, categories, todayMonth]);

  // Data labels plugin — draws values on each point, avoiding overlaps
  const dataLabelsPlugin = {
    id: 'dataLabels',
    afterDatasetsDraw(chart: any) {
      const ctx: CanvasRenderingContext2D = chart.ctx;
      const fontSize = 12;
      ctx.save();
      ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';

      // Collect all visible points grouped by x-index
      const byIndex = new Map<number, Array<{ x: number; y: number; val: number; color: string }>>();
      chart.data.datasets.forEach((dataset: any, di: number) => {
        const meta = chart.getDatasetMeta(di);
        if (meta.hidden) return;
        (dataset.data as (number | null)[]).forEach((val, idx) => {
          if (val == null) return;
          const pt = meta.data[idx];
          if (!pt || pt.skip) return;
          const arr = byIndex.get(idx) ?? [];
          arr.push({ x: pt.x, y: pt.y, val, color: dataset.borderColor as string });
          byIndex.set(idx, arr);
        });
      });

      const labelH = fontSize + 18; // generous vertical gap to avoid collisions
      const placed: Array<{ cx: number; cy: number; w: number; h: number }> = [];

      function overlaps(cx: number, cy: number, w: number) {
        return placed.some(
          (p) =>
            Math.abs(p.cx - cx) < (p.w + w) / 2 + 6 &&
            Math.abs(p.cy - cy) < (p.h + labelH) / 2 + 4,
        );
      }

      byIndex.forEach((points) => {
        // Process top-to-bottom (smallest canvas y = highest on screen first)
        points.sort((a, b) => a.y - b.y);
        points.forEach((pt) => {
          const text = `$${formatAmount(pt.val, 0)}`;
          const w = ctx.measureText(text).width + 8;
          // Try above the point first, then below, then further out
          const tries = [
            pt.y - labelH,
            pt.y + labelH,
            pt.y - labelH * 2,
            pt.y + labelH * 2,
            pt.y - labelH * 3,
            pt.y + labelH * 3,
          ];
          let cy = tries[0];
          for (const t of tries) {
            if (!overlaps(pt.x, t, w)) { cy = t; break; }
          }
          placed.push({ cx: pt.x, cy, w, h: labelH });
          ctx.fillStyle = pt.color;
          ctx.fillText(text, pt.x, cy);
        });
      });

      ctx.restore();
    },
  };

  // Vertical boundary plugin for Chart.js
  const verticalBoundaryPlugin = {
    id: 'verticalBoundary',
    afterDraw(chart: { ctx: CanvasRenderingContext2D; scales: { x: { getPixelForValue: (v: number) => number }; chartArea: { top: number; bottom: number } }; chartArea: { top: number; bottom: number } }) {
      if (lastDataIdx < 0) return;
      const ctx = chart.ctx;
      const xScale = chart.scales['x'] as { getPixelForValue: (v: number) => number };
      const chartArea = chart.chartArea;
      // Draw at the gap between last data month and next
      const xLeft = xScale.getPixelForValue(lastDataIdx);
      const xRight = xScale.getPixelForValue(lastDataIdx + 1);
      const x = (xLeft + xRight) / 2;
      ctx.save();
      ctx.strokeStyle = 'rgba(100,100,100,0.35)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.restore();
    },
  };

  const chartData = {
    labels: monthLabels,
    datasets: selectedAreSavings
      ? [
          {
            label: 'Spent from Savings',
            data: data.map((d) => isCompleted(d.month) ? d.savings : null),
            borderColor: '#d97706',
            backgroundColor: 'rgba(217,119,6,0.15)',
            tension: 0.35,
            spanGaps: false,
            borderWidth: 2.5,
            fill: true,
            pointRadius: 4,
            pointHoverRadius: 6,
          },
        ]
      : [
          {
            label: 'Planned',
            data: cappedPlanned,
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59,130,246,0.12)',
            tension: 0.35,
            borderWidth: 2.5,
            spanGaps: false,
            fill: true,
            pointRadius: 4,
            pointHoverRadius: 6,
          },
          {
            label: 'Actual',
            data: data.map((d) => isCompleted(d.month) ? d.actual : null),
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239,68,68,0.12)',
            tension: 0.35,
            spanGaps: false,
            borderWidth: 2.5,
            fill: true,
            pointRadius: 4,
            pointHoverRadius: 6,
          },
          ...(!categoryFilterActive || selectedIncludeSavings ? [{
            label: 'Spent from Savings',
            data: data.map((d) => isCompleted(d.month) ? d.savings : null),
            borderColor: '#d97706',
            backgroundColor: 'rgba(217,119,6,0.12)',
            tension: 0.35,
            spanGaps: false,
            borderWidth: 2.5,
            fill: true,
            pointRadius: 4,
            pointHoverRadius: 6,
          }] : []),
          ...(scope === 'overall' ? [{
            label: 'Income',
            data: data.map((d) => isCompleted(d.month) ? d.income : null),
            borderColor: '#16a34a',
            backgroundColor: 'rgba(22,163,74,0.12)',
            tension: 0.35,
            spanGaps: false,
            borderWidth: 2.5,
            fill: true,
            pointRadius: 4,
            pointHoverRadius: 6,
          }] : []),
        ],
  };

  function toggleCat(id: number) {
    setSelectedCats((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  }

  return (
    <div>
      <h1 className="view-title">Year View</h1>

      <div className="month-nav">
        <button className="btn btn-ghost btn-sm" onClick={() => setYear((y) => y - 1)}>&lt;</button>
        <span style={{ fontWeight: 700 }}>{year}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => setYear((y) => y + 1)}>&gt;</button>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Month</th>
              <th className="num">Income</th>
              <th className="num">Planned</th>
              <th className="num">Actual</th>
              <th className="num">Variance</th>
              <th className="num">Spent from Savings</th>
            </tr>
          </thead>
          <tbody>
            {data.filter((d) => d.planned > 0 || d.actual > 0 || d.income > 0 || d.savings > 0 || d.month === todayMonth).map((d, i) => {
              const completed = isCompleted(d.month);
              const v = d.planned - d.actual;
              return (
                <tr key={d.month} className={i % 2 === 0 ? 'budget-row-even' : 'budget-row-odd'} style={!completed ? { color: 'var(--text-3)' } : undefined}>
                  <td>{d.month}</td>
                  <td className="num budget-num positive">{completed && d.income > 0 ? `$${formatAmount(d.income, 0)}` : '—'}</td>
                  <td className="num budget-num">${formatAmount(d.planned, 0)}</td>
                  <td className="num budget-num">{completed ? `$${formatAmount(d.actual, 0)}` : '—'}</td>
                  <td className={`num budget-num ${completed ? (v >= 0 ? 'positive' : 'negative') : ''}`}>{completed ? `$${formatAmount(v, 0)}` : '—'}</td>
                  <td className="num budget-num" style={{ color: completed ? 'var(--yellow)' : undefined }}>{completed && d.savings > 0 ? `$${formatAmount(d.savings, 0)}` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="section-title">Spending Trends</div>

      <div className="row" style={{ marginBottom: '0.5rem', flexWrap: 'wrap' }}>
        <button
          className={`btn btn-sm ${scope === 'overall' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setScope('overall')}
        >
          Overall
        </button>
        <button
          className={`btn btn-sm ${scope === 'categories' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setScope('categories')}
        >
          By Category
        </button>
      </div>

      {scope === 'categories' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginBottom: '0.5rem' }}>
          {[...categories].sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
            <button
              key={c.id}
              className={`btn btn-sm ${selectedCats.includes(c.id) ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => toggleCat(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      <div className="card" ref={chartContainerRef}>
        <div className="chart-container">
          <Line
            ref={chartRef}
            data={chartData}
            plugins={[verticalBoundaryPlugin, dataLabelsPlugin] as unknown as Parameters<typeof Line>[0]['plugins'] extends (infer P)[] | undefined ? P[] : never}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              scales: {
                y: {
                  beginAtZero: true,
                  ticks: { color: darkMode ? '#b0bdd0' : '#555', font: { size: 16 } },
                  grid: { color: darkMode ? 'rgba(255,255,255,0.08)' : '#e5e7eb' },
                },
                x: {
                  ticks: { color: darkMode ? '#b0bdd0' : '#555', font: { size: 16 } },
                  grid: { color: darkMode ? 'rgba(255,255,255,0.08)' : '#e5e7eb' },
                },
              },
              plugins: {
                legend: {
                  labels: { color: darkMode ? '#e8ecf4' : '#1a2332', font: { size: 16 }, padding: 20 },
                },
                tooltip: {
                  backgroundColor: darkMode ? '#1a1d27' : '#fff',
                  titleColor: darkMode ? '#e8ecf4' : '#1a2332',
                  bodyColor: darkMode ? '#b0bdd0' : '#4a5568',
                  borderColor: darkMode ? '#2e3347' : '#d0d5dd',
                  borderWidth: 1,
                  padding: 10,
                  callbacks: {
                    label: (ctx) => ` ${ctx.dataset.label}: $${formatAmount(ctx.parsed.y ?? 0, 0)}`,
                  },
                },
              },
            }}
          />
        </div>
      </div>

      <div className="section-title" style={{ marginTop: '1.5rem' }}>Spending Breakdown</div>

      <div className="row" style={{ marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          <button
            className={`btn btn-sm ${pieScope === 'ytd' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setPieScope('ytd')}
          >
            YTD
          </button>
          <button
            className={`btn btn-sm ${pieScope === 'month' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setPieScope('month')}
          >
            Month
          </button>
        </div>
        {pieScope === 'month' && (
          <select
            value={piePeriod}
            onChange={(e) => setPiePeriod(e.target.value)}
            style={{ fontSize: '0.85rem', padding: '0.2rem 0.4rem' }}
          >
            {monthsOfYear(year).filter((m) => m < todayMonth).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        )}
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          <button
            className={`btn btn-sm ${pieGrouping === 'group' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setPieGrouping('group')}
          >
            By Group
          </button>
          <button
            className={`btn btn-sm ${pieGrouping === 'category' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setPieGrouping('category')}
          >
            By Category
          </button>
        </div>
      </div>

      {pieChartData.labels.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', opacity: 0.5, padding: '2rem' }}>
          No spending data for this period.
        </div>
      ) : (
        <div className="card">
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ maxWidth: 360, width: '100%', aspectRatio: '1', flex: '0 0 auto' }}>
              <Pie
                data={{
                  labels: pieChartData.labels,
                  datasets: [{
                    data: pieChartData.values,
                    backgroundColor: PIE_COLORS.slice(0, pieChartData.labels.length),
                    borderWidth: 1,
                    borderColor: darkMode ? '#1a1d27' : '#fff',
                  }],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: true,
                  plugins: {
                    legend: { display: false },
                    tooltip: {
                      backgroundColor: darkMode ? '#1a1d27' : '#fff',
                      titleColor: darkMode ? '#e8ecf4' : '#1a2332',
                      bodyColor: darkMode ? '#b0bdd0' : '#4a5568',
                      borderColor: darkMode ? '#2e3347' : '#d0d5dd',
                      borderWidth: 1,
                      padding: 10,
                      callbacks: {
                        label: (ctx) => {
                          const total = (ctx.dataset.data as number[]).reduce((s, v) => s + v, 0);
                          const pct = total > 0 ? Math.round((ctx.parsed / total) * 100) : 0;
                          return ` $${formatAmount(ctx.parsed, 0)} (${pct}%)`;
                        },
                      },
                    },
                  },
                }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              {pieChartData.labels.map((label, i) => {
                const total = pieChartData.values.reduce((s, v) => s + v, 0);
                const pct = total > 0 ? Math.round((pieChartData.values[i] / total) * 100) : 0;
                return (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0', fontSize: '0.875rem' }}>
                    <span style={{ width: 12, height: 12, borderRadius: 3, background: PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0 }} />
                    <span style={{ flex: 1 }}>{label}</span>
                    <span style={{ opacity: 0.6, fontSize: '0.8rem' }}>{pct}%</span>
                    <span style={{ fontWeight: 600 }}>${formatAmount(pieChartData.values[i], 0)}</span>
                  </div>
                );
              })}
              <div style={{ borderTop: '1px solid var(--border)', marginTop: '0.5rem', paddingTop: '0.5rem', display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '0.875rem' }}>
                <span>Total</span>
                <span>${formatAmount(pieChartData.values.reduce((s, v) => s + v, 0), 0)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
