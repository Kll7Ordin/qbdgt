import type { Transaction } from '../db';

const NOISE = [
  /^delivered/i, /^return or replace/i, /^buy again/i,
  /^track package/i, /^get product support/i, /^write a product review/i,
  /^leave .* feedback/i, /^view order detail/i, /^archive order/i,
  /^not yet shipped/i, /^arriving/i, /^package was/i,
  /^view return/i, /^refund/i,
];

const MONTH_MAP: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12',
};

function parseAmazonDate(raw: string): string | null {
  const m = raw.match(/(\w+)\s+(\d{1,2}),?\s*(\d{4})/);
  if (!m) return null;
  const month = MONTH_MAP[m[1].toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${month}-${m[2].padStart(2, '0')}`;
}

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.−-]/g, '').replace(/−/g, '-');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function isNoiseLine(line: string): boolean {
  return NOISE.some((re) => re.test(line));
}

export function parseAmazonPaste(text: string): Omit<Transaction, 'id'>[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const results: Omit<Transaction, 'id'>[] = [];

  let i = 0;
  while (i < lines.length) {
    if (!/^order\s+placed$/i.test(lines[i])) {
      i++;
      continue;
    }
    i++;

    let txnDate: string | null = null;
    let amount: number | null = null;
    let orderNum = '';
    const itemLines: string[] = [];

    while (i < lines.length && !/^order\s+placed$/i.test(lines[i])) {
      const line = lines[i];

      if (!txnDate) {
        const d = parseAmazonDate(line);
        if (d) { txnDate = d; i++; continue; }
      }

      if (amount === null && /^(total\s*)?[$€]/.test(line)) {
        const a = parseAmount(line.replace(/^total\s*/i, ''));
        if (a !== null) { amount = a; i++; continue; }
      }
      if (amount === null && /^total$/i.test(line)) {
        i++;
        if (i < lines.length) {
          const a = parseAmount(lines[i]);
          if (a !== null) { amount = a; i++; continue; }
        }
        continue;
      }

      const orderMatch = line.match(/order\s*#\s*([\w-]+)/i);
      if (orderMatch) { orderNum = orderMatch[1]; i++; continue; }

      if (!isNoiseLine(line) && line.length > 5) {
        itemLines.push(line);
      }
      i++;
    }

    if (txnDate && amount !== null) {
      const bestItem = itemLines.sort((a, b) => b.length - a.length)[0] ?? '';
      const descParts = ['Amazon'];
      if (bestItem) descParts.push(bestItem);
      if (orderNum) descParts.push(`#${orderNum}`);

      results.push({
        source: 'amazon_paste',
        sourceRef: 'paste',
        txnDate,
        amount,
        instrument: 'Amazon',
        descriptor: descParts.join(' | '),
        categoryId: null,
        linkedTransactionId: null,
        ignoreInBudget: false,
      });
    }
  }

  return results;
}
