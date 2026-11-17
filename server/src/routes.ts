/**
 * Rutas del API, independientes del framework: las monta Express en el servidor
 * y un enrutador mínimo dentro del navegador en la versión web (GitHub Pages).
 */
import { z, ZodError } from 'zod';
import type { DB } from './schema.js';
import {
  HttpError,
  accountBalance,
  accountsMonthStatement,
  addDebtPayment,
  budgetStatus,
  copyBudget,
  createTransfer,
  currentMonth,
  dashboard,
  debtSummary,
  goalSummary,
  insertTransaction,
  linkAsTransfer,
  monthRange,
} from './finance.js';
import { decodeBytes, guessMapping, importCsv, parseCsv } from './csv.js';
import type { BankProvider } from './bank/provider.js';
import { completeConnection, linkAccount, startConnection, syncAccount, syncAll } from './bank/sync.js';

export interface Req {
  params: Record<string, string>;
  query: Record<string, any>;
  body: any;
  file?: { buffer: Uint8Array };
}
export interface Res {
  status(code: number): Res;
  json(data: unknown): unknown;
  end(): unknown;
}
type Handler = (req: Req, res: Res) => unknown;
export interface Router {
  get(path: string, h: Handler): unknown;
  post(path: string, h: Handler): unknown;
  put(path: string, h: Handler): unknown;
  delete(path: string, h: Handler): unknown;
}

export interface RouteOptions {
  bank?: BankProvider | null;
  baseCurrency?: string;
  mode?: 'server' | 'local';
}

/** Convierte un error en respuesta HTTP. */
export function errorResponse(err: unknown): { status: number; body: unknown } {
  if (err instanceof ZodError) return { status: 400, body: { error: 'Datos no válidos', issues: err.issues } };
  if (err instanceof HttpError) return { status: err.status, body: { error: err.message } };
  const msg = (err as Error)?.message ?? String(err);
  if (/UNIQUE constraint/.test(msg)) return { status: 409, body: { error: 'Ya existe un registro igual' } };
  if (/FOREIGN KEY/.test(msg)) return { status: 409, body: { error: 'Está en uso por otros registros' } };
  console.error(err);
  return { status: 500, body: { error: msg } };
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha YYYY-MM-DD');
const month = z.string().regex(/^\d{4}-\d{2}$/, 'Mes YYYY-MM');
const cents = z.number().int();
const id = z.coerce.number().int().positive();
const currency = z.string().length(3).toUpperCase();

const accountSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['checking', 'savings', 'cash', 'credit_card', 'investment', 'other']),
  currency,
  institution: z.string().nullish(),
  opening_balance: cents.default(0),
  opening_date: date,
  color: z.string().default('#6366f1'),
  archived: z.boolean().optional(),
});

const txSchema = z.object({
  account_id: id,
  date,
  amount: cents,
  description: z.string().default(''),
  payee: z.string().nullish(),
  category_id: id.nullish(),
  kind: z.enum(['income', 'expense', 'adjustment']).optional(),
  notes: z.string().nullish(),
});

const categorySchema = z.object({
  name: z.string().min(1),
  kind: z.enum(['income', 'expense']),
  color: z.string().default('#94a3b8'),
  icon: z.string().nullish(),
  parent_id: id.nullish(),
});

const debtSchema = z.object({
  name: z.string().min(1),
  lender: z.string().nullish(),
  currency,
  principal: cents.positive(),
  interest_rate: z.number().min(0).default(0),
  start_date: date,
  monthly_payment: cents.positive().nullish(),
  due_day: z.number().int().min(1).max(31).nullish(),
  notes: z.string().nullish(),
});

const goalSchema = z.object({
  name: z.string().min(1),
  currency,
  target_amount: cents.positive(),
  target_date: date.nullish(),
  account_id: id.nullish(),
  color: z.string().default('#10b981'),
  notes: z.string().nullish(),
});

