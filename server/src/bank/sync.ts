import crypto from 'node:crypto';
import type { DB } from '../db.js';
import { accountBalance, insertTransaction, matchCategory, HttpError } from '../finance.js';
import type { BankProvider } from './provider.js';

export async function startConnection(db: DB, provider: BankProvider, institution: string, country: string) {
  const state = crypto.randomUUID();
  const { url, valid_until } = await provider.startAuth(institution, country, state);
  const r = db
    .prepare(
      `INSERT INTO bank_connections (provider, institution, country, status, state, valid_until) VALUES (?, ?, ?, 'pending', ?, ?)`,
    )
    .run(provider.name, institution, country, state, valid_until);
  return { id: Number(r.lastInsertRowid), url };
}

/** Tras volver del banco: crea la sesión y devuelve las cuentas disponibles para vincular. */
export async function completeConnection(db: DB, provider: BankProvider, code: string, state: string) {
  const conn = db.prepare('SELECT * FROM bank_connections WHERE state = ?').get(state) as any;
  if (!conn) throw new HttpError(404, 'Conexión no encontrada (state inválido)');
  const { session_id, accounts } = await provider.completeAuth(code);
  db.prepare(`UPDATE bank_connections SET session_id = ?, status = 'active' WHERE id = ?`).run(session_id, conn.id);
  return { connection_id: conn.id, accounts };
}

/**
 * Vincula una cuenta del banco con una cuenta de Bisy (nueva o existente),
 * importa sus movimientos y ajusta el saldo inicial para que cuadre con el del banco.
 */
export async function linkAccount(
  db: DB,
  provider: BankProvider,
  connectionId: number,
  bankAccount: { id: string; name: string; currency: string },
  target: { account_id?: number; type?: string },
  daysBack = 90,
) {
  const conn = db.prepare('SELECT * FROM bank_connections WHERE id = ?').get(connectionId) as any;
  if (!conn) throw new HttpError(404, 'Conexión no encontrada');
  const dateFrom = new Date(Date.now() - daysBack * 86400_000).toISOString().slice(0, 10);
  let accountId = target.account_id;
  if (!accountId) {
    const r = db
      .prepare(
        `INSERT INTO accounts (name, type, currency, institution, opening_balance, opening_date, bank_connection_id, external_id) VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
      )
      .run(bankAccount.name, target.type ?? 'checking', bankAccount.currency, conn.institution, dateFrom, connectionId, bankAccount.id);
    accountId = Number(r.lastInsertRowid);
  } else {
    db.prepare('UPDATE accounts SET bank_connection_id = ?, external_id = ? WHERE id = ?').run(connectionId, bankAccount.id, accountId);
  }
  const result = await syncAccount(db, provider, accountId, dateFrom);
  // Cuadrar saldo: saldo_inicial = saldo_banco - suma(movimientos)
  const bal = await provider.getBalance(bankAccount.id);
  if (bal && !target.account_id) {
    const current = accountBalance(db, accountId);
    db.prepare('UPDATE accounts SET opening_balance = opening_balance + ? WHERE id = ?').run(bal.amount - current, accountId);
  }
  return { account_id: accountId, ...result };
}

export async function syncAccount(db: DB, provider: BankProvider, accountId: number, dateFrom?: string) {
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as any;
  if (!acc?.external_id) throw new HttpError(400, 'La cuenta no está vinculada a un banco');
  if (!dateFrom) {
    const last = db
      .prepare(`SELECT MAX(date) AS d FROM transactions WHERE account_id = ? AND source = 'bank'`)
      .get(accountId) as { d: string | null };
    // Re-pedimos 10 días hacia atrás para recoger movimientos que pasaron de pendientes a contabilizados
    const base = last.d ? new Date(last.d) : new Date(Date.now() - 90 * 86400_000);
    dateFrom = new Date(base.getTime() - 10 * 86400_000).toISOString().slice(0, 10);
  }
  const txs = await provider.getTransactions(acc.external_id, dateFrom);
  let imported = 0;
  let skipped = 0;
  db.exec('BEGIN');
  try {
    for (const t of txs) {
      if (t.pending) {
        skipped++;
        continue;
      }
      const id = insertTransaction(db, {
        account_id: accountId,
        date: t.date,
        amount: t.amount,
        description: t.description,
        payee: t.payee,
        category_id: matchCategory(db, `${t.description} ${t.payee ?? ''}`),
        source: 'bank',
        external_id: `bank:${t.id}`,
      });
      if (id) imported++;
      else skipped++;
    }
    db.prepare(`UPDATE bank_connections SET last_synced_at = datetime('now') WHERE id = ?`).run(acc.bank_connection_id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { imported, skipped };
}

export async function syncAll(db: DB, provider: BankProvider) {
  const accounts = db
    .prepare(
      `SELECT a.id FROM accounts a JOIN bank_connections c ON c.id = a.bank_connection_id WHERE c.status = 'active' AND a.archived = 0`,
    )
    .all() as Array<{ id: number }>;
  const results = [];
  for (const a of accounts) {
    try {
      results.push({ account_id: a.id, ...(await syncAccount(db, provider, a.id)) });
    } catch (e) {
      results.push({ account_id: a.id, error: (e as Error).message });
    }
  }
  return results;
}
