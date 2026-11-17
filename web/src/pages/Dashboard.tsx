import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { LOCAL_MODE, type Dashboard as D } from '../api';
import { useApi } from '../hooks';
import { money, monthLabel, pct, thisMonth } from '../format';
import { BudgetBadge, Empty, ErrorBox, Meter, Money, MonthPicker } from '../components/ui';

export default function Dashboard() {
  const [month, setMonth] = useState(thisMonth());
  const { data, error } = useApi<D>(`/dashboard?month=${month}`);
  const base = data?.base_currency ?? 'EUR';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Panel</h1>
          <p>Tu dinero de un vistazo. Totales consolidados en {base}.</p>
        </div>
        <MonthPicker value={month} onChange={setMonth} />
      </div>
      <ErrorBox error={error} />
      {data && data.missing_rates.length > 0 && (
        <div className="alert warn" style={{ marginBottom: 16 }}>
          Falta el tipo de cambio para {data.missing_rates.join(', ')}. Añádelo en <Link to="/ajustes">Ajustes</Link> para ver los totales correctos.
        </div>
      )}
      {data && data.accounts.length === 0 && <Welcome />}
      {data && data.accounts.length > 0 && (
        <div className="stack">
          <div className="grid g-4">
            <Stat label="Patrimonio neto" value={money(data.net_worth.net, base)} hint={`Activos ${money(data.net_worth.assets, base)} · Deudas ${money(data.net_worth.debts, base)}`} />
            <Stat label="Ingresos del mes" dot="var(--income)" value={money(data.totals.income, base)} />
            <Stat label="Gastos del mes" dot="var(--expense)" value={money(data.totals.expense, base)} />
            <Stat
              label="Ahorro del mes"
              value={money(data.totals.savings, base, { sign: true })}
              hint={data.totals.income ? `Tasa de ahorro ${pct(data.totals.savings_rate)}` : 'Sin ingresos este mes'}
            />
          </div>

          <div className="grid g-21">
            <IncomeExpenseChart data={data} />
            <CategoryBreakdown data={data} />
          </div>

          <AccountsTable data={data} />

          <div className="grid g-3">
            <BudgetCard data={data} />
            <DebtsCard data={data} />
            <GoalsCard data={data} />
          </div>

          <NetWorthChart data={data} />
        </div>
      )}
    </>
  );
}

