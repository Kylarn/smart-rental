import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Building2, Pencil, Trash2, User, DoorOpen, UserPlus, UserX } from 'lucide-react';
import { api } from '../lib/api.js';
import { kes, date } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Card, Field, Input, Select, Modal, Spinner, EmptyState, StatusBadge, Avatar, Progress, Badge } from '../components/ui.jsx';
import { COUNTIES } from '../lib/counties.js';

const UNIT_TYPES = ['Bedsitter', 'Studio', '1 Bedroom', '2 Bedroom', '3 Bedroom', '4 Bedroom', 'Maisonette'];

export default function PropertyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showUnit, setShowUnit] = useState(false);
  const [editUnit, setEditUnit] = useState(null);
  const [showEdit, setShowEdit] = useState(false);
  const [showCaretaker, setShowCaretaker] = useState(false);

  const load = () => {
    setLoading(true);
    api
      .get(`/api/properties/${id}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  useEffect(load, [id]);

  if (loading) return <Spinner label="Loading property…" />;
  if (!data) return <EmptyState title="Property not found" message="It may have been removed." action={<Link to="/app/properties" className="btn btn-secondary btn-sm mt-8">Back</Link>} />;

  const { property: p, units, landlord, caretakers } = data;
  const canManage = user?.role === 'landlord' || user?.role === 'admin';

  const remove = async () => {
    if (!window.confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    try {
      await api.del(`/api/properties/${p.id}`);
      toast.success('Property deleted');
      navigate('/app/properties');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const removeCaretaker = async (c) => {
    if (!window.confirm(`Remove ${c.full_name} from this property?`)) return;
    try {
      await api.del(`/api/properties/${p.id}/caretakers/${c.id}`);
      toast.success('Caretaker removed');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <>
      <Link to="/app/properties" className="link flex small" style={{ marginBottom: 14 }}>
        <ArrowLeft size={15} /> All properties
      </Link>
      <div className="page-head">
        <div>
          <h1>{p.name}</h1>
          <p>{p.area ? `${p.area}, ` : ''}{p.county} · {p.property_type}{caretakers?.length ? ` · ${caretakers.length} caretaker${caretakers.length === 1 ? '' : 's'}` : ''}</p>
        </div>
        <div className="page-actions">
          {canManage ? (
            <>
              <Button variant="secondary" onClick={() => setShowEdit(true)}><Pencil size={15} /> Edit</Button>
              <Button variant="danger" onClick={remove}><Trash2 size={15} /> Delete</Button>
              <Button onClick={() => setShowUnit(true)}><Plus size={16} /> Add unit</Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="grid grid-4 mb-16">
        <div className="stat"><div className="stat-main"><span className="stat-label">Units</span><span className="stat-value">{p.stats.units}</span></div><span className="stat-icon"><DoorOpen size={20} /></span></div>
        <div className="stat stat-green"><div className="stat-main"><span className="stat-label">Occupied</span><span className="stat-value">{p.stats.occupied}</span></div><span className="stat-icon"><User size={20} /></span></div>
        <div className="stat stat-amber"><div className="stat-main"><span className="stat-label">Vacant</span><span className="stat-value">{p.stats.vacant}</span></div><span className="stat-icon"><DoorOpen size={20} /></span></div>
        <div className="stat"><div className="stat-main"><span className="stat-label">Occupancy</span><span className="stat-value">{p.stats.occupancyRate}%</span></div><span className="stat-icon"><Building2 size={20} /></span></div>
      </div>

      <div className="grid grid-2 mb-16">
        <Card title="Details">
          <div className="kv"><span>Property type</span><span>{p.property_type}</span></div>
          <div className="kv"><span>Address</span><span>{p.address || '—'}</span></div>
          <div className="kv"><span>Potential monthly rent</span><span>{kes(p.stats.potentialRent)}</span></div>
          <div className="kv"><span>Views</span><span>{p.views}</span></div>
          <div className="kv"><span>Status</span><span><StatusBadge status={p.status} /></span></div>
          {p.description ? <p className="muted small mt-16">{p.description}</p> : null}
          {p.amenities?.length ? (
            <div className="chip-row mt-16">{p.amenities.map((a) => <span className="chip" key={a}>{a}</span>)}</div>
          ) : null}
        </Card>

        <Card title="Landlord">
          <div className="avatar-row">
            <Avatar name={landlord?.full_name} src={landlord?.avatar_url} size={48} />
            <div>
              <strong>{landlord?.full_name}</strong>
              <div className="cell-muted">{landlord?.email}</div>
              <div className="cell-muted">{landlord?.phone}</div>
            </div>
          </div>
          {p.images?.length ? (
            <>
              <div className="divider" />
              <h4 className="mb-8 small muted">Images</h4>
              <div className="flex wrap">
                {p.images.map((img) => (
                  <img key={img} src={img} alt="" style={{ width: 84, height: 62, objectFit: 'cover', borderRadius: 8 }} />
                ))}
              </div>
            </>
          ) : null}
        </Card>
      </div>

      <Card
        className="mb-16"
        title={`Caretakers (${caretakers?.length || 0})`}
        action={canManage ? <Button size="sm" onClick={() => setShowCaretaker(true)}><UserPlus size={14} /> Assign caretaker</Button> : null}
      >
        {caretakers?.length ? (
          <div className="flex-col">
            {caretakers.map((c) => (
              <div className="unit-row" key={c.id}>
                <div className="avatar-row">
                  <Avatar name={c.full_name} src={c.avatar_url} size={36} />
                  <div>
                    <strong>{c.full_name}</strong>
                    <div className="cell-muted">{c.email} · {c.phone || '—'}</div>
                  </div>
                </div>
                <div className="flex">
                  <Badge tone={c.status === 'suspended' ? 'red' : 'green'}>{c.status}</Badge>
                  {canManage ? (
                    <Button size="sm" variant="ghost" title="Remove" onClick={() => removeCaretaker(c)}><UserX size={15} /></Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={UserPlus} title="No caretakers assigned" message="Assign an on-site caretaker to manage day-to-day operations here." action={canManage ? <Button className="mt-8" onClick={() => setShowCaretaker(true)}><UserPlus size={15} /> Assign caretaker</Button> : null} />
        )}
      </Card>

      <Card title={`Units (${units.length})`} padded={false}>
        {units.length === 0 ? (
          <EmptyState icon={DoorOpen} title="No units yet" message="Add units so you can create leases and track rent." action={canManage ? <Button className="mt-8" onClick={() => setShowUnit(true)}><Plus size={15} /> Add unit</Button> : null} />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Unit</th><th>Type</th><th>Rent</th><th>Status</th><th>Tenant</th><th>Paid through</th><th></th></tr>
              </thead>
              <tbody>
                {units.map((u) => (
                  <tr key={u.id}>
                    <td className="cell-strong">{u.unit_number}{u.floor ? <span className="cell-muted"> · {u.floor}</span> : null}</td>
                    <td className="cell-muted">{u.unit_type}{u.bedrooms ? ` · ${u.bedrooms} bed` : ''}</td>
                    <td className="cell-strong">{kes(u.rent)}</td>
                    <td><StatusBadge status={u.status} /></td>
                    <td>{u.tenant ? <Link className="link" to={`/app/tenants/${u.tenant.id}`}>{u.tenant.full_name}</Link> : <span className="faint">—</span>}</td>
                    <td className="cell-muted">{u.paid_through || '—'}</td>
                    <td className="row-actions">{canManage ? <Button size="sm" variant="ghost" onClick={() => setEditUnit(u)}>Edit</Button> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <UnitModal open={showUnit} onClose={() => setShowUnit(false)} propertyId={p.id} onSaved={() => { setShowUnit(false); toast.success('Unit added'); load(); }} />
      <UnitModal open={!!editUnit} onClose={() => setEditUnit(null)} propertyId={p.id} unit={editUnit} onSaved={() => { setEditUnit(null); toast.success('Unit updated'); load(); }} />
      <EditPropertyModal open={showEdit} onClose={() => setShowEdit(false)} property={p} onSaved={() => { setShowEdit(false); toast.success('Property updated'); load(); }} />
      <AssignCaretakerModal open={showCaretaker} onClose={() => setShowCaretaker(false)} propertyId={p.id} propertyName={p.name} onSaved={() => { setShowCaretaker(false); toast.success('Caretaker assigned'); load(); }} />
    </>
  );
}

function AssignCaretakerModal({ open, onClose, propertyId, propertyName, onSaved }) {
  const toast = useToast();
  const [mode, setMode] = useState('existing');
  const [existing, setExisting] = useState([]);
  const [form, setForm] = useState({ caretaker_id: '', full_name: '', email: '', phone: '', password: '' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      api.get('/api/reports/caretakers').then((d) => setExisting(d.caretakers || [])).catch(() => setExisting([]));
      setForm({ caretaker_id: '', full_name: '', email: '', phone: '', password: '' });
      setMode('existing');
    }
  }, [open]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === 'existing') {
        if (!form.caretaker_id) throw new Error('Select a caretaker');
        await api.post(`/api/properties/${propertyId}/caretakers`, { caretaker_id: Number(form.caretaker_id) });
      } else {
        await api.post(`/api/properties/${propertyId}/caretakers`, form);
      }
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Assign caretaker — ${propertyName}`} size="md">
      <div className="tabs mb-16">
        <button type="button" className={`tab ${mode === 'existing' ? 'active' : ''}`} onClick={() => setMode('existing')}>Existing caretaker</button>
        <button type="button" className={`tab ${mode === 'new' ? 'active' : ''}`} onClick={() => setMode('new')}>New caretaker</button>
      </div>
      <form onSubmit={submit}>
        {mode === 'existing' ? (
          <Field label="Caretaker" required>
            <Select value={form.caretaker_id} onChange={set('caretaker_id')} required>
              <option value="">Select caretaker…</option>
              {existing.map((c) => (
                <option key={c.id} value={c.id}>{c.full_name} — {c.email} ({c.properties_assigned || 0} assigned)</option>
              ))}
            </Select>
          </Field>
        ) : (
          <>
            <Field label="Full name" required><Input value={form.full_name} onChange={set('full_name')} required /></Field>
            <div className="form-row">
              <Field label="Email" required><Input type="email" value={form.email} onChange={set('email')} required /></Field>
              <Field label="Phone" required><Input value={form.phone} onChange={set('phone')} placeholder="0712345678" required /></Field>
            </div>
            <Field label="Temporary password" hint="Leave blank to auto-generate a secure password"><Input type="password" value={form.password} onChange={set('password')} /></Field>
          </>
        )}
        <div className="modal-foot" style={{ padding: 0, border: 'none', marginTop: 8 }}>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>Assign</Button>
        </div>
      </form>
    </Modal>
  );
}

