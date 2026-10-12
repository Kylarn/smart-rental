import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ShieldCheck, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api.js';
import { Button, Field, Input, Spinner } from '../components/ui.jsx';

export default function Activate() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [info, setInfo] = useState(null);
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setChecking(false);
      return;
    }
    api
      .get(`/api/auth/activation/${encodeURIComponent(token)}`)
      .then((d) => setInfo(d))
      .catch(() => setInfo({ valid: false, status: 'invalid' }))
      .finally(() => setChecking(false));
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) {
      setError('Passwords do not match');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.post('/api/auth/activation', { token, password: form.password });
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const invalid = !checking && (!info?.valid || !token);

  return (
    <div className="auth-wrap">
      <main className="auth-main">
        <div className="auth-card">
          <span className="brand-mark" style={{ marginBottom: 16 }}>SR</span>

          {checking ? (
            <Spinner label="Checking your activation link…" />
          ) : done ? (
            <>
              <h1><CheckCircle2 size={22} style={{ verticalAlign: -3 }} /> Account activated</h1>
              <p>Your tenant account is now active. You can sign in with your email and the password you just set.</p>
              <Button size="lg" className="btn-block" onClick={() => navigate('/login', { replace: true })}>
                Go to sign in
              </Button>
            </>
          ) : invalid ? (
            <>
              <h1><AlertTriangle size={22} style={{ verticalAlign: -3 }} /> Link expired</h1>
              <p>
                This activation link is invalid or has expired. Ask your landlord to resend it, or request a
                new one below.
              </p>
              <p className="small muted">
                Once you have a fresh link, open it from the SMS or email you received.
              </p>
              <p className="auth-switch">
                Already activated? <Link to="/login">Sign in</Link>
              </p>
            </>
          ) : (
            <>
              <h1>Activate your account</h1>
              <p>
                Welcome{info?.full_name ? `, ${info.full_name}` : ''}. Set a password to activate your tenant
                account.
              </p>
              <form onSubmit={submit}>
                <Field label="Email">
                  <Input value={info?.email || ''} readOnly disabled />
                </Field>
                <Field label="New password" required hint="At least 6 characters">
                  <Input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    minLength={6}
                    required
                  />
                </Field>
                <Field label="Confirm password" required>
                  <Input
                    type="password"
                    value={form.confirm}
                    onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                    required
                  />
                </Field>
                {error ? <div className="notice notice-danger mb-16">{error}</div> : null}
                <Button type="submit" size="lg" className="btn-block" loading={saving}>
                  <ShieldCheck size={16} /> Activate account
                </Button>
              </form>
              <p className="auth-switch">
                Already activated? <Link to="/login">Sign in</Link>
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
