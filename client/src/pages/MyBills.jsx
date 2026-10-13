import { useEffect, useState } from 'react';
import { Receipt, RefreshCw, Smartphone } from 'lucide-react';
import { api } from '../lib/api.js';
import { kes, monthLabel, date } from '../lib/format.js';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Card, Spinner, EmptyState, Badge, StatusBadge, StatCard } from '../components/ui.jsx';
import PayBillModal from '../components/PayBillModal.jsx';

export default function MyBills() {
  const toast = useToast();
  const [bills, setBills] = useState([]);
  const [stats, setStats] = useState({ unpaid: 0, paid: 0, payable: 0 });
  const [loading, setLoading] = useState(true);
  const [payBill, setPayBill] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/utility-bills');
      setBills(data.bills || []);
      setStats(data.stats || { unpaid: 0, paid: 0, payable: 0 });
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

  if (loading && bills.length === 0) return <Spinner label="Loading your bills…" />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My Bills</h1>
          <p>Water, electricity and other utility bills issued for your unit.</p>
        </div>
        <div className="page-actions">
          <Button variant="secondary" onClick={load}><RefreshCw size={16} /> Refresh</Button>
        </div>
      </div>

      <div className="grid grid-3 mb-16">
        <StatCard label="Outstanding" value={kes(stats.unpaid)} icon={Receipt} tone="red" />
        <StatCard label="Open bills" value={String(stats.payable)} icon={Receipt} />
        <StatCard label="Paid to date" value={kes(stats.paid)} icon={Receipt} tone="green" />
      </div>

      <Card className="mt-16" padded={false}>
        {bills.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No utility bills"
            message="You have no utility bills on record. New bills will appear here."
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Period</th><th>Property</th><th>Unit</th><th>Category</th><th className="text-right">Amount</th><th>Status</th><th>Paid on</th><th></th></tr>
              </thead>
              <tbody>
                {bills.map((b) => (
                  <tr key={b.id}>
                    <td className="cell-muted">{monthLabel(b.period)}</td>
                    <td className="cell-strong">{b.property_name}</td>
                    <td>{b.unit_number}</td>
                    <td><Badge tone="gray">{b.category}</Badge></td>
                    <td className="text-right cell-strong">{kes(b.amount)}</td>
                    <td><StatusBadge status={b.status} label={b.status === 'paid' ? 'Paid' : 'Unpaid'} /></td>
                    <td className="cell-muted">{b.status === 'paid' ? date(b.paid_at) : '—'}</td>
                    <td className="row-actions">
                      {b.status === 'unpaid' ? (
                        <Button size="sm" onClick={() => setPayBill(b)}><Smartphone size={14} /> Pay</Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="cell-muted mt-16">
        Pay any unpaid bill directly with M-Pesa using the Pay button. You can also settle with your landlord or caretaker (cash or bank), who will mark it as paid.
      </p>

      <PayBillModal bill={payBill} onClose={() => setPayBill(null)} onPaid={load} />
    </>
  );
}