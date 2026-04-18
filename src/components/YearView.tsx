import { useState, useMemo, useRef, useSyncExternalStore, useEffect } from 'react';
import { getData, subscribe } from '../db';
import { INCOME_CATEGORY_NAMES } from '../seed';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { formatAmount } from '../utils/format';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Title, Tooltip, Legend);

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
            pointRadius: 3,
            pointHoverRadius: 5,
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
            pointRadius: 3,
            pointHoverRadius: 5,
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
            pointRadius: 3,
            pointHoverRadius: 5,
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
            pointRadius: 3,
            pointHoverRadius: 5,
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
            pointRadius: 3,
            pointHoverRadius: 5,
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
            plugins={[verticalBoundaryPlugin as unknown as Parameters<typeof Line>[0]['plugins'] extends (infer P)[] | undefined ? P : never]}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              scales: {
                y: {
                  beginAtZero: true,
                  ticks: { color: darkMode ? '#b0bdd0' : '#555', font: { size: 14 } },
                  grid: { color: darkMode ? 'rgba(255,255,255,0.08)' : '#e5e7eb' },
                },
                x: {
                  ticks: { color: darkMode ? '#b0bdd0' : '#555', font: { size: 14 } },
                  grid: { color: darkMode ? 'rgba(255,255,255,0.08)' : '#e5e7eb' },
                },
              },
              plugins: {
                legend: {
                  labels: { color: darkMode ? '#e8ecf4' : '#1a2332', font: { size: 14 }, padding: 20 },
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
    </div>
  );
}
