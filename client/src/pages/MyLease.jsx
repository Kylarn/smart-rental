import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Download, CalendarDays, Wallet, MapPin } from 'lucide-react';
import { api } from '../lib/api.js';
import { kes, date, titleCase, monthLabel } from '../lib/format.js';
import { Card, Spinner, EmptyState, StatusBadge, Progress } from '../components/ui.jsx';

export default function MyLease() {
  const [lease, setLease] = useState(null);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/api/leases')
      .then((d) => {
        const active = (d.leases || []).find((l) => l.status === 'active') || d.leases?.[0] || null;
        setLease(active);
        if (active) {
          return api.get(`/api/leases/${active.id}`).then((r) => setPayments(r.payments || []));
        }
        return null;
      })
      .catch(() => setLease(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner label="Loading your lease…" />;
  if (!lease) {
    return (
      <EmptyState
        icon={FileText}
        title="No active lease"
        message="Once a landlord assigns you a unit, your lease will appear here."
        action={<Link to="/" className="btn btn-primary btn-sm mt-8">Browse rentals</Link>}
      />
    );
  }

  const paid = lease.coverage.filter((c) => c.paid).length;
  const total = lease.coverage.length || 1;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My Lease</h1>
          <p>{lease.property_name}, Unit {lease.unit_number}</p>
        </div>
        <StatusBadge status={lease.lease_status} />
      </div>

      <div className="grid grid-3 mb-16">
        <div className="stat stat-blue"><div className="stat-main"><span className="stat-label">Monthly rent</span><span className="stat-value">{kes(lease.rent)}</span></div><span className="stat-icon"><Wallet size={20} /></span></div>
        <div className="stat"><div className="stat-main"><span className="stat-label">Deposit</span><span className="stat-value">{kes(lease.deposit)}</span></div></div>
        <div className={`stat ${lease.arrears > 0 ? 'stat-red' : 'stat-green'}`}><div className="stat-main"><span className="stat-label">Arrears</span><span className="stat-value">{kes(lease.arrears)}</span></div></div>
      </div>

      <div className="grid grid-2 mb-16">
        <Card title="Lease details">
          <div className="kv"><span>Property</span><span>{lease.property_name}</span></div>
          <div className="kv"><span>Unit</span><span>{lease.unit_number} · {lease.unit_type}{lease.floor ? ` · ${lease.floor}` : ''}</span></div>
          <div className="kv"><span>Location</span><span><MapPin size={14} /> {lease.area ? `${lease.area}, ` : ''}{lease.county}</span></div>
          <div className="kv"><span>Period</span><span>{date(lease.start_date)} → {date(lease.end_date)}</span></div>
          <div className="kv"><span>Frequency</span><span>{titleCase(lease.frequency)}</span></div>
          {lease.document_url ? (
            <a className="btn btn-secondary btn-sm mt-8" href={lease.document_url} target="_blank" rel="noreferrer"><Download size={15} /> View agreement</a>
          ) : null}
        </Card>

        <Card title="Rent coverage">
          <div className="flex-between mb-8">
            <span className="muted small">{paid} of {total} months paid</span>
            {lease.days_to_expiry >= 0 ? <span className="small muted"><CalendarDays size={13} /> {lease.days_to_expiry} days to expiry</span> : null}
          </div>
          <Progress value={paid} max={total} tone={paid === total ? 'green' : 'blue'} />
          <div className="coverage-grid mt-16">
            {lease.coverage.map((c) => (
              <div key={c.period} className={`cov-cell ${c.paid ? 'cov-cell-paid' : ''}`}>
                <span>{monthLabel(c.period).split(' ')[0]}</span>
                <small>{monthLabel(c.period).split(' ')[1]}</small>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Payment history" padded={false}>
        {payments.length === 0 ? (
          <EmptyState icon={Wallet} title="No payments yet" message="Your rent payments will show up here." />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Receipt</th><th>Period</th><th>Method</th><th className="text-right">Amount</th><th>Status</th><th>Date</th></tr></thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="mono">{p.receipt_number || '—'}</td>
                    <td>{monthLabel(p.period) || p.period}</td>
                    <td className="cell-muted">{titleCase(p.method)}</td>
                    <td className="text-right cell-strong">{kes(p.amount)}</td>
                    <td><StatusBadge status={p.status} /></td>
                    <td className="cell-muted">{date(p.paid_at || p.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
