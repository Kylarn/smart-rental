import { useEffect, useState } from 'react';
import { Settings as SettingsIcon, Save } from 'lucide-react';
import { api } from '../lib/api.js';
import { titleCase } from '../lib/format.js';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Card, Field, Input, Select, Spinner } from '../components/ui.jsx';
import { BarsChart, DonutChart } from '../components/Charts.jsx';

export default function AdminSettings() {
  const toast = useToast();
  const [settings, setSettings] = useState(null);
  const [stats, setStats] = useState(null);
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get('/api/admin/settings').then((d) => setSettings(d.settings)),
      api.get('/api/admin/stats').then(setStats).catch(() => {}),
      api.get('/api/sms/providers').then((d) => setProviders(d.providers || [])).catch(() => {}),
    ])
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const set = (k) => (e) => setSettings({ ...settings, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put('/api/admin/settings', settings);
      toast.success('Settings saved');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner label="Loading settings…" />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Platform settings</h1>
          <p>Configure branding, support contacts and payment behaviour.</p>
        </div>
      </div>

      <div className="grid grid-2">
        <Card title="General">
          <form onSubmit={save}>
            <Field label="Platform name"><Input value={settings?.platform_name || ''} onChange={set('platform_name')} /></Field>
            <div className="form-row">
              <Field label="Support email"><Input type="email" value={settings?.support_email || ''} onChange={set('support_email')} /></Field>
              <Field label="Support phone"><Input value={settings?.support_phone || ''} onChange={set('support_phone')} /></Field>
            </div>
            <div className="form-row">
              <Field label="Currency"><Input value={settings?.currency || ''} onChange={set('currency')} /></Field>
              <Field label="M-Pesa mode">
                <Select value={settings?.mpesa_mode || 'sandbox'} onChange={set('mpesa_mode')}>
                  <option value="sandbox">Sandbox</option>
                  <option value="production">Production</option>
                </Select>
              </Field>
            </div>
            <div className="form-row">
              <Field label="Registration enabled">
                <Select value={settings?.registration_enabled || 'true'} onChange={set('registration_enabled')}>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </Select>
              </Field>
              <Field label="Rent reminder days"><Input type="number" value={settings?.rent_reminder_days || ''} onChange={set('rent_reminder_days')} /></Field>
            </div>
            <Field label="Lease expiry alert (days)"><Input type="number" value={settings?.lease_expiry_days || ''} onChange={set('lease_expiry_days')} /></Field>
            <div className="divider" />
            <h4 className="mb-8">SMS notifications</h4>
            <div className="form-row">
              <Field label="SMS enabled" hint="Turns automated texts on or off platform-wide">
                <Select value={settings?.sms_enabled || 'true'} onChange={set('sms_enabled')}>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </Select>
              </Field>
              <Field label="Provider" hint="Active SMS gateway">
                <Select value={settings?.sms_provider || ''} onChange={set('sms_provider')}>
                  <option value="">Use environment default</option>
                  {providers.map((p) => <option key={p.name} value={p.name}>{p.label}{p.ready ? '' : ' (not configured)'}</option>)}
                </Select>
              </Field>
            </div>
            <Button type="submit" loading={saving}><Save size={15} /> Save settings</Button>
          </form>
        </Card>

        <div className="flex-col">
          <Card title="Users by role">
            {stats?.roleSplit?.length ? (
              <DonutChart data={stats.roleSplit.map((r) => ({ name: titleCase(r.role), value: Number(r.c) }))} />
            ) : <p className="muted small">No data</p>}
          </Card>
          <Card title="Signups (monthly)">
            {stats?.monthlySignups?.length ? (
              <BarsChart data={stats.monthlySignups.map((m) => ({ label: m.ym, signups: Number(m.signups) }))} xKey="label" dataKey="signups" formatter={(v) => v} />
            ) : <p className="muted small">No data</p>}
          </Card>
        </div>
      </div>

      <Card title="Property types" className="mt-16">
        {stats?.propertyTypes?.length ? (
          <DonutChart data={stats.propertyTypes.map((p) => ({ name: p.property_type, value: Number(p.c) }))} />
        ) : <p className="muted small">No data</p>}
      </Card>
    </>
  );
}
