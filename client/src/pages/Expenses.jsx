import { useEffect, useState } from 'react';
import { ReceiptText, Plus, RefreshCw, Pencil, Trash2 } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { kes, date, today } from '../lib/format.js';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Card, Field, Input, Select, Modal, Spinner, EmptyState, Badge, StatCard } from '../components/ui.jsx';

export default function Expenses() {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({ records: 0, total: 0, month: 0 });
  const [byCategory, setByCategory] = useState([]);
  const [categories, setCategories] = useState([]);
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ property_id: '', category: '' });
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [list, props] = await Promise.all([
        api.get(`/api/expenses${qs(filter)}`),
        api.get('/api/properties'),
      ]);
      setItems(list.expenses || []);
      setStats(list.stats || { records: 0, total: 0, month: 0 });
      setByCategory(list.byCategory || []);
      setCategories(list.categories || []);
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

  const remove = async (expense) => {
    if (!window.confirm(`Delete ${expense.description} (${kes(expense.amount)})? This cannot be undone.`)) return;
    try {
      await api.del(`/api/expenses/${expense.id}`);
      toast.success('Expense deleted');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const onSaved = () => {
    setEditing(null);
    setCreating(false);
    load();
  };

  if (loading && items.length === 0) return <Spinner label="Loading expenses…" />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Expenses</h1>
          <p>Track property running costs, utilities, repairs and overheads.</p>
        </div>
        <div className="page-actions">
          <Button variant="secondary" onClick={load}><RefreshCw size={16} /> Refresh</Button>
          <Button onClick={() => setCreating(true)}><Plus size={16} /> Record expense</Button>
        </div>
      </div>

      <div className="grid grid-4 mb-16">
        <StatCard label="This month" value={kes(stats.month)} icon={ReceiptText} tone="red" />
        <StatCard label="All-time total" value={kes(stats.total)} icon={ReceiptText} />
        <StatCard label="Records" value={String(stats.records)} icon={ReceiptText} />
        <StatCard
          label="Largest category"
          value={byCategory[0] ? byCategory[0].category : '—'}
          hint={byCategory[0] ? kes(byCategory[0].total) : ''}
          icon={ReceiptText}
          tone="amber"
        />
      </div>

      <Card className="mt-16" padded={false}>
        <div className="card-toolbar">
          <Select value={filter.property_id} onChange={(e) => setFilter({ ...filter, property_id: e.target.value })} className="toolbar-select">
            <option value="">All properties</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
          <Select value={filter.category} onChange={(e) => setFilter({ ...filter, category: e.target.value })} className="toolbar-select">
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
          <Button size="sm" variant="secondary" onClick={load}>Apply</Button>
        </div>

        {items.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title="No expenses recorded"
            message="Record your first expense to start tracking property costs."
            action={<Button onClick={() => setCreating(true)}><Plus size={16} /> Record expense</Button>}
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Date</th><th>Property</th><th>Unit</th><th>Category</th><th>Description</th><th>Vendor</th><th className="num">Amount</th><th></th></tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id}>
                    <td className="cell-muted">{date(e.expense_date)}</td>
                    <td className="cell-strong">{e.property_name}</td>
                    <td>{e.unit_number || '—'}</td>
                    <td><Badge tone="gray">{e.category}</Badge></td>
                    <td>{e.description}</td>
                    <td className="cell-muted">{e.vendor || '—'}</td>
                    <td className="num cell-strong">{kes(e.amount)}</td>
                    <td className="row-actions">
                      <button className="icon-btn" onClick={() => setEditing(e)} aria-label="Edit expense"><Pencil size={16} /></button>
                      <button className="icon-btn danger" onClick={() => remove(e)} aria-label="Delete expense"><Trash2 size={16} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ExpenseModal
        open={creating || !!editing}
        expense={editing}
        properties={properties}
        categories={categories}
        onClose={() => { setCreating(false); setEditing(null); }}
        onSaved={() => { toast.success(editing ? 'Expense updated' : 'Expense recorded'); onSaved(); }}
      />
    </>
  );
}

function ExpenseModal({ open, expense, properties, categories, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({
    property_id: '',
    unit_id: '',
    category: 'Other',
    description: '',
    amount: '',
    expense_date: today(),
    vendor: '',
    receipt_url: '',
    notes: '',
  });
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      property_id: expense?.property_id || properties[0]?.id || '',
      unit_id: expense?.unit_id || '',
      category: expense?.category || 'Other',
      description: expense?.description || '',
      amount: expense ? String(expense.amount) : '',
      expense_date: expense?.expense_date || today(),
      vendor: expense?.vendor || '',
      receipt_url: expense?.receipt_url || '',
      notes: expense?.notes || '',
    });
    setUnits([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, expense]);

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
      amount: form.amount === '' ? undefined : Number(form.amount),
      unit_id: form.unit_id === '' ? undefined : Number(form.unit_id),
    };
    try {
      if (expense) await api.patch(`/api/expenses/${expense.id}`, payload);
      else await api.post('/api/expenses', payload);
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={expense ? 'Edit expense' : 'Record expense'} size="lg">
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
          <Field label="Unit (optional)">
            <Select value={form.unit_id} onChange={set('unit_id')}>
              <option value="">Entire property</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>{u.unit_number}</option>
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
          <Field label="Date" required><Input type="date" value={form.expense_date} onChange={set('expense_date')} required /></Field>
        </div>
        <Field label="Description" required><Input value={form.description} onChange={set('description')} placeholder="e.g. Roof water tank replacement" required /></Field>
        <div className="form-row">
          <Field label="Amount (KES)" required><Input type="number" min={1} step="any" value={form.amount} onChange={set('amount')} placeholder="0" required /></Field>
          <Field label="Vendor"><Input value={form.vendor} onChange={set('vendor')} placeholder="e.g. FundiFix Ltd" /></Field>
        </div>
        <Field label="Receipt URL"><Input type="url" value={form.receipt_url} onChange={set('receipt_url')} placeholder="https://… (optional)" /></Field>
        <Field label="Notes"><Input value={form.notes} onChange={set('notes')} placeholder="Additional context (optional)" /></Field>
        <div className="modal-foot" style={{ padding: 0, border: 'none', marginTop: 8 }}>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>{expense ? 'Save changes' : 'Record expense'}</Button>
        </div>
      </form>
    </Modal>
  );
}