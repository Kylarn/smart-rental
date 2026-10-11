import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DoorOpen, Search } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { kes } from '../lib/format.js';
import { Button, Card, Input, Select, Spinner, EmptyState, StatusBadge } from '../components/ui.jsx';

export default function Units() {
  const [units, setUnits] = useState([]);
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ search: '', status: '', property_id: '' });

  useEffect(() => {
    api.get('/api/properties').then((d) => setProperties(d.properties || [])).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      api
        .get(`/api/units${qs(filters)}`)
        .then((d) => setUnits(d.units || []))
        .catch(() => setUnits([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [filters]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Units</h1>
          <p>Every unit across your properties.</p>
        </div>
      </div>

      <Card className="mb-16">
        <div className="flex wrap">
          <Input placeholder="Search unit or property…" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} style={{ maxWidth: 280 }} />
          <Select value={filters.property_id} onChange={(e) => setFilters({ ...filters, property_id: e.target.value })} style={{ maxWidth: 230 }}>
            <option value="">All properties</option>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} style={{ maxWidth: 160 }}>
            <option value="">All statuses</option>
            <option value="vacant">Vacant</option>
            <option value="occupied">Occupied</option>
            <option value="reserved">Reserved</option>
            <option value="maintenance">Maintenance</option>
          </Select>
          <div className="grow" />
          <span className="cell-muted">{units.length} units</span>
        </div>
      </Card>

      {loading ? (
        <Spinner label="Loading units…" />
      ) : units.length === 0 ? (
        <EmptyState icon={DoorOpen} title="No units found" message="Adjust filters or add units from a property page." />
      ) : (
        <Card padded={false}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Unit</th><th>Property</th><th>Type</th><th>Rent</th><th>Status</th><th>Tenant</th><th>Arrears</th></tr>
              </thead>
              <tbody>
                {units.map((u) => (
                  <tr key={u.id}>
                    <td className="cell-strong">{u.unit_number}{u.floor ? <span className="cell-muted"> · {u.floor}</span> : null}</td>
                    <td><Link className="link" to={`/app/properties/${u.property_id}`}>{u.property_name}</Link></td>
                    <td className="cell-muted">{u.unit_type}</td>
                    <td className="cell-strong">{kes(u.rent)}</td>
                    <td><StatusBadge status={u.status} /></td>
                    <td>{u.tenant ? <Link className="link" to={`/app/tenants/${u.tenant.id}`}>{u.tenant.full_name}</Link> : <span className="faint">—</span>}</td>
                    <td>{u.arrears?.total > 0 ? <span style={{ color: 'var(--red)', fontWeight: 600 }}>{kes(u.arrears.total)}</span> : <span className="faint">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
