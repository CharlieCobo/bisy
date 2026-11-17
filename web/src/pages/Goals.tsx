import { useState } from 'react';
import { api, type Account, type Goal } from '../api';
import { useApi } from '../hooks';
import { SERIES, dateLabel, money, pct, today } from '../format';
import { Empty, ErrorBox, Meter, Modal, MoneyInput } from '../components/ui';

export default function Goals() {
  const { data, reload, error } = useApi<Goal[]>('/goals');
  const { data: accounts } = useApi<Account[]>('/accounts');
  const [editing, setEditing] = useState<Partial<Goal> | null>(null);
  const [adding, setAdding] = useState<Goal | null>(null);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ahorros</h1>
          <p>Metas de ahorro. Vincúlalas a una cuenta de ahorro o registra aportaciones a mano.</p>
        </div>
        <button className="primary" onClick={() => setEditing({ currency: 'EUR', color: SERIES[2] })}>+ Nueva meta</button>
      </div>
      <ErrorBox error={error} />
      {data && data.length === 0 && <div className="card"><Empty>Crea tu primera meta: fondo de emergencia, viaje, entrada de un piso…</Empty></div>}
      <div className="grid g-3">
        {data?.map((g) => {
          const acc = accounts?.find((a) => a.id === g.account_id);
          return (
            <div className="card" key={g.id}>
              <div className="card-head">
                <h2>{g.name}</h2>
                <button className="ghost small" onClick={() => setEditing(g)}>Editar</button>
              </div>
              <div className="row" style={{ alignItems: 'baseline' }}>
                <span style={{ fontSize: 24, fontWeight: 700 }} className="num">{money(g.current, g.currency)}</span>
                <span className="muted">de {money(g.target_amount, g.currency)}</span>
              </div>
              <div style={{ margin: '10px 0 6px' }}><Meter ratio={g.progress} mode="progress" color="var(--good)" /></div>
              <div className="small muted">
                {pct(g.progress)} {g.progress >= 1 && '🎉 ¡Conseguido!'}
                {g.target_date && ` · objetivo ${dateLabel(g.target_date)}`}
              </div>
              {g.monthly_needed ? <div className="small" style={{ marginTop: 6 }}>Necesitas ahorrar <b>{money(g.monthly_needed, g.currency)}</b> al mes.</div> : null}
              <div className="row" style={{ marginTop: 12 }}>
                {acc ? <span className="chip">🏦 Saldo de {acc.name}</span> : <button className="small" onClick={() => setAdding(g)}>+ Aportación</button>}
              </div>
            </div>
          );
        })}
      </div>
      {editing && accounts && <GoalModal goal={editing} accounts={accounts} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {adding && <ContributionModal goal={adding} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); reload(); }} />}
    </>
  );
}

function GoalModal({ goal, accounts, onClose, onSaved }: { goal: Partial<Goal>; accounts: Account[]; onClose: () => void; onSaved: () => void }) {
  const [g, setG] = useState(goal);
  const [error, setError] = useState<string | null>(null);
  const up = (p: Partial<Goal>) => setG({ ...g, ...p });
  const save = async () => {
    try {
      const body = { name: g.name, currency: g.currency, target_amount: g.target_amount, target_date: g.target_date || null, account_id: g.account_id || null, color: g.color, notes: g.notes || null };
      if (g.id) await api.put(`/goals/${g.id}`, body);
      else await api.post('/goals', body);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal title={g.id ? 'Editar meta' : 'Nueva meta de ahorro'} onClose={onClose}>
      <div className="form-grid">
        <label className="field full">Nombre<input value={g.name ?? ''} onChange={(e) => up({ name: e.target.value })} placeholder="Ej. Fondo de emergencia" autoFocus /></label>
        <label className="field">Objetivo<MoneyInput value={g.target_amount ?? null} onChange={(v) => up({ target_amount: v ?? undefined })} /></label>
        <label className="field">Moneda<select value={g.currency} onChange={(e) => up({ currency: e.target.value })}><option>EUR</option><option>COP</option><option>USD</option></select></label>
        <label className="field">Fecha objetivo<input type="date" value={g.target_date ?? ''} onChange={(e) => up({ target_date: e.target.value || null })} /></label>
        <label className="field">Cuenta vinculada
          <select value={g.account_id ?? ''} onChange={(e) => up({ account_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Ninguna (aportaciones manuales)</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
          </select>
        </label>
      </div>
      <ErrorBox error={error} />
      <div className="actions">
        {g.id && <button className="danger ghost" style={{ marginRight: 'auto' }} onClick={async () => { if (window.confirm('¿Eliminar esta meta?')) { await api.del(`/goals/${g.id}`); onSaved(); } }}>Eliminar</button>}
        <button onClick={onClose}>Cancelar</button>
        <button className="primary" onClick={save}>Guardar</button>
      </div>
    </Modal>
  );
}

function ContributionModal({ goal, onClose, onSaved }: { goal: Goal; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState<number | null>(goal.monthly_needed);
  const [date, setDate] = useState(today());
  const [withdraw, setWithdraw] = useState(false);
  return (
    <Modal title={`Aportación · ${goal.name}`} onClose={onClose}>
      <div className="segmented" style={{ marginBottom: 12 }}>
        <button className={!withdraw ? 'on' : ''} onClick={() => setWithdraw(false)}>Aportar</button>
        <button className={withdraw ? 'on' : ''} onClick={() => setWithdraw(true)}>Retirar</button>
      </div>
      <div className="form-grid">
        <label className="field">Importe ({goal.currency})<MoneyInput value={amount} onChange={setAmount} autoFocus /></label>
        <label className="field">Fecha<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      <div className="actions">
        <button onClick={onClose}>Cancelar</button>
        <button className="primary" disabled={!amount} onClick={async () => { await api.post(`/goals/${goal.id}/contributions`, { date, amount: withdraw ? -amount! : amount }); onSaved(); }}>Guardar</button>
      </div>
    </Modal>
  );
}
