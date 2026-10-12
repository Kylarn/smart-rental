import { useEffect, useRef, useState } from 'react';
import { Wallet, Plus, Smartphone, Search, Receipt } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { kes, date, titleCase, monthLabel } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Card, Field, Input, Select, Modal, Spinner, EmptyState, StatusBadge, Tabs } from '../components/ui.jsx';

export default function Payments() {
  const { user } = useAuth();
  const toast = useToast();
  const isManager = user?.role === 'landlord' || user?.role === 'admin';
  const [payments, setPayments] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('');
  const [search, setSearch] = useState('');
  const [showPay, setShowPay] = useState(false);
  const [showRecord, setShowRecord] = useState(false);
  const [receipt, setReceipt] = useState(null);

  const load = () => {
    setLoading(true);
    api
      .get(`/api/payments${qs({ status: tab, search })}`)
      .then((d) => {
        setPayments(d.payments || []);
        setStats(d.stats);
      })
      .catch(() => setPayments([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, search]);

  const viewReceipt = async (p) => {
    try {
      const d = await api.get(`/api/payments/${p.id}/receipt`);
      setReceipt(d.receipt);
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{isManager ? 'Payments' : 'Rent & Payments'}</h1>
          <p>{isManager ? 'Track rent collection across your portfolio.' : 'Pay your rent and review your history.'}</p>
        </div>
        <div className="page-actions">
          {user?.role === 'tenant' ? <Button onClick={() => setShowPay(true)}><Smartphone size={16} /> Pay rent</Button> : null}
          {isManager ? <Button onClick={() => setShowRecord(true)}><Plus size={16} /> Record payment</Button> : null}
        </div>
      </div>

      {stats ? (
        <div className="grid grid-4 mb-16">
          {user?.role === 'tenant' ? (
            <>
              <div className="stat stat-blue"><div className="stat-main"><span className="stat-label">Monthly rent</span><span className="stat-value">{kes(stats.lease_rent)}</span></div></div>
              <div className={`stat ${stats.arrears > 0 ? 'stat-red' : 'stat-green'}`}><div className="stat-main"><span className="stat-label">Arrears</span><span className="stat-value">{kes(stats.arrears)}</span></div></div>
              <div className="stat stat-green"><div className="stat-main"><span className="stat-label">Total paid</span><span className="stat-value">{kes(stats.total_paid)}</span></div></div>
            </>
          ) : (
            <>
              <div className="stat stat-green"><div className="stat-main"><span className="stat-label">Collected</span><span className="stat-value">{kes(stats.amount)}</span></div></div>
              <div className="stat stat-blue"><div className="stat-main"><span className="stat-label">Transactions</span><span className="stat-value">{stats.total}</span></div></div>
              <div className="stat stat-amber"><div className="stat-main"><span className="stat-label">Pending</span><span className="stat-value">{stats.pending}</span></div></div>
              <div className="stat stat-red"><div className="stat-main"><span className="stat-label">Failed</span><span className="stat-value">{stats.failed}</span></div></div>
            </>
          )}
        </div>
      ) : null}

      <div className="flex-between mb-16 wrap">
        <Tabs
          tabs={[
            { value: '', label: 'All' },
            { value: 'completed', label: 'Completed' },
            { value: 'processing', label: 'Processing' },
            { value: 'pending', label: 'Pending' },
            { value: 'failed', label: 'Failed' },
          ]}
          value={tab}
          onChange={setTab}
        />
        {isManager ? <Input placeholder="Search tenant, receipt, unit…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 280 }} /> : null}
      </div>

      {loading ? (
        <Spinner />
      ) : payments.length === 0 ? (
        <EmptyState icon={Wallet} title="No payments" message={isManager ? 'Payments will appear here once recorded.' : 'Pay your first month of rent to get started.'} />
      ) : (
        <Card padded={false}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  {isManager ? <th>Tenant</th> : null}
                  <th>Property / Unit</th><th>Period</th><th>Method</th><th className="text-right">Amount</th><th>Status</th><th>Date</th><th></th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    {isManager ? <td className="cell-strong">{p.tenant_name}</td> : null}
                    <td>{p.property_name || '—'}<div className="cell-muted">Unit {p.unit_number || '—'}</div></td>
                    <td>{monthLabel(p.period) || p.period || '—'}</td>
                    <td className="cell-muted">{titleCase(p.method)}</td>
                    <td className="text-right cell-strong">{kes(p.amount)}</td>
                    <td>
                      <StatusBadge status={p.status} />
                      {p.status === 'failed' && p.failure_reason ? <div className="small" style={{ color: 'var(--red)' }}>{p.failure_reason}</div> : null}
                    </td>
                    <td className="cell-muted">{date(p.paid_at || p.created_at)}</td>
                    <td className="row-actions">
                      {p.status === 'completed' ? <Button size="sm" variant="ghost" onClick={() => viewReceipt(p)}><Receipt size={15} /></Button> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <PayRentModal open={showPay} onClose={() => setShowPay(false)} stats={stats} onDone={() => { load(); }} />
      <RecordPaymentModal open={showRecord} onClose={() => setShowRecord(false)} onSaved={() => { setShowRecord(false); load(); }} />
      <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />
    </>
  );
}

function PayRentModal({ open, onClose, stats, onDone }) {
  const { user } = useAuth();
  const toast = useToast();
  const [months, setMonths] = useState(1);
  const [phone, setPhone] = useState(user?.phone || '');
  const [phase, setPhase] = useState('form');
  const [info, setInfo] = useState(null);
  const poll = useRef(null);

  useEffect(() => {
    if (open) {
      setMonths(1);
      setPhase('form');
      setInfo(null);
    }
    return () => clearInterval(poll.current);
  }, [open]);

  const amount = (stats?.lease_rent || 0) * months;

  const submit = async (e) => {
    e.preventDefault();
    setPhase('sending');
    try {
      const d = await api.post('/api/payments/initiate', { phone, months_covered: months, amount });
      setInfo(d);
      setPhase('waiting');
      let tries = 0;
      poll.current = setInterval(async () => {
        tries += 1;
        try {
          const s = await api.get(`/api/payments/${d.payment_id}/status`);
          if (['completed', 'failed'].includes(s.status)) {
            clearInterval(poll.current);
            setPhase(s.status === 'completed' ? 'done' : 'failed');
            if (s.status === 'completed') {
              toast.success('Payment received. Asante!');
              onDone();
            } else {
              toast.error(s.failure_reason || 'Payment failed');
            }
          }
        } catch {
          /* keep polling */
        }
        if (tries > 20) {
          clearInterval(poll.current);
          setPhase('timeout');
        }
      }, 3000);
    } catch (err) {
      toast.error(err.message);
      setPhase('form');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Pay rent via M-Pesa" size="md">
      {phase === 'form' ? (
        <form onSubmit={submit}>
          <p className="muted small">An STK push will be sent to your phone. Enter your M-Pesa PIN to complete payment.</p>
          <Field label="M-Pesa phone" required><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712345678" required /></Field>
          <Field label="Months to pay" required>
            <Select value={months} onChange={(e) => setMonths(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6].map((m) => <option key={m} value={m}>{m} month{m > 1 ? 's' : ''}</option>)}
            </Select>
          </Field>
          <div className="notice notice-info">Amount: <strong>{kes(amount)}</strong></div>
          <div className="modal-foot" style={{ padding: 0, border: 'none', marginTop: 8 }}>
            <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit">Send STK push</Button>
          </div>
        </form>
      ) : (
        <div className="center" style={{ padding: '20px 0' }}>
          {phase === 'sending' ? <Spinner label="Sending request to M-Pesa…" /> : null}
          {phase === 'waiting' ? (
            <>
              <Spinner label="Waiting for you to enter your PIN…" />
              <p className="muted small mt-8">{info?.message}</p>
            </>
          ) : null}
          {phase === 'done' ? <div className="notice notice-success">Payment completed successfully.</div> : null}
          {phase === 'failed' ? <div className="notice notice-danger">Payment failed. Please try again.</div> : null}
          {phase === 'timeout' ? <div className="notice notice-warn">Still processing. Check this page later for the updated status.</div> : null}
          {phase !== 'waiting' && phase !== 'sending' ? (
            <Button className="mt-16" onClick={onClose}>Close</Button>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

function RecordPaymentModal({ open, onClose, onSaved }) {
  const toast = useToast();
  const [tenants, setTenants] = useState([]);
  const [form, setForm] = useState({ tenant_id: '', amount: '', method: 'bank', period: '', months_covered: 1, reference: '', phone: '' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) api.get('/api/tenants?status=active').then((d) => setTenants(d.tenants || [])).catch(() => {});
  }, [open]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const d = await api.post('/api/payments/record', { ...form, tenant_id: Number(form.tenant_id), months_covered: Number(form.months_covered) });
      toast.success(`Recorded. Receipt ${d.receipt}`);
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Record payment" size="md">
      <form onSubmit={submit}>
        <Field label="Tenant" required>
          <Select value={form.tenant_id} onChange={set('tenant_id')} required>
            <option value="">Select tenant…</option>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.full_name} — {t.property_name} {t.unit_number}</option>)}
          </Select>
        </Field>
        <div className="form-row">
          <Field label="Amount (KES)" required><Input type="number" min={1} value={form.amount} onChange={set('amount')} required /></Field>
          <Field label="Method" required>
            <Select value={form.method} onChange={set('method')}>
              <option value="cash">Cash</option>
              <option value="bank">Bank</option>
              <option value="mpesa">M-Pesa</option>
              <option value="card">Card</option>
            </Select>
          </Field>
        </div>
        <div className="form-row">
          <Field label="Period" hint="YYYY-MM, blank = oldest due"><Input value={form.period} onChange={set('period')} placeholder="2026-01" /></Field>
          <Field label="Months covered"><Input type="number" min={1} value={form.months_covered} onChange={set('months_covered')} /></Field>
        </div>
        <Field label="Reference"><Input value={form.reference} onChange={set('reference')} placeholder="Bank slip / txn ref" /></Field>
        <div className="modal-foot" style={{ padding: 0, border: 'none', marginTop: 8 }}>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>Record payment</Button>
        </div>
      </form>
    </Modal>
  );
}

function ReceiptModal({ receipt, onClose }) {
  if (!receipt) return null;
  return (
    <Modal open={!!receipt} onClose={onClose} title="Payment receipt" size="md">
      <div className="receipt">
        <div className="receipt-head">
          <strong>Smart Rentals</strong>
          <span>{receipt.receipt_number}</span>
        </div>
        <div className="kv"><span>Tenant</span><span>{receipt.tenant_name}</span></div>
        <div className="kv"><span>Property</span><span>{receipt.property_name} · Unit {receipt.unit_number}</span></div>
        <div className="kv"><span>Period</span><span>{monthLabel(receipt.period) || receipt.period}</span></div>
        <div className="kv"><span>Method</span><span>{titleCase(receipt.method)}</span></div>
        <div className="kv"><span>Paid on</span><span>{date(receipt.paid_at)}</span></div>
        <div className="divider" />
        <div className="kv receipt-total"><span>Amount paid</span><span>{kes(receipt.amount)}</span></div>
        {receipt.landlord ? <p className="muted small mt-8">Landlord: {receipt.landlord.full_name}{receipt.landlord.phone ? ` · ${receipt.landlord.phone}` : ''}</p> : null}
      </div>
      <div className="modal-foot" style={{ padding: 0, border: 'none', marginTop: 12 }}>
        <Button variant="secondary" onClick={onClose}>Close</Button>
        <Button onClick={() => window.print()}>Print</Button>
      </div>
    </Modal>
  );
}
