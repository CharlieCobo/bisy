import Papa from 'papaparse';
import type { DB } from './schema.js';
import { insertTransaction, matchCategory, HttpError } from './finance.js';

export type DateFormat = 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'DD-MM-YYYY';

export interface CsvMapping {
  date: string;
  description: string;
  payee?: string | null;
  /** Columna única con importe con signo */
  amount?: string | null;
  /** O bien dos columnas: cargo (salida) y abono (entrada) */
  debit?: string | null;
  credit?: string | null;
  date_format: DateFormat;
  decimal: ',' | '.';
  /** Invierte el signo (útil para extractos de tarjeta donde el gasto viene positivo) */
  invert?: boolean;
  /** Filas a saltar antes de la cabecera (algunos bancos ponen texto arriba) */
  skip_rows?: number;
}

export function parseCsv(text: string, skipRows = 0) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const body = lines.slice(skipRows).join('\n');
  const res = Papa.parse<Record<string, string>>(body, {
    header: true,
    skipEmptyLines: 'greedy',
    delimiter: '', // autodetecta , ; o tabulador
    transformHeader: (h) => h.trim(),
  });
  return { headers: (res.meta.fields ?? []).filter(Boolean), rows: res.data, delimiter: res.meta.delimiter };
}

export function parseAmount(raw: string | undefined | null, decimal: ',' | '.'): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[^\d,.\-+]/g, '');
  if (s.endsWith('-')) {
    neg = !neg;
    s = s.slice(0, -1);
  }
  if (decimal === ',') s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  return neg ? -cents : cents;
}

export function parseDate(raw: string | undefined, fmt: DateFormat): string | null {
  if (!raw) return null;
  const s = raw.trim().slice(0, 10);
  let y: number, m: number, d: number;
  const parts = s.split(/[\/\-.]/).map(Number);
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) return null;
  switch (fmt) {
    case 'YYYY-MM-DD':
      [y, m, d] = parts;
      break;
    case 'MM/DD/YYYY':
      [m, d, y] = parts;
      break;
    default:
      [d, m, y] = parts;
  }
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const DATE_HINTS = ['fecha', 'date', 'f. valor', 'fecha valor', 'fecha operación', 'fecha operacion'];
const DESC_HINTS = ['concepto', 'descripción', 'descripcion', 'description', 'detalle', 'movimiento'];
const AMOUNT_HINTS = ['importe', 'amount', 'valor', 'cantidad', 'monto'];
const DEBIT_HINTS = ['cargo', 'débito', 'debito', 'debit', 'salida'];
const CREDIT_HINTS = ['abono', 'crédito', 'credito', 'credit', 'entrada'];

function find(headers: string[], hints: string[]) {
  const lower = headers.map((h) => h.toLowerCase());
  for (const hint of hints) {
    const i = lower.findIndex((h) => h === hint);
    if (i >= 0) return headers[i];
  }
  for (const hint of hints) {
    const i = lower.findIndex((h) => h.includes(hint));
    if (i >= 0) return headers[i];
  }
  return null;
}

/** Intenta adivinar el mapeo de columnas para los formatos habituales de bancos españoles y colombianos. */
export function guessMapping(headers: string[], sample: Record<string, string>[]): Partial<CsvMapping> {
  const date = find(headers, DATE_HINTS);
  const description = find(headers, DESC_HINTS);
  const amount = find(headers, AMOUNT_HINTS);
  const debit = amount ? null : find(headers, DEBIT_HINTS);
  const credit = amount ? null : find(headers, CREDIT_HINTS);
  const dateSample = date ? sample.map((r) => r[date]).find(Boolean) ?? '' : '';
  const date_format: DateFormat = /^\d{4}-/.test(dateSample) ? 'YYYY-MM-DD' : 'DD/MM/YYYY';
  const amtCol = amount ?? debit ?? credit;
  const amtSample = amtCol ? sample.map((r) => r[amtCol]).find(Boolean) ?? '' : '';
  const decimal: ',' | '.' = /,\d{1,2}$/.test(amtSample.trim()) ? ',' : '.';
  return { date: date ?? undefined, description: description ?? undefined, amount, debit, credit, date_format, decimal };
}

export function importCsv(db: DB, accountId: number, text: string, mapping: CsvMapping) {
  const acc = db.prepare('SELECT id FROM accounts WHERE id = ?').get(accountId);
  if (!acc) throw new HttpError(404, 'Cuenta no encontrada');
  if (!mapping.amount && !mapping.debit && !mapping.credit)
    throw new HttpError(400, 'Indica la columna de importe o las de cargo/abono');
  const { rows } = parseCsv(text, mapping.skip_rows ?? 0);
  let imported = 0;
  let duplicates = 0;
  const errors: Array<{ row: number; error: string }> = [];
  const seen = new Map<string, number>();
  db.exec('BEGIN');
  try {
    rows.forEach((r, i) => {
      const date = parseDate(r[mapping.date], mapping.date_format);
      let amount: number | null = null;
      if (mapping.amount) amount = parseAmount(r[mapping.amount], mapping.decimal);
      else {
        const debit = mapping.debit ? parseAmount(r[mapping.debit], mapping.decimal) : null;
        const credit = mapping.credit ? parseAmount(r[mapping.credit], mapping.decimal) : null;
        if (debit != null || credit != null) amount = (credit ? Math.abs(credit) : 0) - (debit ? Math.abs(debit) : 0);
      }
      if (!date || amount == null) {
        errors.push({ row: i + 1, error: 'Fecha o importe no válidos' });
        return;
      }
      if (mapping.invert) amount = -amount;
      const description = (r[mapping.description] ?? '').trim();
      const payee = mapping.payee ? (r[mapping.payee] ?? '').trim() || null : null;
      // Id estable para no duplicar si se importa el mismo extracto dos veces
      const base = `${date}|${amount}|${description}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      const external_id = 'csv:' + stableHash(`${base}|${n}`);
      const id = insertTransaction(db, {
        account_id: accountId,
        date,
        amount,
        description,
        payee,
        category_id: matchCategory(db, `${description} ${payee ?? ''}`),
        source: 'csv',
        external_id,
      });
      if (id) imported++;
      else duplicates++;
    });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { imported, duplicates, errors, total: rows.length };
}

/** Hash estable (cyrb53) en JS puro, para que funcione igual en Node y en el navegador. */
export function stableHash(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/** Decodifica bytes como UTF-8 y, si no es válido, como Windows-1252/Latin-1 (habitual en bancos españoles). */
export function decodeBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}
