import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, Trash2, BellRing } from 'lucide-react';
import { api } from '../lib/api.js';
import { timeAgo } from '../lib/format.js';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Card, Spinner, EmptyState, Tabs } from '../components/ui.jsx';

function appLink(link) {
  if (!link) return null;
  if (link.startsWith('/tenant/')) return `/app/${link.slice('/tenant/'.length)}`;
  if (link.startsWith('/landlord/')) return `/app/${link.slice('/landlord/'.length)}`;
  if (link.startsWith('/caretaker/')) return `/app/${link.slice('/caretaker/'.length)}`;
  if (link.startsWith('/app')) return link;
  return null;
}

const TYPE_TONES = { error: 'red', maintenance: 'amber', lease: 'blue', application: 'purple', message: 'blue', announcement: 'green', info: 'gray' };

export default function Notifications() {
  const toast = useToast();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');

  const load = () => {
    setLoading(true);
    api
      .get('/api/notifications?limit=100')
      .then((d) => {
        setItems(d.notifications || []);
        setUnread(d.unread || 0);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const markAll = async () => {
    await api.post('/api/notifications/read-all', {});
    toast.success('All marked as read');
    load();
  };

  const open = async (n) => {
    if (!n.is_read) await api.patch(`/api/notifications/${n.id}/read`, {}).catch(() => {});
    const to = appLink(n.link);
    if (to) navigate(to);
    else load();
  };

  const remove = async (n, e) => {
    e.stopPropagation();
    await api.del(`/api/notifications/${n.id}`);
    load();
  };

  const filtered = items.filter((n) => (tab === 'unread' ? !n.is_read : true));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Notifications</h1>
          <p>{unread > 0 ? `${unread} unread update${unread > 1 ? 's' : ''}.` : 'You are all caught up.'}</p>
        </div>
        {unread > 0 ? <div className="page-actions"><Button variant="secondary" onClick={markAll}><CheckCheck size={16} /> Mark all read</Button></div> : null}
      </div>

      <Tabs tabs={[{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread', count: unread }]} value={tab} onChange={setTab} />

      {loading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <EmptyState icon={BellRing} title="No notifications" message="Updates about your lease, payments and requests will show here." />
      ) : (
        <div className="flex-col">
          {filtered.map((n) => (
            <button key={n.id} className={`notif-row ${!n.is_read ? 'notif-unread' : ''}`} onClick={() => open(n)}>
              <span className={`notif-icon badge-${TYPE_TONES[n.type] || 'gray'}`}><Bell size={16} /></span>
              <div className="grow">
                <div className="flex-between">
                  <strong>{n.title}</strong>
                  <span className="cell-muted small">{timeAgo(n.created_at)}</span>
                </div>
                {n.body ? <div className="cell-muted small">{n.body}</div> : null}
              </div>
              <span className="icon-btn" onClick={(e) => remove(n, e)}><Trash2 size={15} /></span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