function Stat({ label, value, hint, dot }: { label: string; value: string; hint?: string; dot?: string }) {
  return (
    <div className="card stat">
      <div className="label">
        {dot && <span className="dot" style={{ background: dot }} />}
        {label}
      </div>
      <div className="value num">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

function Tip({ active, payload, label, base }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <div className="t" style={{ textTransform: 'capitalize' }}>{monthLabel(label, true)}</div>
      {payload.map((p: any) => (
        <div className="r" key={p.dataKey}>
          <span className="row" style={{ gap: 6 }}>
            <span className="dot" style={{ background: p.color }} />
            {p.name}
          </span>
          <b className="num">{money(p.value, base)}</b>
        </div>
      ))}
    </div>
  );
}

function IncomeExpenseChart({ data }: { data: D }) {
  const base = data.base_currency;
  return (
    <div className="card">
      <div className="card-head">
        <h2>Ingresos vs gastos · 12 meses</h2>
        <div className="legend">
          <span><span className="dot" style={{ background: 'var(--income)' }} />Ingresos</span>
          <span><span className="dot" style={{ background: 'var(--expense)' }} />Gastos</span>
        </div>
      </div>
      <div style={{ height: 260 }}>
        <ResponsiveContainer>
          <BarChart data={data.trend} barGap={2} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="month" tickFormatter={(m) => monthLabel(m)} tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v) => money(v, base, { compact: true })} tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={64} />
            <Tooltip content={<Tip base={base} />} cursor={{ fill: 'var(--surface-2)' }} />
            <Bar dataKey="income" name="Ingresos" fill="var(--income)" radius={[4, 4, 0, 0]} maxBarSize={18} />
            <Bar dataKey="expense" name="Gastos" fill="var(--expense)" radius={[4, 4, 0, 0]} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function CategoryBreakdown({ data }: { data: D }) {
  const base = data.base_currency;
  const rows = data.expenses_by_category;
  const top = rows.slice(0, 8);
  const rest = rows.slice(8).reduce((a, r) => a + r.amount, 0);
  if (rest > 0) top.push({ category_id: -1, name: 'Otras', color: '', icon: '…', amount: rest });
  const max = Math.max(1, ...top.map((r) => r.amount));
  const total = rows.reduce((a, r) => a + r.amount, 0);
  return (
    <div className="card">
      <div className="card-head">
        <h2>¿En qué gasté?</h2>
        <span className="sub num">{money(total, base)}</span>
      </div>
      {top.length === 0 && <Empty>Sin gastos este mes</Empty>}
      {top.map((r) => (
        <Link
          key={r.category_id ?? 'none'}
          to={r.category_id && r.category_id > 0 ? `/movimientos?month=${data.month}&category_id=${r.category_id}` : `/movimientos?month=${data.month}&kind=expense`}
          className="catbar"
          style={{ color: 'inherit' }}
          title={`${r.name}: ${money(r.amount, base)} (${pct(r.amount / total)})`}
        >
          <span className="name">{r.icon} {r.name}</span>
          <span className="bar"><span style={{ width: `${(r.amount / max) * 100}%` }} /></span>
          <span className="num" style={{ textAlign: 'right' }}>{money(r.amount, base)}</span>
        </Link>
      ))}
    </div>
  );
}

function AccountsTable({ data }: { data: D }) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>Cuentas: cómo empezó y terminó el mes</h2>
        <Link to="/cuentas" className="small">Ver cuentas →</Link>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Cuenta</th>
              <th className="r">Saldo inicial</th>
              <th className="r">Ingresos</th>
              <th className="r">Gastos</th>
              <th className="r">Traspasos</th>
              <th className="r">Saldo final</th>
              <th className="r">Variación</th>
            </tr>
          </thead>
          <tbody>
            {data.accounts.map((a) => {
              const transfers = a.transfers_in - a.transfers_out + a.adjustments;
              return (
                <tr key={a.account_id}>
                  <td>
                    <span className="row" style={{ gap: 8 }}>
                      <span className="dot" style={{ background: a.color }} />
                      <Link to={`/movimientos?account_id=${a.account_id}&month=${data.month}`} style={{ color: 'inherit' }}>{a.name}</Link>
                      <span className="chip">{a.currency}</span>
                    </span>
                  </td>
                  <td className="r"><Money cents={a.opening} currency={a.currency} /></td>
                  <td className="r"><Money cents={a.income} currency={a.currency} /></td>
                  <td className="r"><Money cents={-a.expense} currency={a.currency} /></td>
                  <td className="r"><Money cents={transfers} currency={a.currency} sign /></td>
                  <td className="r"><b><Money cents={a.closing} currency={a.currency} /></b></td>
                  <td className="r"><Money cents={a.closing - a.opening} currency={a.currency} sign colored /></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            {Object.entries(data.by_currency).map(([cur, v]) => (
              <tr key={cur}>
                <td>Total {cur}</td>
                <td className="r"><Money cents={v.opening} currency={cur} /></td>
                <td colSpan={3} />
                <td className="r"><Money cents={v.closing} currency={cur} /></td>
                <td className="r"><Money cents={v.closing - v.opening} currency={cur} sign colored /></td>
              </tr>
            ))}
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function BudgetCard({ data }: { data: D }) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>Presupuesto</h2>
        <Link to="/presupuesto" className="small">Editar →</Link>
      </div>
      {data.budget.length === 0 && <Empty>Aún no hay presupuesto para este mes</Empty>}
      <div className="stack" style={{ gap: 12 }}>
        {data.budget.slice(0, 6).map((b) => (
          <div key={b.id}>
            <div className="row" style={{ marginBottom: 5 }}>
              <span>{b.icon} {b.category_name}</span>
              <span className="spacer" />
              <span className="small num">
                {money(b.spent, b.currency)} / {money(b.amount, b.currency)}
              </span>
            </div>
            <Meter ratio={b.ratio} />
            <div style={{ marginTop: 3 }}><BudgetBadge ratio={b.ratio} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DebtsCard({ data }: { data: D }) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>Deudas</h2>
        <Link to="/deudas" className="small">Ver →</Link>
      </div>
      {data.debts.length === 0 && <Empty>Sin deudas activas 🎉</Empty>}
      <div className="stack" style={{ gap: 14 }}>
        {data.debts.map((d) => (
          <div key={d.id}>
            <div className="row" style={{ marginBottom: 5 }}>
              <span>{d.name}</span>
              <span className="spacer" />
              <span className="small num">Quedan {money(d.remaining, d.currency)}</span>
            </div>
            <Meter ratio={d.progress} mode="progress" />
            <div className="small muted" style={{ marginTop: 3 }}>
              {pct(d.progress)} pagado{d.payoff_date ? ` · fin estimado ${monthLabel(d.payoff_date, true)}` : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GoalsCard({ data }: { data: D }) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>Metas de ahorro</h2>
        <Link to="/ahorros" className="small">Ver →</Link>
      </div>
      {data.goals.length === 0 && <Empty>Crea tu primera meta de ahorro</Empty>}
      <div className="stack" style={{ gap: 14 }}>
        {data.goals.map((g) => (
          <div key={g.id}>
            <div className="row" style={{ marginBottom: 5 }}>
              <span>{g.name}</span>
              <span className="spacer" />
              <span className="small num">{money(g.current, g.currency)} / {money(g.target_amount, g.currency)}</span>
            </div>
            <Meter ratio={g.progress} mode="progress" color="var(--good)" />
            <div className="small muted" style={{ marginTop: 3 }}>
              {pct(g.progress)}
              {g.monthly_needed ? ` · ahorra ${money(g.monthly_needed, g.currency)}/mes para llegar` : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NetWorthChart({ data }: { data: D }) {
  const base = data.base_currency;
  return (
    <div className="card">
      <div className="card-head">
        <h2>Evolución del saldo total en cuentas ({base})</h2>
      </div>
      <div style={{ height: 220 }}>
        <ResponsiveContainer>
          <AreaChart data={data.net_worth_trend}>
            <defs>
              <linearGradient id="nw" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="month" tickFormatter={(m) => monthLabel(m)} tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v) => money(v, base, { compact: true })} tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={64} domain={['auto', 'auto']} />
            <Tooltip content={<Tip base={base} />} cursor={{ stroke: 'var(--muted)', strokeDasharray: '3 3' }} />
            <Area type="monotone" dataKey="total" name="Saldo" stroke="var(--accent)" strokeWidth={2} fill="url(#nw)" dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)' }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Welcome() {
  return (
    <div className="card stack" style={{ maxWidth: 680 }}>
      <h2 style={{ fontSize: 18 }}>👋 Bienvenido a Bisy</h2>
      <p style={{ margin: 0 }}>Empieza creando tus cuentas (por ejemplo, tu cuenta del banco en euros y tu cuenta en pesos) con el saldo que tienen hoy.</p>
      {LOCAL_MODE && (
        <p className="small muted" style={{ margin: 0 }}>
          Tus datos se guardan solo en este dispositivo y no se envían a ningún sitio. ¿Quieres verla funcionando antes?
          Carga datos de ejemplo desde <Link to="/ajustes">Ajustes → Tus datos</Link>.
        </p>
      )}
      <div className="row">
        <Link to="/cuentas"><button className="primary">Crear mi primera cuenta</button></Link>
        <Link to="/ajustes"><button>Tipos de cambio</button></Link>
      </div>
    </div>
  );
}