function UnitModal({ open, onClose, propertyId, unit, onSaved }) {
  const toast = useToast();
  const editing = !!unit;
  const [form, setForm] = useState({ unit_number: '', floor: '', unit_type: '1 Bedroom', bedrooms: '', rent: '', deposit: '', size_sqm: '', status: 'vacant', description: '' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        unit_number: unit?.unit_number || '',
        floor: unit?.floor || '',
        unit_type: unit?.unit_type || '1 Bedroom',
        bedrooms: unit?.bedrooms ?? '',
        rent: unit?.rent ?? '',
        deposit: unit?.deposit ?? '',
        size_sqm: unit?.size_sqm ?? '',
        status: unit?.status || 'vacant',
        description: unit?.description || '',
      });
    }
  }, [open, unit]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = { ...form, property_id: propertyId, bedrooms: form.bedrooms === '' ? undefined : Number(form.bedrooms) };
      if (editing) await api.put(`/api/units/${unit.id}`, payload);
      else await api.post('/api/units', payload);
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit unit' : 'Add unit'} size="md">
      <form onSubmit={submit}>
        <div className="form-row">
          <Field label="Unit number" required>
            <Input value={form.unit_number} onChange={set('unit_number')} placeholder="e.g. A1" required />
          </Field>
          <Field label="Floor">
            <Input value={form.floor} onChange={set('floor')} placeholder="e.g. 3rd" />
          </Field>
        </div>
        <div className="form-row">
          <Field label="Unit type" required>
            <Select value={form.unit_type} onChange={set('unit_type')}>
              {UNIT_TYPES.map((t) => <option key={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Bedrooms">
            <Input type="number" min={0} value={form.bedrooms} onChange={set('bedrooms')} placeholder="auto" />
          </Field>
        </div>
        <div className="form-row">
          <Field label="Monthly rent (KES)" required>
            <Input type="number" min={0} value={form.rent} onChange={set('rent')} required />
          </Field>
          <Field label="Deposit (KES)">
            <Input type="number" min={0} value={form.deposit} onChange={set('deposit')} />
          </Field>
        </div>
        <div className="form-row">
          <Field label="Size (m²)">
            <Input type="number" min={0} value={form.size_sqm} onChange={set('size_sqm')} />
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={set('status')}>
              <option value="vacant">Vacant</option>
              <option value="maintenance">Maintenance</option>
              <option value="reserved">Reserved</option>
              <option value="occupied">Occupied</option>
            </Select>
          </Field>
        </div>
        <Field label="Description">
          <Input value={form.description} onChange={set('description')} />
        </Field>
        <div className="modal-foot" style={{ padding: 0, border: 'none', marginTop: 8 }}>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>{editing ? 'Save changes' : 'Add unit'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function EditPropertyModal({ open, onClose, property, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && property) {
      setForm({
        name: property.name,
        county: property.county,
        area: property.area || '',
        address: property.address || '',
        property_type: property.property_type,
        description: property.description || '',
        status: property.status,
      });
    }
  }, [open, property]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.put(`/api/properties/${property.id}`, form);
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Edit property" size="md">
      <form onSubmit={submit}>
        <Field label="Name" required><Input value={form.name || ''} onChange={set('name')} required /></Field>
        <div className="form-row">
          <Field label="County"><Select value={form.county || ''} onChange={set('county')}>{COUNTIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <Field label="Area"><Input value={form.area || ''} onChange={set('area')} /></Field>
        </div>
        <div className="form-row">
          <Field label="Address"><Input value={form.address || ''} onChange={set('address')} /></Field>
          <Field label="Status">
            <Select value={form.status || 'active'} onChange={set('status')}>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </Select>
          </Field>
        </div>
        <Field label="Description"><Input value={form.description || ''} onChange={set('description')} /></Field>
        <div className="modal-foot" style={{ padding: 0, border: 'none', marginTop: 8 }}>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}
