import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, LOCAL_MODE, type Account } from '../api';
import { useApi } from '../hooks';
import { ACCOUNT_TYPES } from '../format';
import { Empty, ErrorBox } from '../components/ui';

interface Connection { id: number; provider: string; institution: string; country: string; status: string; valid_until: string | null; last_synced_at: string | null; accounts: number }
interface Institution { name: string; country: string; logo?: string }

export default function Banks() {
  const { data: health } = useApi<{ bank_provider: string | null }>('/health');
  const { data: connections, reload } = useApi<Connection[]>('/bank/connections');
  const [country, setCountry] = useState('ES');
  const [search, setSearch] = useState('');
  const { data: institutions, error: instError } = useApi<Institution[]>(health?.bank_provider ? `/bank/institutions?country=${country}` : null);
  const [error, setError] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const connect = async (inst: Institution) => {
    setError(null);
    try {
      const r = await api.post<{ url: string }>('/bank/connections', { institution: inst.name, country: inst.country, return_to: window.location.origin });
      window.location.href = r.url; // el banco te pide autorización (SCA) y vuelve a /bancos/callback
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const syncAll = async () => {
    setBusy(true);
    try {
      const r = await api.post<Array<{ account_id: number; imported?: number; error?: string }>>('/bank/sync');
      const imported = r.reduce((s, x) => s + (x.imported ?? 0), 0);
      const errs = r.filter((x) => x.error);
      setSyncMsg(`${imported} movimientos nuevos importados${errs.length ? ` · ${errs.length} cuentas con error: ${errs[0].error}` : ''}`);
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const list = (institutions ?? []).filter((i) => i.name.toLowerCase().includes(search.toLowerCase())).slice(0, 60);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Conexión con bancos</h1>
          <p>Importa movimientos automáticamente vía PSD2 (open banking), con acceso de solo lectura.</p>
        </div>
        {health?.bank_provider && <button className="primary" onClick={syncAll} disabled={busy}>{busy ? 'Sincronizando…' : '⟳ Sincronizar ahora'}</button>}
      </div>
      {syncMsg && <div className="alert" style={{ marginBottom: 12 }}>{syncMsg}</div>}
      <ErrorBox error={error} />

      {LOCAL_MODE && (
        <div className="card stack" style={{ marginBottom: 16 }}>
          <h2>No disponible en la versión web</h2>
          <p style={{ margin: 0 }}>
            Conectar con el banco necesita una clave privada que no puede guardarse en una página pública. Para eso hay que ejecutar Bisy
            en tu ordenador (<code>npm run dev</code>, ver README). Mientras tanto, descarga el extracto de tu banco y súbelo en{' '}
            <Link to="/importar">Importar CSV</Link>: los movimientos repetidos se ignoran.
          </p>
        </div>
      )}
      {!LOCAL_MODE && health && !health.bank_provider && (
        <div className="card stack" style={{ marginBottom: 16 }}>
          <h2>Configura la conexión bancaria</h2>
          <p style={{ margin: 0 }}>
            Bisy usa <b>Enable Banking</b>, un agregador PSD2 autorizado que es gratuito para conectar <b>tus propias cuentas</b> en
            España y el resto de la UE. Pasos:
          </p>
          <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
            <li>Regístrate en <a href="https://enablebanking.com" target="_blank" rel="noreferrer">enablebanking.com</a> y crea una aplicación en modo <i>Production (restricted)</i>.</li>
            <li>Como URL de redirección pon <code>https://charliecobo.github.io/bisy/callback.html</code> (esa página te devuelve a tu Bisy local).</li>
            <li>Descarga la clave privada <code>.pem</code> y guárdala en la carpeta del proyecto (no se sube a GitHub).</li>
            <li>En el portal, vincula tus cuentas a la aplicación (requisito del modo gratuito).</li>
            <li>Copia <code>.env.example</code> a <code>.env</code> y rellena <code>ENABLE_BANKING_APP_ID</code> y <code>ENABLE_BANKING_KEY_PATH</code>. Reinicia Bisy.</li>
          </ol>
          <p className="small muted" style={{ margin: 0 }}>
            Para bancos colombianos (Bancolombia, Davivienda, Nequi…) por ahora usa <Link to="/importar">Importar CSV</Link>. Más detalles en <code>docs/conexion-bancaria.md</code>.
          </p>
        </div>
      )}

      <div className="grid g-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-head"><h2>Conexiones</h2></div>
          {connections?.length === 0 && <Empty>Aún no has conectado ningún banco.</Empty>}
          {connections?.map((c) => {
            const expires = c.valid_until ? Math.ceil((new Date(c.valid_until).getTime() - Date.now()) / 86400000) : null;
            return (
              <div key={c.id} className="row" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <b>{c.institution}</b> <span className="chip">{c.country}</span>
                  <div className="small muted">
                    {c.status === 'active' ? '✓ Activa' : c.status === 'pending' ? '… Pendiente de autorizar' : c.status} · {c.accounts} cuentas
                    {c.last_synced_at && ` · sincronizada ${c.last_synced_at.slice(0, 16)}`}
                  </div>
                  {expires != null && c.status === 'active' && (
                    <div className={`small ${expires < 15 ? 'badge-status warn' : 'muted'}`}>
                      {expires > 0 ? `El permiso caduca en ${expires} días (PSD2 exige renovarlo)` : '▲ Permiso caducado: vuelve a conectar'}
                    </div>
                  )}
                </div>
                <span className="spacer" />
                <button className="ghost small danger" onClick={async () => { if (window.confirm('¿Desconectar? Las cuentas y movimientos se conservan.')) { await api.del(`/bank/connections/${c.id}`); reload(); } }}>Desconectar</button>
              </div>
            );
          })}
        </div>

        {health?.bank_provider && (
          <div className="card">
            <div className="card-head">
              <h2>Conectar un banco</h2>
              <select value={country} onChange={(e) => setCountry(e.target.value)}>
                <option value="ES">España</option>
                <option value="PT">Portugal</option>
                <option value="FR">Francia</option>
                <option value="DE">Alemania</option>
                <option value="IT">Italia</option>
                <option value="NL">Países Bajos</option>
              </select>
            </div>
            <input placeholder="Buscar banco…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: '100%', marginBottom: 10 }} />
            <ErrorBox error={instError} />
            <div style={{ maxHeight: 420, overflow: 'auto' }}>
              {list.map((i) => (
                <button key={i.name} className="ghost" style={{ width: '100%', justifyContent: 'flex-start', gap: 10 }} onClick={() => connect(i)}>
                  {i.logo ? <img src={i.logo} alt="" style={{ width: 22, height: 22, objectFit: 'contain' }} /> : <span>🏦</span>}
                  {i.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/** Página a la que vuelve el banco tras autorizar. Permite vincular cada cuenta del banco. */
export function BankCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { data: accounts } = useApi<Account[]>('/accounts');
  const [result, setResult] = useState<{ connection_id: number; accounts: Array<{ id: string; name: string; iban: string | null; currency: string }> } | null>(null);
  const [error, setError] = useState<string | null>(params.get('error_description') ?? params.get('error'));
  const [choices, setChoices] = useState<Record<string, { target: string; type: string; enabled: boolean }>>({});
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state || started.current) return;
    started.current = true;
    api
      .post<typeof result>('/bank/callback', { code, state })
      .then((r) => {
        setResult(r);
        setChoices(Object.fromEntries(r!.accounts.map((a) => [a.id, { target: 'new', type: 'checking', enabled: true }])));
      })
      .catch((e) => setError(e.message));
  }, [params]);

  const link = async () => {
    if (!result) return;
    setBusy(true);
    try {
      for (const a of result.accounts) {
        const c = choices[a.id];
        if (!c?.enabled) continue;
        await api.post(`/bank/connections/${result.connection_id}/link`, {
          bank_account: { id: a.id, name: a.name, currency: a.currency },
          account_id: c.target === 'new' ? null : Number(c.target),
          type: c.type,
          days_back: 90,
        });
      }
      navigate('/movimientos');
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head"><h1>Vincular cuentas del banco</h1></div>
      <ErrorBox error={error} />
      {!result && !error && <div className="card"><Empty>Completando la autorización…</Empty></div>}
      {result && (
        <div className="card stack">
          <p style={{ margin: 0 }}>Elige qué hacer con cada cuenta. Se importarán los últimos 90 días y el saldo se ajustará al del banco.</p>
          <table>
            <thead><tr><th /><th>Cuenta en el banco</th><th>Guardar como</th><th>Tipo</th></tr></thead>
            <tbody>
              {result.accounts.map((a) => {
                const c = choices[a.id];
                return (
                  <tr key={a.id}>
                    <td><input type="checkbox" checked={c?.enabled} onChange={(e) => setChoices({ ...choices, [a.id]: { ...c, enabled: e.target.checked } })} /></td>
                    <td><b>{a.name}</b><div className="small muted">{a.iban} · {a.currency}</div></td>
                    <td>
                      <select value={c?.target} onChange={(e) => setChoices({ ...choices, [a.id]: { ...c, target: e.target.value } })}>
                        <option value="new">Nueva cuenta</option>
                        {accounts?.filter((x) => x.currency === a.currency).map((x) => <option key={x.id} value={x.id}>Vincular con {x.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={c?.type} disabled={c?.target !== 'new'} onChange={(e) => setChoices({ ...choices, [a.id]: { ...c, type: e.target.value } })}>
                        {Object.entries(ACCOUNT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div><button className="primary" onClick={link} disabled={busy}>{busy ? 'Importando…' : 'Vincular e importar'}</button></div>
        </div>
      )}
    </>
  );
}
