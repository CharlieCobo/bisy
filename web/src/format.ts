const fmtCache = new Map<string, Intl.NumberFormat>();

/** Formatea céntimos como moneda. COP se muestra sin decimales. */
export function money(cents: number, currency: string, opts: { compact?: boolean; sign?: boolean } = {}) {
  const key = `${currency}|${opts.compact}|${opts.sign}`;
  let f = fmtCache.get(key);
  if (!f) {
    const noDecimals = currency === 'COP' || opts.compact;
    f = new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency,
      notation: opts.compact ? 'compact' : 'standard',
      minimumFractionDigits: noDecimals ? 0 : 2,
      maximumFractionDigits: noDecimals ? (opts.compact ? 1 : 0) : 2,
      signDisplay: opts.sign ? 'exceptZero' : 'auto',
      useGrouping: 'always' as any,
    });
    fmtCache.set(key, f);
  }
  return f.format(cents / 100 || 0); // evita "-0,00"
}

/**
 * Convierte texto introducido por el usuario a céntimos.
 * Acepta formato español ("1.234,56", "1.500") e inglés ("1,234.56", "12.5").
 */
export function parseMoney(input: string): number | null {
  let s = input.trim().replace(/[^\d,.\-]/g, '');
  if (!s) return null;
  const comma = s.lastIndexOf(',');
  const dot = s.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    // El último separador es el decimal
    s = comma > dot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (comma >= 0) {
    s = s.replace(',', '.');
  } else if (dot >= 0 && (s.split('.').length > 2 || /\.\d{3}$/.test(s))) {
    s = s.replace(/\./g, ''); // "1.500" o "1.500.000" = separador de miles
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function centsToInput(cents: number) {
  return (cents / 100).toLocaleString('es-ES', { useGrouping: false, maximumFractionDigits: 2 });
}

export function pct(r: number, digits = 0) {
  return `${(r * 100).toFixed(digits)} %`;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function monthLabel(m: string, long = false) {
  const [y, mm] = m.split('-').map(Number);
  return long ? `${MONTHS_LONG[mm - 1]} ${y}` : `${MONTHS[mm - 1]} ${String(y).slice(2)}`;
}

export function dateLabel(d: string) {
  const [y, m, day] = d.split('-').map(Number);
  return `${day} ${MONTHS[m - 1]} ${y}`;
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function thisMonth() {
  return today().slice(0, 7);
}

export function shiftMonth(m: string, delta: number) {
  const [y, mm] = m.split('-').map(Number);
  const d = new Date(y, mm - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export const ACCOUNT_TYPES: Record<string, string> = {
  checking: 'Cuenta corriente',
  savings: 'Ahorro',
  cash: 'Efectivo',
  credit_card: 'Tarjeta de crédito',
  investment: 'Inversión',
  other: 'Otra',
};

/** Paleta categórica validada (orden fijo). */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
