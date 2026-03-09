import type { Transaction } from '../db';

const MONTH_MAP: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04',
  may: '05', jun: '06', jul: '07', aug: '08',
  sep: '09', oct: '10', nov: '11', dec: '12',
  january: '01', february: '02', march: '03', april: '04',
  june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12',
};

function parsePeriodHeader(line: string): { month: string; year: string } | null {
  const m = line.match(/^(\w+)\s+(\d{4})$/);
  if (!m) return null;
  const month = MONTH_MAP[m[1].toLowerCase()];
  if (!month) return null;
  return { month, year: m[2] };
}

function parseAmount(raw: string): number | null {
  let s = raw.replace(/\u2212/g, '-').replace(/[€$,\s]/g, '');
  s = s.replace(/[^0-9.-]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function parseDateLine(line: string, year: string): { date: string; type: string } | null {
  const m = line.match(/^(\w{3})\s+(\d{1,2})\s*\.\s*(.+)/);
  if (!m) return null;
  const month = MONTH_MAP[m[1].toLowerCase()];
  if (!month) return null;
  return {
    date: `${year}-${month}-${m[2].padStart(2, '0')}`,
    type: m[3].trim(),
  };
}

export function parsePaypalPaste(text: string): Omit<Transaction, 'id'>[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const results: Omit<Transaction, 'id'>[] = [];

  let currentYear = new Date().getFullYear().toString();
  let i = 0;

  while (i < lines.length) {
    const period = parsePeriodHeader(lines[i]);
    if (period) {
      currentYear = period.year;
      i++;
      continue;
    }

    const merchant = lines[i];
    if (i + 2 >= lines.length) { i++; continue; }

    const amountRaw = lines[i + 1];
    const amount = parseAmount(amountRaw);
    if (amount === null) { i++; continue; }

    const dateInfo = parseDateLine(lines[i + 2], currentYear);
    if (!dateInfo) { i++; continue; }

    i += 3;

    let detail = '';
    if (i < lines.length && lines[i].startsWith('"')) {
      detail = lines[i].replace(/^"|"$/g, '');
      i++;
    }

    const descParts = ['PayPal', merchant, dateInfo.type];
    if (detail) descParts.push(detail);

    results.push({
      source: 'paypal_paste',
      sourceRef: 'paste',
      txnDate: dateInfo.date,
      amount: Math.abs(amount),
      instrument: 'PayPal',
      descriptor: descParts.join(' | '),
      categoryId: null,
      linkedTransactionId: null,
      ignoreInBudget: amount < 0,
    });
  }

  return results;
}
