import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, Plus, Search } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { kes, date, dateTime, today, addDays } from '../lib/format.js';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Card, Field, Input, Select, Modal, Spinner, EmptyState, StatusBadge, Avatar, Tabs } from '../components/ui.jsx';

export default function Tenants() {
  const toast = useToast();
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('active');
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const load = () => {
    setLoading(true);
    api
      .get(`/api/tenants${qs({ status: tab })}`)
      .then((d) => setTenants(d.tenants || []))
      .catch(() => setTenants([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, [tab]);

  const filtered = tenants.filter(
    (t) => !search || t.full_name.toLowerCase().includes(search.toLowerCase()) || t.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tenants</h1>
          <p>Manage the people renting your units.</p>
        </div>
        <div className="page-actions">
          <Button onClick={() => setShowAdd(true)}><Plus size={16} /> Add tenant</Button>
        </div>
      </div>

      <div className="flex-between mb-16 wrap">
        <Tabs
          tabs={[{ value: 'active', label: 'Active' }, { value: 'former', label: 'Former' }, { value: 'all', label: 'All' }]}
          value={tab}
          onChange={setTab}
        />
        <Input placeholder="Search tenants…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 260 }} />
      </div>

      {loading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Users} title="No tenants" message="Add a tenant to a vacant unit to get started." action={<Button className="mt-8" onClick={() => setShowAdd(true)}><Plus size={15} /> Add tenant</Button>} />
      ) : (
        <div className="grid grid-auto">
          {filtered.map((t) => (
            <Link to={`/app/tenants/${t.id}`} className="property-card" key={t.id} style={{ padding: 18 }}>
              <div className="flex-between">
                <div className="avatar-row">
                  <Avatar name={t.full_name} src={t.avatar_url} size={44} />
                  <div>
                    <strong>{t.full_name}</strong>
                    <div className="cell-muted">{t.email}</div>
                  </div>
                </div>
                <StatusBadge status={t.status} />
              </div>
              <div className="divider" />
              <div className="kv"><span>Property</span><span>{t.property_name || '—'}</span></div>
              <div className="kv"><span>Unit</span><span>{t.unit_number ? `${t.unit_number} · ${t.unit_type}` : '—'}</span></div>
              <div className="kv"><span>Rent</span><span>{t.lease ? kes(t.lease.rent) : '—'}</span></div>
              <div className="kv"><span>Lease</span><span>{t.lease ? <StatusBadge status={t.lease.lease_status} /> : <span className="faint">—</span>}</span></div>
              {t.lease?.arrears > 0 ? (
                <div className="notice notice-danger mt-8">Arrears: {kes(t.lease.arrears)}</div>
              ) : null}
            </Link>
          ))}
        </div>
      )}

      <AddTenantModal open={showAdd} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); toast.success('Tenant added'); load(); }} />
    </>
  );
}

function AddTenantModal({ open, onClose, onSaved }) {
  const toast = useToast();
  const [units, setUnits] = useState([]);
  const [form, setForm] = useState({
    full_name: '', email: '', phone: '', unit_id: '', start_date: today(), end_date: addDays(365), rent: '', deposit: '', frequency: 'monthly', password: '',
  });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [activation, setActivation] = useState(null);

  useEffect(() => {
    if (open) {
      api.get('/api/units?status=vacant').then((d) => setUnits(d.units || [])).catch(() => {});
    }
  }, [open]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrors({});
    try {
      const d = await api.post('/api/tenants', { ...form, unit_id: Number(form.unit_id) });
      setForm({ full_name: '', email: '', phone: '', unit_id: '', start_date: today(), end_date: addDays(365), rent: '', deposit: '', frequency: 'monthly', password: '' });
      if (d.activation?.url) {
        setActivation(d.activation);
      } else {
        toast.success('Tenant added');
        onSaved();
      }
    } catch (err) {
      setErrors(err.validation || {});
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const close = () => {
    setActivation(null);
    onClose();
  };

  const finish = () => {
    setActivation(null);
    onSaved();
  };

  return (
    <Modal open={open} onClose={close} title={activation ? 'Tenant added' : 'Add tenant'} size="lg">
      {activation ? (
        <div className="flex-col">
          <div className="notice notice-success">
            The tenant account was created and an activation link has been sent by SMS. Share this link if
            they did not receive it. It expires {dateTime(activation.expires_at)}.
          </div>
          <Field label="Activation link">
            <Input value={activation.url} readOnly onFocus={(e) => e.target.select()} />
          </Field>
          <p className="small muted">
            The tenant sets their own password on this page — no temporary password is ever sent by SMS.
          </p>
          <div className="modal-foot" style={{ padding: 0, border: 'none', marginTop: 8 }}>
            <Button variant="secondary" type="button" onClick={() => navigator.clipboard?.writeText(activation.url).then(() => toast.success('Link copied'))}>
              Copy link
            </Button>
            <Button type="button" onClick={finish}>Done</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit}>
          <div className="form-row">
            <Field label="Full name" required error={errors.full_name}><Input value={form.full_name} onChange={set('full_name')} required /></Field>
            <Field label="Phone" required error={errors.phone}><Input value={form.phone} onChange={set('phone')} placeholder="0712345678" required /></Field>
          </div>
          <Field label="Email" required error={errors.email}><Input type="email" value={form.email} onChange={set('email')} required /></Field>
          <Field label="Assign to unit" required error={errors.unit_id}>
            <Select value={form.unit_id} onChange={set('unit_id')} required>
              <option value="">Select a vacant unit…</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.property_name} — Unit {u.unit_number} ({u.unit_type}, {kes(u.rent)})</option>)}
            </Select>
          </Field>
          <div className="form-row">
            <Field label="Lease start" required><Input type="date" value={form.start_date} onChange={set('start_date')} required /></Field>
            <Field label="Lease end" required><Input type="date" value={form.end_date} onChange={set('end_date')} required /></Field>
          </div>
          <div className="form-row">
            <Field label="Monthly rent (KES)" hint="Defaults to unit rent"><Input type="number" value={form.rent} onChange={set('rent')} /></Field>
            <Field label="Deposit (KES)"><Input type="number" value={form.deposit} onChange={set('deposit')} /></Field>
          </div>
          <div className="form-row">
            <Field label="Frequency">
              <Select value={form.frequency} onChange={set('frequency')}>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="semi-annually">Semi-annually</option>
                <option value="annually">Annually</option>
              </Select>
            </Field>
            <Field label="Temp password" hint="Leave blank to email an activation link"><Input value={form.password} onChange={set('password')} placeholder="optional" /></Field>
          </div>
          <div className="modal-foot" style={{ padding: 0, border: 'none', marginTop: 8 }}>
            <Button variant="secondary" type="button" onClick={close}>Cancel</Button>
            <Button type="submit" loading={loading}>Add tenant</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
