import type { DB } from './db.js';
import { tx } from './db.js';

export type Kind = 'income' | 'expense' | 'transfer' | 'adjustment';

export interface Account {
  id: number;
  name: string;
  type: string;
  currency: string;
  institution: string | null;
  opening_balance: number;
  opening_date: string;
  color: string;
  archived: number;
  bank_connection_id: number | null;
  external_id: string | null;
}

// ---------- Fechas ----------

export function monthRange(month: string): { start: string; end: string; next: string } {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, `Mes inválido: ${month}`);
  const [y, m] = month.split('-').map(Number);
  const start = `${month}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${month}-${String(lastDay).padStart(2, '0')}`;
  const nextDate = new Date(Date.UTC(y, m, 1));
  const next = nextDate.toISOString().slice(0, 10);
  return { start, end, next };
}

export function currentMonth(d = new Date()): string {
  return d.toISOString().slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---------- Tipos de cambio ----------

/**
 * Devuelve cuántas unidades de `to` vale 1 unidad de `from` en la fecha dada
 * (usa el tipo más reciente en o antes de esa fecha; si no hay, el más antiguo disponible).
 * Prueba directo, inverso y cruzado vía EUR/USD.
 */
export function getRate(db: DB, from: string, to: string, date?: string): number | null {
  if (from === to) return 1;
  const direct = lookupRate(db, from, to, date);
  if (direct != null) return direct;
  for (const pivot of ['EUR', 'USD']) {
    if (pivot === from || pivot === to) continue;
    const a = lookupRate(db, from, pivot, date);
    const b = lookupRate(db, pivot, to, date);
    if (a != null && b != null) return a * b;
  }
  return null;
}

function lookupRate(db: DB, from: string, to: string, date?: string): number | null {
  const d = date ?? '9999-12-31';
  const q = (base: string, quote: string) =>
    (db
      .prepare(
        `SELECT rate FROM exchange_rates WHERE base = ? AND quote = ? AND date <= ? ORDER BY date DESC LIMIT 1`,
      )
      .get(base, quote, d) as { rate: number } | undefined) ??
    (db
      .prepare(`SELECT rate FROM exchange_rates WHERE base = ? AND quote = ? ORDER BY date ASC LIMIT 1`)
      .get(base, quote) as { rate: number } | undefined);
  const r = q(from, to);
  if (r) return r.rate;
  const inv = q(to, from);
  if (inv && inv.rate) return 1 / inv.rate;
  return null;
}

export function convert(db: DB, amount: number, from: string, to: string, date?: string): number | null {
  const r = getRate(db, from, to, date);
  return r == null ? null : Math.round(amount * r);
}

// ---------- Saldos ----------

export function accountBalance(db: DB, accountId: number, untilExclusive?: string): number {
  const acc = db.prepare('SELECT opening_balance FROM accounts WHERE id = ?').get(accountId) as
    | { opening_balance: number }
    | undefined;
  if (!acc) throw new HttpError(404, 'Cuenta no encontrada');
  const row = untilExclusive
    ? (db
        .prepare('SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE account_id = ? AND date < ?')
        .get(accountId, untilExclusive) as { s: number })
    : (db.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE account_id = ?').get(accountId) as {
        s: number;
      });
  return acc.opening_balance + row.s;
}

export interface AccountMonth {
  account_id: number;
  name: string;
  currency: string;
  color: string;
  type: string;
  opening: number;
  income: number;
  expense: number;
  transfers_in: number;
  transfers_out: number;
  adjustments: number;
  closing: number;
}

/** Saldo inicial, entradas, salidas y saldo final de cada cuenta en un mes. */
export function accountsMonthStatement(db: DB, month: string, includeArchived = false): AccountMonth[] {
  const { start, next } = monthRange(month);
  const accounts = db
    .prepare(`SELECT * FROM accounts ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY currency, name`)
    .all() as unknown as Account[];
  return accounts.map((a) => {
    const opening = accountBalance(db, a.id, start);
    const rows = db
      .prepare(
        `SELECT kind,
                COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END),0) AS pos,
                COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END),0) AS neg,
                COALESCE(SUM(amount),0) AS net
         FROM transactions WHERE account_id = ? AND date >= ? AND date < ? GROUP BY kind`,
      )
      .all(a.id, start, next) as Array<{ kind: Kind; pos: number; neg: number; net: number }>;
    const by = Object.fromEntries(rows.map((r) => [r.kind, r]));
    const income = by.income?.net ?? 0;
    const expense = 0 - (by.expense?.net ?? 0);
    const transfers_in = by.transfer?.pos ?? 0;
    const transfers_out = by.transfer?.neg ?? 0;
    const adjustments = by.adjustment?.net ?? 0;
    return {
      account_id: a.id,
      name: a.name,
      currency: a.currency,
      color: a.color,
      type: a.type,
      opening,
      income,
      expense,
      transfers_in,
      transfers_out,
      adjustments,
      closing: opening + income - expense + transfers_in - transfers_out + adjustments,
    };
  });
}

