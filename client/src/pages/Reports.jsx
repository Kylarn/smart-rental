import { useEffect, useState } from 'react';
import { BarChart3, Download, TrendingUp, Wallet, Building2, AlertTriangle, Activity, Search } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { kes, titleCase, dateTime, today, addDays } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Card, Input, Spinner, EmptyState, StatusBadge, Tabs, Avatar } from '../components/ui.jsx';
import { TrendChart, BarsChart, DonutChart } from '../components/Charts.jsx';

const EXPORTS = [
  { type: 'payments', label: 'Payments' },
  { type: 'tenants', label: 'Tenants' },
  { type: 'properties', label: 'Properties' },
  { type: 'arrears', label: 'Arrears' },
  { type: 'maintenance', label: 'Maintenance' },
  { type: 'expenses', label: 'Expenses' },
];

export default function Reports() {
  const [tab, setTab] = useState('overview');
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <p>Financial and operational analytics across your portfolio.</p>
        </div>
      </div>
      <Tabs tabs={[{ value: 'overview', label: 'Overview' }, { value: 'activity', label: 'Activity' }]} value={tab} onChange={setTab} />
      <div className="mt-16">{tab === 'overview' ? <OverviewReports /> : <ActivityReports />}</div>
    </>
  );
}

function OverviewReports() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState({ from: '', to: '' });
  const [downloading, setDownloading] = useState('');

  const load = () => {
    setLoading(true);
    api
      .get(`/api/reports/overview${qs(range)}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const download = async (type) => {
    setDownloading(type);
    try {
      const csv = await api.get(`/api/reports/export${qs({ type, ...range })}`);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `smart-rentals-${type}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${titleCase(type)} export downloaded`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDownloading('');
    }
  };

  if (loading && !data) return <Spinner label="Building reports…" />;
  if (!data) return <EmptyState icon={BarChart3} title="No report data" message="Add properties and record payments to see analytics." />;

  const { stats, trends, incomeByProperty, maintenanceByCategory, methodSplit, arrears, expensesByCategory } = data;

  return (
    <>
      <Card className="mb-16">
        <div className="flex wrap items-center">
          <span className="small muted">Period</span>
          <Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} style={{ maxWidth: 170 }} />
          <span className="small muted">to</span>
          <Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} style={{ maxWidth: 170 }} />
          <div className="grow" />
          <div className="flex wrap">
            {EXPORTS.map((e) => (
              <Button key={e.type} size="sm" variant="secondary" loading={downloading === e.type} onClick={() => download(e.type)}>
                <Download size={14} /> {e.label}
              </Button>
            ))}
          </div>
        </div>
      </Card>

      <div className="grid grid-4 mb-16">
        <div className="stat"><div className="stat-main"><span className="stat-label">Properties</span><span className="stat-value">{stats.properties}</span><span className="stat-hint">{stats.units} units</span></div><span className="stat-icon"><Building2 size={20} /></span></div>
        <div className="stat stat-blue"><div className="stat-main"><span className="stat-label">Occupancy</span><span className="stat-value">{stats.occupancyRate}%</span><span className="stat-hint">{stats.occupied} occupied</span></div><span className="stat-icon"><TrendingUp size={20} /></span></div>
        <div className="stat stat-green"><div className="stat-main"><span className="stat-label">Collected this month</span><span className="stat-value">{kes(stats.collectedThisMonth)}</span><span className="stat-hint">Expected {kes(stats.expectedRent)} · Spent {kes(stats.expensesMonth)}</span></div><span className="stat-icon"><Wallet size={20} /></span></div>
        <div className="stat stat-red"><div className="stat-main"><span className="stat-label">Outstanding</span><span className="stat-value">{kes(stats.outstanding)}</span><span className="stat-hint">All-time expenses {kes(stats.expensesTotal)}</span></div><span className="stat-icon"><AlertTriangle size={20} /></span></div>
      </div>

      <div className="grid grid-2 mb-16">
        <Card title="Rent collection (12 months)"><TrendChart data={trends} dataKey="collected" xKey="label" /></Card>
        <Card title="Income by property">
          {incomeByProperty.length ? (
            <BarsChart data={incomeByProperty} xKey="name" dataKey="income" />
          ) : (
            <EmptyState title="No income data" />
          )}
        </Card>
      </div>

      <div className="grid grid-2 mb-16">
        <Card title="Payment methods">
          {methodSplit.length ? (
            <DonutChart data={methodSplit.map((m) => ({ name: titleCase(m.method), value: m.amount }))} />
          ) : (
            <EmptyState title="No payments yet" />
          )}
        </Card>
        <Card title="Maintenance by category">
          {maintenanceByCategory.length ? (
            <BarsChart data={maintenanceByCategory} xKey="category" dataKey="cost" formatter={(v) => kes(v)} />
          ) : (
            <EmptyState title="No maintenance data" />
          )}
        </Card>
      </div>

      <div className="grid grid-2 mb-16">
        <Card title="Expenses by category">
          {expensesByCategory?.length ? (
            <DonutChart data={expensesByCategory.map((c) => ({ name: c.category, value: c.total }))} />
          ) : (
            <EmptyState title="No expenses in this period" message="Record expenses to see your cost breakdown." />
          )}
        </Card>
        <Card title="Expenses by property">
          {incomeByProperty.some((r) => r.expenses) ? (
            <BarsChart data={incomeByProperty} xKey="name" dataKey="expenses" formatter={(v) => kes(v)} />
          ) : (
            <EmptyState title="No expenses in this period" />
          )}
        </Card>
      </div>

      <Card title={`Arrears (${arrears.length})`} padded={false}>
        {arrears.length === 0 ? (
          <EmptyState icon={BarChart3} title="No arrears" message="All tenants are up to date." />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Tenant</th><th>Property</th><th>Unit</th><th>Rent</th><th>Months due</th><th className="text-right">Arrears</th></tr></thead>
              <tbody>
                {arrears.map((a) => (
                  <tr key={a.lease_id}>
                    <td className="cell-strong">{a.tenant_name}<div className="cell-muted">{a.phone}</div></td>
                    <td>{a.property_name}</td>
                    <td>{a.unit_number}</td>
                    <td>{kes(a.rent)}</td>
                    <td><span className="badge badge-red">{a.months}</span></td>
                    <td className="text-right cell-strong" style={{ color: 'var(--red)' }}>{kes(a.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function ActivityReports() {
  const toast = useToast();
  const { user } = useAuth();
  const [activity, setActivity] = useState([]);
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ property_id: '', from: addDays(-90), to: today(), action: '' });

  const load = async () => {
    setLoading(true);
    try {
      const [act, props] = await Promise.all([
        api.get(`/api/reports/activity${qs(filters)}`),
        api.get('/api/properties'),
      ]);
      setActivity(act.activity || []);
      setProperties(props.properties || []);
    } catch (err) {
      toast.error(err.message);
      setActivity([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const actorLabel = (a) => {
    if (a.user_name) return a.user_name;
    if (a.actor_role) return titleCase(a.actor_role);
    return 'System';
  };

  return (
    <>
      <Card className="mb-16">
        <div className="flex wrap items-center">
          {user?.role !== 'caretaker' ? (
            <>
              <span className="small muted">Property</span>
              <select className="input select" value={filters.property_id} onChange={(e) => setFilters({ ...filters, property_id: e.target.value })} style={{ maxWidth: 220 }}>
                <option value="">All properties</option>
                {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </>
          ) : null}
          <span className="small muted">From</span>
          <Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} style={{ maxWidth: 170 }} />
          <span className="small muted">to</span>
          <Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} style={{ maxWidth: 170 }} />
          <div className="search-wrap" style={{ position: 'relative', flex: 1, minWidth: 180 }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
            <Input placeholder="Filter by action (e.g. payment, lease, moveout)…" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })} style={{ paddingLeft: 30 }} />
          </div>
        </div>
      </Card>

      {loading ? (
        <Spinner label="Loading activity…" />
      ) : activity.length === 0 ? (
        <EmptyState icon={Activity} title="No activity found" message="Adjust your filters to see more." />
      ) : (
        <Card title={`Activity (${activity.length})`} padded={false}>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Actor</th><th>Action</th><th>Property</th><th>Details</th><th>When</th></tr></thead>
              <tbody>
                {activity.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <div className="avatar-row">
                        <Avatar name={a.user_name} src={a.user_avatar} size={30} />
                        <div>
                          <strong>{actorLabel(a)}</strong>
                          {a.actor_role ? <div className="cell-muted small">{titleCase(a.actor_role)}</div> : null}
                        </div>
                      </div>
                    </td>
                    <td><span className="badge">{titleCase(a.action.replace(/\./g, ' '))}</span></td>
                    <td className="cell-muted">{a.property_name || '—'}</td>
                    <td className="cell-muted small">
                      {a.details ? Object.entries(a.details).slice(0, 3).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ') : '—'}
                    </td>
                    <td className="cell-muted">{dateTime(a.created_at)}</td>
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