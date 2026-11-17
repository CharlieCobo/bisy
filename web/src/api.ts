export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    method,
    headers: body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const issues = (data as any)?.issues as Array<{ path: string[]; message: string }> | undefined;
    const detail = issues?.length ? `: ${issues.map((i) => `${i.path.join('.')} ${i.message}`).join(', ')}` : '';
    throw new ApiError(res.status, ((data as any)?.error ?? res.statusText) + detail, data);
  }
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b),
  put: <T>(p: string, b?: unknown) => request<T>('PUT', p, b),
  del: <T>(p: string) => request<T>('DELETE', p),
};

// ---- Tipos compartidos con el API ----
export type AccountType = 'checking' | 'savings' | 'cash' | 'credit_card' | 'investment' | 'other';

export interface Account {
  id: number;
  name: string;
  type: AccountType;
  currency: string;
  institution: string | null;
  opening_balance: number;
  opening_date: string;
  color: string;
  archived: number;
  balance: number;
  bank_connection_id: number | null;
  bank_institution?: string | null;
  last_synced_at?: string | null;
}

export interface Category {
  id: number;
  name: string;
  kind: 'income' | 'expense';
  color: string;
  icon: string | null;
  parent_id: number | null;
}

export interface Transaction {
  id: number;
  account_id: number;
  account_name: string;
  account_color: string;
  currency: string;
  date: string;
  amount: number;
  description: string;
  payee: string | null;
  category_id: number | null;
  category_name: string | null;
  category_color: string | null;
  category_icon: string | null;
  kind: 'income' | 'expense' | 'transfer' | 'adjustment';
  transfer_id: number | null;
  from_account_id: number | null;
  to_account_id: number | null;
  notes: string | null;
  source: 'manual' | 'csv' | 'bank';
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

export interface BudgetRow {
  id: number;
  month: string;
  category_id: number;
  category_name: string;
  color: string;
  icon: string | null;
  currency: string;
  amount: number;
  spent: number;
  remaining: number;
  ratio: number;
  unconverted: boolean;
}

export interface Debt {
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
  progress: number;
  payoff_months: number | null;
  payoff_date: string | null;
  history: Array<{ month: string; remaining: number; paid: number }>;
}

export interface Goal {
  id: number;
  name: string;
  currency: string;
  target_amount: number;
  target_date: string | null;
  account_id: number | null;
  color: string;
  notes: string | null;
  current: number;
  progress: number;
  monthly_needed: number | null;
}

export interface Dashboard {
  month: string;
  base_currency: string;
  accounts: AccountMonth[];
  by_currency: Record<string, { opening: number; closing: number }>;
  net_worth: { assets: number; debts: number; net: number };
  totals: { income: number; expense: number; savings: number; savings_rate: number };
  expenses_by_category: Array<{ category_id: number | null; name: string; color: string; icon: string | null; amount: number }>;
  trend: Array<{ month: string; income: number; expense: number }>;
  net_worth_trend: Array<{ month: string; total: number }>;
  budget: BudgetRow[];
  debts: Debt[];
  goals: Goal[];
  missing_rates: string[];
}