// ---------- Movimientos ----------

export interface NewTransaction {
  account_id: number;
  date: string;
  amount: number; // con signo
  description?: string;
  payee?: string | null;
  category_id?: number | null;
  kind?: Kind;
  notes?: string | null;
  source?: 'manual' | 'csv' | 'bank';
  external_id?: string | null;
  pending?: boolean;
}

export function inferKind(amount: number): Kind {
  return amount >= 0 ? 'income' : 'expense';
}

/** Inserta un movimiento. Devuelve el id o null si ya existía (mismo external_id en la cuenta). */
export function insertTransaction(db: DB, t: NewTransaction): number | null {
  const kind = t.kind ?? inferKind(t.amount);
  const res = db
    .prepare(
      `INSERT INTO transactions (account_id, date, amount, description, payee, category_id, kind, notes, source, external_id, pending)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, external_id) DO NOTHING`,
    )
    .run(
      t.account_id,
      t.date,
      t.amount,
      t.description ?? '',
      t.payee ?? null,
      t.category_id ?? null,
      kind,
      t.notes ?? null,
      t.source ?? 'manual',
      t.external_id ?? null,
      t.pending ? 1 : 0,
    );
  return res.changes ? Number(res.lastInsertRowid) : null;
}

/** Aplica las reglas de categorización a un texto. */
export function matchCategory(db: DB, text: string): number | null {
  const rules = db.prepare('SELECT pattern, category_id FROM category_rules ORDER BY priority DESC, id').all() as Array<{
    pattern: string;
    category_id: number;
  }>;
  const t = text.toLowerCase();
  for (const r of rules) if (t.includes(r.pattern.toLowerCase())) return r.category_id;
  return null;
}

// ---------- Traspasos ----------

export interface NewTransfer {
  date: string;
  from_account_id: number;
  to_account_id: number;
  from_amount: number; // positivo, en moneda de la cuenta origen
  to_amount?: number; // positivo, en moneda de la cuenta destino (obligatorio si las monedas difieren y no hay tipo)
  fee?: number; // comisión en moneda origen
  description?: string;
}

