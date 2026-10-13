import { useEffect, useRef, useState } from 'react';
import { Smartphone } from 'lucide-react';
import { api } from '../lib/api.js';
import { kes, monthLabel } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Field, Input, Modal, Spinner } from './ui.jsx';

export default function PayBillModal({ bill, onClose, onPaid }) {
  const { user } = useAuth();
  const toast = useToast();
  const [phone, setPhone] = useState(user?.phone || '');
  const [phase, setPhase] = useState('form');
  const [info, setInfo] = useState(null);
  const poll = useRef(null);

  useEffect(() => {
    if (bill) {
      setPhase('form');
      setInfo(null);
      setPhone(user?.phone || '');
    }
    return () => clearInterval(poll.current);
  }, [bill, user]);

  if (!bill) return null;

  const submit = async (e) => {
    e.preventDefault();
    setPhase('sending');
    try {
      const d = await api.post(`/api/utility-bills/${bill.id}/pay-mpesa`, { phone });
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
              toast.success('Bill payment received. Asante!');
              onPaid?.();
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
    <Modal open={!!bill} onClose={onClose} title="Pay bill via M-Pesa" size="md">
      {phase === 'form' ? (
        <form onSubmit={submit}>
          <p className="muted small">
            {monthLabel(bill.period)} {bill.category} bill — an STK push will be sent to your phone. Enter your M-Pesa PIN to complete payment.
          </p>
          <Field label="M-Pesa phone" required>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712345678" required />
          </Field>
          <div className="notice notice-info">Amount: <strong>{kes(bill.amount)}</strong></div>
          <div className="modal-foot" style={{ padding: 0, border: 'none', marginTop: 8 }}>
            <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit"><Smartphone size={16} /> Send STK push</Button>
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
          {phase === 'done' ? <div className="notice notice-success">Bill paid successfully.</div> : null}
          {phase === 'failed' ? <div className="notice notice-danger">Payment failed. Please try again.</div> : null}
          {phase === 'timeout' ? <div className="notice notice-warn">Still processing. Check My Bills later for the updated status.</div> : null}
          {phase !== 'waiting' && phase !== 'sending' ? (
            <Button className="mt-16" onClick={onClose}>Close</Button>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
