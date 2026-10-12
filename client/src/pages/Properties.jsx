import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Plus, MapPin, Search, Eye } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { kes } from '../lib/format.js';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Card, Field, Input, Select, Textarea, Modal, Spinner, EmptyState, StatusBadge, Progress } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { COUNTIES } from '../lib/counties.js';

const TYPES = ['Apartment', 'Bedsitter', 'Studio', 'Maisonette', 'Villa', 'Townhouse', 'Hostel', 'Commercial'];
const AMENITIES = ['Water', 'Electricity', 'Security', 'Parking', 'Wi-Fi', 'Gym', 'Pool', 'Lift', 'Backup generator', 'CCTV', 'Borehole', 'Garden'];

export default function Properties() {
  const toast = useToast();
  const { user } = useAuth();
  const canManage = user?.role === 'landlord' || user?.role === 'admin';
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ search: '', county: '' });
  const [showCreate, setShowCreate] = useState(false);

  const load = () => {
    setLoading(true);
    api
      .get(`/api/properties${qs(filters)}`)
      .then((d) => setProperties(d.properties || []))
      .catch(() => setProperties([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Properties</h1>
          <p>Manage your property portfolio and listings.</p>
        </div>
        <div className="page-actions">
          {canManage ? (
            <Button onClick={() => setShowCreate(true)}>
              <Plus size={16} /> Add property
            </Button>
          ) : null}
        </div>
      </div>

      <Card className="mb-16" padded>
        <div className="flex wrap">
          <Input
            placeholder="Search properties…"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            style={{ maxWidth: 300 }}
          />
          <Select value={filters.county} onChange={(e) => setFilters({ ...filters, county: e.target.value })} style={{ maxWidth: 200 }}>
            <option value="">All counties</option>
            {COUNTIES.map((c) => <option key={c}>{c}</option>)}
          </Select>
          <div className="grow" />
          <span className="cell-muted">{properties.length} properties</span>
        </div>
      </Card>

      {loading ? (
        <Spinner label="Loading properties…" />
      ) : properties.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No properties yet"
          message="Add your first property to start managing units and tenants."
          action={canManage ? <Button className="mt-8" onClick={() => setShowCreate(true)}><Plus size={15} /> Add property</Button> : null}
        />
      ) : (
        <div className="grid grid-auto">
          {properties.map((p) => (
            <Link to={`/app/properties/${p.id}`} className="property-card" key={p.id}>
              <div className="property-thumb">
                {p.images?.[0] ? <img src={p.images[0]} alt={p.name} /> : <div className="center" style={{ paddingTop: 70 }}><Building2 size={40} color="#94a0b8" /></div>}
                <div className="thumb-badge"><StatusBadge status={p.status} /></div>
              </div>
              <div className="property-body">
                <h3>{p.name}</h3>
                <span className="property-loc"><MapPin size={14} /> {p.area ? `${p.area}, ` : ''}{p.county}</span>
                <div className="chip-row">
                  <span className="chip">{p.property_type}</span>
                  <span className="chip"><Eye size={13} /> {p.views} views</span>
                </div>
                <div className="mt-8">
                  <div className="flex-between small muted mb-8">
                    <span>Occupancy</span>
                    <span>
                      {p.stats?.occupied || 0}/{Math.max((p.stats?.units || 0) - (p.stats?.unknown || 0), 0)} known units · {p.stats?.occupancyRate || 0}%
                      {p.stats?.unknown ? ` · ${p.stats.unknown} unknown` : ''}
                    </span>
                  </div>
                  <Progress value={p.stats?.occupied || 0} max={Math.max((p.stats?.units || 0) - (p.stats?.unknown || 0), 1)} tone={(p.stats?.occupancyRate || 0) === 100 ? 'green' : 'blue'} />
                </div>
                <div className="property-foot">
                  <span className="price">{kes(p.stats?.potentialRent || 0)}<small> /mo potential</small></span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <CreateProperty
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => {
          setShowCreate(false);
          toast.success('Property created');
          load();
        }}
      />
    </>
  );
}

function CreateProperty({ open, onClose, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', county: 'Nairobi', area: '', address: '', property_type: 'Apartment', description: '', amenities: [] });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const toggleAmenity = (a) =>
    setForm((f) => ({ ...f, amenities: f.amenities.includes(a) ? f.amenities.filter((x) => x !== a) : [...f.amenities, a] }));

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrors({});
    try {
      await api.post('/api/properties', form);
      onCreated();
      setForm({ name: '', county: 'Nairobi', area: '', address: '', property_type: 'Apartment', description: '', amenities: [] });
    } catch (err) {
      setErrors(err.validation || {});
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add property" size="lg">
      <form onSubmit={submit}>
        <Field label="Property name" required error={errors.name}>
          <Input value={form.name} onChange={set('name')} placeholder="e.g. Kilimani Heights Apartments" required />
        </Field>
        <div className="form-row">
          <Field label="County" required>
            <Select value={form.county} onChange={set('county')}>
              {COUNTIES.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Area / neighbourhood">
            <Input value={form.area} onChange={set('area')} placeholder="e.g. Kilimani" />
          </Field>
        </div>
        <div className="form-row">
          <Field label="Property type" required>
            <Select value={form.property_type} onChange={set('property_type')}>
              {TYPES.map((t) => <option key={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Address">
            <Input value={form.address} onChange={set('address')} placeholder="Street / building" />
          </Field>
        </div>
        <Field label="Description">
          <Textarea value={form.description} onChange={set('description')} placeholder="Describe the property…" />
        </Field>
        <Field label="Amenities">
          <div className="chip-row">
            {AMENITIES.map((a) => (
              <button
                type="button"
                key={a}
                className={`chip ${form.amenities.includes(a) ? 'chip-active' : ''}`}
                style={form.amenities.includes(a) ? { background: 'var(--primary-soft)', borderColor: 'var(--primary)', color: 'var(--primary)' } : undefined}
                onClick={() => toggleAmenity(a)}
              >
                {a}
              </button>
            ))}
          </div>
        </Field>
        <div className="modal-foot" style={{ padding: 0, border: 'none', marginTop: 8 }}>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>Create property</Button>
        </div>
      </form>
    </Modal>
  );
}
