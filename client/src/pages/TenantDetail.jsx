import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Phone, Mail, MapPin, IdCard } from 'lucide-react';
import { api } from '../lib/api.js';
import { kes, date, titleCase } from '../lib/format.js';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Card, Field, Input, Modal, Spinner, EmptyState, StatusBadge, Avatar, Tabs } from '../components/ui.jsx';

export default function TenantDetail() {
  const { id } = useParams();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('payments');
  const [showEdit, setShowEdit] = useState(false);

  const load = () => {
    setLoading(true);
    api
      .get(`/api/tenants/${id}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  useEffect(load, [id]);

  if (loading) return <Spinner label="Loading tenant…" />;
  if (!data) return <EmptyState title="Tenant not found" action={<Link to="/app/tenants" className="btn btn-secondary btn-sm mt-8">Back</Link>} />;

  const { tenant, leases, payments, maintenance, total_paid, arrears } = data;
  const activeLease = leases.find((l) => l.lease_status === 'active') || leases[0];

  return (
    <>
      <Link to="/app/tenants" className="link flex small" style={{ marginBottom: 14 }}><ArrowLeft size={15} /> All tenants</Link>

      <div className="page-head">
        <div className="avatar-row">
          <Avatar name={tenant.full_name} src={tenant.avatar_url} size={54} />
          <div>
            <h1>{tenant.full_name}</h1>
            <p>{tenant.email} · {tenant.phone || 'no phone'}</p>
          </div>
        </div>
        <div className="page-actions">
          <StatusBadge status={tenant.status} />
          <Button variant="secondary" onClick={() => setShowEdit(true)}><Pencil size={15} /> Edit</Button>
        </div>
      </div>

      <div className="grid grid-3 mb-16">
        <Card title="Contact">
          <div className="flex-col small">
            <span className="flex"><Mail size={15} /> {tenant.email}</span>
            <span className="flex"><Phone size={15} /> {tenant.phone || '—'}</span>
            <span className="flex"><MapPin size={15} /> {tenant.county || '—'}</span>
            <span className="flex"><IdCard size={15} /> {tenant.id_number || '—'}</span>
          </div>
        </Card>
        <Card title="Lease">
          {activeLease ? (
            <>
              <div className="kv"><span>Property</span><span>{activeLease.property_name}</span></div>
              <div className="kv"><span>Unit</span><span>{activeLease.unit_number}</span></div>
              <div className="kv"><span>Rent</span><span>{kes(activeLease.rent)}</span></div>
              <div className="kv"><span>Period</span><span>{date(activeLease.start_date)} → {date(activeLease.end_date)}</span></div>
            </>
          ) : <p className="muted small">No active lease</p>}
        </Card>
        <Card title="Financials">
          <div className="kv"><span>Total paid</span><span style={{ color: 'var(--green)' }}>{kes(total_paid)}</span></div>
          <div className="kv"><span>Arrears</span><span style={{ color: arrears.total > 0 ? 'var(--red)' : 'var(--green)' }}>{kes(arrears.total)}</span></div>
          {arrears.unpaidPeriods?.length ? (
            <div className="chip-row mt-8">{arrears.unpaidPeriods.map((m) => <span className="chip" key={m}>{m}</span>)}</div>
          ) : null}
        </Card>
      </div>

      <Tabs
        tabs={[
          { value: 'payments', label: 'Payments', count: payments.length },
          { value: 'leases', label: 'Leases', count: leases.length },
          { value: 'maintenance', label: 'Maintenance', count: maintenance.length },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'payments' ? (
        <Card padded={false}>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Receipt</th><th>Period</th><th>Method</th><th className="text-right">Amount</th><th>Status</th><th>Date</th></tr></thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="mono">{p.receipt_number || '—'}</td>
                    <td>{p.period || '—'}</td>
                    <td className="cell-muted">{titleCase(p.method)}</td>
                    <td className="text-right cell-strong">{kes(p.amount)}</td>
                    <td><StatusBadge status={p.status} /></td>
                    <td className="cell-muted">{date(p.paid_at || p.created_at)}</td>
                  </tr>
                ))}
                {!payments.length ? <tr><td colSpan={6}><div className="empty">No payments recorded</div></td></tr> : null}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {tab === 'leases' ? (
        <div className="flex-col">
          {leases.map((l) => (
            <Card key={l.id}>
              <div className="flex-between">
                <div>
                  <strong>{l.property_name} · Unit {l.unit_number}</strong>
                  <div className="cell-muted">{date(l.start_date)} → {date(l.end_date)} · {kes(l.rent)}/mo</div>
                </div>
                <div className="flex">
                  {l.arrears > 0 ? <span className="badge badge-red">{kes(l.arrears)} arrears</span> : null}
                  <StatusBadge status={l.lease_status} />
                </div>
              </div>
            </Card>
          ))}
          {!leases.length ? <EmptyState title="No leases" /> : null}
        </div>
      ) : null}

      {tab === 'maintenance' ? (
        <Card padded={false}>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Issue</th><th>Category</th><th>Priority</th><th>Status</th><th>Reported</th></tr></thead>
              <tbody>
                {maintenance.map((m) => (
                  <tr key={m.id}>
                    <td className="cell-strong">{m.title}</td>
                    <td className="cell-muted">{m.category}</td>
                    <td><StatusBadge status={m.priority} /></td>
                    <td><StatusBadge status={m.status} /></td>
                    <td className="cell-muted">{date(m.created_at)}</td>
                  </tr>
                ))}
                {!maintenance.length ? <tr><td colSpan={5}><div className="empty">No maintenance requests</div></td></tr> : null}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <EditTenantModal open={showEdit} onClose={() => setShowEdit(false)} tenant={tenant} onSaved={() => { setShowEdit(false); toast.success('Tenant updated'); load(); }} />
    </>
  );
}

function EditTenantModal({ open, onClose, tenant, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ full_name: '', phone: '', county: '', id_number: '' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && tenant) setForm({ full_name: tenant.full_name || '', phone: tenant.phone || '', county: tenant.county || '', id_number: tenant.id_number || '' });
  }, [open, tenant]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.put(`/api/tenants/${tenant.id}`, form);
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Edit tenant" size="md">
      <form onSubmit={submit}>
        <Field label="Full name"><Input value={form.full_name} onChange={set('full_name')} /></Field>
        <Field label="Phone"><Input value={form.phone} onChange={set('phone')} /></Field>
        <div className="form-row">
          <Field label="County"><Input value={form.county} onChange={set('county')} /></Field>
          <Field label="ID number"><Input value={form.id_number} onChange={set('id_number')} /></Field>
        </div>
        <div className="modal-foot" style={{ padding: 0, border: 'none', marginTop: 8 }}>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}
