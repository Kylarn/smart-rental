import { useState } from 'react';
import { User, Lock, Save } from 'lucide-react';
import { api } from '../lib/api.js';
import { titleCase } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Card, Field, Input, Avatar } from '../components/ui.jsx';

export default function Profile() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({
    full_name: user?.full_name || '',
    phone: user?.phone || '',
    county: user?.county || '',
    id_number: user?.id_number || '',
    bio: user?.bio || '',
  });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [pw, setPw] = useState({ current_password: '', new_password: '', confirm: '' });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwErrors, setPwErrors] = useState({});

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setP = (k) => (e) => setPw({ ...pw, [k]: e.target.value });

  const saveProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const d = await api.put('/api/auth/me', form);
      setUser(d.user);
      toast.success('Profile updated');
    } catch (err) {
      setErrors(err.validation || {});
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const savePassword = async (e) => {
    e.preventDefault();
    if (pw.new_password !== pw.confirm) {
      setPwErrors({ confirm: 'Passwords do not match' });
      return;
    }
    setPwSaving(true);
    setPwErrors({});
    try {
      await api.put('/api/auth/password', { current_password: pw.current_password, new_password: pw.new_password });
      toast.success('Password changed');
      setPw({ current_password: '', new_password: '', confirm: '' });
    } catch (err) {
      setPwErrors(err.validation || {});
      toast.error(err.message);
    } finally {
      setPwSaving(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Profile</h1>
          <p>Manage your personal details and account security.</p>
        </div>
      </div>

      <div className="grid grid-2">
        <Card title="Personal details">
          <div className="avatar-row mb-16">
            <Avatar name={user?.full_name} src={user?.avatar_url} size={56} />
            <div>
              <strong>{user?.full_name}</strong>
              <div className="cell-muted">{user?.email} · {titleCase(user?.role)}</div>
            </div>
          </div>
          <form onSubmit={saveProfile}>
            <Field label="Full name" required error={errors.full_name}><Input value={form.full_name} onChange={set('full_name')} required /></Field>
            <div className="form-row">
              <Field label="Phone" error={errors.phone}><Input value={form.phone} onChange={set('phone')} placeholder="0712345678" /></Field>
              <Field label="County"><Input value={form.county} onChange={set('county')} /></Field>
            </div>
            <Field label="ID number"><Input value={form.id_number} onChange={set('id_number')} /></Field>
            <Field label="Bio"><Input value={form.bio} onChange={set('bio')} placeholder="A short note about you" /></Field>
            <Button type="submit" loading={saving}><Save size={15} /> Save changes</Button>
          </form>
        </Card>

        <Card title="Change password">
          <form onSubmit={savePassword}>
            <Field label="Current password" required error={pwErrors.current_password}><Input type="password" value={pw.current_password} onChange={setP('current_password')} required /></Field>
            <Field label="New password" required error={pwErrors.new_password} hint="At least 6 characters"><Input type="password" value={pw.new_password} onChange={setP('new_password')} minLength={6} required /></Field>
            <Field label="Confirm new password" required error={pwErrors.confirm}><Input type="password" value={pw.confirm} onChange={setP('confirm')} required /></Field>
            <Button type="submit" loading={pwSaving}><Lock size={15} /> Update password</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
