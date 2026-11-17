import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type Account, type Category, type Transaction } from '../api';
import { useApi } from '../hooks';
import { dateLabel, money, today } from '../format';
import { Empty, ErrorBox, Modal, Money, MoneyInput } from '../components/ui';

export default function Transactions() {
  const [params, setParams] = useSearchParams();
  const qs = params.toString();
  const [limit, setLimit] = useState(100);
  const { data, reload, error } = useApi<{ items: Transaction[]; total: number }>(`/transactions?limit=${limit}${qs ? '&' + qs : ''}`);
  const { data: accounts } = useApi<Account[]>('/accounts');
  const { data: categories } = useApi<Category[]>('/categories');
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);

  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p);
    setSelected(new Set());
  };

  const items = data?.items ?? [];
  const totals = useMemo(() => {
    const t: Record<string, { in: number; out: number }> = {};
    for (const x of items) {
      if (x.kind === 'transfer') continue;
      t[x.currency] ??= { in: 0, out: 0 };
      if (x.amount > 0) t[x.currency].in += x.amount;
      else t[x.currency].out += -x.amount;
    }
    return t;
  }, [items]);

  const toggle = (id: number) => {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  };

  const setCategory = async (id: number, category_id: number | null) => {
    await api.post('/transactions/bulk-category', { ids: [id], category_id });
    reload();
  };

  const selectedTx = items.filter((t) => selected.has(t.id));
  const canLink =
    selectedTx.length === 2 &&
    selectedTx.every((t) => t.kind !== 'transfer') &&
    selectedTx.some((t) => t.amount < 0) &&
    selectedTx.some((t) => t.amount > 0) &&
    selectedTx[0].account_id !== selectedTx[1].account_id;

  const linkTransfer = async () => {
    const out = selectedTx.find((t) => t.amount < 0)!;
    const inn = selectedTx.find((t) => t.amount > 0)!;
    try {
      await api.post('/transfers/link', { out_transaction_id: out.id, in_transaction_id: inn.id });
      setMsg('Movimientos unidos como traspaso.');
      setSelected(new Set());
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const bulkCategory = async (category_id: string) => {
    if (!category_id) return;
    await api.post('/transactions/bulk-category', { ids: [...selected], category_id: Number(category_id) });
    setSelected(new Set());
    reload();
  };

  const remove = async (t: Transaction) => {
    const what = t.kind === 'transfer' ? 'este traspaso (se borran ambos lados)' : 'este movimiento';
    if (!window.confirm(`¿Eliminar ${what}?`)) return;
    await api.del(`/transactions/${t.id}`);
    reload();
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Movimientos</h1>
          <p>{data ? `${data.total} movimientos` : 'Cargando…'}</p>
        </div>
        <button className="primary" onClick={() => setShowNew(true)}>+ Nuevo movimiento</button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row">
          <input placeholder="Buscar…" defaultValue={params.get('search') ?? ''} onKeyDown={(e) => e.key === 'Enter' && set('search', (e.target as HTMLInputElement).value)} style={{ width: 200 }} />
          <select value={params.get('account_id') ?? ''} onChange={(e) => set('account_id', e.target.value)}>
            <option value="">Todas las cuentas</option>
            {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
          </select>
          <select value={params.get('category_id') ?? ''} onChange={(e) => set('category_id', e.target.value)}>
            <option value="">Todas las categorías</option>
            <option value="none">⚠️ Sin categoría</option>
            {categories?.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
          <select value={params.get('kind') ?? ''} onChange={(e) => set('kind', e.target.value)}>
            <option value="">Todos los tipos</option>
            <option value="income">Ingresos</option>
            <option value="expense">Gastos</option>
            <option value="transfer">Traspasos</option>
            <option value="adjustment">Ajustes</option>
          </select>
          <input type="month" value={params.get('month') ?? ''} onChange={(e) => set('month', e.target.value)} />
          {qs && <button className="ghost small" onClick={() => setParams(new URLSearchParams())}>Limpiar filtros</button>}
          <span className="spacer" />
          {Object.entries(totals).map(([cur, t]) => (
            <span key={cur} className="small num muted">
              {cur}: <span className="pos">+{money(t.in, cur)}</span> / −{money(t.out, cur)}
            </span>
          ))}
        </div>
      </div>

      {selected.size > 0 && (
        <div className="alert" style={{ marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <b>{selected.size} seleccionados</b>
          <select defaultValue="" onChange={(e) => bulkCategory(e.target.value)}>
            <option value="">Asignar categoría…</option>
            {categories?.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
          <button className="small" disabled={!canLink} onClick={linkTransfer} title="Selecciona una salida y una entrada de cuentas distintas">
            ⇄ Marcar como traspaso
          </button>
          <button className="ghost small" onClick={() => setSelected(new Set())}>Cancelar</button>
        </div>
      )}
      {msg && <div className="alert" style={{ marginBottom: 12 }} onClick={() => setMsg(null)}>{msg}</div>}
      <ErrorBox error={error} />

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 30 }} />
                <th>Fecha</th>
                <th>Descripción</th>
                <th>Cuenta</th>
                <th>Categoría</th>
                <th className="r">Importe</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id}>
                  <td><input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} aria-label="Seleccionar" /></td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>{dateLabel(t.date)}</td>
                  <td>
                    <div>{t.description || <span className="muted">—</span>}</div>
                    {(t.payee || t.source !== 'manual') && (
                      <div className="small muted">
                        {t.payee}
                        {t.source !== 'manual' && <span className="chip" style={{ marginLeft: t.payee ? 6 : 0 }}>{t.source === 'bank' ? '🔗 banco' : '📥 CSV'}</span>}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className="row" style={{ gap: 6 }}>
                      <span className="dot" style={{ background: t.account_color }} />
                      {t.account_name}
                    </span>
                  </td>
                  <td>
                    {t.kind === 'transfer' ? (
                      <span className="chip">⇄ Traspaso</span>
                    ) : (
                      <select
                        value={t.category_id ?? ''}
                        onChange={(e) => setCategory(t.id, e.target.value ? Number(e.target.value) : null)}
                        style={{ padding: '4px 8px', maxWidth: 190, borderColor: t.category_id ? undefined : 'var(--warning)' }}
                      >
                        <option value="">Sin categoría</option>
                        {categories
                          ?.filter((c) => c.kind === (t.amount >= 0 ? 'income' : 'expense'))
                          .map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="r" style={{ whiteSpace: 'nowrap' }}>
                    <b><Money cents={t.amount} currency={t.currency} sign colored /></b>
                  </td>
                  <td className="r"><button className="ghost small danger" onClick={() => remove(t)} aria-label="Eliminar">✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && items.length === 0 && <Empty>No hay movimientos con estos filtros</Empty>}
          {data && items.length < data.total && (
            <div style={{ textAlign: 'center', padding: 14 }}>
              <button onClick={() => setLimit(Math.min(1000, limit + 200))} disabled={limit >= 1000}>
                Ver más ({items.length} de {data.total})
              </button>
            </div>
          )}
        </div>
      </div>

      {showNew && accounts && categories && (
        <NewTransactionModal accounts={accounts} categories={categories} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); reload(); }} />
      )}
    </>
  );
}

export function NewTransactionModal({ accounts, categories, onClose, onSaved, defaultAccount }: {
  accounts: Account[];
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
  defaultAccount?: number;
}) {
  const [mode, setMode] = useState<'expense' | 'income' | 'transfer'>('expense');
  const [accountId, setAccountId] = useState<number>(defaultAccount ?? accounts[0]?.id);
  const [toAccountId, setToAccountId] = useState<number>(accounts.find((a) => a.id !== accountId)?.id ?? accounts[0]?.id);
  const [amount, setAmount] = useState<number | null>(null);
  const [toAmount, setToAmount] = useState<number | null>(null);
  const [fee, setFee] = useState<number | null>(null);
  const [date, setDate] = useState(today());
  const [description, setDescription] = useState('');
  const [payee, setPayee] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const from = accounts.find((a) => a.id === accountId);
  const to = accounts.find((a) => a.id === toAccountId);
  const crossCurrency = mode === 'transfer' && from && to && from.currency !== to.currency;

  const save = async () => {
    setError(null);
    if (!amount || amount <= 0) return setError('Indica un importe mayor que 0');
    try {
      if (mode === 'transfer') {
        await api.post('/transfers', {
          date,
          from_account_id: accountId,
          to_account_id: toAccountId,
          from_amount: amount,
          to_amount: crossCurrency ? toAmount : amount,
          fee: fee ?? 0,
          description: description || undefined,
        });
      } else {
        await api.post('/transactions', {
          account_id: accountId,
          date,
          amount: mode === 'expense' ? -amount : amount,
          description,
          payee: payee || null,
          category_id: categoryId ? Number(categoryId) : null,
          kind: mode,
        });
      }
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal title="Nuevo movimiento" onClose={onClose}>
      <div className="segmented" style={{ marginBottom: 16 }}>
        <button className={mode === 'expense' ? 'on' : ''} onClick={() => setMode('expense')}>Gasto</button>
        <button className={mode === 'income' ? 'on' : ''} onClick={() => setMode('income')}>Ingreso</button>
        <button className={mode === 'transfer' ? 'on' : ''} onClick={() => setMode('transfer')}>Traspaso</button>
      </div>
      <div className="form-grid">
        <label className="field">
          {mode === 'transfer' ? 'Desde' : 'Cuenta'}
          <select value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
          </select>
        </label>
        {mode === 'transfer' ? (
          <label className="field">
            Hacia
            <select value={toAccountId} onChange={(e) => setToAccountId(Number(e.target.value))}>
              {accounts.filter((a) => a.id !== accountId).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
            </select>
          </label>
        ) : (
          <label className="field">
            Fecha
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        )}
        <label className="field">
          Importe {from && `(${from.currency})`}
          <MoneyInput value={amount} onChange={setAmount} autoFocus />
        </label>
        {mode === 'transfer' ? (
          crossCurrency ? (
            <label className="field">
              Importe recibido ({to?.currency})
              <MoneyInput value={toAmount} onChange={setToAmount} placeholder="Vacío = usar tipo de cambio" />
            </label>
          ) : (
            <label className="field">
              Fecha
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          )
        ) : (
          <label className="field">
            Categoría
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Sin categoría</option>
              {categories.filter((c) => c.kind === mode).map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </select>
          </label>
        )}
        {crossCurrency && (
          <label className="field">
            Fecha
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        )}
        {mode === 'transfer' && (
          <label className="field">
            Comisión ({from?.currency}, opcional)
            <MoneyInput value={fee} onChange={setFee} />
          </label>
        )}
        <label className="field full">
          Descripción
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={mode === 'transfer' ? 'Ej. Envío a Colombia' : 'Ej. Mercadona'} />
        </label>
        {mode !== 'transfer' && (
          <label className="field full">
            {mode === 'expense' ? 'Comercio / beneficiario' : 'Pagador'} (opcional)
            <input value={payee} onChange={(e) => setPayee(e.target.value)} />
          </label>
        )}
      </div>
      {crossCurrency && amount && toAmount ? (
        <p className="small muted">Tipo aplicado: 1 {from!.currency} = {(toAmount / amount).toLocaleString('es-ES', { maximumFractionDigits: 4 })} {to!.currency}</p>
      ) : null}
      <ErrorBox error={error} />
      <div className="actions">
        <button onClick={onClose}>Cancelar</button>
        <button className="primary" onClick={save}>Guardar</button>
      </div>
    </Modal>
  );
}