export function createTransfer(db: DB, t: NewTransfer): number {
  if (t.from_account_id === t.to_account_id) throw new HttpError(400, 'Las cuentas deben ser distintas');
  const from = db.prepare('SELECT * FROM accounts WHERE id = ?').get(t.from_account_id) as Account | undefined;
  const to = db.prepare('SELECT * FROM accounts WHERE id = ?').get(t.to_account_id) as Account | undefined;
  if (!from || !to) throw new HttpError(404, 'Cuenta no encontrada');
  let toAmount = t.to_amount;
  if (toAmount == null) {
    toAmount = convert(db, t.from_amount, from.currency, to.currency, t.date) ?? undefined;
    if (toAmount == null)
      throw new HttpError(400, `Indica el importe recibido: no hay tipo de cambio ${from.currency}→${to.currency}`);
  }
  const fee = t.fee ?? 0;
  const desc = t.description || `Traspaso ${from.name} → ${to.name}`;
  return tx(db, () => {
    const r = db
      .prepare(
        `INSERT INTO transfers (date, from_account_id, to_account_id, from_amount, to_amount, fee, description) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(t.date, from.id, to.id, t.from_amount, toAmount!, fee, desc);
    const id = Number(r.lastInsertRowid);
    const ins = db.prepare(
      `INSERT INTO transactions (account_id, date, amount, description, kind, transfer_id, category_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    ins.run(from.id, t.date, -t.from_amount, desc, 'transfer', id, null);
    ins.run(to.id, t.date, toAmount!, desc, 'transfer', id, null);
    if (fee > 0) {
      const cat = db.prepare(`SELECT id FROM categories WHERE name = 'Intereses y comisiones'`).get() as
        | { id: number }
        | undefined;
      ins.run(from.id, t.date, -fee, `Comisión: ${desc}`, 'expense', id, cat?.id ?? null);
    }
    return id;
  });
}

/**
 * Convierte dos movimientos existentes (p. ej. importados del banco) en un traspaso:
 * uno negativo en la cuenta origen y otro positivo en la destino.
 */
export function linkAsTransfer(db: DB, outTxId: number, inTxId: number): number {
  const a = db.prepare('SELECT * FROM transactions WHERE id = ?').get(outTxId) as any;
  const b = db.prepare('SELECT * FROM transactions WHERE id = ?').get(inTxId) as any;
  if (!a || !b) throw new HttpError(404, 'Movimiento no encontrado');
  if (a.amount >= 0 || b.amount <= 0) throw new HttpError(400, 'El primero debe ser una salida y el segundo una entrada');
  if (a.account_id === b.account_id) throw new HttpError(400, 'Deben ser de cuentas distintas');
  return tx(db, () => {
    const r = db
      .prepare(
        `INSERT INTO transfers (date, from_account_id, to_account_id, from_amount, to_amount, description) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(a.date, a.account_id, b.account_id, -a.amount, b.amount, a.description || b.description);
    const id = Number(r.lastInsertRowid);
    db.prepare(`UPDATE transactions SET kind = 'transfer', transfer_id = ?, category_id = NULL WHERE id IN (?, ?)`).run(
      id,
      a.id,
      b.id,
    );
    return id;
  });
}

// ---------- Deudas ----------

export interface DebtSummary {
  id: number;
  name: string;
  lender: string | null;
  currency: string;
  principal: number;
  interest_rate: number;
  start_date: string;
  monthly_payment: number | null;
  due_day: number | null;
  notes: string | null;
  closed: number;
  paid_principal: number;
  paid_interest: number;
  remaining: number;
  progress: number; // 0..1
  payoff_months: number | null;
  payoff_date: string | null;
  history: Array<{ month: string; remaining: number; paid: number }>;
}

/** Meses hasta liquidar con cuota fija e interés anual (sistema francés). */
export function monthsToPayoff(balance: number, annualRatePct: number, payment: number): number | null {
  if (balance <= 0) return 0;
  if (!payment || payment <= 0) return null;
  const r = annualRatePct / 100 / 12;
  let b = balance;
  for (let m = 1; m <= 1200; m++) {
    b = b * (1 + r) - payment;
    if (b <= 0) return m;
  }
  return null; // la cuota no cubre los intereses
}

export function debtSummary(db: DB, debtId: number, today = new Date()): DebtSummary {
  const d = db.prepare('SELECT * FROM debts WHERE id = ?').get(debtId) as any;
  if (!d) throw new HttpError(404, 'Deuda no encontrada');
  const p = db
    .prepare(
      'SELECT COALESCE(SUM(principal_amount),0) AS pp, COALESCE(SUM(interest_amount),0) AS pi FROM debt_payments WHERE debt_id = ?',
    )
    .get(debtId) as { pp: number; pi: number };
  const remaining = Math.max(0, d.principal - p.pp);
  const months = d.monthly_payment ? monthsToPayoff(remaining, d.interest_rate, d.monthly_payment) : null;
  let payoff_date: string | null = null;
  if (months != null) payoff_date = shiftMonth(currentMonth(today), months);

  const rows = db
    .prepare(
      `SELECT substr(date,1,7) AS month, SUM(principal_amount) AS paid FROM debt_payments WHERE debt_id = ? GROUP BY month ORDER BY month`,
    )
    .all(debtId) as Array<{ month: string; paid: number }>;
  let running = d.principal;
  const history = [{ month: d.start_date.slice(0, 7), remaining: d.principal, paid: 0 }];
  for (const r of rows) {
    running -= r.paid;
    if (r.month === history[history.length - 1].month) {
      history[history.length - 1] = { month: r.month, remaining: running, paid: r.paid };
    } else history.push({ month: r.month, remaining: running, paid: r.paid });
  }
  return {
    ...d,
    paid_principal: p.pp,
    paid_interest: p.pi,
    remaining,
    progress: d.principal ? p.pp / d.principal : 0,
    payoff_months: months,
    payoff_date,
    history,
  };
}

export interface NewDebtPayment {
  date: string;
  principal_amount: number;
  interest_amount?: number;
  /** Si se indica, se crea un gasto en esa cuenta */
  account_id?: number | null;
  /** Importe cargado en la cuenta (si su moneda difiere de la deuda) */
  account_amount?: number | null;
  /** Vincular a un movimiento existente en lugar de crear uno nuevo */
  transaction_id?: number | null;
}

export function addDebtPayment(db: DB, debtId: number, p: NewDebtPayment): number {
  const d = db.prepare('SELECT * FROM debts WHERE id = ?').get(debtId) as any;
  if (!d) throw new HttpError(404, 'Deuda no encontrada');
  const interest = p.interest_amount ?? 0;
  return tx(db, () => {
    let txId: number | null = p.transaction_id ?? null;
    const cat = db.prepare(`SELECT id FROM categories WHERE name = 'Pago de deudas'`).get() as { id: number } | undefined;
    if (txId) {
      db.prepare(`UPDATE transactions SET category_id = COALESCE(?, category_id), kind = 'expense' WHERE id = ?`).run(
        cat?.id ?? null,
        txId,
      );
    } else if (p.account_id) {
      const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(p.account_id) as Account | undefined;
      if (!acc) throw new HttpError(404, 'Cuenta no encontrada');
      let amt = p.account_amount ?? null;
      if (amt == null) {
        amt = convert(db, p.principal_amount + interest, d.currency, acc.currency, p.date);
        if (amt == null) throw new HttpError(400, `Indica el importe cargado: no hay tipo ${d.currency}→${acc.currency}`);
      }
      txId = insertTransaction(db, {
        account_id: acc.id,
        date: p.date,
        amount: -Math.abs(amt),
        description: `Pago ${d.name}`,
        payee: d.lender,
        category_id: cat?.id ?? null,
        kind: 'expense',
      });
    }
    const r = db
      .prepare(
        'INSERT INTO debt_payments (debt_id, date, principal_amount, interest_amount, transaction_id) VALUES (?, ?, ?, ?, ?)',
      )
      .run(debtId, p.date, p.principal_amount, interest, txId);
    const s = db
      .prepare('SELECT COALESCE(SUM(principal_amount),0) AS pp FROM debt_payments WHERE debt_id = ?')
      .get(debtId) as { pp: number };
    if (s.pp >= d.principal) db.prepare('UPDATE debts SET closed = 1 WHERE id = ?').run(debtId);
    return Number(r.lastInsertRowid);
  });
}

// ---------- Metas de ahorro ----------

export function goalSummary(db: DB, goalId: number) {
  const g = db.prepare('SELECT * FROM savings_goals WHERE id = ?').get(goalId) as any;
  if (!g) throw new HttpError(404, 'Meta no encontrada');
  let current: number;
  if (g.account_id) {
    const acc = db.prepare('SELECT currency FROM accounts WHERE id = ?').get(g.account_id) as { currency: string };
    const bal = accountBalance(db, g.account_id);
    current = convert(db, bal, acc.currency, g.currency) ?? bal;
  } else {
    current = (
      db.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM goal_contributions WHERE goal_id = ?').get(goalId) as {
        s: number;
      }
    ).s;
  }
  let monthly_needed: number | null = null;
  if (g.target_date) {
    const months = monthsBetween(currentMonth(), g.target_date.slice(0, 7));
    monthly_needed = months > 0 ? Math.max(0, Math.ceil((g.target_amount - current) / months)) : null;
  }
  return { ...g, current, progress: Math.min(1, current / g.target_amount), monthly_needed };
}

export function monthsBetween(a: string, b: string): number {
  const [y1, m1] = a.split('-').map(Number);
  const [y2, m2] = b.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

// ---------- Presupuesto ----------

export function budgetStatus(db: DB, month: string) {
  const { start, next } = monthRange(month);
  const budgets = db
    .prepare(
      `SELECT b.*, c.name AS category_name, c.color, c.icon FROM budgets b JOIN categories c ON c.id = b.category_id WHERE b.month = ? ORDER BY c.name`,
    )
    .all(month) as any[];
  const spentRows = db
    .prepare(
      `SELECT t.category_id, t.amount, t.date, a.currency FROM transactions t JOIN accounts a ON a.id = t.account_id
       WHERE t.kind = 'expense' AND t.date >= ? AND t.date < ? AND t.category_id IS NOT NULL`,
    )
    .all(start, next) as Array<{ category_id: number; amount: number; date: string; currency: string }>;
  return budgets.map((b) => {
    let spent = 0;
    let unconverted = false;
    for (const r of spentRows) {
      if (r.category_id !== b.category_id) continue;
      const v = convert(db, -r.amount, r.currency, b.currency, r.date);
      if (v == null) unconverted = true;
      else spent += v;
    }
    return { ...b, spent, remaining: b.amount - spent, ratio: b.amount ? spent / b.amount : 0, unconverted };
  });
}

/** Copia el presupuesto de un mes a otro (sin sobrescribir lo existente). */
export function copyBudget(db: DB, fromMonth: string, toMonth: string): number {
  const r = db
    .prepare(
      `INSERT OR IGNORE INTO budgets (month, category_id, currency, amount) SELECT ?, category_id, currency, amount FROM budgets WHERE month = ?`,
    )
    .run(toMonth, fromMonth);
  return Number(r.changes);
}

// ---------- Panel ----------

export function dashboard(db: DB, month: string, base: string) {
  const { start, next } = monthRange(month);
  const statement = accountsMonthStatement(db, month);
  const missingRates = new Set<string>();
  const toBase = (amount: number, cur: string, date?: string) => {
    const v = convert(db, amount, cur, base, date);
    if (v == null) {
      missingRates.add(cur);
      return 0;
    }
    return v;
  };

  // Patrimonio
  const byCurrency: Record<string, { opening: number; closing: number }> = {};
  for (const s of statement) {
    byCurrency[s.currency] ??= { opening: 0, closing: 0 };
    byCurrency[s.currency].opening += s.opening;
    byCurrency[s.currency].closing += s.closing;
  }
  const debts = (db.prepare('SELECT id FROM debts WHERE closed = 0').all() as Array<{ id: number }>).map((d) =>
    debtSummary(db, d.id),
  );
  const assetsBase = statement.reduce((acc, s) => acc + toBase(s.closing, s.currency, monthRange(month).end), 0);
  const debtsBase = debts.reduce((acc, d) => acc + toBase(d.remaining, d.currency), 0);

  // Gastos por categoría del mes, en moneda base
  const catRows = db
    .prepare(
      `SELECT t.amount, t.date, a.currency, c.id AS category_id, COALESCE(c.name,'Sin categoría') AS name, COALESCE(c.color,'#cbd5e1') AS color, c.icon
       FROM transactions t JOIN accounts a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.kind = 'expense' AND t.date >= ? AND t.date < ?`,
    )
    .all(start, next) as any[];
  const byCat = new Map<string, { category_id: number | null; name: string; color: string; icon: string | null; amount: number }>();
  for (const r of catRows) {
    const key = String(r.category_id ?? 'none');
    const e = byCat.get(key) ?? { category_id: r.category_id, name: r.name, color: r.color, icon: r.icon, amount: 0 };
    e.amount += toBase(-r.amount, r.currency, r.date);
    byCat.set(key, e);
  }
  const expensesByCategory = [...byCat.values()].filter((e) => e.amount > 0).sort((a, b) => b.amount - a.amount);

  // Tendencia de 12 meses (ingresos vs gastos) en moneda base
  const firstMonth = shiftMonth(month, -11);
  const trendRows = db
    .prepare(
      `SELECT substr(t.date,1,7) AS m, t.kind, t.amount, t.date, a.currency FROM transactions t JOIN accounts a ON a.id = t.account_id
       WHERE t.kind IN ('income','expense') AND t.date >= ? AND t.date < ?`,
    )
    .all(`${firstMonth}-01`, next) as any[];
  const trendMap = new Map<string, { month: string; income: number; expense: number }>();
  for (let i = 0; i < 12; i++) {
    const m = shiftMonth(firstMonth, i);
    trendMap.set(m, { month: m, income: 0, expense: 0 });
  }
  for (const r of trendRows) {
    const e = trendMap.get(r.m);
    if (!e) continue;
    const v = toBase(r.amount, r.currency, r.date);
    if (r.kind === 'income') e.income += v;
    else e.expense -= v;
  }

  // Evolución del patrimonio (saldo de cierre de cada mes, en base)
  const netWorthTrend = [...trendMap.keys()].map((m) => {
    const { next: n, end } = monthRange(m);
    const accounts = db.prepare('SELECT id, currency FROM accounts WHERE archived = 0').all() as Array<{
      id: number;
      currency: string;
    }>;
    const total = accounts.reduce((acc, a) => acc + toBase(accountBalance(db, a.id, n), a.currency, end), 0);
    return { month: m, total };
  });

  const totals = { income: 0, expense: 0 };
  for (const s of statement) {
    totals.income += toBase(s.income, s.currency, start);
    totals.expense += toBase(s.expense, s.currency, start);
  }

  const goals = (db.prepare('SELECT id FROM savings_goals').all() as Array<{ id: number }>).map((g) =>
    goalSummary(db, g.id),
  );

  return {
    month,
    base_currency: base,
    accounts: statement,
    by_currency: byCurrency,
    net_worth: { assets: assetsBase, debts: debtsBase, net: assetsBase - debtsBase },
    totals: { ...totals, savings: totals.income - totals.expense, savings_rate: totals.income ? (totals.income - totals.expense) / totals.income : 0 },
    expenses_by_category: expensesByCategory,
    trend: [...trendMap.values()],
    net_worth_trend: netWorthTrend,
    budget: budgetStatus(db, month),
    debts,
    goals,
    missing_rates: [...missingRates],
  };
}
