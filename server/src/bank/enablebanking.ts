/**
 * Cliente mínimo de Enable Banking (https://enablebanking.com/docs/api/reference/),
 * agregador PSD2 con acceso gratuito ("restricted production") para tus propias cuentas.
 *
 * Autenticación: JWT RS256 firmado con la clave privada de tu aplicación,
 * cabecera `kid` = id de la aplicación.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import type { BankAccount, BankProvider, BankTransaction, Institution } from './provider.js';

const API = 'https://api.enablebanking.com';

function b64url(input: Buffer | string) {
  return Buffer.from(input).toString('base64url');
}

export class EnableBankingProvider implements BankProvider {
  readonly name = 'enablebanking';
  constructor(
    private appId: string,
    private privateKeyPem: string,
    private redirectUrl: string,
  ) {}

  static fromEnv(): EnableBankingProvider | null {
    const appId = process.env.ENABLE_BANKING_APP_ID;
    const keyPath = process.env.ENABLE_BANKING_KEY_PATH;
    const redirect = process.env.ENABLE_BANKING_REDIRECT_URL ?? 'http://localhost:5173/bancos/callback';
    if (!appId || !keyPath || !fs.existsSync(keyPath)) return null;
    return new EnableBankingProvider(appId, fs.readFileSync(keyPath, 'utf8'), redirect);
  }

  private jwt() {
    const now = Math.floor(Date.now() / 1000);
    const header = { typ: 'JWT', alg: 'RS256', kid: this.appId };
    const body = { iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + 3600 };
    const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(body))}`;
    const sig = crypto.sign('RSA-SHA256', Buffer.from(data), this.privateKeyPem);
    return `${data}.${b64url(sig)}`;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.jwt()}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Enable Banking ${method} ${path}: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  async listInstitutions(country: string): Promise<Institution[]> {
    const r = await this.call<{ aspsps: Array<{ name: string; country: string; logo?: string; maximum_consent_validity?: number }> }>(
      'GET',
      `/aspsps?country=${encodeURIComponent(country)}&psu_type=personal`,
    );
    return r.aspsps.map((a) => ({ name: a.name, country: a.country, logo: a.logo, max_consent_days: a.maximum_consent_validity ? Math.floor(a.maximum_consent_validity / 86400) : undefined }));
  }

  async startAuth(institution: string, country: string, state: string, consentDays = 180) {
    const validUntil = new Date(Date.now() + consentDays * 86400_000).toISOString();
    const r = await this.call<{ url: string }>('POST', '/auth', {
      access: { valid_until: validUntil },
      aspsp: { name: institution, country },
      state,
      redirect_url: this.redirectUrl,
      psu_type: 'personal',
    });
    return { url: r.url, valid_until: validUntil };
  }

  async completeAuth(code: string): Promise<{ session_id: string; accounts: BankAccount[] }> {
    const r = await this.call<{
      session_id: string;
      accounts: Array<{ uid: string; account_id?: { iban?: string }; name?: string; currency?: string; product?: string }>;
    }>('POST', '/sessions', { code });
    return {
      session_id: r.session_id,
      accounts: r.accounts.map((a) => ({
        id: a.uid,
        iban: a.account_id?.iban ?? null,
        name: a.name ?? a.product ?? a.account_id?.iban ?? 'Cuenta',
        currency: a.currency ?? 'EUR',
      })),
    };
  }

  async getBalance(accountId: string): Promise<{ amount: number; currency: string } | null> {
    const r = await this.call<{ balances: Array<{ balance_amount: { amount: string; currency: string }; balance_type: string }> }>(
      'GET',
      `/accounts/${accountId}/balances`,
    );
    const pref = ['CLBD', 'ITAV', 'XPCD', 'CLAV'];
    const b = [...r.balances].sort((x, y) => idx(pref, x.balance_type) - idx(pref, y.balance_type))[0];
    return b ? { amount: Math.round(Number(b.balance_amount.amount) * 100), currency: b.balance_amount.currency } : null;
  }

  async getTransactions(accountId: string, dateFrom: string): Promise<BankTransaction[]> {
    const out: BankTransaction[] = [];
    let continuation: string | undefined;
    do {
      const qs = new URLSearchParams({ date_from: dateFrom });
      if (continuation) qs.set('continuation_key', continuation);
      const r = await this.call<{ transactions: any[]; continuation_key?: string }>(
        'GET',
        `/accounts/${accountId}/transactions?${qs}`,
      );
      for (const t of r.transactions) {
        const amt = Math.round(Number(t.transaction_amount.amount) * 100);
        const signed = t.credit_debit_indicator === 'DBIT' ? -Math.abs(amt) : Math.abs(amt);
        const counterparty = signed < 0 ? t.creditor?.name : t.debtor?.name;
        const desc = [...(t.remittance_information ?? [])].join(' ').trim() || counterparty || t.bank_transaction_code?.description || '';
        out.push({
          id: t.entry_reference ?? t.transaction_id ?? hash(`${t.booking_date}|${signed}|${desc}`),
          date: t.booking_date ?? t.value_date ?? t.transaction_date,
          amount: signed,
          currency: t.transaction_amount.currency,
          description: desc,
          payee: counterparty ?? null,
          pending: t.status === 'PDNG',
        });
      }
      continuation = r.continuation_key || undefined;
    } while (continuation);
    return out;
  }
}

function idx(arr: string[], v: string) {
  const i = arr.indexOf(v);
  return i < 0 ? 99 : i;
}

function hash(s: string) {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 20);
}
