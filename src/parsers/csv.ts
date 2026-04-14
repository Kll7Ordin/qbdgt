import type { Transaction } from '../db';

/** Infer display instrument from filename (e.g. Scotia_Momentum_VISA_... -> Card). */
function inferInstrumentFromFilename(filename: string): string {
  const base = filename.replace(/\.csv$/i, '').toLowerCase();
  if (/amazon/.test(base)) return 'Amazon';
  if (/paypal/.test(base)) return 'PayPal';
  if (/visa|mastercard|master.?card|momentum|credit.?card|\bcard\b/.test(base)) return 'Card';
  if (/chequing|checking|cheq/.test(base)) return 'Chequing';
  return 'Card'; // default for bank CSV (credit card exports are common)
}

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
  const headerFields = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const findIndex = (...names: string[]) =>
    headerFields.findIndex((h) => names.includes(h));

  // Newer exports include a leading "Filter" column. Use header-based mapping first.
  const dateIndex = findIndex('date');
  const descIndex = findIndex('description');
  const subDescIndex = findIndex('sub-description', 'sub description');
  const amountIndex = findIndex('amount');
  const typeIndex = findIndex('type of transaction', 'type');

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    if (fields.length < 5) continue;

    let dateRaw = '';
    let desc = '';
    let subDesc = '';
    let amountRaw = '';
    let typeRaw = '';

    if (dateIndex !== -1 && descIndex !== -1 && amountIndex !== -1) {
      dateRaw = fields[dateIndex] ?? '';
      desc = fields[descIndex] ?? '';
      subDesc = subDescIndex !== -1 ? (fields[subDescIndex] ?? '') : '';
      amountRaw = fields[amountIndex] ?? '';
      typeRaw = typeIndex !== -1 ? (fields[typeIndex] ?? '').trim().toLowerCase() : '';
    } else {
      // Backward-compatible fallback for legacy CSV shape.
      [dateRaw, desc, subDesc, , amountRaw] = fields;
    }

    if (!dateRaw || !amountRaw) continue;

    const amount = parseFloat(amountRaw.replace(/[,$]/g, ''));
    if (isNaN(amount)) continue;

    const descriptor = [desc, subDesc].filter(Boolean).join(' ').trim();

    // Credit = income (ignoreInBudget true), Debit = expense (ignoreInBudget false).
    // Use "Type of Transaction" when present; otherwise fall back to amount sign (credit card style: negative = credit).
    let ignoreInBudget: boolean;
    if (typeRaw === 'credit') {
      ignoreInBudget = true;
    } else if (typeRaw === 'debit') {
      ignoreInBudget = false;
    } else {
      ignoreInBudget = amount < 0; // legacy: negative = credit (e.g. credit card payments)
    }

    results.push({
      source: 'bank_csv',
      sourceRef: filename,
      txnDate: parseDate(dateRaw),
      amount: Math.abs(amount),
      instrument: inferInstrumentFromFilename(filename),
      descriptor,
      categoryId: null,
      linkedTransactionId: null,
      ignoreInBudget,
      comment: null,
    });
  }

  return results;
}
