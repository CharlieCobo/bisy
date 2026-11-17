import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.js';
import {
  accountsMonthStatement, addDebtPayment, budgetStatus, convert, createTransfer, debtSummary,
  insertTransaction, linkAsTransfer, monthsToPayoff, goalSummary,
} from './finance.js';
import { importCsv, parseAmount, parseDate, guessMapping, parseCsv } from './csv.js';

function setup() {
  const db = openDb(':memory:');
  const mk = (name: string, cur: string, opening: number) =>
    Number(db.prepare(`INSERT INTO accounts (name, type, currency, opening_balance, opening_date) VALUES (?, 'checking', ?, ?, '2026-01-01')`).run(name, cur, opening).lastInsertRowid);
  db.prepare(`INSERT INTO exchange_rates (date, base, quote, rate) VALUES ('2026-01-01','EUR','COP',4500)`).run();
  const cat = (n: string) => (db.prepare('SELECT id FROM categories WHERE name = ?').get(n) as { id: number }).id;
  return { db, eur: mk('BBVA', 'EUR', 100000), cop: mk('Bancolombia', 'COP', 0), cat };
}

test('saldo inicial y final por mes', () => {
  const { db, eur, cat } = setup();
  insertTransaction(db, { account_id: eur, date: '2026-01-05', amount: -20000, category_id: cat('Supermercado') });
  insertTransaction(db, { account_id: eur, date: '2026-02-01', amount: 250000, category_id: cat('Nómina') });
  insertTransaction(db, { account_id: eur, date: '2026-02-10', amount: -5000 });
  const feb = accountsMonthStatement(db, '2026-02').find((a) => a.account_id === eur)!;
  assert.equal(feb.opening, 80000);
  assert.equal(feb.income, 250000);
  assert.equal(feb.expense, 5000);
  assert.equal(feb.closing, 325000);
});

test('traspaso entre monedas con tipo de cambio y comisión', () => {
  const { db, eur, cop } = setup();
  createTransfer(db, { date: '2026-01-10', from_account_id: eur, to_account_id: cop, from_amount: 10000, fee: 300 });
  const s = accountsMonthStatement(db, '2026-01');
  const e = s.find((a) => a.account_id === eur)!;
  const c = s.find((a) => a.account_id === cop)!;
  assert.equal(e.transfers_out, 10000);
  assert.equal(e.expense, 300);
  assert.equal(e.closing, 100000 - 10300);
  assert.equal(c.transfers_in, 45000000);
  assert.equal(convert(db, 45000000, 'COP', 'EUR'), 10000);
});

test('vincular dos movimientos importados como traspaso', () => {
  const { db, eur, cop } = setup();
  const a = insertTransaction(db, { account_id: eur, date: '2026-01-10', amount: -10000 })!;
  const b = insertTransaction(db, { account_id: cop, date: '2026-01-11', amount: 44000000 })!;
  linkAsTransfer(db, a, b);
  const s = accountsMonthStatement(db, '2026-01');
  assert.equal(s.find((x) => x.account_id === eur)!.transfers_out, 10000);
  assert.equal(s.find((x) => x.account_id === eur)!.expense, 0);
});

test('deuda: pagos reducen el saldo pendiente y crean gasto', () => {
  const { db, eur } = setup();
  const d = Number(db.prepare(`INSERT INTO debts (name, currency, principal, interest_rate, start_date, monthly_payment) VALUES ('Coche','EUR',100000,0,'2026-01-01',10000)`).run().lastInsertRowid);
  addDebtPayment(db, d, { date: '2026-01-05', principal_amount: 9000, interest_amount: 1000, account_id: eur });
  const s = debtSummary(db, d, new Date('2026-01-20'));
  assert.equal(s.remaining, 91000);
  assert.equal(s.payoff_months, 10);
  assert.equal(accountsMonthStatement(db, '2026-01').find((a) => a.account_id === eur)!.expense, 10000);
  assert.equal(monthsToPayoff(1000, 0, 0), null);
});

test('presupuesto convierte gastos a la moneda del presupuesto', () => {
  const { db, eur, cop, cat } = setup();
  db.prepare(`INSERT INTO budgets (month, category_id, currency, amount) VALUES ('2026-01', ?, 'EUR', 50000)`).run(cat('Restaurantes'));
  insertTransaction(db, { account_id: eur, date: '2026-01-02', amount: -10000, category_id: cat('Restaurantes') });
  insertTransaction(db, { account_id: cop, date: '2026-01-03', amount: -9000000, category_id: cat('Restaurantes') });
  const [b] = budgetStatus(db, '2026-01');
  assert.equal(b.spent, 12000);
});

test('meta de ahorro con aportaciones', () => {
  const { db } = setup();
  const g = Number(db.prepare(`INSERT INTO savings_goals (name, currency, target_amount) VALUES ('Viaje','EUR',100000)`).run().lastInsertRowid);
  db.prepare(`INSERT INTO goal_contributions (goal_id, date, amount) VALUES (?, '2026-01-01', 25000)`).run(g);
  assert.equal(goalSummary(db, g).progress, 0.25);
});

test('CSV: formatos españoles y deduplicación', () => {
  assert.equal(parseAmount('-1.234,56 €', ','), -123456);
  assert.equal(parseAmount('1,234.56', '.'), 123456);
  assert.equal(parseAmount('(12,00)', ','), -1200);
  assert.equal(parseDate('05/03/2026', 'DD/MM/YYYY'), '2026-03-05');
  const { db, eur } = setup();
  const csv = 'Fecha;Concepto;Importe;Saldo\n05/03/2026;Mercadona;-45,30;100\n06/03/2026;Nómina;1.500,00;200\n';
  const { headers, rows } = parseCsv(csv);
  const g = guessMapping(headers, rows);
  assert.equal(g.amount, 'Importe');
  assert.equal(g.decimal, ',');
  const mapping = { date: 'Fecha', description: 'Concepto', amount: 'Importe', date_format: 'DD/MM/YYYY' as const, decimal: ',' as const };
  assert.equal(importCsv(db, eur, csv, mapping).imported, 2);
  const again = importCsv(db, eur, csv, mapping);
  assert.equal(again.imported, 0);
  assert.equal(again.duplicates, 2);
});
