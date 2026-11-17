/**
 * Esquema y utilidades de base de datos independientes del motor:
 * se usan tanto con node:sqlite (servidor) como con sql.js (versión web en el navegador).
 */

export interface Statement {
  get(...params: any[]): any;
  all(...params: any[]): any[];
  run(...params: any[]): { changes: number | bigint; lastInsertRowid: number | bigint };
}

export interface DB {
  exec(sql: string): void;
  prepare(sql: string): Statement;
}

/**
 * Todas las cantidades se guardan como enteros en unidades mínimas (céntimos / centavos)
 * para evitar errores de coma flotante. 12,34 € => 1234.
 */
const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS currencies (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  decimals INTEGER NOT NULL DEFAULT 2
);

-- 1 unidad de "base" = rate unidades de "quote" (p. ej. EUR->COP 4500)
CREATE TABLE IF NOT EXISTS exchange_rates (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  base TEXT NOT NULL REFERENCES currencies(code),
  quote TEXT NOT NULL REFERENCES currencies(code),
  rate REAL NOT NULL,
  UNIQUE(date, base, quote)
);

CREATE TABLE IF NOT EXISTS bank_connections (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,
  institution TEXT NOT NULL,
  country TEXT NOT NULL,
  session_id TEXT,
  valid_until TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  state TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('checking','savings','cash','credit_card','investment','other')),
  currency TEXT NOT NULL REFERENCES currencies(code),
  institution TEXT,
  opening_balance INTEGER NOT NULL DEFAULT 0,
  opening_date TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366f1',
  archived INTEGER NOT NULL DEFAULT 0,
  bank_connection_id INTEGER REFERENCES bank_connections(id) ON DELETE SET NULL,
  external_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
  parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  color TEXT NOT NULL DEFAULT '#94a3b8',
  icon TEXT,
  UNIQUE(name, kind)
);

CREATE TABLE IF NOT EXISTS transfers (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  from_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  to_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  from_amount INTEGER NOT NULL CHECK (from_amount > 0),
  to_amount INTEGER NOT NULL CHECK (to_amount > 0),
  fee INTEGER NOT NULL DEFAULT 0,
  description TEXT
);

CREATE TABLE IF NOT EXISTS debts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  lender TEXT,
  currency TEXT NOT NULL REFERENCES currencies(code),
  principal INTEGER NOT NULL CHECK (principal > 0),
  interest_rate REAL NOT NULL DEFAULT 0,
  start_date TEXT NOT NULL,
  monthly_payment INTEGER,
  due_day INTEGER,
  notes TEXT,
  closed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS savings_goals (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  currency TEXT NOT NULL REFERENCES currencies(code),
  target_amount INTEGER NOT NULL CHECK (target_amount > 0),
  target_date TEXT,
  -- Si hay cuenta vinculada, el progreso = saldo de esa cuenta
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  color TEXT NOT NULL DEFAULT '#10b981',
  notes TEXT
);

-- amount: con signo. Positivo = entra dinero, negativo = sale dinero.
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  payee TEXT,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('income','expense','transfer','adjustment')),
  transfer_id INTEGER REFERENCES transfers(id) ON DELETE CASCADE,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','csv','bank')),
  external_id TEXT,
  pending INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_tx_account_date ON transactions(account_id, date);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);

-- Pagos de deudas. principal_amount reduce la deuda; interest_amount es coste.
CREATE TABLE IF NOT EXISTS debt_payments (
  id INTEGER PRIMARY KEY,
  debt_id INTEGER NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  principal_amount INTEGER NOT NULL CHECK (principal_amount >= 0),
  interest_amount INTEGER NOT NULL DEFAULT 0,
  transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL
);

-- Aportaciones a metas sin cuenta vinculada
CREATE TABLE IF NOT EXISTS goal_contributions (
  id INTEGER PRIMARY KEY,
  goal_id INTEGER NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL
);

-- Presupuesto mensual por categoría de gasto
CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY,
  month TEXT NOT NULL,           -- 'YYYY-MM'
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  currency TEXT NOT NULL REFERENCES currencies(code),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  UNIQUE(month, category_id, currency)
);

-- Reglas de autocategorización para movimientos importados
CREATE TABLE IF NOT EXISTS category_rules (
  id INTEGER PRIMARY KEY,
  pattern TEXT NOT NULL,         -- texto (sin distinguir mayúsculas) a buscar en descripción/beneficiario
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 0
);
`;

const DEFAULT_CURRENCIES = [
  ['EUR', 'Euro', '€', 2],
  ['COP', 'Peso colombiano', '$', 2],
  ['USD', 'Dólar estadounidense', 'US$', 2],
] as const;

const DEFAULT_CATEGORIES: Array<[string, 'income' | 'expense', string, string]> = [
  ['Nómina', 'income', '#10b981', '💼'],
  ['Freelance', 'income', '#14b8a6', '🧑‍💻'],
  ['Intereses', 'income', '#22c55e', '📈'],
  ['Otros ingresos', 'income', '#84cc16', '➕'],
  ['Vivienda', 'expense', '#6366f1', '🏠'],
  ['Supermercado', 'expense', '#f59e0b', '🛒'],
  ['Restaurantes', 'expense', '#f97316', '🍽️'],
  ['Transporte', 'expense', '#0ea5e9', '🚇'],
  ['Servicios', 'expense', '#8b5cf6', '💡'],
  ['Salud', 'expense', '#ef4444', '🩺'],
  ['Ocio', 'expense', '#ec4899', '🎉'],
  ['Compras', 'expense', '#d946ef', '🛍️'],
  ['Suscripciones', 'expense', '#a855f7', '📺'],
  ['Viajes', 'expense', '#06b6d4', '✈️'],
  ['Educación', 'expense', '#3b82f6', '📚'],
  ['Familia', 'expense', '#f43f5e', '👨‍👩‍👧'],
  ['Pago de deudas', 'expense', '#64748b', '💳'],
  ['Intereses y comisiones', 'expense', '#475569', '🏦'],
  ['Impuestos', 'expense', '#78716c', '🧾'],
  ['Otros gastos', 'expense', '#94a3b8', '📦'],
];

export function initSchema(db: DB) {
  db.exec(SCHEMA);
  seedDefaults(db);
}

function seedDefaults(db: DB) {
  const insCur = db.prepare('INSERT OR IGNORE INTO currencies (code, name, symbol, decimals) VALUES (?, ?, ?, ?)');
  for (const c of DEFAULT_CURRENCIES) insCur.run(...c);
  const count = db.prepare('SELECT COUNT(*) AS n FROM categories').get() as { n: number };
  if (count.n === 0) {
    const ins = db.prepare('INSERT INTO categories (name, kind, color, icon) VALUES (?, ?, ?, ?)');
    for (const c of DEFAULT_CATEGORIES) ins.run(...c);
  }
}

/** Ejecuta fn dentro de una transacción SQL. */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
