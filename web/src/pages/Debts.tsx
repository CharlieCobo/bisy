import { useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, type Account, type Debt } from '../api';
import { useApi } from '../hooks';
import { dateLabel, money, monthLabel, pct, today } from '../format';
import { Empty, ErrorBox, Meter, Modal, Money, MoneyInput } from '../components/ui';

export default function Debts() {
  const { data, reload, error } = useApi<Debt[]>('/debts');
  const { data: accounts } = useApi<Account[]>('/accounts');
  const [editing, setEditing] = useState<Partial<Debt> | null>(null);
  const [paying, setPaying] = useState<Debt | null>(null);

  const active = (data ?? []).filter((d) => !d.closed);
  const byCur: Record<string, number> = {};
  for (const d of active) byCur[d.currency] = (byCur[d.currency] ?? 0) + d.remaining;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Deudas</h1>
          <p>Cuánto debes y cómo baja con cada pago.</p>
        </div>
        <button className="primary" onClick={() => setEditing({ currency: 'EUR', interest_rate: 0, start_date: today() })}>+ Nueva deuda</button>
      </div>
      <ErrorBox error={error} />
      <div className="grid g-4" style={{ marginBottom: 16 }}>
        {Object.entries(byCur).map(([cur, v]) => (
          <div className="card stat" key={cur}>
            <div className="label">Deuda pendiente ({cur})</div>
            <div className="value num">{money(v, cur)}</div>
          </div>
        ))}
      </div>
      {data && data.length === 0 && <div className="card"><Empty>No tienes deudas registradas.</Empty></div>}
      <div className="grid g-2">
        {data?.map((d) => (
          <div className="card" key={d.id} style={{ opacity: d.closed ? 0.65 : 1 }}>
            <div className="card-head">
              <div>
                <h2>{d.name} {d.closed ? '✅' : ''}</h2>
                <div className="small muted">{d.lender ?? ''}{d.interest_rate ? ` · ${d.interest_rate} % TAE` : ''}{d.due_day ? ` · paga el día ${d.due_day}` : ''}</div>
              </div>
              <div className="row" style={{ gap: 4 }}>
                {!d.closed && <button className="small primary" onClick={() => setPaying(d)}>Registrar pago</button>}
                <button className="small ghost" onClick={() => setEditing(d)}>Editar</button>
              </div>
            </div>
            <div className="row" style={{ alignItems: 'baseline' }}>
              <span style={{ fontSize: 24, fontWeight: 700 }} className="num">{money(d.remaining, d.currency)}</span>
              <span className="muted">pendiente de {money(d.principal, d.currency)}</span>
            </div>
            <div style={{ margin: '10px 0 6px' }}><Meter ratio={d.progress} mode="progress" /></div>
            <div className="row small muted">
              <span>{pct(d.progress)} pagado</span>
              <span>· Intereses pagados {money(d.paid_interest, d.currency)}</span>
              <span className="spacer" />
              {d.payoff_date && <span>Fin estimado: <b style={{ textTransform: 'capitalize' }}>{monthLabel(d.payoff_date, true)}</b> ({d.payoff_months} meses)</span>}
              {!d.closed && d.monthly_payment && d.payoff_months == null && <span style={{ color: 'var(--critical)' }}>⚠️ La cuota no cubre los intereses</span>}
            </div>
            {d.history.length > 1 && (
              <div style={{ height: 150, marginTop: 12 }}>
                <ResponsiveContainer>
                  <AreaChart data={d.history}>
                    <CartesianGrid vertical={false} stroke="var(--grid)" />
                    <XAxis dataKey="month" tickFormatter={(m) => monthLabel(m)} tick={{ fill: 'var(--muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={(v) => money(v, d.currency, { compact: true })} tick={{ fill: 'var(--muted)', fontSize: 10 }} axisLine={false} tickLine={false} width={56} />
                    <Tooltip formatter={(v: number) => money(v, d.currency)} labelFormatter={(m) => monthLabel(String(m), true)} />
                    <Area type="stepAfter" dataKey="remaining" name="Pendiente" stroke="var(--accent)" strokeWidth={2} fill="var(--accent-soft)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
            <Payments debt={d} onChange={reload} />
          </div>
        ))}
      </div>
      {editing && <DebtModal debt={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {paying && accounts && <PaymentModal debt={paying} accounts={accounts} onClose={() => setPaying(null)} onSaved={() => { setPaying(null); reload(); }} />}
    </>
  );
}

function Payments({ debt, onChange }: { debt: Debt; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const { data, reload } = useApi<Array<{ id: number; date: string; principal_amount: number; interest_amount: number; account_name: string | null }>>(open ? `/debts/${debt.id}/payments` : null);
  return (
    <div style={{ marginTop: 10 }}>
      <button className="ghost small" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} Historial de pagos</button>
      {open && data && (
        <table style={{ marginTop: 6 }}>
          <thead><tr><th>Fecha</th><th>Cuenta</th><th className="r">Capital</th><th className="r">Intereses</th><th /></tr></thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.id}>
                <td>{dateLabel(p.date)}</td>
                <td className="muted">{p.account_name ?? '—'}</td>
                <td className="r"><Money cents={p.principal_amount} currency={debt.currency} /></td>
                <td className="r"><Money cents={p.interest_amount} currency={debt.currency} /></td>
                <td className="r"><button className="ghost small danger" onClick={async () => { await api.del(`/debts/${debt.id}/payments/${p.id}`); reload(); onChange(); }}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function DebtModal({ debt, onClose, onSaved }: { debt: Partial<Debt>; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState(debt);
  const [error, setError] = useState<string | null>(null);
  const up = (p: Partial<Debt>) => setD({ ...d, ...p });
  const save = async () => {
    try {
      const body = { name: d.name, lender: d.lender || null, currency: d.currency, principal: d.principal, interest_rate: Number(d.interest_rate ?? 0), start_date: d.start_date, monthly_payment: d.monthly_payment || null, due_day: d.due_day || null, notes: d.notes || null };
      if (d.id) await api.put(`/debts/${d.id}`, body);
      else await api.post('/debts', body);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal title={d.id ? 'Editar deuda' : 'Nueva deuda'} onClose={onClose}>
      <div className="form-grid">
        <label className="field full">Nombre<input value={d.name ?? ''} onChange={(e) => up({ name: e.target.value })} placeholder="Ej. Préstamo coche" autoFocus /></label>
        <label className="field">Acreedor<input value={d.lender ?? ''} onChange={(e) => up({ lender: e.target.value })} placeholder="Banco, persona…" /></label>
        <label className="field">Moneda<select value={d.currency} onChange={(e) => up({ currency: e.target.value })}><option>EUR</option><option>COP</option><option>USD</option></select></label>
        <label className="field">Importe total de la deuda<MoneyInput value={d.principal ?? null} onChange={(v) => up({ principal: v ?? undefined })} /></label>
        <label className="field">Interés anual (%)<input type="number" step="0.01" value={d.interest_rate ?? 0} onChange={(e) => up({ interest_rate: Number(e.target.value) })} /></label>
        <label className="field">Cuota mensual<MoneyInput value={d.monthly_payment ?? null} onChange={(v) => up({ monthly_payment: v })} /></label>
        <label className="field">Día de pago<input type="number" min={1} max={31} value={d.due_day ?? ''} onChange={(e) => up({ due_day: e.target.value ? Number(e.target.value) : null })} /></label>
        <label className="field">Fecha de inicio<input type="date" value={d.start_date ?? today()} onChange={(e) => up({ start_date: e.target.value })} /></label>
        <label className="field full">Notas<textarea value={d.notes ?? ''} onChange={(e) => up({ notes: e.target.value })} rows={2} /></label>
      </div>
      <ErrorBox error={error} />
      <div className="actions">
        {d.id && <button className="danger ghost" style={{ marginRight: 'auto' }} onClick={async () => { if (window.confirm('¿Eliminar esta deuda y su historial de pagos?')) { await api.del(`/debts/${d.id}`); onSaved(); } }}>Eliminar</button>}
        <button onClick={onClose}>Cancelar</button>
        <button className="primary" onClick={save}>Guardar</button>
      </div>
    </Modal>
  );
}

function PaymentModal({ debt, accounts, onClose, onSaved }: { debt: Debt; accounts: Account[]; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(today());
  const [principal, setPrincipal] = useState<number | null>(debt.monthly_payment ? Math.min(debt.monthly_payment, debt.remaining) : null);
  const [interest, setInterest] = useState<number | null>(null);
  const [accountId, setAccountId] = useState<string>(String(accounts.find((a) => a.currency === debt.currency)?.id ?? ''));
  const [accountAmount, setAccountAmount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const acc = accounts.find((a) => String(a.id) === accountId);
  const cross = acc && acc.currency !== debt.currency;
  const save = async () => {
    try {
      await api.post(`/debts/${debt.id}/payments`, {
        date,
        principal_amount: principal ?? 0,
        interest_amount: interest ?? 0,
        account_id: accountId ? Number(accountId) : null,
        account_amount: cross ? accountAmount : null,
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal title={`Pago · ${debt.name}`} onClose={onClose}>
      <p className="muted small" style={{ marginTop: -8 }}>Pendiente: {money(debt.remaining, debt.currency)}. Si el pago llegó importado del banco, también puedes elegir "No crear movimiento".</p>
      <div className="form-grid">
        <label className="field">Capital amortizado ({debt.currency})<MoneyInput value={principal} onChange={setPrincipal} autoFocus /></label>
        <label className="field">Intereses / comisiones ({debt.currency})<MoneyInput value={interest} onChange={setInterest} /></label>
        <label className="field">Pagado desde
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">No crear movimiento</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
          </select>
        </label>
        <label className="field">Fecha<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        {cross && <label className="field full">Importe cargado en la cuenta ({acc!.currency})<MoneyInput value={accountAmount} onChange={setAccountAmount} placeholder="Vacío = usar tipo de cambio" /></label>}
      </div>
      {principal != null && <p className="small muted">Total del pago: {money((principal ?? 0) + (interest ?? 0), debt.currency)} · quedará {money(Math.max(0, debt.remaining - (principal ?? 0)), debt.currency)}</p>}
      <ErrorBox error={error} />
      <div className="actions">
        <button onClick={onClose}>Cancelar</button>
        <button className="primary" onClick={save}>Registrar pago</button>
      </div>
    </Modal>
  );
}

