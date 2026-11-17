import { useState } from 'react';
import { api, type BudgetRow, type Category } from '../api';
import { useApi } from '../hooks';
import { money, shiftMonth, thisMonth } from '../format';
import { BudgetBadge, Empty, ErrorBox, Meter, MoneyInput, MonthPicker } from '../components/ui';

export default function Budget() {
  const [month, setMonth] = useState(thisMonth());
  const { data, reload, error } = useApi<BudgetRow[]>(`/budgets?month=${month}`);
  const { data: categories } = useApi<Category[]>('/categories');
  const [msg, setMsg] = useState<string | null>(null);
  const [newCat, setNewCat] = useState('');
  const [newCur, setNewCur] = useState('EUR');
  const [newAmount, setNewAmount] = useState<number | null>(null);

  const totals: Record<string, { amount: number; spent: number }> = {};
  for (const b of data ?? []) {
    totals[b.currency] ??= { amount: 0, spent: 0 };
    totals[b.currency].amount += b.amount;
    totals[b.currency].spent += b.spent;
  }
  const used = new Set((data ?? []).map((b) => `${b.category_id}|${b.currency}`));

  const save = async (category_id: number, currency: string, amount: number) => {
    await api.put('/budgets', { month, category_id, currency, amount });
    reload();
  };

  const copyPrev = async () => {
    const r = await api.post<{ copied: number }>('/budgets/copy', { from: shiftMonth(month, -1), to: month });
    setMsg(r.copied ? `Copiadas ${r.copied} partidas del mes anterior.` : 'El mes anterior no tenía partidas nuevas que copiar.');
    reload();
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Presupuesto mensual</h1>
          <p>Define cuánto quieres gastar por categoría. Los gastos en otra moneda se convierten automáticamente.</p>
        </div>
        <div className="row">
          <MonthPicker value={month} onChange={setMonth} />
          <button onClick={copyPrev}>Copiar del mes anterior</button>
        </div>
      </div>
      {msg && <div className="alert" style={{ marginBottom: 12 }}>{msg}</div>}
      <ErrorBox error={error} />

      <div className="grid g-4" style={{ marginBottom: 16 }}>
        {Object.entries(totals).map(([cur, t]) => (
          <div className="card stat" key={cur}>
            <div className="label">Total presupuestado ({cur})</div>
            <div className="value num">{money(t.spent, cur)} <span className="muted" style={{ fontSize: 15 }}>/ {money(t.amount, cur)}</span></div>
            <div style={{ marginTop: 8 }}><Meter ratio={t.amount ? t.spent / t.amount : 0} /></div>
            <div className="hint">{t.amount - t.spent >= 0 ? `Te quedan ${money(t.amount - t.spent, cur)}` : `Te has pasado ${money(t.spent - t.amount, cur)}`}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Categoría</th><th className="r" style={{ width: 160 }}>Presupuesto</th><th className="r">Gastado</th><th style={{ width: '30%' }}>Progreso</th><th className="r">Disponible</th><th /></tr>
            </thead>
            <tbody>
              {data?.map((b) => (
                <tr key={b.id}>
                  <td>{b.icon} {b.category_name} <span className="chip">{b.currency}</span></td>
                  <td className="r">
                    <InlineAmount cents={b.amount} onSave={(v) => save(b.category_id, b.currency, v)} />
                  </td>
                  <td className="r num">{money(b.spent, b.currency)}{b.unconverted && <span title="Hay gastos en otra moneda sin tipo de cambio"> ⚠️</span>}</td>
                  <td><Meter ratio={b.ratio} /><BudgetBadge ratio={b.ratio} /></td>
                  <td className="r num" style={{ color: b.remaining < 0 ? 'var(--critical)' : undefined }}>{money(b.remaining, b.currency)}</td>
                  <td className="r"><button className="ghost small danger" onClick={async () => { await api.del(`/budgets/${b.id}`); reload(); }} aria-label="Quitar">✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.length === 0 && <Empty>No hay presupuesto para este mes. Añade categorías abajo o copia el del mes anterior.</Empty>}
        </div>
        <div className="row" style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <select value={newCat} onChange={(e) => setNewCat(e.target.value)}>
            <option value="">Añadir categoría…</option>
            {categories?.filter((c) => c.kind === 'expense' && !used.has(`${c.id}|${newCur}`)).map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
          <select value={newCur} onChange={(e) => setNewCur(e.target.value)}>
            <option>EUR</option><option>COP</option><option>USD</option>
          </select>
          <div style={{ width: 140 }}><MoneyInput value={newAmount} onChange={setNewAmount} /></div>
          <button className="primary" disabled={!newCat || !newAmount} onClick={async () => { await save(Number(newCat), newCur, newAmount!); setNewCat(''); setNewAmount(null); }}>Añadir</button>
        </div>
      </div>
    </>
  );
}

function InlineAmount({ cents, onSave }: { cents: number; onSave: (v: number) => void }) {
  const [v, setV] = useState<number | null>(cents);
  return (
    <div onBlur={() => v != null && v !== cents && onSave(v)} style={{ display: 'inline-block', width: 130 }}>
      <MoneyInput value={v} onChange={setV} />
    </div>
  );
}
