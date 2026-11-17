import { NavLink, Route, Routes } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Transactions from './pages/Transactions';
import Accounts from './pages/Accounts';
import Budget from './pages/Budget';
import Debts from './pages/Debts';
import Goals from './pages/Goals';
import Import from './pages/Import';
import Banks, { BankCallback } from './pages/Banks';
import Settings from './pages/Settings';
import { LOCAL_MODE } from './api';

const NAV = [
  ['/', '📊', 'Panel'],
  ['/movimientos', '↕️', 'Movimientos'],
  ['/cuentas', '🏦', 'Cuentas'],
  ['/presupuesto', '🎯', 'Presupuesto'],
  ['/deudas', '💳', 'Deudas'],
  ['/ahorros', '🐷', 'Ahorros'],
  ['/importar', '📥', 'Importar CSV'],
  ['/bancos', '🔗', 'Bancos'],
  ['/ajustes', '⚙️', 'Ajustes'],
] as const;

export default function App() {
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" /> Bisy
        </div>
        <nav className="nav">
          {NAV.map(([to, ico, label]) => (
            <NavLink key={to} to={to} end={to === '/'}>
              <span className="ico">{ico}</span>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="foot">
          {LOCAL_MODE ? 'Tus datos se guardan solo en este dispositivo. Haz copias en Ajustes.' : 'Tus datos se guardan en local (SQLite).'}
        </div>
      </aside>
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/movimientos" element={<Transactions />} />
          <Route path="/cuentas" element={<Accounts />} />
          <Route path="/presupuesto" element={<Budget />} />
          <Route path="/deudas" element={<Debts />} />
          <Route path="/ahorros" element={<Goals />} />
          <Route path="/importar" element={<Import />} />
          <Route path="/bancos" element={<Banks />} />
          <Route path="/bancos/callback" element={<BankCallback />} />
          <Route path="/ajustes" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
