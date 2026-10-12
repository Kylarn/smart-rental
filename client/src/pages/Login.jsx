import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ShieldCheck, Building2, Wallet } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Field, Input } from '../components/ui.jsx';

const DEMO = [
  { role: 'Admin', email: 'admin@smartrentals.co.ke', password: 'Admin@123' },
];

export default function Login() {
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(form.email, form.password);
      toast.success('Welcome back!');
      navigate(location.state?.from || '/app', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

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
          <h2>Manage rentals the modern way.</h2>
          <p>
            One platform for landlords, tenants and property managers across Kenya — leases, M-Pesa rent,
            maintenance and listings in one place.
          </p>
          <div className="mt-24 auth-points">
            <div className="auth-point">
              <span>
                <Building2 size={17} />
              </span>
              Track properties, units and occupancy in real time
            </div>
            <div className="auth-point">
              <span>
                <Wallet size={17} />
              </span>
              Collect rent via M-Pesa and reconcile instantly
            </div>
            <div className="auth-point">
              <span>
                <ShieldCheck size={17} />
              </span>
              Secure role-based access for every user
            </div>
          </div>
        </div>
        <p className="small" style={{ color: '#8895b0' }}>
          © {new Date().getFullYear()} Smart Rentals
        </p>
      </aside>

      <main className="auth-main">
        <div className="auth-card">
          <h1>Sign in</h1>
          <p>Welcome back. Enter your credentials to continue.</p>
          <form onSubmit={submit}>
            <Field label="Email address" required>
              <Input
                type="email"
                placeholder="you@example.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </Field>
            <Field label="Password" required>
              <Input
                type="password"
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
              />
            </Field>
            {error ? <div className="notice notice-danger mb-16">{error}</div> : null}
            <Button type="submit" loading={loading} className="btn-block" size="lg">
              Sign in
            </Button>
          </form>
          <p className="auth-switch">
            Don&apos;t have an account? <Link to="/register">Create one</Link>
          </p>

          {import.meta.env.DEV ? (
            <div className="demo-box">
              <strong>Demo accounts</strong> (click to fill)
              {DEMO.map((d) => (
                <div className="demo-row" key={d.email}>
                  <span>{d.role}</span>
                  <button type="button" onClick={() => setForm({ email: d.email, password: d.password })}>
                    {d.email}
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
