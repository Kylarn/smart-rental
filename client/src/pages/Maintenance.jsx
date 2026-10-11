import { useEffect, useState } from 'react';
import { Wrench, Plus, AlertTriangle, CheckCircle2, Clock, Image as ImageIcon } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { kes, timeAgo, titleCase } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Card, Field, Input, Textarea, Select, Modal, Spinner, EmptyState, StatusBadge, Avatar, Tabs } from '../components/ui.jsx';

const CATEGORIES = ['General', 'Plumbing', 'Electrical', 'Structural', 'Appliance', 'Pest control', 'Security', 'Cleaning'];
const STATUS_FLOW = ['submitted', 'under_review', 'assigned', 'in_progress', 'completed', 'closed'];

export default function Maintenance() {
  const { user } = useAuth();
  const toast = useToast();
  const isManager = user?.role === 'landlord' || user?.role === 'admin';
  const [requests, setRequests] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('open');
  const [showCreate, setShowCreate] = useState(false);
  const [managing, setManaging] = useState(null);

  const load = () => {
    setLoading(true);
    api
      .get('/api/maintenance')
      .then((d) => {
        setRequests(d.requests || []);
        setStats(d.stats);
      })
      .catch(() => setRequests([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const filtered = requests.filter((r) => {
    if (tab === 'open') return !['completed', 'closed'].includes(r.status);
    if (tab === 'closed') return ['completed', 'closed'].includes(r.status);
    if (tab === 'urgent') return r.priority === 'urgent' && !['completed', 'closed'].includes(r.status);
    return true;
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Maintenance</h1>
          <p>{isManager ? 'Handle repair requests from your tenants.' : 'Report issues and follow their progress.'}</p>
        </div>
        <div className="page-actions">
          <Button onClick={() => setShowCreate(true)}><Plus size={16} /> New request</Button>
        </div>
      </div>

      {stats ? (
        <div className="grid grid-4 mb-16">
          <div className="stat"><div className="stat-main"><span className="stat-label">Total</span><span className="stat-value">{stats.total}</span></div><span className="stat-icon"><Wrench size={20} /></span></div>
          <div className="stat stat-amber"><div className="stat-main"><span className="stat-label">Open</span><span className="stat-value">{stats.open}</span></div><span className="stat-icon"><Clock size={20} /></span></div>
          <div className="stat stat-red"><div className="stat-main"><span className="stat-label">Urgent</span><span className="stat-value">{stats.urgent}</span></div><span className="stat-icon"><AlertTriangle size={20} /></span></div>
          <div className="stat stat-green"><div className="stat-main"><span className="stat-label">Completed</span><span className="stat-value">{stats.completed}</span></div><span className="stat-icon"><CheckCircle2 size={20} /></span></div>
        </div>
      ) : null}

      <Tabs
        tabs={[
          { value: 'open', label: 'Open' },
          { value: 'urgent', label: 'Urgent' },
          { value: 'closed', label: 'Resolved' },
          { value: 'all', label: 'All' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {loading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Wrench} title="Nothing here" message={isManager ? 'No maintenance requests match this view.' : 'Submit a request if something needs fixing.'} action={<Button className="mt-8" onClick={() => setShowCreate(true)}><Plus size={15} /> New request</Button>} />
      ) : (
        <div className="flex-col">
          {filtered.map((r) => (
            <Card key={r.id}>
              <div className="flex-between wrap">
                <div>
                  <div className="flex">
                    <strong>{r.title}</strong>
                    <StatusBadge status={r.priority} />
                  </div>
                  <div className="cell-muted small">
                    {r.property_name}{r.unit_number ? ` · Unit ${r.unit_number}` : ''} · {r.category} · {timeAgo(r.created_at)}
                  </div>
                </div>
                <StatusBadge status={r.status} />
              </div>
              <p className="muted small mt-8">{r.description}</p>
              {r.photos?.length ? (
                <div className="flex wrap mt-8">
                  {r.photos.map((p) => <a key={p} href={p} target="_blank" rel="noreferrer"><img src={p} alt="" style={{ width: 74, height: 56, objectFit: 'cover', borderRadius: 8 }} /></a>)}
                </div>
              ) : null}
              {isManager && r.tenant_name ? (
                <div className="avatar-row mt-8"><Avatar name={r.tenant_name} src={r.tenant_avatar} size={28} /><span className="small">{r.tenant_name}</span><span className="cell-muted small">{r.tenant_phone}</span></div>
              ) : null}
              {r.resolution_notes ? <div className="notice notice-info mt-8">Resolution: {r.resolution_notes}</div> : null}
              {isManager ? (
                <div className="flex wrap mt-16 items-center">
                  <span className="small muted">Move to:</span>
                  {STATUS_FLOW.map((s, i) => (
                    <Button key={s} size="sm" variant={i === STATUS_FLOW.indexOf(r.status) + 1 ? 'primary' : 'secondary'} disabled={i <= STATUS_FLOW.indexOf(r.status)} onClick={() => setManaging({ request: r, status: s })}>
                      {titleCase(s)}
                    </Button>
                  ))}
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}

      <CreateRequestModal open={showCreate} onClose={() => setShowCreate(false)} isManager={isManager} onSaved={() => { setShowCreate(false); toast.success('Request submitted'); load(); }} />
      <ManageModal data={managing} onClose={() => setManaging(null)} onSaved={() => { setManaging(null); toast.success('Request updated'); load(); }} />
    </>
  );
}

function CreateRequestModal({ open, onClose, isManager, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ title: '', description: '', category: 'General', priority: 'medium' });
  const [properties, setProperties] = useState([]);
  const [propertyId, setPropertyId] = useState('');
  const [leasePropertyId, setLeasePropertyId] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (isManager) {
      api.get('/api/properties').then((d) => setProperties(d.properties || [])).catch(() => {});
    } else {
      api.get('/api/leases').then((d) => {
        const active = (d.leases || []).find((l) => l.status === 'active');
        if (active) setLeasePropertyId(active.property_id);
      }).catch(() => {});
    }
  }, [open, isManager]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const property_id = isManager ? Number(propertyId) : leasePropertyId;
      if (!property_id) throw new Error('No active property found for this request');
      await api.post('/api/maintenance', { ...form, property_id });
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New maintenance request" size="md">
      <form onSubmit={submit}>
        <Field label="Issue title" required><Input value={form.title} onChange={set('title')} placeholder="e.g. Leaking kitchen tap" required /></Field>
        <Field label="Description" required><Textarea value={form.description} onChange={set('description')} placeholder="Describe the problem in detail…" required /></Field>
        <div className="form-row">
          <Field label="Category">
            <Select value={form.category} onChange={set('category')}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select>
          </Field>
          <Field label="Priority">
            <Select value={form.priority} onChange={set('priority')}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </Select>
          </Field>
        </div>
        {isManager ? (
          <Field label="Property" required>
            <Select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} required>
              <option value="">Select property…</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.county}</option>)}
            </Select>
          </Field>
        ) : null}
        <div className="modal-foot" style={{ padding: 0, border: 'none', marginTop: 8 }}>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>Submit</Button>
        </div>
      </form>
    </Modal>
  );
}

function ManageModal({ data, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ assigned_to: '', resolution_notes: '', estimated_cost: '', actual_cost: '' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (data) setForm({ assigned_to: data.request.assigned_to || '', resolution_notes: data.request.resolution_notes || '', estimated_cost: data.request.estimated_cost ?? '', actual_cost: data.request.actual_cost ?? '' });
  }, [data]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.patch(`/api/maintenance/${data.request.id}`, { status: data.status, ...form });
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={!!data} onClose={onClose} title={`Advance to "${data ? titleCase(data.status) : ''}"`} size="md">
      {data ? (
        <form onSubmit={submit}>
          <Field label="Assigned to"><Input value={form.assigned_to} onChange={set('assigned_to')} placeholder="Technician / contractor" /></Field>
          <div className="form-row">
            <Field label="Estimated cost (KES)"><Input type="number" value={form.estimated_cost} onChange={set('estimated_cost')} /></Field>
            <Field label="Actual cost (KES)"><Input type="number" value={form.actual_cost} onChange={set('actual_cost')} /></Field>
          </div>
          <Field label="Resolution notes"><Textarea value={form.resolution_notes} onChange={set('resolution_notes')} /></Field>
          <div className="modal-foot" style={{ padding: 0, border: 'none', marginTop: 8 }}>
            <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={loading}>Save</Button>
          </div>
        </form>
      ) : null}
    </Modal>
  );
}
