import { useEffect, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { api } from '../lib/api.js';
import { kes, titleCase, monthLabel } from '../lib/format.js';
import { Badge, Card, EmptyState, Select, Spinner } from '../components/ui.jsx';

const TONES = {
  caretaker_accommodation: 'purple',
  verified: 'green',
  active: 'green',
  pending: 'amber',
  moved_out: 'gray',
  held: 'blue',
  refunded: 'gray',
  forfeited: 'red',
  unknown: 'gray',
};

function Tone({ value }) {
  if (value === undefined || value === null) return null;
  return <Badge tone={TONES[value] || 'gray'}>{titleCase(value)}</Badge>;
}

function Stat({ label, value, tone }) {
  return (
    <div className={`stat${tone ? ` stat-${tone}` : ''}`}>
      <div className="stat-main">
        <span className="stat-label">{label}</span>
        <span className="stat-value">{value}</span>
      </div>
    </div>
  );
}

export default function RentRegister() {
  const [properties, setProperties] = useState([]);
  const [propertyId, setPropertyId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api
      .get('/api/properties')
      .then((d) => {
        const list = d.properties || [];
        setProperties(list);
        if (list.length) setPropertyId(String(list[0].id));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!propertyId) return;
    setLoading(true);
    api
      .get(`/api/properties/${propertyId}/register`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [propertyId]);

  const occ = data?.occupancy;
  const rs = data?.registerSummary;
  const ds = data?.depositSummary;
  const rt = data?.rentSummary;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Rent Register</h1>
          <p>Imported paper-register records, deposits and historical rent. Read-only.</p>
        </div>
        <Select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} style={{ maxWidth: 260 }}>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>

      {loading ? (
        <Spinner label="Loading register…" />
      ) : !data ? (
        <EmptyState icon={ClipboardList} title="No register data" message="Select a property with imported records." />
      ) : (
        <>
          <div className="grid grid-4 mb-16">
            <Stat label="Rooms" value={occ.units} />
            <Stat label="Known occupied" value={occ.occupied} tone="green" />
            <Stat label="Unknown occupancy" value={occ.unknown_occupancy} tone="amber" />
            <Stat label="Rent unknown" value={occ.rent_unknown} tone="amber" />
          </div>

          <div className="grid grid-4 mb-16">
            <Stat label="Register entries" value={rs.total} />
            <Stat label="Caretaker accommodation" value={rs.caretaker_accommodation} />
            <Stat label="Deposits held" value={`${ds.count} · ${kes(ds.total)}`} tone="purple" />
            <Stat label="Historical rent" value={`${rt.count} · ${kes(rt.total)}`} />
          </div>

          {(rs.unverified_details || rs.unverified_contacts || occ.unverified_details || occ.rent_unknown) ? (
            <div className="notice mb-16">
              Imported records are <strong>unverified</strong>: {occ.unverified_details} unit details without verification,
              {' '}{rs.unverified_details} register details and {rs.unverified_contacts} contacts unverified, {rt.unverified_dates} unverified dates and {rt.unverified_amounts} unverified
              amounts. Unknown occupancy is not treated as vacant and these tenancies generate no rent arrears or SMS.
            </div>
          ) : null}

          <Card title="Tenant register" padded={false} className="mb-16">
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>Room</th><th>Tenant</th><th>Role</th><th>Status</th><th>Deposit</th><th>Verified</th></tr>
                </thead>
                <tbody>
                  {data.register.map((r) => (
                    <tr key={r.id}>
                      <td className="cell-strong">{r.unit_number || r.room_label}</td>
                      <td>{r.tenant_name}</td>
                      <td><Tone value={r.tenancy_role} /></td>
                      <td><Tone value={r.status} /></td>
                      <td>{r.deposit_amount ? kes(r.deposit_amount) : <span className="faint">—</span>}</td>
                      <td className="cell-muted">
                        {[r.details_verified ? 'Details' : null, r.contact_verified ? 'Contact' : null].filter(Boolean).join(' · ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Historical rent" padded={false} className="mb-16">
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>Room</th><th>Tenant</th><th>Period</th><th>Amount</th><th>Raw date</th><th>Verified</th></tr>
                </thead>
                <tbody>
                  {data.rent.map((e) => (
                    <tr key={e.id}>
                      <td className="cell-strong">{e.unit_number || e.room_label}</td>
                      <td>{e.tenant_name}</td>
                      <td>{monthLabel(e.period) || e.period}</td>
                      <td className="cell-strong">{kes(e.amount)}</td>
                      <td className="cell-muted">{e.raw_date || <span className="faint">—</span>}</td>
                      <td className="cell-muted">
                        {e.date_verified && e.amount_verified ? 'Date · Amount' : e.date_verified ? 'Date only' : e.amount_verified ? 'Amount only' : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Deposits" padded={false}>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>Room</th><th>Tenant</th><th>Amount</th><th>Status</th><th>Verified</th></tr>
                </thead>
                <tbody>
                  {data.deposits.length === 0 ? (
                    <tr><td colSpan={5} className="faint" style={{ textAlign: 'center' }}>No deposits recorded</td></tr>
                  ) : (
                    data.deposits.map((d) => (
                      <tr key={d.id}>
                        <td className="cell-strong">{d.unit_number || d.room_label || '—'}</td>
                        <td>{d.tenant_name}</td>
                        <td className="cell-strong">{kes(d.amount)}</td>
                        <td><Tone value={d.status} /></td>
                        <td className="cell-muted">{d.verified ? 'Yes' : 'No'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
