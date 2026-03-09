import { useState, useMemo, useRef, useSyncExternalStore } from 'react';
import { getData, subscribe } from '../db';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

function monthsOfYear(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) =>
    `${year}-${String(i + 1).padStart(2, '0')}`
  );
}

interface MonthData {
  month: string;
  planned: number;
  actual: number;
}

export function YearView() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [selectedCats, setSelectedCats] = useState<number[]>([]);
  const [scope, setScope] = useState<'overall' | 'categories'>('overall');
  const chartRef = useRef(null);
  const appData = useSyncExternalStore(subscribe, getData);
  const categories = appData.categories;

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

    return months.map((m) => {
      const mBudgets = allBudgets.filter((b) =>
        b.month === m && (!filterCats || filterCats.has(b.categoryId))
      );
      const planned = mBudgets.reduce((s, b) => s + b.targetAmount, 0);

      const mTxns = allTxns.filter((t) =>
        t.txnDate.startsWith(m) && !t.ignoreInBudget
      );

      let actual = 0;
      for (const t of mTxns) {
        const splits = splitsByTxn.get(t.id);
        if (splits && splits.length > 0) {
          for (const s of splits) {
            if (!filterCats || filterCats.has(s.categoryId)) {
              actual += s.amount;
            }
          }
        } else if (t.categoryId && (!filterCats || filterCats.has(t.categoryId))) {
          actual += t.amount;
        }
      }

      return { month: m, planned, actual };
    });
  }, [appData, year, scope, selectedCats]);

  const monthLabels = data.map((d) => d.month.split('-')[1]);

  const chartData = {
    labels: monthLabels,
    datasets: [
      {
        label: 'Planned',
        data: data.map((d) => d.planned),
        borderColor: '#3b82f6',
        backgroundColor: '#3b82f644',
        tension: 0.3,
      },
      {
        label: 'Actual',
        data: data.map((d) => d.actual),
        borderColor: '#ef4444',
        backgroundColor: '#ef444444',
        tension: 0.3,
      },
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
              <th className="num">Planned</th>
              <th className="num">Actual</th>
              <th className="num">Variance</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => {
              const v = d.planned - d.actual;
              return (
                <tr key={d.month}>
                  <td>{d.month}</td>
                  <td className="num">${d.planned.toFixed(0)}</td>
                  <td className="num">${d.actual.toFixed(0)}</td>
                  <td className={`num ${v >= 0 ? 'positive' : 'negative'}`}>${v.toFixed(0)}</td>
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
          {categories.map((c) => (
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

      <div className="card">
        <div className="chart-container">
          <Line
            ref={chartRef}
            data={chartData}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              scales: {
                y: { beginAtZero: true, ticks: { color: '#888' }, grid: { color: '#333' } },
                x: { ticks: { color: '#888' }, grid: { color: '#222' } },
              },
              plugins: { legend: { labels: { color: '#ccc' } } },
            }}
          />
        </div>
      </div>
    </div>
  );
}
