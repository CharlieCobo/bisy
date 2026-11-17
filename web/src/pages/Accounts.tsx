import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, type Account, type AccountMonth, type AccountType } from '../api';
import { useApi } from '../hooks';
import { ACCOUNT_TYPES, SERIES, money, monthLabel, today } from '../format';
import { Empty, ErrorBox, Modal, Money, MoneyInput } from '../components/ui';

export default function Accounts() {
  const { data: accounts, reload, error } = useApi<Account[]>('/accounts?all=1');
  const { data: currencies } = useApi<Array<{ code: string; name: string }>>('/currencies');
  const [editing, setEditing] = useState<Partial<Account> | null>(null);
  const [detail, setDetail] = useState<Account | null>(null);

  const groups = new Map<string, Account[]>();
  for (const a of accounts ?? []) {
    const k = a.archived ? 'Archivadas' : a.currency;
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Cuentas</h1>
          <p>Bancos, efectivo y tarjetas, cada una en su moneda.</p>
        </div>
        <button className="primary" onClick={() => setEditing({ type: 'checking', currency: 'EUR', opening_balance: 0, opening_date: today(), color: SERIES[(accounts?.length ?? 0) % SERIES.length] })}>
          + Nueva cuenta
        </button>
      </div>
      <ErrorBox error={error} />
      {accounts && accounts.length === 0 && <div className="card"><Empty>Crea tu primera cuenta para empezar.</Empty></div>}
      <div className="stack">
        {[...groups.entries()].map(([k, list]) => {
          const total = list.reduce((s, a) => s + a.balance, 0);
          return (
            <div key={k}>
              <div className="row" style={{ marginBottom: 10 }}>
                <h2>{k === 'Archivadas' ? k : `Cuentas en ${k}`}</h2>
                {k !== 'Archivadas' && <span className="muted num">· {money(total, k)}</span>}
              </div>
              <div className="grid g-3">
                {list.map((a) => (
                  <div key={a.id} className="card acct-card" style={{ ['--c' as any]: a.color, opacity: a.archived ? 0.6 : 1 }}>
                    <div className="row">
                      <div>
                        <div style={{ fontWeight: 600 }}>{a.name}</div>
                        <div className="small muted">
                          {ACCOUNT_TYPES[a.type]}
                          {a.institution ? ` · ${a.institution}` : ''}
                        </div>
                      </div>
                      <span className="spacer" />
                      {a.bank_connection_id && <span className="chip" title={a.last_synced_at ? `Última sincronización ${a.last_synced_at}` : ''}>🔗 Banco</span>}
                    </div>
                    <div className="stat" style={{ marginTop: 14 }}>
                      <div className="value num"><Money cents={a.balance} currency={a.currency} /></div>
                    </div>
                    <div className="row" style={{ marginTop: 12 }}>
                      <button className="small" onClick={() => setDetail(a)}>Mes a mes</button>
                      <Link to={`/movimientos?account_id=${a.id}`}><button className="small">Movimientos</button></Link>
                      <span className="spacer" />
                      <button className="ghost small" onClick={() => setEditing(a)}>Editar</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {editing && currencies && <AccountModal account={editing} currencies={currencies} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {detail && <AccountHistory account={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function AccountModal({ account, currencies, onClose, onSaved }: { account: Partial<Account>; currencies: Array<{ code: string; name: string }>; onClose: () => void; onSaved: () => void }) {
  const [a, setA] = useState(account);
  const [error, setError] = useState<string | null>(null);
  const up = (p: Partial<Account>) => setA({ ...a, ...p });
  const save = async () => {
    try {
      const body = { ...a, archived: !!a.archived, opening_balance: a.opening_balance ?? 0 };
      if (a.id) await api.put(`/accounts/${a.id}`, body);
      else await api.post('/accounts', body);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async () => {
    if (!window.confirm('¿Eliminar la cuenta y TODOS sus movimientos? Si solo quieres ocultarla, archívala.')) return;
    await api.del(`/accounts/${a.id}`);
    onSaved();
  };
  return (
    <Modal title={a.id ? 'Editar cuenta' : 'Nueva cuenta'} onClose={onClose}>
      <div className="form-grid">
        <label className="field full">
          Nombre
          <input value={a.name ?? ''} onChange={(e) => up({ name: e.target.value })} placeholder="Ej. BBVA nómina" autoFocus />
        </label>
        <label className="field">
          Tipo
          <select value={a.type} onChange={(e) => up({ type: e.target.value as AccountType })}>
            {Object.entries(ACCOUNT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="field">
          Moneda
          <select value={a.currency} onChange={(e) => up({ currency: e.target.value })}>
            {currencies.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
          </select>
        </label>
        <label className="field">
          Saldo inicial
          <MoneyInput value={a.opening_balance ?? 0} onChange={(v) => up({ opening_balance: v ?? 0 })} />
        </label>
        <label className="field">
          Fecha del saldo inicial
          <input type="date" value={a.opening_date ?? today()} onChange={(e) => up({ opening_date: e.target.value })} />
        </label>
        <label className="field">
          Entidad
          <input value={a.institution ?? ''} onChange={(e) => up({ institution: e.target.value })} placeholder="Opcional" />
        </label>
        <label className="field">
          Color
          <div className="row" style={{ gap: 6 }}>
            {SERIES.map((c) => (
              <button key={c} type="button" onClick={() => up({ color: c })} aria-label={c}
                style={{ width: 24, height: 24, padding: 0, borderRadius: 99, background: c, outline: a.color === c ? '2px solid var(--text)' : 'none', outlineOffset: 2 }} />
            ))}
          </div>
        </label>
        {a.id && (
          <label className="row full" style={{ gap: 8 }}>
            <input type="checkbox" checked={!!a.archived} onChange={(e) => up({ archived: e.target.checked ? 1 : 0 })} /> Archivar (ocultar del panel)
          </label>
        )}
      </div>
      <ErrorBox error={error} />
      <div className="actions">
        {a.id && <button className="danger ghost" onClick={remove} style={{ marginRight: 'auto' }}>Eliminar</button>}
        <button onClick={onClose}>Cancelar</button>
        <button className="primary" onClick={save}>Guardar</button>
      </div>
    </Modal>
  );
}

function AccountHistory({ account, onClose }: { account: Account; onClose: () => void }) {
  const { data } = useApi<Array<AccountMonth & { month: string }>>(`/accounts/${account.id}/history?months=12`);
  const cur = account.currency;
  return (
    <Modal title={`${account.name} · mes a mes`} onClose={onClose}>
      {!data ? <Empty>Cargando…</Empty> : (
        <>
          <div style={{ height: 200 }}>
            <ResponsiveContainer>
              <BarChart data={data}>
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <XAxis dataKey="month" tickFormatter={(m) => monthLabel(m)} tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => money(v, cur, { compact: true })} tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={60} />
                <Tooltip formatter={(v: number) => money(v, cur)} labelFormatter={(m) => monthLabel(String(m), true)} />
                <Bar dataKey="closing" name="Saldo final" fill={account.color} radius={[4, 4, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table>
              <thead><tr><th>Mes</th><th className="r">Inicio</th><th className="r">Entradas</th><th className="r">Salidas</th><th className="r">Final</th></tr></thead>
              <tbody>
                {[...data].reverse().map((m) => (
                  <tr key={m.month}>
                    <td style={{ textTransform: 'capitalize' }}>{monthLabel(m.month, true)}</td>
                    <td className="r"><Money cents={m.opening} currency={cur} /></td>
                    <td className="r"><Money cents={m.income + m.transfers_in} currency={cur} /></td>
                    <td className="r"><Money cents={-(m.expense + m.transfers_out)} currency={cur} /></td>
                    <td className="r"><b><Money cents={m.closing} currency={cur} /></b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="actions"><button onClick={onClose}>Cerrar</button></div>
    </Modal>
  );
}
