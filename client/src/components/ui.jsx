import { useEffect } from 'react';
import { X } from 'lucide-react';
import { initials } from '../lib/format.js';

export function Button({ variant = 'primary', size = 'md', loading, children, className = '', ...props }) {
  return (
    <button
      className={`btn btn-${variant} btn-${size} ${className}`}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <span className="spinner spinner-sm" /> : null}
      {children}
    </button>
  );
}

export function Card({ title, action, children, className = '', padded = true }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="card-head">
          {title ? <h3>{title}</h3> : <span />}
          {action}
        </header>
      )}
      <div className={padded ? 'card-body' : ''}>{children}</div>
    </section>
  );
}

export function StatCard({ label, value, hint, icon: Icon, tone = 'default' }) {
  return (
    <div className={`stat stat-${tone}`}>
      <div className="stat-main">
        <span className="stat-label">{label}</span>
        <span className="stat-value">{value}</span>
        {hint ? <span className="stat-hint">{hint}</span> : null}
      </div>
      {Icon ? (
        <span className="stat-icon">
          <Icon size={20} />
        </span>
      ) : null}
    </div>
  );
}

const STATUS_TONES = {
  active: 'green',
  completed: 'green',
  approved: 'green',
  assigned: 'green',
  closed: 'gray',
  occupied: 'blue',
  vacant: 'amber',
  reserved: 'purple',
  maintenance: 'amber',
  pending: 'amber',
  processing: 'blue',
  under_review: 'blue',
  info_requested: 'amber',
  submitted: 'amber',
  in_progress: 'blue',
  failed: 'red',
  rejected: 'red',
  terminated: 'red',
  expired: 'red',
  suspended: 'red',
  archived: 'gray',
  expiring: 'amber',
};

export function StatusBadge({ status, label }) {
  const tone = STATUS_TONES[status] || 'gray';
  const text = label || String(status || '').replace(/_/g, ' ');
  return <span className={`badge badge-${tone}`}>{text}</span>;
}

export function Badge({ children, tone = 'gray' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Avatar({ name, src, size = 36 }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {src ? <img src={src} alt={name || ''} /> : initials(name)}
    </span>
  );
}

export function Field({ label, error, hint, children, required }) {
  return (
    <label className={`field ${error ? 'has-error' : ''}`}>
      {label ? (
        <span className="field-label">
          {label} {required ? <em>*</em> : null}
        </span>
      ) : null}
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Input({ className = '', ...props }) {
  return <input className={`input ${className}`} {...props} />;
}

export function Textarea({ className = '', ...props }) {
  return <textarea className={`input textarea ${className}`} {...props} />;
}

export function Select({ className = '', children, ...props }) {
  return (
    <select className={`input select ${className}`} {...props}>
      {children}
    </select>
  );
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal modal-${size}`} role="dialog" aria-modal="true">
        <header className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-foot">{footer}</footer> : null}
      </div>
    </div>
  );
}

export function EmptyState({ title, message, icon: Icon, action }) {
  return (
    <div className="empty">
      {Icon ? <Icon size={32} /> : null}
      <h4>{title}</h4>
      {message ? <p>{message}</p> : null}
      {action}
    </div>
  );
}

export function Spinner({ label }) {
  return (
    <div className="loading">
      <span className="spinner" />
      {label ? <span>{label}</span> : null}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          className={`tab ${value === t.value ? 'active' : ''}`}
          onClick={() => onChange(t.value)}
        >
          {t.label}
          {t.count !== undefined ? <span className="tab-count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Progress({ value, max = 100, tone = 'blue' }) {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="progress">
      <div className={`progress-bar progress-${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
