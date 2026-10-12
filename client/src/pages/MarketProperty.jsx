import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MapPin, Building2, BedDouble, Ruler, CheckCircle2, ArrowLeft, Phone, Mail } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { kes, date, today, addDays, titleCase } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Field, Input, Select, Textarea, Modal, Spinner, StatusBadge } from '../components/ui.jsx';

export default function MarketProperty() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);

  const load = () => {
    setLoading(true);
    api
      .get(`/api/market/properties/${id}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  useEffect(load, [id]);

  if (loading) return <div className="full-load"><Spinner label="Loading property…" /></div>;
  if (!data) {
    return (
      <div className="market" style={{ padding: 40 }}>
        <Link to="/" className="link">← Back to home</Link>
        <h2 className="mt-24">Property not found</h2>
      </div>
    );
  }

  const { property: p, units, landlord, myApplications } = data;
  const vacant = units.filter((u) => u.status === 'vacant' && u.occupancy_known !== 0);

  return (
    <div className="market">
      <header className="market-header">
        <Link to="/" className="flex" style={{ color: '#fff' }}>
          <span className="brand-mark">SR</span>
          <span className="brand-name">
            Smart <strong>Rentals</strong>
          </span>
        </Link>
        <nav className="market-nav">
          {user ? (
            <Link to="/app"><Button variant="primary" size="sm">Dashboard</Button></Link>
          ) : (
            <Link to="/login"><Button variant="secondary" size="sm">Sign in</Button></Link>
          )}
        </nav>
      </header>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px' }}>
        <Link to="/" className="link flex" style={{ marginBottom: 16 }}>
          <ArrowLeft size={15} /> Back to home
        </Link>

        <div className="gallery mb-16">
          {(p.images?.length ? p.images : [null, null, null]).slice(0, 3).map((img, i) => (
            <div key={i} className={i === 0 ? 'gallery-main' : ''}>
              {img ? <img src={img} alt={`${p.name} ${i + 1}`} /> : <div style={{ height: '100%', background: '#dbe4f5' }} />}
            </div>
          ))}
        </div>

        <div className="detail-layout">
          <div className="flex-col">
            <div className="detail-box">
              <div className="flex-between">
                <div>
                  <h1 style={{ fontSize: 24 }}>{p.name}</h1>
                  <span className="property-loc mt-8" style={{ display: 'flex' }}>
                    <MapPin size={15} /> {[p.address, p.area, p.county].filter(Boolean).join(', ')}
                  </span>
                </div>
                <StatusBadge status={p.status} />
              </div>
              <div className="chip-row mt-16">
                <span className="chip"><Building2 size={13} /> {p.property_type}</span>
                <span className="chip"><BedDouble size={13} /> {vacant.length} vacant</span>
                <span className="chip">{units.length} total units</span>
              </div>
              {p.description ? (
                <>
                  <div className="divider" />
                  <h3 className="mb-8">About this property</h3>
                  <p className="muted">{p.description}</p>
                </>
              ) : null}
              {p.amenities?.length ? (
                <>
                  <div className="divider" />
                  <h3 className="mb-8">Amenities</h3>
                  <div className="chip-row">
                    {p.amenities.map((a) => (
                      <span className="chip" key={a}><CheckCircle2 size={13} /> {a}</span>
                    ))}
                  </div>
                </>
              ) : null}
            </div>

            <div className="detail-box">
              <h3 className="mb-16">Available units</h3>
              {vacant.length === 0 ? (
                <p className="muted">No units are currently vacant at this property.</p>
              ) : (
                <div className="unit-list">
                  {vacant.map((u) => (
                    <div className="unit-row" key={u.id}>
                      <div>
                        <strong>Unit {u.unit_number}</strong>
                        <div className="cell-muted">
                          {u.unit_type}
                          {u.bedrooms ? ` · ${u.bedrooms} bed` : ''}
                          {u.size_sqm ? (
                            <>
                              {' '}· <Ruler size={12} style={{ verticalAlign: -1 }} /> {u.size_sqm} m²
                            </>
                          ) : null}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="price">{kes(u.rent)}<small> /mo</small></div>
                        <div className="cell-muted">deposit {kes(u.deposit)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="detail-box sticky-box">
            <div className="price" style={{ fontSize: 24 }}>
              {p.min_rent ? kes(p.min_rent) : '—'} <small>from / month</small>
            </div>
            <p className="muted small mt-8">Managed by {p.landlord_name}</p>
            <div className="divider" />
            <div className="kv"><span>Deposit</span><span>{vacant.length ? `From ${kes(vacant[0].deposit)}` : '—'}</span></div>
            <div className="kv"><span>Property type</span><span>{p.property_type}</span></div>
            <div className="kv"><span>County</span><span>{p.county}</span></div>

            {myApplications?.length ? (
              <div className="notice notice-warn mt-16">
                You already applied to this property ({titleCase(myApplications[0].status)}).
              </div>
            ) : null}

            <div className="flex-col mt-16">
              <Button className="btn-block" size="lg" onClick={() => setModal('apply')}>
                Apply to rent
              </Button>
              <Button variant="secondary" className="btn-block" onClick={() => setModal('viewing')}>
                Request a viewing
              </Button>
              <Button variant="ghost" className="btn-block" onClick={() => setModal('contact')}>
                <Mail size={15} /> Message landlord
              </Button>
            </div>
            <div className="divider" />
            <div className="flex-col small muted">
              <span className="flex"><Phone size={14} /> {landlord?.phone || 'Available on request'}</span>
              <span className="flex"><Mail size={14} /> {landlord?.email || '—'}</span>
            </div>
          </div>
        </div>

        <div className="detail-box mt-16">
          <h3 className="mb-8">Check application status</h3>
          <p className="muted small mb-16">Applied before? Enter your reference and email to see the latest status.</p>
          <StatusCheck />
        </div>
      </div>

      <ApplyModal
        open={modal === 'apply'}
        onClose={() => setModal(null)}
        property={p}
        units={vacant}
        user={user}
        onDone={() => { setModal(null); load(); }}
      />
      <ContactModal open={modal === 'contact'} onClose={() => setModal(null)} property={p} user={user} mode="contact" toast={toast} />
      <ContactModal open={modal === 'viewing'} onClose={() => setModal(null)} property={p} user={user} mode="viewing" toast={toast} />
    </div>
  );
}

function ApplyModal({ open, onClose, property, units, user, onDone }) {
  const toast = useToast();
  const [form, setForm] = useState({
    full_name: user?.full_name || '',
    email: user?.email || '',
    phone: user?.phone || '',
    move_in_date: addDays(14),
    unit_id: '',
    occupants: 1,
    message: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (user) setForm((f) => ({ ...f, full_name: user.full_name || f.full_name, email: user.email || f.email, phone: user.phone || f.phone }));
  }, [user]);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const data = await api.post(`/api/market/properties/${property.id}/apply`, { ...form, unit_id: form.unit_id || null });
      setResult({ reference: data.reference, email: form.email });
      toast.success('Application submitted successfully!');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  if (result) {
    return (
      <Modal open={open} onClose={onDone} title="Application submitted" size="md">
        <div className="empty">
          <CheckCircle2 size={32} />
          <h4>Thank you!</h4>
          <p>Your application for {property.name} has been received and is pending review.</p>
          <div className="field">
            <span className="field-label">Your reference</span>
            <div className="flex">
              <Input value={result.reference} readOnly onFocus={(e) => e.target.select()} />
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigator.clipboard?.writeText(result.reference).then(() => toast.success('Reference copied'))}
              >
                Copy
              </Button>
            </div>
            <span className="field-hint">Keep this reference. Use “Check application status” below to track progress with it and {result.email}.</span>
          </div>
        </div>
        <div className="modal-foot" style={{ padding: 0, border: 'none', marginTop: 8 }}>
          <Button type="button" onClick={onDone}>Done</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={`Apply for ${property.name}`} size="md">
      <form onSubmit={submit}>
        <div className="form-row">
          <Field label="Full name" required>
            <Input value={form.full_name} onChange={set('full_name')} required />
          </Field>
          <Field label="Phone" required>
            <Input value={form.phone} onChange={set('phone')} placeholder="0712345678" required />
          </Field>
        </div>
        <Field label="Email" required>
          <Input type="email" value={form.email} onChange={set('email')} required />
        </Field>
        <div className="form-row">
          <Field label="Preferred move-in date" required>
            <Input type="date" min={today()} value={form.move_in_date} onChange={set('move_in_date')} required />
          </Field>
          <Field label="Occupants">
            <Input type="number" min={1} value={form.occupants} onChange={set('occupants')} />
          </Field>
        </div>
        {units.length ? (
          <Field label="Preferred unit (optional)">
            <Select value={form.unit_id} onChange={set('unit_id')}>
              <option value="">No preference</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  Unit {u.unit_number} · {u.unit_type} · {kes(u.rent)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Message (optional)">
          <Textarea value={form.message} onChange={set('message')} placeholder="Tell the landlord a little about yourself…" />
        </Field>
        {error ? <div className="notice notice-danger mb-16">{error}</div> : null}
        <div className="modal-foot" style={{ padding: 0, border: 'none', marginTop: 8 }}>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>Submit application</Button>
        </div>
      </form>
    </Modal>
  );
}

function ContactModal({ open, onClose, property, user, mode, toast }) {
  const isViewing = mode === 'viewing';
  const [form, setForm] = useState({
    name: user?.full_name || '',
    email: user?.email || '',
    phone: user?.phone || '',
    message: '',
    viewing_date: addDays(3),
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const url = isViewing
        ? `/api/market/properties/${property.id}/viewing`
        : `/api/market/properties/${property.id}/contact`;
      const data = await api.post(url, form);
      toast.success(data.message || 'Sent!');
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <Modal open={open} onClose={onClose} title={isViewing ? 'Request a viewing' : `Contact ${property.landlord_name}`} size="md">
      <form onSubmit={submit}>
        <Field label="Your name" required>
          <Input value={form.name} onChange={set('name')} required />
        </Field>
        <div className="form-row">
          <Field label="Phone" required>
            <Input value={form.phone} onChange={set('phone')} placeholder="0712345678" required />
          </Field>
          {isViewing ? (
            <Field label="Preferred date" required>
              <Input type="date" min={today()} value={form.viewing_date} onChange={set('viewing_date')} required />
            </Field>
          ) : (
            <Field label="Email" required>
              <Input type="email" value={form.email} onChange={set('email')} required />
            </Field>
          )}
        </div>
        <Field label={isViewing ? 'Notes (optional)' : 'Message'} required={!isViewing}>
          <Textarea
            value={form.message}
            onChange={set('message')}
            required={!isViewing}
            placeholder={isViewing ? 'Anything the landlord should know?' : 'I am interested in this property…'}
          />
        </Field>
        {error ? <div className="notice notice-danger mb-16">{error}</div> : null}
        <div className="modal-foot" style={{ padding: 0, border: 'none', marginTop: 8 }}>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>{isViewing ? 'Send request' : 'Send message'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function StatusCheck() {
  const [form, setForm] = useState({ reference: '', email: '' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const d = await api.get(`/api/market/applications/status${qs({ reference: form.reference, email: form.email })}`);
      setResult(d);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex-col">
      <div className="form-row">
        <Field label="Reference">
          <Input
            value={form.reference}
            onChange={(e) => setForm({ ...form, reference: e.target.value })}
            placeholder="APP-000123"
            required
          />
        </Field>
        <Field label="Email">
          <Input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="you@example.com"
            required
          />
        </Field>
      </div>
      {error ? <div className="notice notice-danger mb-16">{error}</div> : null}
      {result ? (
        <div className="notice notice-info mb-16">
          {result.property_name}: <StatusBadge status={result.status} /> (updated {date(result.updated_at || result.submitted_at)})
          {result.message ? <div className="small mt-8">{result.message}</div> : null}
        </div>
      ) : null}
      <Button type="submit" variant="secondary" loading={loading}>Check status</Button>
    </form>
  );
}
