import { useEffect, useState } from 'react';
import { ScrollText, Search } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { dateTime, titleCase } from '../lib/format.js';
import { Card, Input, Spinner, EmptyState, Avatar, Badge } from '../components/ui.jsx';

export default function AdminAudit() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState('');

  const load = () => {
    setLoading(true);
    api
      .get(`/api/admin/audit-logs${qs({ action })}`)
      .then((d) => setLogs(d.logs || []))
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  const parse = (details) => {
    if (!details) return null;
    try {
      const d = JSON.parse(details);
      return Object.entries(d).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' · ');
    } catch {
      return details;
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <p>A record of key actions across the platform.</p>
        </div>
      </div>

      <Card className="mb-16">
        <div className="flex items-center wrap">
          <Search size={16} className="cell-muted" />
          <Input placeholder="Filter by action (e.g. payment, lease, admin)…" value={action} onChange={(e) => setAction(e.target.value)} style={{ maxWidth: 340 }} />
          <div className="grow" />
          <span className="cell-muted">{logs.length} entries</span>
        </div>
      </Card>

      {loading ? (
        <Spinner />
      ) : logs.length === 0 ? (
        <EmptyState icon={ScrollText} title="No audit entries" message="Actions will be recorded here as they happen." />
      ) : (
        <Card padded={false}>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th><th>IP</th><th>When</th></tr></thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {l.user_name ? (
                        <div className="avatar-row">
                          <Avatar name={l.user_name} size={30} />
                          <div><strong>{l.user_name}</strong><div className="small muted">{titleCase(l.user_role || '')}</div></div>
                        </div>
                      ) : <span className="faint">System</span>}
                    </td>
                    <td><Badge tone="blue">{l.action}</Badge></td>
                    <td className="cell-muted">{l.entity ? `${l.entity}${l.entity_id ? ` #${l.entity_id}` : ''}` : '—'}</td>
                    <td className="cell-muted small">{parse(l.details) || '—'}</td>
                    <td className="mono small">{l.ip || '—'}</td>
                    <td className="cell-muted">{dateTime(l.created_at)}</td>
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
