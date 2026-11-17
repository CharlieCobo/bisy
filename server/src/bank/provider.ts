/**
 * Interfaz común para agregadores bancarios. Hoy está implementado Enable Banking (España / UE, PSD2).
 * Para Colombia se puede añadir otro proveedor (p. ej. Belvo o Prometeo) implementando esta interfaz.
 */
export interface Institution {
  name: string;
  country: string;
  logo?: string;
  max_consent_days?: number;
}

export interface BankAccount {
  id: string; // id del proveedor
  iban: string | null;
  name: string;
  currency: string;
}

export interface BankTransaction {
  id: string; // id estable del proveedor, para deduplicar
  date: string; // YYYY-MM-DD
  amount: number; // céntimos con signo
  currency: string;
  description: string;
  payee: string | null;
  pending: boolean;
}

export interface BankProvider {
  readonly name: string;
  listInstitutions(country: string): Promise<Institution[]>;
  startAuth(institution: string, country: string, state: string, consentDays?: number): Promise<{ url: string; valid_until: string }>;
  completeAuth(code: string): Promise<{ session_id: string; accounts: BankAccount[] }>;
  getBalance(accountId: string): Promise<{ amount: number; currency: string } | null>;
  getTransactions(accountId: string, dateFrom: string): Promise<BankTransaction[]>;
}
