import { useEffect, useState } from 'react';
import { Receipt, Plus, RefreshCw, Pencil, Trash2, HandCoins } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { kes, monthLabel } from '../lib/format.js';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Card, Field, Input, Select, Modal, Spinner, EmptyState, Badge, StatusBadge, StatCard } from '../components/ui.jsx';

const CATEGORIES = ['Water', 'Electricity', 'Garbage', 'Internet', 'Other'];
const PAY_METHODS = ['cash', 'mpesa', 'bank', 'other'];

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function UtilityBills() {
  const toast = useToast();
  const [bills, setBills] = useState([]);
  const [stats, setStats] = useState({ unpaid: 0, paid: 0, payable: 0 });
  const [properties, setProperties] = useState([]);
  const [filter, setFilter] = useState({ property_id: '', status: '' });
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [paying, setPaying] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [list, props] = await Promise.all([
        api.get(`/api/utility-bills${qs(filter)}`),
        api.get('/api/properties'),
      ]);
      setBills(list.bills || []);
      setStats(list.stats || { unpaid: 0, paid: 0, payable: 0 });
      setProperties(props.properties || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = async (bill) => {
    if (!window.confirm(`Delete the ${bill.category} bill for ${monthLabel(bill.period)} (${kes(bill.amount)})?`)) return;
    try {
      await api.del(`/api/utility-bills/${bill.id}`);
      toast.success('Bill deleted');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading && bills.length === 0) return <Spinner label="Loading bills…" />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Utility Bills</h1>
          <p>Issue water, electricity and other bills to tenants per unit and month.</p>
        </div>
        <div className="page-actions">
          <Button variant="secondary" onClick={load}><RefreshCw size={16} /> Refresh</Button>
          <Button onClick={() => setCreating(true)}><Plus size={16} /> New bill</Button>
        </div>
      </div>

      <div className="grid grid-4 mb-16">
        <StatCard label="Unpaid" value={kes(stats.unpaid)} icon={Receipt} tone="red" />
        <StatCard label="Open bills" value={String(stats.payable)} icon={Receipt} />
        <StatCard label="Collected" value={kes(stats.paid)} icon={Receipt} tone="green" />
        <StatCard label="Total billed" value={kes((stats.unpaid || 0) + (stats.paid || 0))} icon={Receipt} />
      </div>

      <Card className="mt-16" padded={false}>
        <div className="card-toolbar">
          <Select value={filter.property_id} onChange={(e) => setFilter({ ...filter, property_id: e.target.value })} className="toolbar-select">
            <option value="">All properties</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
          <Select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })} className="toolbar-select">
            <option value="">All statuses</option>
            <option value="unpaid">Unpaid</option>
            <option value="paid">Paid</option>
          </Select>
          <Button size="sm" variant="secondary" onClick={load}>Apply</Button>
        </div>

        {bills.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No utility bills yet"
            message="Issue a bill to a tenant's occupied unit to start tracking utility recovery."
            action={<Button onClick={() => setCreating(true)}><Plus size={16} /> New bill</Button>}
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Period</th><th>Property</th><th>Unit</th><th>Tenant</th><th>Category</th><th className="num">Amount</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {bills.map((b) => (
                  <tr key={b.id}>
                    <td className="cell-muted">{monthLabel(b.period)}</td>
                    <td className="cell-strong">{b.property_name}</td>
                    <td>{b.unit_number}</td>
                    <td>{b.tenant_name}</td>
                    <td><Badge tone="gray">{b.category}</Badge></td>
                    <td className="num cell-strong">{kes(b.amount)}</td>
                    <td><StatusBadge status={b.status} label={b.status === 'paid' ? 'Paid' : 'Unpaid'} /></td>
                    <td className="row-actions">
                      {b.status === 'unpaid' ? (
                        <>
                          <button className="icon-btn" onClick={() => setPaying(b)} aria-label="Record payment" title="Record payment"><HandCoins size={16} /></button>
                          <button className="icon-btn" onClick={() => setEditing(b)} aria-label="Edit bill"><Pencil size={16} /></button>
                          <button className="icon-btn danger" onClick={() => remove(b)} aria-label="Delete bill"><Trash2 size={16} /></button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <BillModal
        open={creating || !!editing}
        bill={editing}
        properties={properties}
        categories={CATEGORIES}
        defaultPeriod={currentMonth()}
        onClose={() => { setCreating(false); setEditing(null); }}
        onSaved={() => { toast.success(editing ? 'Bill updated' : 'Bill issued'); setCreating(false); setEditing(null); load(); }}
      />
      <PayModal bill={paying} onClose={() => setPaying(null)} onPaid={() => { toast.success('Payment recorded'); setPaying(null); load(); }} />
    </>
  );
}

function BillModal({ open, bill, properties, categories, defaultPeriod, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ property_id: '', unit_id: '', category: 'Water', period: defaultPeriod, amount: '', notes: '' });
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      property_id: bill?.property_id || properties[0]?.id || '',
      unit_id: bill?.unit_id || '',
      category: bill?.category || 'Water',
      period: bill?.period || defaultPeriod,
      amount: bill ? String(bill.amount) : '',
      notes: bill?.notes || '',
    });
    setUnits([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bill]);

  useEffect(() => {
    let active = true;
    if (!form.property_id) { setUnits([]); return undefined; }
    api.get(`/api/units?property_id=${form.property_id}`)
      .then((d) => active && setUnits(d.units || []))
      .catch(() => active && setUnits([]));
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.property_id, open]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    const payload = {
      ...form,
      property_id: Number(form.property_id),
      unit_id: Number(form.unit_id),
      amount: Number(form.amount),
    };
    try {
      if (bill) await api.patch(`/api/utility-bills/${bill.id}`, payload);
      else await api.post('/api/utility-bills', payload);
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={bill ? 'Edit bill' : 'Issue a utility bill'} size="lg">
      <form onSubmit={submit}>
        <div className="form-row">
          <Field label="Property" required>
            <Select value={form.property_id} onChange={set('property_id')} required>
              <option value="">Select property</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Unit" required>
            <Select value={form.unit_id} onChange={set('unit_id')} required>
              <option value="">Select occupied unit</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>{u.unit_number}{u.tenant ? ` — ${u.tenant.full_name}` : ''}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="form-row">
          <Field label="Category" required>
            <Select value={form.category} onChange={set('category')} required>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Period (month)" required>
            <Input type="month" value={form.period} onChange={set('period')} required />
          </Field>
        </div>
        <div className="form-row">
          <Field label="Amount (KES)" required>
            <Input type="number" min={1} step="any" value={form.amount} onChange={set('amount')} placeholder="0" required />
          </Field>
          <Field label="Notes">
            <Input value={form.notes} onChange={set('notes')} placeholder="e.g. units consumed, reading (optional)" />
          </Field>
        </div>
        <div className="modal-foot" style={{ padding: 0, border: 'none', marginTop: 8 }}>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>{bill ? 'Save changes' : 'Issue bill'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function PayModal({ bill, onClose, onPaid }) {
  const toast = useToast();
  const [form, setForm] = useState({ method: 'mpesa', reference: '' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (bill) setForm({ method: 'cash', reference: '' });
  }, [bill]);

  if (!bill) return null;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post(`/api/utility-bills/${bill.id}/pay`, form);
      onPaid();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Record bill payment">
      <p>
        {bill.category} bill — {monthLabel(bill.period)} · Unit {bill.unit_number} · <strong>{kes(bill.amount)}</strong> · {bill.tenant_name}
      </p>
      <form onSubmit={submit}>
        <div className="form-row">
          <Field label="Payment method" required>
            <Select value={form.method} onChange={set('method')} required>
              {PAY_METHODS.map((m) => (
                <option key={m} value={m}>{m === 'mpesa' ? 'M-Pesa' : m[0].toUpperCase() + m.slice(1)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Reference">
            <Input value={form.reference} onChange={set('reference')} placeholder="Receipt / transaction no. (optional)" />
          </Field>
        </div>
        <div className="modal-foot" style={{ padding: 0, border: 'none', marginTop: 8 }}>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>Mark as paid</Button>
        </div>
      </form>
    </Modal>
  );
}