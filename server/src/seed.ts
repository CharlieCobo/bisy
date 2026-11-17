/**
 * Datos de ejemplo para probar la app: `npm run seed` (crea server/data/bisy-demo.db).
 * Para usarla: DB_PATH=./server/data/bisy-demo.db npm run dev
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { addDebtPayment, createTransfer, currentMonth, insertTransaction, shiftMonth } from './finance.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(here, '../data/bisy-demo.db');
for (const f of [file, `${file}-wal`, `${file}-shm`]) if (fs.existsSync(f)) fs.rmSync(f);
const db = openDb(file);

const cat = (name: string) => (db.prepare('SELECT id FROM categories WHERE name = ?').get(name) as { id: number }).id;
const acc = (name: string, type: string, currency: string, opening: number, color: string) =>
  Number(
    db
      .prepare('INSERT INTO accounts (name, type, currency, opening_balance, opening_date, color, institution) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(name, type, currency, opening, `${shiftMonth(currentMonth(), -11)}-01`, color, name.split(' ')[0]).lastInsertRowid,
  );

const now = currentMonth();
const start = shiftMonth(now, -11);
db.prepare('INSERT INTO exchange_rates (date, base, quote, rate) VALUES (?, ?, ?, ?)').run(`${start}-01`, 'EUR', 'COP', 4450);
db.prepare('INSERT INTO exchange_rates (date, base, quote, rate) VALUES (?, ?, ?, ?)').run(`${now}-01`, 'EUR', 'COP', 4380);
db.prepare('INSERT INTO exchange_rates (date, base, quote, rate) VALUES (?, ?, ?, ?)').run(`${now}-01`, 'EUR', 'USD', 1.08);

const bbva = acc('BBVA Cuenta Online', 'checking', 'EUR', 2_150_00, '#2563eb');
const ahorro = acc('ING Cuenta Naranja', 'savings', 'EUR', 6_000_00, '#f97316');
const bancol = acc('Bancolombia Ahorros', 'savings', 'COP', 3_200_000_00, '#eab308');
const nequi = acc('Nequi', 'checking', 'COP', 250_000_00, '#a855f7');
acc('Efectivo', 'cash', 'EUR', 120_00, '#10b981');

let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const between = (a: number, b: number) => Math.round(a + rnd() * (b - a));

const debtId = Number(
  db
    .prepare('INSERT INTO debts (name, lender, currency, principal, interest_rate, start_date, monthly_payment, due_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('Préstamo coche', 'Santander', 'EUR', 12_000_00, 6.5, `${start}-01`, 350_00, 5).lastInsertRowid,
);
const debt2 = Number(
  db
    .prepare('INSERT INTO debts (name, lender, currency, principal, interest_rate, start_date, monthly_payment, due_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('Crédito estudios', 'ICETEX', 'COP', 18_000_000_00, 12, `${start}-01`, 650_000_00, 15).lastInsertRowid,
);

for (let i = 0; i < 12; i++) {
  const m = shiftMonth(start, i);
  const d = (day: number) => `${m}-${String(day).padStart(2, '0')}`;
  insertTransaction(db, { account_id: bbva, date: d(1), amount: 2_850_00, description: 'NÓMINA EMPRESA SL', category_id: cat('Nómina') });
  insertTransaction(db, { account_id: bbva, date: d(2), amount: -950_00, description: 'Alquiler piso', category_id: cat('Vivienda') });
  insertTransaction(db, { account_id: bbva, date: d(4), amount: -between(60_00, 95_00), description: 'Iberdrola', category_id: cat('Servicios') });
  insertTransaction(db, { account_id: bbva, date: d(6), amount: -45_99, description: 'Digi + Netflix + Spotify', category_id: cat('Suscripciones') });
  for (let w = 0; w < 4; w++) {
    insertTransaction(db, { account_id: bbva, date: d(3 + w * 7), amount: -between(45_00, 110_00), description: w % 2 ? 'Mercadona' : 'Carrefour', category_id: cat('Supermercado') });
    insertTransaction(db, { account_id: bbva, date: d(5 + w * 7), amount: -between(15_00, 60_00), description: 'Restaurante', category_id: cat('Restaurantes') });
  }
  insertTransaction(db, { account_id: bbva, date: d(10), amount: -between(20_00, 55_00), description: 'Abono transporte', category_id: cat('Transporte') });
  insertTransaction(db, { account_id: bbva, date: d(18), amount: -between(30_00, 180_00), description: 'Amazon', category_id: cat('Compras') });
  insertTransaction(db, { account_id: bbva, date: d(22), amount: -between(20_00, 120_00), description: 'Cine y planes', category_id: cat('Ocio') });
  if (i % 3 === 0) insertTransaction(db, { account_id: bbva, date: d(14), amount: between(300_00, 700_00), description: 'Proyecto freelance', category_id: cat('Freelance') });
  createTransfer(db, { date: d(3), from_account_id: bbva, to_account_id: ahorro, from_amount: 300_00, description: 'Ahorro mensual' });
  createTransfer(db, { date: d(8), from_account_id: bbva, to_account_id: bancol, from_amount: 200_00, to_amount: 200_00 * 4400, fee: 3_50, description: 'Envío a Colombia' });
  insertTransaction(db, { account_id: bancol, date: d(12), amount: -between(150_000_00, 400_000_00), description: 'Ayuda familia', category_id: cat('Familia') });
  createTransfer(db, { date: d(13), from_account_id: bancol, to_account_id: nequi, from_amount: 100_000_00, description: 'Recarga Nequi' });
  insertTransaction(db, { account_id: nequi, date: d(16), amount: -between(40_000_00, 90_000_00), description: 'Rappi', category_id: cat('Restaurantes') });
  insertTransaction(db, { account_id: ahorro, date: d(28), amount: between(3_00, 8_00), description: 'Intereses', category_id: cat('Intereses') });
  addDebtPayment(db, debtId, { date: d(5), principal_amount: 290_00, interest_amount: 60_00, account_id: bbva });
  addDebtPayment(db, debt2, { date: d(15), principal_amount: 480_000_00, interest_amount: 170_000_00, account_id: bancol });
}

for (const [name, amount] of [
  ['Supermercado', 400_00], ['Restaurantes', 180_00], ['Ocio', 100_00], ['Compras', 120_00], ['Transporte', 50_00],
  ['Servicios', 90_00], ['Suscripciones', 50_00], ['Vivienda', 950_00],
] as const) {
  db.prepare('INSERT INTO budgets (month, category_id, currency, amount) VALUES (?, ?, ?, ?)').run(now, cat(name), 'EUR', amount);
}
db.prepare('INSERT INTO budgets (month, category_id, currency, amount) VALUES (?, ?, ?, ?)').run(now, cat('Familia'), 'COP', 350_000_00);

db.prepare('INSERT INTO savings_goals (name, currency, target_amount, target_date, account_id, color) VALUES (?, ?, ?, ?, ?, ?)').run(
  'Fondo de emergencia', 'EUR', 12_000_00, `${shiftMonth(now, 10)}-01`, ahorro, '#10b981');
const viaje = Number(
  db.prepare('INSERT INTO savings_goals (name, currency, target_amount, target_date, color) VALUES (?, ?, ?, ?, ?)').run(
    'Viaje a Colombia', 'EUR', 2_500_00, `${shiftMonth(now, 6)}-01`, '#f59e0b').lastInsertRowid,
);
db.prepare('INSERT INTO goal_contributions (goal_id, date, amount) VALUES (?, ?, ?)').run(viaje, `${now}-01`, 900_00);
db.prepare('INSERT INTO category_rules (pattern, category_id) VALUES (?, ?)').run('mercadona', cat('Supermercado'));
db.prepare('INSERT INTO category_rules (pattern, category_id) VALUES (?, ?)').run('rappi', cat('Restaurantes'));

console.log(`Base de datos de ejemplo creada en ${file}`);
