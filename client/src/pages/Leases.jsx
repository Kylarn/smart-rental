import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Plus, Upload, Ban, Download, Pencil } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { kes, date, titleCase } from '../lib/format.js';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Card, Field, Input, Select, Modal, Spinner, EmptyState, StatusBadge, Tabs } from '../components/ui.jsx';

export default function Leases() {
  const toast = useToast();
  const [leases, setLeases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('active');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null);
  const [uploading, setUploading] = useState(null);

  const load = () => {
    setLoading(true);
    api
      .get(`/api/leases${qs({ status: status === 'all' ? '' : status })}`)
      .then((d) => setLeases(d.leases || []))
      .catch(() => setLeases([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, [status]);

  const terminate = async (lease) => {
    if (!window.confirm(`Terminate the lease for ${lease.tenant_name} (Unit ${lease.unit_number})?`)) return;
    try {
      await api.post(`/api/leases/${lease.id}/terminate`, {});
      toast.success('Lease terminated');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const onUpload = async (lease, file) => {
    if (!file) return;
    setUploading(lease.id);
    const fd = new FormData();
    fd.append('document', file);
    try {
      await api.post(`/api/leases/${lease.id}/document`, fd);
      toast.success('Document uploaded');
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUploading(null);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Leases</h1>
          <p>Track tenancy agreements, coverage and renewals.</p>
        </div>
        <div className="page-actions">
          <Button onClick={() => setShowCreate(true)}><Plus size={16} /> New lease</Button>
        </div>
      </div>

      <div className="flex-between mb-16 wrap">
        <Tabs
          tabs={[
            { value: 'active', label: 'Active' },
            { value: 'expired', label: 'Expired' },
            { value: 'terminated', label: 'Terminated' },
            { value: 'all', label: 'All' },
          ]}
          value={status}
          onChange={setStatus}
        />
        <span className="cell-muted">{leases.length} leases</span>
      </div>

      {loading ? (
        <Spinner />
      ) : leases.length === 0 ? (
        <EmptyState icon={FileText} title="No leases" message="Create a lease to put a tenant into a unit." action={<Button className="mt-8" onClick={() => setShowCreate(true)}><Plus size={15} /> New lease</Button>} />
      ) : (
        <Card padded={false}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Tenant</th><th>Property / Unit</th><th>Rent</th><th>Period</th><th>Coverage</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {leases.map((l) => (
                  <tr key={l.id}>
                    <td className="cell-strong">
                      {l.tenant_name}
                      <div className="cell-muted">{l.tenant_email}</div>
                    </td>
                    <td>
                      {l.property_name}
                      <div className="cell-muted">Unit {l.unit_number} · {l.unit_type}</div>
                    </td>
                    <td className="cell-strong">
                      {kes(l.rent)}
                      <div className="cell-muted">{titleCase(l.frequency)}</div>
                    </td>
                    <td className="cell-muted">{date(l.start_date)}<br />{date(l.end_date)}</td>
                    <td>
                      <div className="coverage">
                        {l.coverage.slice(-6).map((c) => (
                          <span key={c.period} className={`cov-dot ${c.paid ? 'cov-paid' : 'cov-due'}`} title={c.period} />
                        ))}
                      </div>
                      {l.arrears > 0 ? <span className="small" style={{ color: 'var(--red)' }}>{kes(l.arrears)} due</span> : <span className="small muted">Up to date</span>}
                    </td>
                    <td>
                      <StatusBadge status={l.lease_status} />
                      {l.lease_status === 'expiring' ? <div className="small muted">{l.days_to_expiry}d left</div> : null}
                    </td>
                    <td className="row-actions">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(l)}><Pencil size={14} /></Button>
                      <label className="icon-btn" title="Upload document">
                        {uploading === l.id ? <span className="spinner spinner-sm" /> : <Upload size={15} />}
                        <input type="file" hidden accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => onUpload(l, e.target.files?.[0])} />
                      </label>
                      {l.document_url ? (
                        <a className="icon-btn" href={l.document_url} target="_blank" rel="noreferrer" title="View document"><Download size={15} /></a>
                      ) : null}
                      {l.status === 'active' ? (
                        <Button size="sm" variant="ghost" title="Terminate" onClick={() => terminate(l)}><Ban size={14} /></Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <CreateLeaseModal open={showCreate} onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); toast.success('Lease created'); load(); }} />
      <EditLeaseModal lease={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); toast.success('Lease updated'); load(); }} />
    </>
  );
}

function CreateLeaseModal({ open, onClose, onSaved }) {
  const toast = useToast();
  const [units, setUnits] = useState([]);
  const [form, setForm] = useState({
    unit_id: '', tenant_name: '', tenant_email: '', tenant_phone: '',
    start_date: new Date().toISOString().slice(0, 10),
    end_date: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
    rent: '', deposit: '', frequency: 'monthly', notes: '',
  });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (open) api.get('/api/units?status=vacant').then((d) => setUnits(d.units || [])).catch(() => {});
  }, [open]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrors({});
    try {
      await api.post('/api/leases', { ...form, unit_id: Number(form.unit_id) });
      onSaved();
    } catch (err) {
      setErrors(err.validation || {});
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New lease" size="lg">
      <form onSubmit={submit}>
        <Field label="Vacant unit" required error={errors.unit_id}>
          <Select value={form.unit_id} onChange={set('unit_id')} required>
            <option value="">Select a vacant unit…</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.property_name} — Unit {u.unit_number} ({u.unit_type}, {kes(u.rent)})</option>)}
          </Select>
        </Field>
        <div className="form-row">
          <Field label="Tenant name" required error={errors.tenant_name}><Input value={form.tenant_name} onChange={set('tenant_name')} required /></Field>
          <Field label="Tenant phone" required error={errors.tenant_phone}><Input value={form.tenant_phone} onChange={set('tenant_phone')} required /></Field>
        </div>
        <Field label="Tenant email" required error={errors.tenant_email}><Input type="email" value={form.tenant_email} onChange={set('tenant_email')} required /></Field>
        <div className="form-row">
          <Field label="Start date" required><Input type="date" value={form.start_date} onChange={set('start_date')} required /></Field>
          <Field label="End date" required error={errors.end_date}><Input type="date" value={form.end_date} onChange={set('end_date')} required /></Field>
        </div>
        <div className="form-row">
          <Field label="Rent (KES)" hint="Defaults to unit rent"><Input type="number" value={form.rent} onChange={set('rent')} /></Field>
          <Field label="Deposit (KES)"><Input type="number" value={form.deposit} onChange={set('deposit')} /></Field>
        </div>
        <Field label="Frequency">
          <Select value={form.frequency} onChange={set('frequency')}>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="semi-annually">Semi-annually</option>
            <option value="annually">Annually</option>
          </Select>
        </Field>
        <div className="modal-foot" style={{ padding: 0, border: 'none', marginTop: 8 }}>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>Create lease</Button>
        </div>
      </form>
    </Modal>
  );
}

function EditLeaseModal({ lease, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (lease) setForm({ start_date: lease.start_date, end_date: lease.end_date, rent: lease.rent, deposit: lease.deposit, frequency: lease.frequency, notes: lease.notes || '' });
  }, [lease]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.put(`/api/leases/${lease.id}`, form);
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={!!lease} onClose={onClose} title="Edit lease" size="md">
      <form onSubmit={submit}>
        <div className="form-row">
          <Field label="Start date"><Input type="date" value={form.start_date || ''} onChange={set('start_date')} /></Field>
          <Field label="End date"><Input type="date" value={form.end_date || ''} onChange={set('end_date')} /></Field>
        </div>
        <div className="form-row">
          <Field label="Rent (KES)"><Input type="number" value={form.rent || ''} onChange={set('rent')} /></Field>
          <Field label="Deposit (KES)"><Input type="number" value={form.deposit || ''} onChange={set('deposit')} /></Field>
        </div>
        <Field label="Frequency">
          <Select value={form.frequency || 'monthly'} onChange={set('frequency')}>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="semi-annually">Semi-annually</option>
            <option value="annually">Annually</option>
          </Select>
        </Field>
        <Field label="Notes"><Input value={form.notes || ''} onChange={set('notes')} /></Field>
        <div className="modal-foot" style={{ padding: 0, border: 'none', marginTop: 8 }}>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}
