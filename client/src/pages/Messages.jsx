import { useEffect, useState } from 'react';
import { MessageSquare, Send, PenSquare, ArrowLeft, Reply } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { timeAgo, titleCase } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Card, Field, Input, Textarea, Select, Modal, Spinner, EmptyState, Avatar, Tabs } from '../components/ui.jsx';

export default function Messages() {
  const { user } = useAuth();
  const toast = useToast();
  const [box, setBox] = useState('inbox');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null);
  const [showCompose, setShowCompose] = useState(false);

  const load = () => {
    setLoading(true);
    api
      .get(`/api/messages${qs({ box })}`)
      .then((d) => setMessages(d.messages || []))
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, [box]);

  const openMessage = async (m) => {
    try {
      const d = await api.get(`/api/messages/${m.id}`);
      setOpen(d.message);
      if (box === 'inbox' && !m.is_read) load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Messages</h1>
          <p>Communicate directly with {user?.role === 'tenant' ? 'your landlord' : 'your tenants'}.</p>
        </div>
        <div className="page-actions">
          <Button onClick={() => setShowCompose(true)}><PenSquare size={16} /> Compose</Button>
        </div>
      </div>

      {open ? (
        <Card
          title={open.subject}
          action={<Button size="sm" variant="ghost" onClick={() => setOpen(null)}><ArrowLeft size={15} /> Back</Button>}
        >
          <div className="msg-meta">
            <Avatar name={open.sender_name} src={open.sender_avatar} size={36} />
            <div>
              <strong>{open.sender_name}</strong>
              <div className="cell-muted small">to {open.recipient_name} · {timeAgo(open.created_at)}</div>
            </div>
          </div>
          <div className="msg-body">{open.body}</div>
          <div className="flex mt-16">
            <Button size="sm" onClick={() => { setShowCompose(true); }}>
              <Reply size={14} /> Reply
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <Tabs tabs={[{ value: 'inbox', label: 'Inbox' }, { value: 'sent', label: 'Sent' }]} value={box} onChange={setBox} />
          {loading ? (
            <Spinner />
          ) : messages.length === 0 ? (
            <EmptyState icon={MessageSquare} title="No messages" message="Messages you send and receive will appear here." />
          ) : (
            <div className="flex-col">
              {messages.map((m) => (
                <button key={m.id} className={`msg-row ${!m.is_read && box === 'inbox' ? 'msg-unread' : ''}`} onClick={() => openMessage(m)}>
                  <Avatar name={m.counterpart_name} src={m.counterpart_avatar} size={40} />
                  <div className="msg-content">
                    <div className="flex-between">
                      <strong>{m.counterpart_name}<span className="cell-muted small"> · {titleCase(m.counterpart_role)}</span></strong>
                      <span className="cell-muted small">{timeAgo(m.created_at)}</span>
                    </div>
                    <div className="msg-subject">{m.subject}</div>
                    <div className="cell-muted small">{m.body.slice(0, 90)}{m.body.length > 90 ? '…' : ''}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <ComposeModal
        open={showCompose}
        onClose={() => setShowCompose(false)}
        onSent={() => { setShowCompose(false); toast.success('Message sent'); load(); }}
        replyTo={open}
      />
    </>
  );
}

function ComposeModal({ open, onClose, onSent, replyTo }) {
  const { user } = useAuth();
  const toast = useToast();
  const [recipients, setRecipients] = useState([]);
  const [form, setForm] = useState({ recipient_id: '', subject: '', body: '' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({ recipient_id: replyTo ? (replyTo.sender_id === user.id ? replyTo.recipient_id : replyTo.sender_id) : '', subject: replyTo ? `Re: ${replyTo.subject}` : '', body: '' });
    if (replyTo) return;
    if (user?.role === 'landlord' || user?.role === 'admin' || user?.role === 'caretaker') {
      const path = user.role === 'admin' ? '/api/admin/users' : '/api/tenants?status=active';
      api.get(path).then((d) => setRecipients((d.users || d.tenants || []).map((t) => ({ id: t.id, full_name: t.full_name, role: t.role })))).catch(() => {});
    } else {
      api.get('/api/leases').then((d) => {
        const active = (d.leases || []).find((l) => l.status === 'active');
        if (active?.landlord_id) setRecipients([{ id: active.landlord_id, full_name: active.landlord_name || 'My landlord', role: 'landlord' }]);
      }).catch(() => {});
    }
  }, [open, replyTo, user]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/api/messages', { ...form, recipient_id: Number(form.recipient_id) });
      onSent();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New message" size="md">
      <form onSubmit={submit}>
        <Field label="Recipient" required>
          <Select value={form.recipient_id} onChange={set('recipient_id')} required disabled={!!replyTo}>
            <option value="">Select recipient…</option>
            {recipients.map((r) => <option key={r.id} value={r.id}>{r.full_name}{r.role ? ` (${titleCase(r.role)})` : ''}</option>)}
          </Select>
        </Field>
        <Field label="Subject" required><Input value={form.subject} onChange={set('subject')} required /></Field>
        <Field label="Message" required><Textarea value={form.body} onChange={set('body')} rows={5} required /></Field>
        <div className="modal-foot" style={{ padding: 0, border: 'none', marginTop: 8 }}>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}><Send size={15} /> Send</Button>
        </div>
      </form>
    </Modal>
  );
}