export function registerRoutes(r: Router, db: DB, opts: RouteOptions = {}) {
  const base = opts.baseCurrency ?? 'EUR';

  r.get('/health', (_req, res) => {
    res.json({ ok: true, mode: opts.mode ?? 'server', bank_provider: opts.bank?.name ?? null, base_currency: base });
  });

  // ---------- Monedas y tipos de cambio ----------
  r.get('/currencies', (_req, res) => {
    res.json(db.prepare('SELECT * FROM currencies ORDER BY code').all());
  });
  r.get('/exchange-rates', (_req, res) => {
    res.json(db.prepare('SELECT * FROM exchange_rates ORDER BY date DESC, base, quote LIMIT 200').all());
  });
  r.post('/exchange-rates', (req, res) => {
    const b = z.object({ date, base: currency, quote: currency, rate: z.number().positive() }).parse(req.body);
    db.prepare(
      'INSERT INTO exchange_rates (date, base, quote, rate) VALUES (?, ?, ?, ?) ON CONFLICT(date, base, quote) DO UPDATE SET rate = excluded.rate',
    ).run(b.date, b.base, b.quote, b.rate);
    res.status(201).json(b);
  });
  r.delete('/exchange-rates/:id', (req, res) => {
    db.prepare('DELETE FROM exchange_rates WHERE id = ?').run(id.parse(req.params.id));
    res.status(204).end();
  });
  /** Descarga los tipos del día desde open.er-api.com (gratuito, sin clave). */
  r.post('/exchange-rates/refresh', async (_req, res) => {
    const resp = await fetch(`https://open.er-api.com/v6/latest/${base}`);
    if (!resp.ok) throw new HttpError(502, 'No se pudo obtener el tipo de cambio');
    const data = (await resp.json()) as { rates: Record<string, number> };
    const codes = (db.prepare('SELECT code FROM currencies').all() as Array<{ code: string }>).map((c) => c.code);
    const today = new Date().toISOString().slice(0, 10);
    const saved: Array<{ quote: string; rate: number }> = [];
    for (const q of codes) {
      if (q === base || !data.rates[q]) continue;
      db.prepare(
        'INSERT INTO exchange_rates (date, base, quote, rate) VALUES (?, ?, ?, ?) ON CONFLICT(date, base, quote) DO UPDATE SET rate = excluded.rate',
      ).run(today, base, q, data.rates[q]);
      saved.push({ quote: q, rate: data.rates[q] });
    }
    res.json({ date: today, base, rates: saved });
  });

  // ---------- Cuentas ----------
  r.get('/accounts', (req, res) => {
    const all = req.query.all === '1';
    const rows = db
      .prepare(
        `SELECT a.*, c.institution AS bank_institution, c.status AS bank_status, c.last_synced_at
         FROM accounts a LEFT JOIN bank_connections c ON c.id = a.bank_connection_id
         ${all ? '' : 'WHERE a.archived = 0'} ORDER BY a.archived, a.currency, a.name`,
      )
      .all() as any[];
    res.json(rows.map((a) => ({ ...a, balance: accountBalance(db, a.id) })));
  });
  r.post('/accounts', (req, res) => {
    const a = accountSchema.parse(req.body);
    const out = db
      .prepare(
        'INSERT INTO accounts (name, type, currency, institution, opening_balance, opening_date, color) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(a.name, a.type, a.currency, a.institution ?? null, a.opening_balance, a.opening_date, a.color);
    res.status(201).json({ id: Number(out.lastInsertRowid) });
  });
  r.put('/accounts/:id', (req, res) => {
    const a = accountSchema.parse(req.body);
    db.prepare(
      'UPDATE accounts SET name=?, type=?, currency=?, institution=?, opening_balance=?, opening_date=?, color=?, archived=? WHERE id=?',
    ).run(a.name, a.type, a.currency, a.institution ?? null, a.opening_balance, a.opening_date, a.color, a.archived ? 1 : 0, id.parse(req.params.id));
    res.json({ ok: true });
  });
  r.delete('/accounts/:id', (req, res) => {
    db.prepare('DELETE FROM accounts WHERE id = ?').run(id.parse(req.params.id));
    res.status(204).end();
  });
  /** Saldo inicial y final de cada cuenta en un mes */
  r.get('/accounts/statement', (req, res) => {
    const m = month.parse(req.query.month ?? currentMonth());
    res.json(accountsMonthStatement(db, m));
  });
  /** Histórico mensual de una cuenta (últimos N meses) */
  r.get('/accounts/:id/history', (req, res) => {
    const accId = id.parse(req.params.id);
    const months = z.coerce.number().int().min(1).max(60).parse(req.query.months ?? 12);
    const cur = currentMonth();
    const out = [];
    for (let i = months - 1; i >= 0; i--) {
      const [y, mm] = cur.split('-').map(Number);
      const m = new Date(Date.UTC(y, mm - 1 - i, 1)).toISOString().slice(0, 7);
      const s = accountsMonthStatement(db, m, true).find((x) => x.account_id === accId);
      if (s) out.push({ month: m, ...s });
    }
    res.json(out);
  });

  // ---------- Categorías ----------
  r.get('/categories', (_req, res) => {
    res.json(db.prepare('SELECT * FROM categories ORDER BY kind DESC, name').all());
  });
  r.post('/categories', (req, res) => {
    const c = categorySchema.parse(req.body);
    const out = db
      .prepare('INSERT INTO categories (name, kind, color, icon, parent_id) VALUES (?, ?, ?, ?, ?)')
      .run(c.name, c.kind, c.color, c.icon ?? null, c.parent_id ?? null);
    res.status(201).json({ id: Number(out.lastInsertRowid) });
  });
  r.put('/categories/:id', (req, res) => {
    const c = categorySchema.parse(req.body);
    db.prepare('UPDATE categories SET name=?, kind=?, color=?, icon=?, parent_id=? WHERE id=?').run(
      c.name,
      c.kind,
      c.color,
      c.icon ?? null,
      c.parent_id ?? null,
      id.parse(req.params.id),
    );
    res.json({ ok: true });
  });
  r.delete('/categories/:id', (req, res) => {
    db.prepare('DELETE FROM categories WHERE id = ?').run(id.parse(req.params.id));
    res.status(204).end();
  });

  // Reglas de categorización automática
  r.get('/category-rules', (_req, res) => {
    res.json(
      db
        .prepare(
          'SELECT r.*, c.name AS category_name FROM category_rules r JOIN categories c ON c.id = r.category_id ORDER BY r.priority DESC, r.id',
        )
        .all(),
    );
  });
  r.post('/category-rules', (req, res) => {
    const b = z
      .object({ pattern: z.string().min(2), category_id: id, priority: z.number().int().default(0), apply_existing: z.boolean().default(true) })
      .parse(req.body);
    const out = db
      .prepare('INSERT INTO category_rules (pattern, category_id, priority) VALUES (?, ?, ?)')
      .run(b.pattern, b.category_id, b.priority);
    let updated = 0;
    if (b.apply_existing) {
      const like = `%${b.pattern.toLowerCase()}%`;
      updated = Number(
        db
          .prepare(
            `UPDATE transactions SET category_id = ? WHERE category_id IS NULL AND kind IN ('income','expense')
             AND (lower(description) LIKE ? OR lower(COALESCE(payee,'')) LIKE ?)`,
          )
          .run(b.category_id, like, like).changes,
      );
    }
    res.status(201).json({ id: Number(out.lastInsertRowid), updated });
  });
  r.delete('/category-rules/:id', (req, res) => {
    db.prepare('DELETE FROM category_rules WHERE id = ?').run(id.parse(req.params.id));
    res.status(204).end();
  });

  // ---------- Movimientos ----------
  r.get('/transactions', (req, res) => {
    const q = z
      .object({
        account_id: id.optional(),
        category_id: z.union([id, z.literal('none')]).optional(),
        kind: z.enum(['income', 'expense', 'transfer', 'adjustment']).optional(),
        month: month.optional(),
        from: date.optional(),
        to: date.optional(),
        search: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(1000).default(200),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);
    const where: string[] = [];
    const params: any[] = [];
    if (q.account_id) (where.push('t.account_id = ?'), params.push(q.account_id));
    if (q.category_id === 'none') where.push(`t.category_id IS NULL AND t.kind IN ('income','expense')`);
    else if (q.category_id) (where.push('t.category_id = ?'), params.push(q.category_id));
    if (q.kind) (where.push('t.kind = ?'), params.push(q.kind));
    if (q.month) {
      const { start, next } = monthRange(q.month);
      where.push('t.date >= ? AND t.date < ?');
      params.push(start, next);
    }
    if (q.from) (where.push('t.date >= ?'), params.push(q.from));
    if (q.to) (where.push('t.date <= ?'), params.push(q.to));
    if (q.search) {
      where.push(`(lower(t.description) LIKE ? OR lower(COALESCE(t.payee,'')) LIKE ? OR lower(COALESCE(t.notes,'')) LIKE ?)`);
      const s = `%${q.search.toLowerCase()}%`;
      params.push(s, s, s);
    }
    const sqlWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = db
      .prepare(
        `SELECT t.*, a.name AS account_name, a.currency, a.color AS account_color,
                c.name AS category_name, c.color AS category_color, c.icon AS category_icon,
                tr.from_account_id, tr.to_account_id
         FROM transactions t JOIN accounts a ON a.id = t.account_id
         LEFT JOIN categories c ON c.id = t.category_id
         LEFT JOIN transfers tr ON tr.id = t.transfer_id
         ${sqlWhere} ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, q.limit, q.offset);
    const total = db
      .prepare(`SELECT COUNT(*) AS n FROM transactions t ${sqlWhere}`)
      .get(...params) as { n: number };
    res.json({ items: rows, total: total.n });
  });
  r.post('/transactions', (req, res) => {
    const t = txSchema.parse(req.body);
    const newId = insertTransaction(db, { ...t, source: 'manual' });
    res.status(201).json({ id: newId });
  });
  r.put('/transactions/:id', (req, res) => {
    const txId = id.parse(req.params.id);
    const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(txId) as any;
    if (!existing) throw new HttpError(404, 'Movimiento no encontrado');
    if (existing.kind === 'transfer') {
      // En traspasos solo se permite editar descripción y notas
      const b = z.object({ description: z.string().optional(), notes: z.string().nullish() }).parse(req.body);
      db.prepare('UPDATE transactions SET description = COALESCE(?, description), notes = ? WHERE id = ?').run(
        b.description ?? null,
        b.notes ?? null,
        txId,
      );
      return res.json({ ok: true });
    }
    const t = txSchema.partial().parse(req.body);
    const m = { ...existing, ...t };
    db.prepare(
      'UPDATE transactions SET account_id=?, date=?, amount=?, description=?, payee=?, category_id=?, kind=?, notes=? WHERE id=?',
    ).run(m.account_id, m.date, m.amount, m.description, m.payee ?? null, m.category_id ?? null, t.kind ?? (m.amount >= 0 ? 'income' : 'expense'), m.notes ?? null, txId);
    res.json({ ok: true });
  });
  /** Categorizar varios movimientos a la vez */
  r.post('/transactions/bulk-category', (req, res) => {
    const b = z.object({ ids: z.array(id).min(1), category_id: id.nullable() }).parse(req.body);
    const stmt = db.prepare(`UPDATE transactions SET category_id = ? WHERE id = ? AND kind != 'transfer'`);
    let n = 0;
    for (const i of b.ids) n += Number(stmt.run(b.category_id, i).changes);
    res.json({ updated: n });
  });
  r.delete('/transactions/:id', (req, res) => {
    const txId = id.parse(req.params.id);
    const t = db.prepare('SELECT transfer_id FROM transactions WHERE id = ?').get(txId) as any;
    if (t?.transfer_id) db.prepare('DELETE FROM transfers WHERE id = ?').run(t.transfer_id);
    else db.prepare('DELETE FROM transactions WHERE id = ?').run(txId);
    res.status(204).end();
  });

  // ---------- Traspasos ----------
  r.post('/transfers', (req, res) => {
    const b = z
      .object({
        date,
        from_account_id: id,
        to_account_id: id,
        from_amount: cents.positive(),
        to_amount: cents.positive().nullish(),
        fee: cents.min(0).optional(),
        description: z.string().optional(),
      })
      .parse(req.body);
    res.status(201).json({ id: createTransfer(db, { ...b, to_amount: b.to_amount ?? undefined }) });
  });
  r.post('/transfers/link', (req, res) => {
    const b = z.object({ out_transaction_id: id, in_transaction_id: id }).parse(req.body);
    res.status(201).json({ id: linkAsTransfer(db, b.out_transaction_id, b.in_transaction_id) });
  });

  // ---------- Presupuesto ----------
  r.get('/budgets', (req, res) => {
    res.json(budgetStatus(db, month.parse(req.query.month ?? currentMonth())));
  });
  r.put('/budgets', (req, res) => {
    const b = z.object({ month, category_id: id, currency, amount: cents.min(0) }).parse(req.body);
    db.prepare(
      'INSERT INTO budgets (month, category_id, currency, amount) VALUES (?, ?, ?, ?) ON CONFLICT(month, category_id, currency) DO UPDATE SET amount = excluded.amount',
    ).run(b.month, b.category_id, b.currency, b.amount);
    res.json({ ok: true });
  });
  r.delete('/budgets/:id', (req, res) => {
    db.prepare('DELETE FROM budgets WHERE id = ?').run(id.parse(req.params.id));
    res.status(204).end();
  });
  r.post('/budgets/copy', (req, res) => {
    const b = z.object({ from: month, to: month }).parse(req.body);
    res.json({ copied: copyBudget(db, b.from, b.to) });
  });

  // ---------- Deudas ----------
  r.get('/debts', (_req, res) => {
    const ids = db.prepare('SELECT id FROM debts ORDER BY closed, name').all() as Array<{ id: number }>;
    res.json(ids.map((d) => debtSummary(db, d.id)));
  });
  r.post('/debts', (req, res) => {
    const d = debtSchema.parse(req.body);
    const out = db
      .prepare(
        'INSERT INTO debts (name, lender, currency, principal, interest_rate, start_date, monthly_payment, due_day, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(d.name, d.lender ?? null, d.currency, d.principal, d.interest_rate, d.start_date, d.monthly_payment ?? null, d.due_day ?? null, d.notes ?? null);
    res.status(201).json({ id: Number(out.lastInsertRowid) });
  });
  r.put('/debts/:id', (req, res) => {
    const d = debtSchema.parse(req.body);
    db.prepare(
      'UPDATE debts SET name=?, lender=?, currency=?, principal=?, interest_rate=?, start_date=?, monthly_payment=?, due_day=?, notes=? WHERE id=?',
    ).run(d.name, d.lender ?? null, d.currency, d.principal, d.interest_rate, d.start_date, d.monthly_payment ?? null, d.due_day ?? null, d.notes ?? null, id.parse(req.params.id));
    res.json({ ok: true });
  });
  r.delete('/debts/:id', (req, res) => {
    db.prepare('DELETE FROM debts WHERE id = ?').run(id.parse(req.params.id));
    res.status(204).end();
  });
  r.get('/debts/:id/payments', (req, res) => {
    res.json(
      db
        .prepare(
          `SELECT p.*, t.account_id, a.name AS account_name FROM debt_payments p
           LEFT JOIN transactions t ON t.id = p.transaction_id LEFT JOIN accounts a ON a.id = t.account_id
           WHERE p.debt_id = ? ORDER BY p.date DESC`,
        )
        .all(id.parse(req.params.id)),
    );
  });
  r.post('/debts/:id/payments', (req, res) => {
    const p = z
      .object({
        date,
        principal_amount: cents.min(0),
        interest_amount: cents.min(0).optional(),
        account_id: id.nullish(),
        account_amount: cents.positive().nullish(),
        transaction_id: id.nullish(),
      })
      .parse(req.body);
    res.status(201).json({ id: addDebtPayment(db, id.parse(req.params.id), p) });
  });
  r.delete('/debts/:debtId/payments/:id', (req, res) => {
    db.prepare('DELETE FROM debt_payments WHERE id = ? AND debt_id = ?').run(id.parse(req.params.id), id.parse(req.params.debtId));
    db.prepare(
      'UPDATE debts SET closed = 0 WHERE id = ? AND principal > (SELECT COALESCE(SUM(principal_amount),0) FROM debt_payments WHERE debt_id = ?)',
    ).run(id.parse(req.params.debtId), id.parse(req.params.debtId));
    res.status(204).end();
  });

  // ---------- Metas de ahorro ----------
  r.get('/goals', (_req, res) => {
    const ids = db.prepare('SELECT id FROM savings_goals ORDER BY target_date IS NULL, target_date, name').all() as Array<{ id: number }>;
    res.json(ids.map((g) => goalSummary(db, g.id)));
  });
  r.post('/goals', (req, res) => {
    const g = goalSchema.parse(req.body);
    const out = db
      .prepare('INSERT INTO savings_goals (name, currency, target_amount, target_date, account_id, color, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(g.name, g.currency, g.target_amount, g.target_date ?? null, g.account_id ?? null, g.color, g.notes ?? null);
    res.status(201).json({ id: Number(out.lastInsertRowid) });
  });
  r.put('/goals/:id', (req, res) => {
    const g = goalSchema.parse(req.body);
    db.prepare('UPDATE savings_goals SET name=?, currency=?, target_amount=?, target_date=?, account_id=?, color=?, notes=? WHERE id=?').run(
      g.name,
      g.currency,
      g.target_amount,
      g.target_date ?? null,
      g.account_id ?? null,
      g.color,
      g.notes ?? null,
      id.parse(req.params.id),
    );
    res.json({ ok: true });
  });
  r.delete('/goals/:id', (req, res) => {
    db.prepare('DELETE FROM savings_goals WHERE id = ?').run(id.parse(req.params.id));
    res.status(204).end();
  });
  r.post('/goals/:id/contributions', (req, res) => {
    const b = z.object({ date, amount: cents }).parse(req.body);
    const out = db
      .prepare('INSERT INTO goal_contributions (goal_id, date, amount) VALUES (?, ?, ?)')
      .run(id.parse(req.params.id), b.date, b.amount);
    res.status(201).json({ id: Number(out.lastInsertRowid) });
  });

  // ---------- Panel ----------
  r.get('/dashboard', (req, res) => {
    const m = month.parse(req.query.month ?? currentMonth());
    const cur = currency.parse(req.query.base ?? base);
    res.json(dashboard(db, m, cur));
  });

  // ---------- Importación CSV ----------
  r.post('/import/csv/preview', (req, res) => {
    if (!req.file) throw new HttpError(400, 'Falta el archivo');
    const skip = z.coerce.number().int().min(0).default(0).parse(req.body?.skip_rows ?? 0);
    const text = decodeBytes(req.file.buffer);
    const { headers, rows, delimiter } = parseCsv(text, skip);
    res.json({ headers, delimiter, sample: rows.slice(0, 10), total: rows.length, guess: guessMapping(headers, rows.slice(0, 10)) });
  });
  r.post('/import/csv', (req, res) => {
    if (!req.file) throw new HttpError(400, 'Falta el archivo');
    const accountId = id.parse(req.body.account_id);
    const mapping = z
      .object({
        date: z.string().min(1),
        description: z.string().min(1),
        payee: z.string().nullish(),
        amount: z.string().nullish(),
        debit: z.string().nullish(),
        credit: z.string().nullish(),
        date_format: z.enum(['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD-MM-YYYY']),
        decimal: z.enum([',', '.']),
        invert: z.boolean().optional(),
        skip_rows: z.number().int().min(0).optional(),
      })
      .parse(JSON.parse(req.body.mapping));
    res.json(importCsv(db, accountId, decodeBytes(req.file.buffer), mapping));
  });

  // ---------- Bancos (PSD2) ----------
  const bank = () => {
    if (!opts.bank)
      throw new HttpError(
        503,
        'Conexión bancaria no configurada. Añade ENABLE_BANKING_APP_ID y ENABLE_BANKING_KEY_PATH en .env (ver docs/conexion-bancaria.md).',
      );
    return opts.bank;
  };
  r.get('/bank/connections', (_req, res) => {
    res.json(
      db
        .prepare(
          `SELECT c.*, (SELECT COUNT(*) FROM accounts a WHERE a.bank_connection_id = c.id) AS accounts
           FROM bank_connections c WHERE c.status != 'pending' OR c.created_at > datetime('now','-1 day') ORDER BY c.created_at DESC`,
        )
        .all(),
    );
  });
  r.get('/bank/institutions', async (req, res) => {
    const country = z.string().length(2).toUpperCase().parse(req.query.country ?? 'ES');
    res.json(await bank().listInstitutions(country));
  });
  r.post('/bank/connections', async (req, res) => {
    const b = z.object({ institution: z.string().min(1), country: z.string().length(2).toUpperCase() }).parse(req.body);
    res.status(201).json(await startConnection(db, bank(), b.institution, b.country));
  });
  r.post('/bank/callback', async (req, res) => {
    const b = z.object({ code: z.string().min(1), state: z.string().min(1) }).parse(req.body);
    res.json(await completeConnection(db, bank(), b.code, b.state));
  });
  r.post('/bank/connections/:id/link', async (req, res) => {
    const b = z
      .object({
        bank_account: z.object({ id: z.string(), name: z.string(), currency }),
        account_id: id.nullish(),
        type: z.enum(['checking', 'savings', 'cash', 'credit_card', 'investment', 'other']).optional(),
        days_back: z.number().int().min(1).max(730).default(90),
      })
      .parse(req.body);
    res.json(
      await linkAccount(db, bank(), id.parse(req.params.id), b.bank_account, { account_id: b.account_id ?? undefined, type: b.type }, b.days_back),
    );
  });
  r.post('/bank/sync', async (_req, res) => {
    res.json(await syncAll(db, bank()));
  });
  r.post('/bank/sync/:accountId', async (req, res) => {
    res.json(await syncAccount(db, bank(), id.parse(req.params.accountId)));
  });
  r.delete('/bank/connections/:id', (req, res) => {
    const cid = id.parse(req.params.id);
    db.prepare('UPDATE accounts SET bank_connection_id = NULL WHERE bank_connection_id = ?').run(cid);
    db.prepare('DELETE FROM bank_connections WHERE id = ?').run(cid);
    res.status(204).end();
  });

}
