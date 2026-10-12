import { useEffect, useState } from 'react';
import { Send, RefreshCw, MessageSquareWarning, CheckCircle2, Clock, XCircle, AlertCircle } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { dateTime, titleCase } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Card, StatCard, Input, Select, Spinner, EmptyState, StatusBadge, Badge, PageHeader } from '../components/ui.jsx';

export default function SmsLog() {
  const { user } = useAuth();
  const toast = useToast();
  const [data, setData] = useState({ messages: [], stats: {}, enabled: true });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: '', event_type: '', search: '' });
  const [flushing, setFlushing] = useState(false);

  const load = () => {
    setLoading(true);
    api
      .get(`/api/sms${qs(filters)}`)
      .then((d) => setData({ messages: d.messages || [], stats: d.stats || {}, enabled: d.enabled !== false }))
      .catch(() => setData({ messages: [], stats: {}, enabled: true }))
      .finally(() => setLoading(false));
  };

  useEffect(load, [filters.status, filters.event_type]);

  const search = (e) => {
    e.preventDefault();
    load();
  };

  const flush = async () => {
    setFlushing(true);
    try {
      const d = await api.post('/api/sms/flush', {});
      toast.success(`Dispatched ${d.sent} queued message${d.sent === 1 ? '' : 's'}`);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setFlushing(false);
    }
  };

  const { stats, messages, enabled } = data;

  return (
    <>
      <PageHeader
        title="SMS notifications"
        subtitle="Automated text messages sent to tenants and the delivery log."
        actions={
          user?.role === 'admin' ? (
            <Button variant="secondary" onClick={flush} loading={flushing}>
              <RefreshCw size={15} /> Dispatch queue
            </Button>
          ) : null
        }
      />

      {!enabled ? (
        <div className="notice notice-warn mb-16">
          SMS notifications are currently disabled by the platform administrator. Messages will be queued but
          not delivered.
        </div>
      ) : null}

      <div className="grid grid-4 mb-16">
        <StatCard label="Queued" value={stats.queued || 0} icon={Clock} tone="amber" />
        <StatCard label="Sent" value={stats.sent || 0} icon={Send} tone="blue" />
        <StatCard label="Delivered" value={stats.delivered || 0} icon={CheckCircle2} tone="green" />
        <StatCard label="Failed" value={stats.failed || 0} icon={XCircle} tone="red" />
      </div>

      <Card
        title="Message log"
        action={
          <form className="flex" onSubmit={search}>
            <Select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              style={{ width: 150 }}
            >
              <option value="">All statuses</option>
              <option value="queued">Queued</option>
              <option value="sent">Sent</option>
              <option value="delivered">Delivered</option>
              <option value="failed">Failed</option>
            </Select>
            <Input
              placeholder="Search phone or text…"
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              style={{ maxWidth: 220 }}
            />
            <Button type="submit" variant="secondary">Search</Button>
          </form>
        }
      >
        {loading ? (
          <Spinner />
        ) : messages.length === 0 ? (
          <EmptyState
            icon={MessageSquareWarning}
            title="No messages yet"
            message="Automated SMS such as rent reminders, payment receipts and utility bills will appear here."
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Recipient</th>
                  <th>Message</th>
                  <th>Event</th>
                  <th>Status</th>
                  <th>Sent</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((m) => (
                  <tr key={m.id}>
                    <td>{m.phone}</td>
                    <td className="cell-muted" style={{ maxWidth: 420 }}>{m.message}</td>
                    <td>
                      <span className="small">{titleCase(m.event_type)}</span>
                      {m.simulated ? <Badge tone="amber">Simulated</Badge> : null}
                    </td>
                    <td><StatusBadge status={m.status} /></td>
                    <td className="cell-muted">{dateTime(m.sent_at || m.created_at)}</td>
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
