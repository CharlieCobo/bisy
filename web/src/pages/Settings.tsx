import { useState } from 'react';
import { api, LOCAL_MODE, type Category } from '../api';
import { useApi } from '../hooks';
import { SERIES, dateLabel, today } from '../format';
import { ErrorBox, Modal } from '../components/ui';

export default function Settings() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ajustes</h1>
          <p>Categorías, reglas automáticas y tipos de cambio.</p>
        </div>
      </div>
      <div className="grid g-2" style={{ alignItems: 'start' }}>
        <div className="stack">
          {LOCAL_MODE && <LocalData />}
          <Rates />
          <Rules />
        </div>
        <Categories />
      </div>
    </>
  );
}

function Rates() {
  const { data, reload } = useApi<Array<{ id: number; date: string; base: string; quote: string; rate: number }>>('/exchange-rates');
  const [form, setForm] = useState({ date: today(), base: 'EUR', quote: 'COP', rate: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    try {
      await api.post('/exchange-rates', { ...form, rate: Number(form.rate.replace(',', '.')) });
      setForm({ ...form, rate: '' });
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const refresh = async () => {
    setBusy(true);
    try {
      await api.post('/exchange-rates/refresh');
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <div className="card-head">
        <h2>Tipos de cambio</h2>
        <button className="small" onClick={refresh} disabled={busy}>{busy ? 'Actualizando…' : '⟳ Actualizar hoy'}</button>
      </div>
      <p className="small muted" style={{ marginTop: -6 }}>Se usan para el patrimonio consolidado y el presupuesto. Para cada fecha se usa el tipo más reciente anterior.</p>
      <div className="row" style={{ marginBottom: 10 }}>
        <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        <span>1</span>
        <select value={form.base} onChange={(e) => setForm({ ...form, base: e.target.value })}><option>EUR</option><option>USD</option><option>COP</option></select>
        <span>=</span>
        <input value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} placeholder="4.500" style={{ width: 100 }} />
        <select value={form.quote} onChange={(e) => setForm({ ...form, quote: e.target.value })}><option>COP</option><option>EUR</option><option>USD</option></select>
        <button className="primary small" onClick={save} disabled={!form.rate}>Añadir</button>
      </div>
      <ErrorBox error={error} />
      <table>
        <tbody>
          {data?.slice(0, 12).map((r) => (
            <tr key={r.id}>
              <td>{dateLabel(r.date)}</td>
              <td className="num">1 {r.base} = {r.rate.toLocaleString('es-ES', { maximumFractionDigits: 4 })} {r.quote}</td>
              <td className="r"><button className="ghost small danger" onClick={async () => { await api.del(`/exchange-rates/${r.id}`); reload(); }}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Rules() {
  const { data, reload } = useApi<Array<{ id: number; pattern: string; category_name: string }>>('/category-rules');
  const { data: categories } = useApi<Category[]>('/categories');
  const [pattern, setPattern] = useState('');
  const [cat, setCat] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="card">
      <div className="card-head"><h2>Reglas de categorización</h2></div>
      <p className="small muted" style={{ marginTop: -6 }}>Si la descripción o el comercio contiene el texto, se asigna la categoría al importar.</p>
      <div className="row" style={{ marginBottom: 10 }}>
        <input placeholder="Texto, p. ej. mercadona" value={pattern} onChange={(e) => setPattern(e.target.value)} />
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">Categoría…</option>
          {categories?.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
        </select>
        <button className="primary small" disabled={pattern.length < 2 || !cat} onClick={async () => {
          const r = await api.post<{ updated: number }>('/category-rules', { pattern, category_id: Number(cat) });
          setMsg(`Regla creada. ${r.updated} movimientos sin categoría actualizados.`);
          setPattern('');
          reload();
        }}>Añadir</button>
      </div>
      {msg && <div className="alert" style={{ marginBottom: 8 }}>{msg}</div>}
      <table>
        <tbody>
          {data?.map((r) => (
            <tr key={r.id}>
              <td>“{r.pattern}”</td>
              <td>→ {r.category_name}</td>
              <td className="r"><button className="ghost small danger" onClick={async () => { await api.del(`/category-rules/${r.id}`); reload(); }}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Categories() {
  const { data, reload } = useApi<Category[]>('/categories');
  const [editing, setEditing] = useState<Partial<Category> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      const body = { name: editing!.name, kind: editing!.kind, color: editing!.color, icon: editing!.icon || null };
      if (editing!.id) await api.put(`/categories/${editing!.id}`, body);
      else await api.post('/categories', body);
      setEditing(null);
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const section = (kind: 'income' | 'expense', title: string) => (
    <>
      <div className="row" style={{ margin: '6px 0 8px' }}>
        <h3>{title}</h3>
        <span className="spacer" />
        <button className="small" onClick={() => setEditing({ kind, color: SERIES[0], icon: '' })}>+ Añadir</button>
      </div>
      <div className="row" style={{ marginBottom: 16 }}>
        {data?.filter((c) => c.kind === kind).map((c) => (
          <button key={c.id} className="chip" style={{ border: 'none', padding: '6px 11px' }} onClick={() => setEditing(c)}>
            {c.icon} {c.name}
          </button>
        ))}
      </div>
    </>
  );
  return (
    <div className="card">
      <div className="card-head"><h2>Categorías</h2></div>
      {section('expense', 'Gastos')}
      {section('income', 'Ingresos')}
      {editing && (
        <Modal title={editing.id ? 'Editar categoría' : 'Nueva categoría'} onClose={() => setEditing(null)}>
          <div className="form-grid">
            <label className="field">Nombre<input value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus /></label>
            <label className="field">Emoji<input value={editing.icon ?? ''} onChange={(e) => setEditing({ ...editing, icon: e.target.value })} placeholder="🛒" /></label>
            <label className="field">Tipo
              <select value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value as 'income' | 'expense' })}>
                <option value="expense">Gasto</option><option value="income">Ingreso</option>
              </select>
            </label>
          </div>
          <ErrorBox error={error} />
          <div className="actions">
            {editing.id && <button className="danger ghost" style={{ marginRight: 'auto' }} onClick={async () => { if (window.confirm('¿Eliminar categoría? Sus movimientos quedarán sin categoría.')) { await api.del(`/categories/${editing.id}`); setEditing(null); reload(); } }}>Eliminar</button>}
            <button onClick={() => setEditing(null)}>Cancelar</button>
            <button className="primary" onClick={save}>Guardar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function LocalData() {
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>, ok: string, reload = false) => {
    setError(null);
    try {
      await fn();
      setMsg(ok);
      if (reload) setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const local = () => import('../local/localServer');
  return (
    <div className="card">
      <div className="card-head"><h2>Tus datos</h2></div>
      <p className="small muted" style={{ marginTop: -6 }}>
        En esta versión web tus datos se guardan <b>solo en este navegador y dispositivo</b>; no se envían a ningún servidor.
        Si borras los datos del navegador se pierden: descarga una copia de vez en cuando. Con esa copia puedes pasar tus datos a otro dispositivo.
      </p>
      <div className="row">
        <button className="primary small" onClick={() => run(async () => (await local()).exportBackup(), 'Copia descargada.')}>⬇ Descargar copia</button>
        <label className="btn small" style={{ cursor: 'pointer' }}>
          ⬆ Restaurar copia
          <input type="file" accept=".db,application/x-sqlite3,application/octet-stream" hidden onChange={(e) => {
            const f = e.target.files?.[0];
            if (f && window.confirm('Se sustituirán TODOS los datos actuales por los de la copia. ¿Continuar?'))
              run(async () => (await local()).importBackup(f), 'Copia restaurada.', true);
          }} />
        </label>
        <span className="spacer" />
        <button className="small" onClick={() => window.confirm('Se borrarán tus datos y se cargarán datos de ejemplo. ¿Continuar?') && run(async () => (await local()).resetAll(true), 'Datos de ejemplo cargados.', true)}>Cargar ejemplo</button>
        <button className="small danger" onClick={() => window.confirm('¿Borrar TODOS los datos de este dispositivo?') && run(async () => (await local()).resetAll(false), 'Datos borrados.', true)}>Borrar todo</button>
      </div>
      {msg && <div className="alert" style={{ marginTop: 10 }}>{msg}</div>}
      <ErrorBox error={error} />
    </div>
  );
}
