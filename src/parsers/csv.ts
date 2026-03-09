import type { Transaction } from '../db';

function parseDate(raw: string): string {
  const trimmed = raw.trim();
  const parts = trimmed.split('/');
  if (parts.length === 3) {
    const [m, d, y] = parts;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const dashed = trimmed.split('-');
  if (dashed.length === 3) {
    const [y, m, d] = dashed;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return trimmed;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

export function parseBankCsv(
  text: string,
  filename: string,
): Omit<Transaction, 'id'>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const results: Omit<Transaction, 'id'>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    if (fields.length < 5) continue;

    const [dateRaw, desc, subDesc, , amountRaw] = fields;
    if (!dateRaw || !amountRaw) continue;

    const amount = parseFloat(amountRaw.replace(/[,$]/g, ''));
    if (isNaN(amount)) continue;

    const descriptor = [desc, subDesc].filter(Boolean).join(' ').trim();

    results.push({
      source: 'bank_csv',
      sourceRef: filename,
      txnDate: parseDate(dateRaw),
      amount: Math.abs(amount),
      instrument: filename.replace(/\.csv$/i, ''),
      descriptor,
      categoryId: null,
      linkedTransactionId: null,
      ignoreInBudget: amount < 0,
      comment: null,
    });
  }

  return results;
}
