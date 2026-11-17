import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Account } from '../api';
import { useApi } from '../hooks';
import { ErrorBox } from '../components/ui';

interface Preview {
  headers: string[];
  delimiter: string;
  sample: Record<string, string>[];
  total: number;
  guess: Partial<Mapping>;
}
interface Mapping {
  date: string;
  description: string;
  payee: string | null;
  amount: string | null;
  debit: string | null;
  credit: string | null;
  date_format: 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'DD-MM-YYYY';
  decimal: ',' | '.';
  invert: boolean;
  skip_rows: number;
}

export default function Import() {
  const { data: accounts } = useApi<Account[]>('/accounts');
  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [amountMode, setAmountMode] = useState<'single' | 'split'>('single');
  const [skip, setSkip] = useState(0);
  const [result, setResult] = useState<{ imported: number; duplicates: number; errors: Array<{ row: number; error: string }>; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPreview = async (f: File, skipRows = skip) => {
    setError(null);
    setResult(null);
    const fd = new FormData();
    fd.append('file', f);
    fd.append('skip_rows', String(skipRows));
    try {
      const p = await api.post<Preview>('/import/csv/preview', fd);
      setPreview(p);
      const g = p.guess;
      setAmountMode(g.amount ? 'single' : g.debit || g.credit ? 'split' : 'single');
      setMapping({
        date: g.date ?? p.headers[0] ?? '',
        description: g.description ?? p.headers[1] ?? '',
        payee: null,
        amount: g.amount ?? null,
        debit: g.debit ?? null,
        credit: g.credit ?? null,
        date_format: g.date_format ?? 'DD/MM/YYYY',
        decimal: g.decimal ?? ',',
        invert: false,
        skip_rows: skipRows,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const doImport = async () => {
    if (!file || !mapping || !accountId) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('account_id', accountId);
    const m = amountMode === 'single' ? { ...mapping, debit: null, credit: null } : { ...mapping, amount: null };
    fd.append('mapping', JSON.stringify(m));
    try {
      setResult(await api.post('/import/csv', fd));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const up = (p: Partial<Mapping>) => setMapping({ ...mapping!, ...p });
  const col = (value: string | null, onChange: (v: string | null) => void, optional = false) => (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      {optional && <option value="">—</option>}
      {preview?.headers.map((h) => <option key={h} value={h}>{h}</option>)}
    </select>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Importar extracto CSV</h1>
          <p>Descarga el extracto desde la web de tu banco (CSV; si es Excel, guárdalo como CSV) y súbelo aquí. Los movimientos repetidos se ignoran.</p>
        </div>
      </div>
      <div className="grid g-2" style={{ alignItems: 'start' }}>
        <div className="card stack">
          <h2>1. Archivo y cuenta</h2>
          <label className="field">
            Cuenta destino
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Elige una cuenta…</option>
              {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
            </select>
          </label>
          <label className="field">
            Archivo CSV
            <input type="file" accept=".csv,.txt,text/csv" onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); if (f) loadPreview(f); }} />
          </label>
          <label className="field">
            Filas a saltar antes de la cabecera
            <input type="number" min={0} value={skip} onChange={(e) => { const n = Number(e.target.value); setSkip(n); if (file) loadPreview(file, n); }} style={{ width: 100 }} />
          </label>
        </div>

        {mapping && preview && (
          <div className="card stack">
            <h2>2. Columnas</h2>
            <div className="form-grid">
              <label className="field">Fecha{col(mapping.date, (v) => up({ date: v ?? '' }))}</label>
              <label className="field">Formato de fecha
                <select value={mapping.date_format} onChange={(e) => up({ date_format: e.target.value as Mapping['date_format'] })}>
                  <option value="DD/MM/YYYY">DD/MM/AAAA</option>
                  <option value="DD-MM-YYYY">DD-MM-AAAA</option>
                  <option value="YYYY-MM-DD">AAAA-MM-DD</option>
                  <option value="MM/DD/YYYY">MM/DD/AAAA</option>
                </select>
              </label>
              <label className="field">Descripción{col(mapping.description, (v) => up({ description: v ?? '' }))}</label>
              <label className="field">Beneficiario (opcional){col(mapping.payee, (v) => up({ payee: v }), true)}</label>
              <div className="full segmented">
                <button className={amountMode === 'single' ? 'on' : ''} onClick={() => setAmountMode('single')}>Una columna de importe (+/−)</button>
                <button className={amountMode === 'split' ? 'on' : ''} onClick={() => setAmountMode('split')}>Columnas de cargo y abono</button>
              </div>
              {amountMode === 'single' ? (
                <label className="field">Importe{col(mapping.amount, (v) => up({ amount: v }))}</label>
              ) : (
                <>
                  <label className="field">Cargo (salidas){col(mapping.debit, (v) => up({ debit: v }), true)}</label>
                  <label className="field">Abono (entradas){col(mapping.credit, (v) => up({ credit: v }), true)}</label>
                </>
              )}
              <label className="field">Separador decimal
                <select value={mapping.decimal} onChange={(e) => up({ decimal: e.target.value as ',' | '.' })}>
                  <option value=",">Coma (1.234,56)</option>
                  <option value=".">Punto (1,234.56)</option>
                </select>
              </label>
              <label className="row full" style={{ gap: 8 }}>
                <input type="checkbox" checked={mapping.invert} onChange={(e) => up({ invert: e.target.checked })} />
                Invertir signo (para tarjetas donde los gastos vienen en positivo)
              </label>
            </div>
            <ErrorBox error={error} />
            <button className="primary" disabled={!accountId} onClick={doImport}>Importar {preview.total} filas</button>
            {result && (
              <div className="alert">
                ✅ {result.imported} importados · {result.duplicates} ya existían
                {result.errors.length > 0 && ` · ${result.errors.length} filas con error (p. ej. fila ${result.errors[0].row})`}.{' '}
                <Link to={`/movimientos?account_id=${accountId}&category_id=none`}>Categorizar los que quedaron sin categoría →</Link>
              </div>
            )}
          </div>
        )}
      </div>
      {!mapping && <ErrorBox error={error} />}

      {preview && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-head"><h2>Vista previa</h2><span className="sub">primeras {preview.sample.length} de {preview.total} filas · separador “{preview.delimiter}”</span></div>
          <div className="table-wrap">
            <table>
              <thead><tr>{preview.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>{preview.sample.map((r, i) => <tr key={i}>{preview.headers.map((h) => <td key={h} className="small">{r[h]}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
