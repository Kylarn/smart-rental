import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Field, Input, Select } from '../components/ui.jsx';
import { COUNTIES } from '../lib/counties.js';

export default function Register() {
  const { register } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    phone: '',
    password: '',
    role: 'tenant',
    county: 'Nairobi',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [pending, setPending] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setFieldErrors({});
    try {
      const result = await register(form);
      if (result && result.pending) {
        setPending(result.message || 'Your account is awaiting admin approval.');
        return;
      }
      toast.success('Account created. Welcome!');
      navigate('/app', { replace: true });
    } catch (err) {
      setError(err.message);
      if (err.validation) setFieldErrors(err.validation);
    } finally {
      setLoading(false);
    }
  };

  const update = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  return (
    <div className="auth-wrap">
      <aside className="auth-aside">
        <div className="brand" style={{ padding: 0, border: 'none' }}>
          <span className="brand-mark">SR</span>
          <span className="brand-name">
            Smart <strong>Rentals</strong>
          </span>
        </div>
        <div>
          <h2>Join Kenya&apos;s smartest rental platform.</h2>
          <p>List your properties or find your next home in minutes. No paperwork headaches.</p>
        </div>
        <p className="small" style={{ color: '#8895b0' }}>
          © {new Date().getFullYear()} Smart Rentals
        </p>
      </aside>

      <main className="auth-main">
        <div className="auth-card">
          <h1>Create account</h1>
          <p>Get started in less than a minute.</p>
          {pending ? (
            <div className="notice notice-info mb-16">{pending}</div>
          ) : (
          <form onSubmit={submit}>
            <Field label="Full name" required error={fieldErrors.full_name}>
              <Input value={form.full_name} onChange={update('full_name')} placeholder="Jane Wanjiku" required />
            </Field>
            <div className="form-row">
              <Field label="Email" required error={fieldErrors.email}>
                <Input type="email" value={form.email} onChange={update('email')} placeholder="you@example.com" required />
              </Field>
              <Field label="Phone" required error={fieldErrors.phone}>
                <Input value={form.phone} onChange={update('phone')} placeholder="0712345678" required />
              </Field>
            </div>
            <div className="form-row">
              <Field label="I am a" required>
                <Select value={form.role} onChange={update('role')}>
                  <option value="tenant">Tenant / Renter</option>
                  <option value="landlord">Landlord / Property manager</option>
                </Select>
              </Field>
              <Field label="County">
                <Select value={form.county} onChange={update('county')}>
                  {COUNTIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Password" required error={fieldErrors.password} hint="At least 6 characters">
              <Input type="password" value={form.password} onChange={update('password')} placeholder="••••••••" required />
            </Field>
            {error ? <div className="notice notice-danger mb-16">{error}</div> : null}
            <Button type="submit" loading={loading} className="btn-block" size="lg">
              Create account
            </Button>
          </form>
          )}
          <p className="auth-switch">
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
