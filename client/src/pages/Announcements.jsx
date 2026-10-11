import { useEffect, useState } from 'react';
import { Megaphone, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { timeAgo } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Card, Field, Input, Textarea, Select, Modal, Spinner, EmptyState } from '../components/ui.jsx';

export default function Announcements() {
  const { user } = useAuth();
  const toast = useToast();
  const canPost = user?.role === 'landlord' || user?.role === 'admin' || user?.role === 'caretaker';
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = () => {
    setLoading(true);
    api
      .get('/api/announcements')
      .then((d) => setItems(d.announcements || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const remove = async (a) => {
    if (!window.confirm(`Delete announcement "${a.title}"?`)) return;
    try {
      await api.del(`/api/announcements/${a.id}`);
      toast.success('Deleted');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Announcements</h1>
          <p>{canPost ? 'Broadcast updates to tenants on your properties.' : 'Updates from your landlord.'}</p>
        </div>
        {canPost ? (
          <div className="page-actions">
            <Button onClick={() => setShowCreate(true)}><Plus size={16} /> New announcement</Button>
          </div>
        ) : null}
      </div>

      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState icon={Megaphone} title="No announcements" message={canPost ? 'Post an update to notify your tenants.' : 'You have no announcements yet.'} action={canPost ? <Button className="mt-8" onClick={() => setShowCreate(true)}><Plus size={15} /> New announcement</Button> : null} />
      ) : (
        <div className="flex-col">
          {items.map((a) => (
            <Card key={a.id}>
              <div className="flex-between">
                <div className="flex items-center" style={{ gap: 12 }}>
                  <span className="stat-icon"><Megaphone size={18} /></span>
                  <div>
                    <strong>{a.title}</strong>
                    <div className="cell-muted small">{a.property_name || 'All properties'} · {timeAgo(a.created_at)}</div>
                  </div>
                </div>
                {canPost ? <Button size="sm" variant="ghost" onClick={() => remove(a)}><Trash2 size={15} /></Button> : null}
              </div>
              <p className="muted small mt-8" style={{ whiteSpace: 'pre-wrap' }}>{a.body}</p>
            </Card>
          ))}
        </div>
      )}

      <CreateAnnouncement open={showCreate} onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); toast.success('Announcement posted'); load(); }} />
    </>
  );
}

function CreateAnnouncement({ open, onClose, onSaved }) {
  const toast = useToast();
  const [properties, setProperties] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [form, setForm] = useState({ property_id: '', title: '', body: '' });
  const [scope, setScope] = useState('all');
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) api.get('/api/properties').then((d) => setProperties(d.properties || [])).catch(() => {});
  }, [open]);

  useEffect(() => {
    setSelected([]);
    if (scope === 'selected' && form.property_id) {
      api
        .get('/api/tenants')
        .then((d) => {
          const pid = Number(form.property_id);
          setTenants((d.tenants || []).filter((t) => t.property_id === pid && t.lease?.lease_status === 'active'));
        })
        .catch(() => setTenants([]));
    } else {
      setTenants([]);
    }
  }, [scope, form.property_id]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const submit = async (e) => {
    e.preventDefault();
    if (scope === 'selected' && selected.length === 0) {
      toast.error('Select at least one tenant to receive this announcement');
      return;
    }
    setLoading(true);
    try {
      await api.post('/api/announcements', {
        ...form,
        property_id: Number(form.property_id),
        tenant_ids: scope === 'selected' ? selected : undefined,
      });
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New announcement" size="md">
      <form onSubmit={submit}>
        <Field label="Property" required>
          <Select value={form.property_id} onChange={set('property_id')} required>
            <option value="">Select property…</option>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.county}</option>)}
          </Select>
        </Field>
        <Field label="Title" required><Input value={form.title} onChange={set('title')} placeholder="e.g. Water maintenance on Saturday" required /></Field>
        <Field label="Message" required><Textarea value={form.body} onChange={set('body')} rows={4} required /></Field>
        <Field label="Recipients">
          <div className="flex wrap" style={{ gap: 8 }}>
            <Button size="sm" type="button" variant={scope === 'all' ? 'primary' : 'secondary'} onClick={() => setScope('all')}>All active tenants at this property</Button>
            <Button size="sm" type="button" variant={scope === 'selected' ? 'primary' : 'secondary'} onClick={() => setScope('selected')}>Select specific tenants</Button>
          </div>
        </Field>
        {scope === 'selected' ? (
          <Field label={`Tenants (${selected.length} selected)`}>
            <div className="check-list">
              {tenants.length === 0 ? (
                <p className="muted small">Select a property with active tenants to choose recipients. Only tenants with an active lease at this property can be notified.</p>
              ) : (
                tenants.map((t) => (
                  <label key={t.id} className="check-row">
                    <input type="checkbox" checked={selected.includes(t.id)} onChange={() => toggle(t.id)} />
                    <span>{t.full_name} — {t.unit_number} · {t.phone}</span>
                  </label>
                ))
              )}
            </div>
          </Field>
        ) : null}
        <div className="modal-foot" style={{ padding: 0, border: 'none', marginTop: 8 }}>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>Post</Button>
        </div>
      </form>
    </Modal>
  );
}