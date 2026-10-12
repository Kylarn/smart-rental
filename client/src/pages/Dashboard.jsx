import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2,
  Wallet,
  Users,
  Wrench,
  Inbox,
  DoorOpen,
  AlertTriangle,
  TrendingUp,
  CalendarClock,
  FileText,
  Bell,
  ClipboardList,
  ReceiptText,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { kes, shortKes, date, timeAgo, titleCase } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Card, StatCard, Spinner, StatusBadge, EmptyState, Progress, Badge } from '../components/ui.jsx';
import { TrendChart, BarsChart, DonutChart } from '../components/Charts.jsx';

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/api/dashboard')
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner label="Loading dashboard…" />;
  if (!data) return <EmptyState title="Could not load dashboard" message="Please refresh and try again." />;

  if (user?.role === 'landlord') return <LandlordDashboard data={data} user={user} />;
  if (user?.role === 'caretaker') return <CaretakerDashboard data={data} user={user} />;
  if (user?.role === 'admin') return <AdminDashboard data={data} />;
  return <TenantDashboard data={data} user={user} />;
}

function LandlordDashboard({ data, user }) {
  const { stats, trends, recentPayments, recentMaintenance, recentExpenses, applications, expiring, arrears, byProperty } = data;
  const appTotal = Object.values(applications || {}).reduce((a, b) => a + b, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Welcome, {user.full_name.split(' ')[0]}</h1>
          <p>Here&apos;s how your portfolio is performing today.</p>
        </div>
        <div className="page-actions">
          <Link to="/app/properties" className="btn btn-secondary btn-md">Manage properties</Link>
          <Link to="/app/reports" className="btn btn-primary btn-md">Reports</Link>
        </div>
      </div>

      <div className="grid grid-4">
        <StatCard label="Collected this month" value={shortKes(stats.collectedThisMonth)} icon={Wallet} tone="green" hint={`Expected ${shortKes(stats.expectedRent)}/mo`} />
        <StatCard label="Outstanding arrears" value={shortKes(stats.outstanding)} icon={AlertTriangle} tone={stats.outstanding > 0 ? 'red' : 'green'} />
        <StatCard label="Occupancy" value={`${stats.occupancyRate}%`} icon={Building2} hint={`${stats.occupied}/${stats.units - (stats.unknown || 0)} known units occupied${stats.unknown ? ` · ${stats.unknown} unknown` : ''}`} />
        <StatCard label="Open maintenance" value={stats.pendingMaintenance} icon={Wrench} tone="amber" />
      </div>

      <div className="grid grid-2 section-gap">
        <Card title="Rent collected (last 6 months)">
          {trends?.length ? <TrendChart data={trends} /> : <EmptyState title="No payment history yet" />}
        </Card>
        <Card title="Applications pipeline" action={<Link to="/app/applications" className="link small">View all</Link>}>
          <div className="stat-strip mb-16">
            <div><span>Total</span><strong>{appTotal}</strong></div>
            <div><span>Pending</span><strong>{applications?.pending || 0}</strong></div>
            <div><span>Approved</span><strong>{applications?.approved || 0}</strong></div>
            <div><span>Assigned</span><strong>{applications?.assigned || 0}</strong></div>
          </div>
          <Progress value={applications?.assigned || 0} max={appTotal || 1} tone="green" />
          <p className="small muted mt-8">{(applications?.assigned || 0)} of {appTotal} applications assigned to units</p>
        </Card>
      </div>

      <div className="grid grid-2 section-gap">
        <Card title="Recent payments" action={<Link to="/app/payments" className="link small">View all</Link>} padded={false}>
          {recentPayments?.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Tenant</th><th>Unit</th><th className="text-right">Amount</th><th>Status</th></tr></thead>
                <tbody>
                  {recentPayments.map((p) => (
                    <tr key={p.id}>
                      <td className="cell-strong">{p.tenant_name}</td>
                      <td className="cell-muted">{p.property_name} · {p.unit_number}</td>
                      <td className="text-right cell-strong">{kes(p.amount)}</td>
                      <td><StatusBadge status={p.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState title="No payments yet" />}
        </Card>

        <Card title="Arrears watchlist" action={<Link to="/app/reports" className="link small">Reports</Link>}>
          {arrears?.length ? (
            <div className="flex-col">
              {arrears.map((a) => (
                <div className="unit-row" key={a.lease_id}>
                  <div>
                    <strong>{a.tenant_name}</strong>
                    <div className="cell-muted">{a.property_name} · Unit {a.unit_number}</div>
                  </div>
                  <div className="text-right">
                    <div className="cell-strong" style={{ color: 'var(--red)' }}>{kes(a.total)}</div>
                    <div className="cell-muted">{a.months} month(s)</div>
                  </div>
                </div>
              ))}
            </div>
          ) : <EmptyState icon={TrendingUp} title="All rent up to date" message="No outstanding balances across your portfolio." />}
        </Card>
      </div>

      <div className="grid grid-2 section-gap">
        <Card title="Leases expiring soon" action={<Link to="/app/leases" className="link small">View all</Link>}>
          {expiring?.length ? (
            <div className="flex-col">
              {expiring.map((l) => (
                <div className="unit-row" key={l.id}>
                  <div>
                    <strong>{l.tenant_name}</strong>
                    <div className="cell-muted">{l.property_name} · Unit {l.unit_number}</div>
                  </div>
                  <Badge tone="amber"><CalendarClock size={12} /> {date(l.end_date)}</Badge>
                </div>
              ))}
            </div>
          ) : <EmptyState title="No leases expiring in 45 days" />}
        </Card>

        <Card title="Occupancy by property">
          {byProperty?.length ? (
            <div className="flex-col">
              {byProperty.map((p) => (
                <div key={p.id}>
                  <div className="flex-between mb-8">
                    <strong className="small">{p.name}</strong>
                    <span className="cell-muted">{p.occupied}/{p.units - (p.unknown || 0)} known · {kes(p.monthly_rent)}/mo{p.unknown ? ` · ${p.unknown} unknown` : ''}</span>
                  </div>
                  <Progress value={p.occupied} max={Math.max((p.units || 0) - (p.unknown || 0), 1)} tone={p.occupied === (p.units - (p.unknown || 0)) ? 'green' : 'blue'} />
                </div>
              ))}
            </div>
          ) : <EmptyState icon={Building2} title="No properties yet" message="Add your first property to see analytics." action={<Link to="/app/properties" className="btn btn-primary btn-sm mt-8">Add property</Link>} />}
        </Card>
      </div>

      <div className="grid grid-2 section-gap">
        <Card title="Recent maintenance" action={<Link to="/app/maintenance" className="link small">View all</Link>} padded={false}>
          {recentMaintenance?.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Issue</th><th>Property</th><th>Priority</th><th>Status</th><th>Reported</th></tr></thead>
                <tbody>
                  {recentMaintenance.map((m) => (
                    <tr key={m.id}>
                      <td className="cell-strong">{m.title}</td>
                      <td className="cell-muted">{m.property_name} · {m.unit_number || '—'}</td>
                      <td><StatusBadge status={m.priority} /></td>
                      <td><StatusBadge status={m.status} /></td>
                      <td className="cell-muted">{timeAgo(m.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState icon={Wrench} title="No maintenance requests" />}
        </Card>

        <Card title="Recent expenses" action={<Link to="/app/expenses" className="link small">View all</Link>} padded={false}>
          {recentExpenses?.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Date</th><th>Category</th><th>Description</th><th className="text-right">Amount</th></tr></thead>
                <tbody>
                  {recentExpenses.map((e) => (
                    <tr key={e.id}>
                      <td className="cell-muted">{date(e.expense_date)}</td>
                      <td><Badge tone="gray">{e.category}</Badge></td>
                      <td className="cell-strong">{e.description}</td>
                      <td className="text-right cell-strong">{kes(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState icon={ReceiptText} title="No expenses recorded" message="Track property costs like utilities, repairs and salaries." action={<Link to="/app/expenses" className="btn btn-primary btn-sm mt-8">Record expense</Link>} />}
        </Card>
      </div>
    </>
  );
}

function CaretakerDashboard({ data, user }) {
  const { stats, trends, recentPayments, recentMaintenance, recentExpenses, moveOuts, arrears, expiring, byProperty } = data;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Welcome, {user.full_name.split(' ')[0]}</h1>
          <p>Operational overview of the properties you manage.</p>
        </div>
        <div className="page-actions">
          <Link to="/app/maintenance" className="btn btn-secondary btn-md">Requests</Link>
          <Link to="/app/moveouts" className="btn btn-primary btn-md">Move-Outs</Link>
        </div>
      </div>

      <div className="grid grid-4">
        <StatCard label="Occupancy" value={`${stats.occupancyRate}%`} icon={Building2} hint={`${stats.occupied}/${stats.units - (stats.unknown || 0)} known units · ${stats.properties} properties${stats.unknown ? ` · ${stats.unknown} unknown` : ''}`} />
        <StatCard label="Collected this month" value={shortKes(stats.collectedMonth)} icon={Wallet} tone="green" hint={`Expected ${shortKes(stats.monthlyRent)}/mo`} />
        <StatCard label="Outstanding arrears" value={shortKes(stats.arrearsTotal)} icon={AlertTriangle} tone={stats.arrearsTotal > 0 ? 'red' : 'green'} />
        <StatCard label="Open maintenance" value={stats.maintenance_open} icon={Wrench} tone="amber" hint={`${stats.complaints} complaints`} />
      </div>

      <div className="grid grid-2 section-gap">
        <Card title="Rent collected (last 6 months)">
          {trends?.length ? <TrendChart data={trends} /> : <EmptyState title="No payments yet" />}
        </Card>
        <Card title="Recent move-outs" action={<Link to="/app/moveouts" className="link small">Manage</Link>} padded={false}>
          {moveOuts?.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Tenant</th><th>Unit</th><th>Date</th><th>Status</th></tr></thead>
                <tbody>
                  {moveOuts.map((m) => (
                    <tr key={m.id}>
                      <td className="cell-strong">{m.tenant_name}</td>
                      <td className="cell-muted">{m.property_name} · {m.unit_number}</td>
                      <td className="cell-muted">{date(m.move_out_date)}</td>
                      <td><StatusBadge status={m.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState icon={ClipboardList} title="No move-outs yet" />}
        </Card>
      </div>

      <div className="grid grid-2 section-gap">
        <Card title="Arrears watchlist" action={<Link to="/app/reports" className="link small">Reports</Link>}>
          {arrears?.length ? (
            <div className="flex-col">
              {arrears.map((a) => (
                <div className="unit-row" key={a.lease_id}>
                  <div>
                    <strong>{a.tenant_name}</strong>
                    <div className="cell-muted">{a.property_name} · Unit {a.unit_number}</div>
                  </div>
                  <div className="text-right">
                    <div className="cell-strong" style={{ color: 'var(--red)' }}>{kes(a.total)}</div>
                    <div className="cell-muted">{a.months} month(s)</div>
                  </div>
                </div>
              ))}
            </div>
          ) : <EmptyState icon={TrendingUp} title="All rent up to date" message="No outstanding balances across your properties." />}
        </Card>

        <Card title="Leases expiring soon">
          {expiring?.length ? (
            <div className="flex-col">
              {expiring.map((l) => (
                <div className="unit-row" key={l.id}>
                  <div>
                    <strong>{l.tenant_name}</strong>
                    <div className="cell-muted">{l.property_name} · Unit {l.unit_number}</div>
                  </div>
                  <Badge tone="amber"><CalendarClock size={12} /> {date(l.end_date)}</Badge>
                </div>
              ))}
            </div>
          ) : <EmptyState title="No leases expiring in 45 days" />}
        </Card>
      </div>

      <div className="grid grid-2 section-gap">
        <Card title="Recent maintenance" action={<Link to="/app/maintenance" className="link small">View all</Link>} padded={false}>
          {recentMaintenance?.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Issue</th><th>Property</th><th>Priority</th><th>Status</th><th>Reported</th></tr></thead>
                <tbody>
                  {recentMaintenance.map((m) => (
                    <tr key={m.id}>
                      <td className="cell-strong">{m.title}</td>
                      <td className="cell-muted">{m.property_name} · {m.unit_number || '—'}</td>
                      <td><StatusBadge status={m.priority} /></td>
                      <td><StatusBadge status={m.status} /></td>
                      <td className="cell-muted">{timeAgo(m.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState icon={Wrench} title="No maintenance requests" />}
        </Card>

        <Card title="Recent expenses" action={<Link to="/app/expenses" className="link small">View all</Link>} padded={false}>
          {recentExpenses?.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Date</th><th>Category</th><th>Description</th><th className="text-right">Amount</th></tr></thead>
                <tbody>
                  {recentExpenses.map((e) => (
                    <tr key={e.id}>
                      <td className="cell-muted">{date(e.expense_date)}</td>
                      <td><Badge tone="gray">{e.category}</Badge></td>
                      <td className="cell-strong">{e.description}</td>
                      <td className="text-right cell-strong">{kes(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState icon={ReceiptText} title="No expenses recorded" message="Track property costs like utilities, repairs and salaries." action={<Link to="/app/expenses" className="btn btn-primary btn-sm mt-8">Record expense</Link>} />}
        </Card>
      </div>
    </>
  );
}

function TenantDashboard({ data, user }) {
  const { stats, payments, maintenance, announcements, applications } = data;
  const lease = stats.lease;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Hello, {user.full_name.split(' ')[0]}</h1>
          <p>Your tenancy at a glance.</p>
        </div>
        <div className="page-actions">
          <Link to="/app/payments" className="btn btn-primary btn-md">Pay rent</Link>
          <Link to="/app/maintenance" className="btn btn-secondary btn-md">Report issue</Link>
        </div>
      </div>

      <div className="grid grid-4">
        <StatCard label="Rent due" value={kes(stats.arrears?.total || 0)} icon={Wallet} tone={stats.arrears?.total ? 'red' : 'green'} hint={stats.arrears?.total ? `${stats.arrears.months} month(s) outstanding` : 'All paid up'} />
        <StatCard label="Monthly rent" value={kes(lease?.rent || 0)} icon={Building2} hint={lease ? `Unit ${lease.unit_number}` : 'No active lease'} />
        <StatCard label="Open maintenance" value={stats.maintenance_open || 0} icon={Wrench} tone="amber" hint={`${stats.maintenance_total || 0} total`} />
        <StatCard label="My applications" value={stats.applications || 0} icon={Inbox} hint={`${stats.applications_pending || 0} in progress`} />
      </div>

      <div className="grid grid-2 section-gap">
        <Card title="My lease">
          {lease ? (
            <>
              <div className="kv"><span>Property</span><span>{lease.property_name}</span></div>
              <div className="kv"><span>Unit</span><span>{lease.unit_number} · {lease.unit_type}</span></div>
              <div className="kv"><span>Rent</span><span>{kes(lease.rent)} / month</span></div>
              <div className="kv"><span>Lease period</span><span>{date(lease.start_date)} → {date(lease.end_date)}</span></div>
              <div className="kv"><span>Status</span><span><StatusBadge status="active" /></span></div>
              <Link to="/app/lease" className="btn btn-secondary btn-sm mt-16">View full lease</Link>
            </>
          ) : (
            <EmptyState icon={FileText} title="No active lease" message="Browse the marketplace to find your next home." action={<Link to="/" className="btn btn-primary btn-sm mt-8">Browse rentals</Link>} />
          )}
        </Card>

        <Card title="Recent payments" action={<Link to="/app/payments" className="link small">View all</Link>}>
          {payments?.length ? (
            <div className="flex-col">
              {payments.map((p) => (
                <div className="unit-row" key={p.id}>
                  <div>
                    <strong>{kes(p.amount)}</strong>
                    <div className="cell-muted">Period {p.period || '—'} · {titleCase(p.method)}</div>
                  </div>
                  <StatusBadge status={p.status} />
                </div>
              ))}
            </div>
          ) : <EmptyState title="No payments yet" />}
        </Card>
      </div>

      <div className="grid grid-2 section-gap">
        <Card title="Announcements" action={<Link to="/app/announcements" className="link small">View all</Link>}>
          {announcements?.length ? (
            <div className="timeline">
              {announcements.map((a) => (
                <div className="timeline-item" key={a.id}>
                  <span className="timeline-dot" />
                  <div>
                    <strong>{a.title}</strong>
                    <p className="muted small">{a.body}</p>
                    <span className="faint small">{timeAgo(a.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : <EmptyState icon={Bell} title="No announcements" />}
        </Card>

        <Card title="Maintenance requests" action={<Link to="/app/maintenance" className="link small">View all</Link>}>
          {maintenance?.length ? (
            <div className="flex-col">
              {maintenance.map((m) => (
                <div className="unit-row" key={m.id}>
                  <div>
                    <strong>{m.title}</strong>
                    <div className="cell-muted">{timeAgo(m.created_at)}</div>
                  </div>
                  <StatusBadge status={m.status} />
                </div>
              ))}
            </div>
          ) : <EmptyState icon={Wrench} title="No requests" />}
        </Card>
      </div>
    </>
  );
}

function AdminDashboard({ data }) {
  const { stats, trends, recentAudit, recentPayments, topCounties } = data;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Platform overview</h1>
          <p>Everything happening across Smart Rentals.</p>
        </div>
      </div>

      <div className="grid grid-4">
        <StatCard label="Total users" value={stats.users} icon={Users} hint={`${stats.landlords} landlords · ${stats.tenants} tenants`} />
        <StatCard label="Properties" value={stats.properties} icon={Building2} hint={`${stats.units} units`} />
        <StatCard label="Collected" value={shortKes(stats.collected)} icon={Wallet} tone="green" hint={`${stats.paymentCount} payments`} />
        <StatCard label="Open maintenance" value={stats.maintenanceOpen} icon={Wrench} tone="amber" hint={`${stats.activeLeases} active leases`} />
      </div>

      <div className="grid grid-2 section-gap">
        <Card title="Platform collections (6 months)">
          {trends?.length ? <TrendChart data={trends} /> : <EmptyState title="No data yet" />}
        </Card>
        <Card title="Properties by county">
          {topCounties?.length ? <BarsChart data={topCounties} xKey="county" dataKey="properties" formatter={(v) => v} /> : <EmptyState title="No properties" />}
        </Card>
      </div>

      <div className="grid grid-2 section-gap">
        <Card title="Recent signups & activity" padded={false}>
          {recentAudit?.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>User</th><th>Action</th><th>When</th></tr></thead>
                <tbody>
                  {recentAudit.slice(0, 8).map((a) => (
                    <tr key={a.id}>
                      <td className="cell-strong">{a.user_name || 'System'}</td>
                      <td className="cell-muted">{titleCase(a.action.replace(/\./g, ' '))}</td>
                      <td className="cell-muted">{timeAgo(a.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState title="No activity" />}
        </Card>
        <Card title="Recent payments" padded={false}>
          {recentPayments?.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Tenant</th><th>Property</th><th className="text-right">Amount</th><th>Status</th></tr></thead>
                <tbody>
                  {recentPayments.map((p) => (
                    <tr key={p.id}>
                      <td className="cell-strong">{p.tenant_name}</td>
                      <td className="cell-muted">{p.property_name || '—'}</td>
                      <td className="text-right cell-strong">{kes(p.amount)}</td>
                      <td><StatusBadge status={p.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState title="No payments" />}
        </Card>
      </div>
    </>
  );
}
