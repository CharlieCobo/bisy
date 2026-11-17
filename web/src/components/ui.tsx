import { useEffect, useState, type ReactNode } from 'react';
import { money, monthLabel, parseMoney, centsToInput, shiftMonth } from '../format';

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function MonthPicker({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  return (
    <div className="row" style={{ gap: 4 }}>
      <button className="small" onClick={() => onChange(shiftMonth(value, -1))} aria-label="Mes anterior">‹</button>
      <input type="month" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} style={{ width: 160 }} />
      <button className="small" onClick={() => onChange(shiftMonth(value, 1))} aria-label="Mes siguiente">›</button>
      <span className="muted small" style={{ marginLeft: 6, textTransform: 'capitalize' }}>{monthLabel(value, true)}</span>
    </div>
  );
}

export function Money({ cents, currency, sign, colored, compact }: { cents: number; currency: string; sign?: boolean; colored?: boolean; compact?: boolean }) {
  const cls = colored ? (cents > 0 ? 'pos' : 'neg') : '';
  return <span className={`num ${cls}`}>{money(cents, currency, { sign, compact })}</span>;
}

/** Barra de progreso con estado (ok / aviso / excedido) que nunca depende solo del color. */
export function Meter({ ratio, mode = 'budget', color }: { ratio: number; mode?: 'budget' | 'progress'; color?: string }) {
  const cls = mode === 'budget' ? (ratio > 1 ? 'over' : ratio > 0.85 ? 'warn' : '') : '';
  return (
    <div className={`meter ${cls}`} role="meter" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%`, ...(color && !cls ? { background: color } : {}) }} />
    </div>
  );
}

export function BudgetBadge({ ratio }: { ratio: number }) {
  if (ratio > 1) return <span className="badge-status over">▲ Excedido</span>;
  if (ratio > 0.85) return <span className="badge-status warn">● Cerca del límite</span>;
  return <span className="badge-status ok">✓ En rango</span>;
}

/** Campo de dinero que acepta "1.234,56" y devuelve céntimos. */
export function MoneyInput({ value, onChange, placeholder, autoFocus }: { value: number | null; onChange: (c: number | null) => void; placeholder?: string; autoFocus?: boolean }) {
  const [text, setText] = useState(value != null ? centsToInput(value) : '');
  useEffect(() => {
    if (value == null) setText('');
  }, [value]);
  return (
    <input
      inputMode="decimal"
      className="num"
      style={{ width: '100%' }}
      value={text}
      placeholder={placeholder ?? '0,00'}
      autoFocus={autoFocus}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseMoney(e.target.value));
      }}
    />
  );
}

export function ErrorBox({ error }: { error: string | null }) {
  return error ? <div className="alert error">{error}</div> : null;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
