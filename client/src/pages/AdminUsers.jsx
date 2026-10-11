import { useEffect, useState } from 'react';
import { UserCog, Plus, Search, ShieldCheck, Ban, Trash2, Pencil } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { date, titleCase } from '../lib/format.js';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Card, Field, Input, Select, Modal, Spinner, EmptyState, StatusBadge, Avatar, Tabs, Badge } from '../components/ui.jsx';

const ROLE_TONES = { admin: 'purple', landlord: 'blue', tenant: 'gray', caretaker: 'amber' };

export default function AdminUsers() {
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState('all');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = () => {
    setLoading(true);
    api
      .get(`/api/admin/users${qs({ role: role === 'all' ? '' : role, search })}`)
      .then((d) => setUsers(d.users || []))
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, search]);

  const toggleSuspend = async (u) => {
    try {
      await api.patch(`/api/admin/users/${u.id}`, { status: u.status === 'suspended' ? 'active' : 'suspended' });
      toast.success(u.status === 'suspended' ? 'Account reactivated' : 'Account suspended');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const remove = async (u) => {
    if (!window.confirm(`Delete ${u.full_name}? This cannot be undone.`)) return;
    try {
      await api.del(`/api/admin/users/${u.id}`);
      toast.success('User deleted');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Users</h1>
          <p>Manage landlords, tenants and administrators.</p>
        </div>
        <div className="page-actions">
          <Button onClick={() => setShowCreate(true)}><Plus size={16} /> New user</Button>
        </div>
      </div>

      <div className="flex-between mb-16 wrap">
        <Tabs
          tabs={[
            { value: 'all', label: 'All' },
            { value: 'landlord', label: 'Landlords' },
            { value: 'tenant', label: 'Tenants' },
            { value: 'caretaker', label: 'Caretakers' },
            { value: 'admin', label: 'Admins' },
          ]}
          value={role}
          onChange={setRole}
        />
        <Input placeholder="Search name, email, phone…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 280 }} />
      </div>

      {loading ? (
        <Spinner />
      ) : users.length === 0 ? (
        <EmptyState icon={UserCog} title="No users" message="No accounts match your filters." />
      ) : (
        <Card padded={false}>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>User</th><th>Role</th><th>Contact</th><th>Portfolio</th><th>Status</th><th>Joined</th><th></th></tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="avatar-row">
                        <Avatar name={u.full_name} src={u.avatar_url} size={34} />
                        <div><strong>{u.full_name}</strong><div className="cell-muted">{u.email}</div></div>
                      </div>
                    </td>
                    <td><Badge tone={ROLE_TONES[u.role]}>{titleCase(u.role)}</Badge></td>
                    <td className="cell-muted">{u.phone || '—'}<div className="small">{u.county || ''}</div></td>
                    <td className="cell-muted">
                      {u.role === 'landlord' ? `${u.properties} properties` : u.role === 'tenant' ? `${u.leases} leases` : '—'}
                    </td>
                    <td><StatusBadge status={u.status} /></td>
                    <td className="cell-muted">{date(u.created_at)}</td>
                    <td className="row-actions">
                      <Button size="sm" variant="ghost" title="Edit" onClick={() => setEditing(u)}><Pencil size={15} /></Button>
                      <Button size="sm" variant="ghost" title={u.status === 'suspended' ? 'Reactivate' : 'Suspend'} onClick={() => toggleSuspend(u)}>
                        {u.status === 'suspended' ? <ShieldCheck size={15} /> : <Ban size={15} />}
                      </Button>
                      <Button size="sm" variant="ghost" title="Delete" onClick={() => remove(u)}><Trash2 size={15} /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <CreateUserModal open={showCreate} onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); toast.success('User created'); load(); }} />
      <EditUserModal user={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); toast.success('User updated'); load(); }} />
    </>
  );
}

function CreateUserModal({ open, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', password: '', role: 'tenant', county: '' });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrors({});
    try {
      await api.post('/api/admin/users', form);
      onSaved();
      setForm({ full_name: '', email: '', phone: '', password: '', role: 'tenant', county: '' });
    } catch (err) {
      setErrors(err.validation || {});
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New user" size="md">
      <form onSubmit={submit}>
        <Field label="Full name" required error={errors.full_name}><Input value={form.full_name} onChange={set('full_name')} required /></Field>
        <div className="form-row">
          <Field label="Email" required error={errors.email}><Input type="email" value={form.email} onChange={set('email')} required /></Field>
          <Field label="Phone" required error={errors.phone}><Input value={form.phone} onChange={set('phone')} placeholder="0712345678" required /></Field>
        </div>
        <div className="form-row">
          <Field label="Role" required>
            <Select value={form.role} onChange={set('role')}>
              <option value="tenant">Tenant</option>
              <option value="caretaker">Caretaker</option>
              <option value="landlord">Landlord</option>
              <option value="admin">Admin</option>
            </Select>
          </Field>
          <Field label="County"><Input value={form.county} onChange={set('county')} /></Field>
        </div>
        <Field label="Password" required error={errors.password} hint="At least 6 characters"><Input type="password" value={form.password} onChange={set('password')} minLength={6} required /></Field>
        <div className="modal-foot" style={{ padding: 0, border: 'none', marginTop: 8 }}>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>Create user</Button>
        </div>
      </form>
    </Modal>
  );
}

function EditUserModal({ user, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ full_name: '', role: 'tenant', county: '', password: '' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) setForm({ full_name: user.full_name || '', role: user.role || 'tenant', county: user.county || '', password: '' });
  }, [user]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = { full_name: form.full_name, role: form.role, county: form.county };
      if (form.password) payload.password = form.password;
      await api.patch(`/api/admin/users/${user.id}`, payload);
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={!!user} onClose={onClose} title="Edit user" size="md">
      {user ? (
        <form onSubmit={submit}>
          <Field label="Full name" required><Input value={form.full_name} onChange={set('full_name')} required /></Field>
          <div className="form-row">
            <Field label="Role" hint="You cannot change your own role">
              <Select value={form.role} onChange={set('role')}>
                <option value="tenant">Tenant</option>
                <option value="caretaker">Caretaker</option>
                <option value="landlord">Landlord</option>
                <option value="admin">Admin</option>
              </Select>
            </Field>
            <Field label="County"><Input value={form.county} onChange={set('county')} /></Field>
          </div>
          <Field label="Reset password" hint="Leave blank to keep current"><Input type="password" value={form.password} onChange={set('password')} /></Field>
          <div className="modal-foot" style={{ padding: 0, border: 'none', marginTop: 8 }}>
            <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={loading}>Save</Button>
          </div>
        </form>
      ) : null}
    </Modal>
  );
}
