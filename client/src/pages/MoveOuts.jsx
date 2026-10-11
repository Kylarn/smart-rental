import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, DoorOpen, Plus, CheckCircle2, Trash2, LogOut } from 'lucide-react';
import { api } from '../lib/api.js';
import { kes, date, today } from '../lib/format.js';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Card, Field, Input, Select, Modal, Spinner, EmptyState, StatusBadge, Tabs } from '../components/ui.jsx';

export default function MoveOuts() {
  const toast = useToast();
  const [tab, setTab] = useState('active');
  const [leases, setLeases] = useState([]);
  const [moveOuts, setMoveOuts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [initiating, setInitiating] = useState(null);
  const [completing, setCompleting] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [leaseData, moveData] = await Promise.all([
        api.get('/api/leases?status=active'),
        api.get('/api/leases/move-outs'),
      ]);
      setLeases(leaseData.leases || []);
      setMoveOuts(moveData.move_outs || []);
    } catch (err) {
      toast.error(err.message);
      setLeases([]);
      setMoveOuts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pending = moveOuts.filter((m) => m.status === 'initiated');
  const completed = moveOuts.filter((m) => m.status === 'completed');

  if (loading) return <Spinner label="Loading move-out workflow…" />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Move-Outs</h1>
          <p>Record tenant departures, inspects and settle outstanding balances.</p>
        </div>
        <div className="page-actions">
          <Button onClick={load} variant="secondary">Refresh</Button>
        </div>
      </div>

      <div className="grid grid-4 mb-16">
        <div className="stat"><div className="stat-main"><span className="stat-label">Active leases</span><span className="stat-value">{leases.length}</span></div><span className="stat-icon"><DoorOpen size={20} /></span></div>
        <div className="stat stat-amber"><div className="stat-main"><span className="stat-label">Initiated</span><span className="stat-value">{pending.length}</span></div><span className="stat-icon"><LogOut size={20} /></span></div>
        <div className="stat stat-green"><div className="stat-main"><span className="stat-label">Completed</span><span className="stat-value">{completed.length}</span></div><span className="stat-icon"><CheckCircle2 size={20} /></span></div>
        <div className="stat"><div className="stat-main"><span className="stat-label">Total records</span><span className="stat-value">{moveOuts.length}</span></div><span className="stat-icon"><ClipboardList size={20} /></span></div>
      </div>

      <Tabs
        tabs={[
          { value: 'active', label: 'Active leases', count: leases.length },
          { value: 'moveouts', label: 'Move-out records', count: moveOuts.length },
        ]}
        value={tab}
        onChange={setTab}
      />

      <Card className="mt-16" padded={false}>
        {tab === 'active' ? (
          leases.length === 0 ? (
            <EmptyState icon={DoorOpen} title="No active leases" message="Move-outs can only be initiated on leases that are currently active." />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Tenant</th><th>Property</th><th>Unit</th><th>Rent</th><th>End date</th><th></th></tr></thead>
                <tbody>
                  {leases.map((l) => (
                    <tr key={l.id}>
                      <td className="cell-strong">
                        <Link className="link" to={`/app/tenants/${l.tenant_id}`}>{l.tenant_name}</Link>
                      </td>
                      <td className="cell-muted">{l.property_name}</td>
                      <td>{l.unit_number}</td>
                      <td className="cell-strong">{kes(l.rent)}</td>
                      <td className="cell-muted">{date(l.end_date)}</td>
                      <td className="row-actions">
                        <Button size="sm" onClick={() => setInitiating(l)}><LogOut size={14} /> Record move-out</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : moveOuts.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No move-out records" message="Record a move-out from the Active leases tab to get started." />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Tenant</th><th>Property</th><th>Unit</th><th>Date</th><th>Arrears</th><th>Damages</th><th>Deposit</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {moveOuts.map((m) => (
                  <tr key={m.id}>
                    <td className="cell-strong">
                      <Link className="link" to={`/app/tenants/${m.tenant_id}`}>{m.tenant_name}</Link>
                    </td>
                    <td className="cell-muted">{m.property_name}</td>
                    <td>{m.unit_number}</td>
                    <td className="cell-muted">{date(m.move_out_date)}</td>
                    <td className="cell-strong">{kes(m.outstanding_rent)}</td>
                    <td>{kes(m.damages_cost)}</td>
                    <td className="cell-muted">{kes(m.deposit_held)}{m.refund_status !== 'pending' ? ` · ${m.refund_status}` : ''}</td>
                    <td><StatusBadge status={m.status} /></td>
                    <td className="row-actions">
                      {m.status === 'initiated' ? (
                        <Button size="sm" variant="success" onClick={() => setCompleting(m)}><CheckCircle2 size={14} /> Complete</Button>
                      ) : (
                        <span className="faint small">{m.completed_at ? date(m.completed_at) : ''}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <InitiateModal lease={initiating} onClose={() => setInitiating(null)} onSaved={() => { setInitiating(null); toast.success('Move-out recorded'); load(); }} />
      <CompleteModal moveOut={completing} onClose={() => setCompleting(null)} onSaved={() => { setCompleting(null); toast.success('Move-out completed'); load(); }} />
    </>
  );
}

function InitiateModal({ lease, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({
    move_out_date: today(),
    reason: '',
    deposit_held: '',
    deposit_refund: '',
    keys_returned: true,
    damages: [{ description: '', cost: '' }],
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (lease) {
      setForm({
        move_out_date: today(),
        reason: '',
        deposit_held: lease.deposit ?? '',
        deposit_refund: '',
        keys_returned: true,
        damages: [{ description: '', cost: '' }],
      });
    }
  }, [lease]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setDamage = (i, k, v) => {
    const damages = [...form.damages];
    damages[i][k] = v;
    setForm({ ...form, damages });
  };

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post(`/api/leases/${lease.id}/move-out`, {
        ...form,
        deposit_held: form.deposit_held === '' ? undefined : Number(form.deposit_held),
        deposit_refund: form.deposit_refund === '' ? undefined : Number(form.deposit_refund),
        damages: form.damages.filter((d) => d.description || d.cost),
      });
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={!!lease} onClose={onClose} title={`Record move-out — ${lease?.tenant_name}`} size="lg">
      {lease ? (
        <form onSubmit={submit}>
          <div className="kv"><span>Unit</span><span>{lease.unit_number} · {lease.property_name}</span></div>
          <div className="kv"><span>Rent</span><span>{kes(lease.rent)} / month</span></div>
          <div className="form-row">
            <Field label="Move-out date" required><Input type="date" value={form.move_out_date} onChange={set('move_out_date')} required /></Field>
            <Field label="Reason"><Input value={form.reason} onChange={set('reason')} placeholder="e.g. Relocation" /></Field>
          </div>
          <div className="form-row">
            <Field label="Deposit held (KES)"><Input type="number" min={0} value={form.deposit_held} onChange={set('deposit_held')} /></Field>
            <Field label="Deposit to refund (KES)"><Input type="number" min={0} value={form.deposit_refund} onChange={set('deposit_refund')} /></Field>
          </div>

          <div className="divider" />
          <h4 className="mb-8 small muted">Damages & inspection</h4>
          {form.damages.map((d, i) => (
            <div className="form-row" key={i}>
              <Field label={i === 0 ? 'Damage description' : ''}>
                <Input value={d.description} onChange={(ev) => setDamage(i, 'description', ev.target.value)} placeholder="e.g. Cracked bathroom tile" />
              </Field>
              <Field label={i === 0 ? 'Cost (KES)' : ''}>
                <Input type="number" min={0} value={d.cost} onChange={(ev) => setDamage(i, 'cost', ev.target.value)} placeholder="0" />
              </Field>
              {form.damages.length > 1 ? (
                <button type="button" className="icon-btn" onClick={() => setForm({ ...form, damages: form.damages.filter((_, j) => j !== i) })} aria-label="Remove damage">
                  <Trash2 size={16} />
                </button>
              ) : <span className="icon-btn" style={{ visibility: 'hidden' }}><Trash2 size={16} /></span>}
            </div>
          ))}
          <Button size="sm" variant="secondary" type="button" onClick={() => setForm({ ...form, damages: [...form.damages, { description: '', cost: '' }] })}>
            <Plus size={14} /> Add damage
          </Button>

          <div className="checkbox-row mt-16">
            <input type="checkbox" id="mo-keys" checked={form.keys_returned} onChange={(e) => setForm({ ...form, keys_returned: e.target.checked })} />
            <label htmlFor="mo-keys">Keys returned</label>
          </div>

          <div className="modal-foot" style={{ padding: 0, border: 'none', marginTop: 8 }}>
            <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={loading}>Record move-out</Button>
          </div>
        </form>
      ) : null}
    </Modal>
  );
}

function CompleteModal({ moveOut, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({
    deposit_refund: '',
    refund_status: 'pending',
    meter_water: '',
    meter_electricity: '',
    keys_returned: true,
    keys_notes: '',
    notes: '',
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (moveOut) setForm({ deposit_refund: '', refund_status: moveOut.refund_status || 'pending', meter_water: '', meter_electricity: '', keys_returned: true, keys_notes: '', notes: '' });
  }, [moveOut]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post(`/api/leases/${moveOut.lease_id}/move-out/complete`, {
        ...form,
        deposit_refund: form.deposit_refund === '' ? undefined : Number(form.deposit_refund),
      });
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={!!moveOut} onClose={onClose} title={`Complete move-out — ${moveOut?.tenant_name}`} size="md">
      {moveOut ? (
        <>
          <div className="kv"><span>Unit</span><span>{moveOut.unit_number} · {moveOut.property_name}</span></div>
          <div className="kv"><span>Outstanding rent (recorded)</span><span className="cell-strong">{kes(moveOut.outstanding_rent)}</span></div>
          <div className="kv"><span>Damages cost</span><span className="cell-strong">{kes(moveOut.damages_cost)}</span></div>
          <div className="kv"><span>Deposit held</span><span>{kes(moveOut.deposit_held)}</span></div>
          <div className="notice mt-16">Completing this move-out will terminate the lease and mark the unit vacant. The tenant&apos;s account and payment history are preserved.</div>
          <form onSubmit={submit}>
            <div className="form-row">
              <Field label="Deposit refund (KES)"><Input type="number" min={0} value={form.deposit_refund} onChange={set('deposit_refund')} /></Field>
              <Field label="Refund status">
                <Select value={form.refund_status} onChange={set('refund_status')}>
                  <option value="pending">Pending</option>
                  <option value="refunded">Refunded</option>
                  <option value="partial">Partial</option>
                  <option value="forfeited">Forfeited</option>
                  <option value="not_applicable">N/A</option>
                </Select>
              </Field>
            </div>
            <div className="form-row">
              <Field label="Meter reading (water)"><Input value={form.meter_water} onChange={set('meter_water')} /></Field>
              <Field label="Meter reading (electricity)"><Input value={form.meter_electricity} onChange={set('meter_electricity')} /></Field>
            </div>
            <div className="checkbox-row">
              <input type="checkbox" id="co-keys" checked={form.keys_returned} onChange={(e) => setForm({ ...form, keys_returned: e.target.checked })} />
              <label htmlFor="co-keys">Keys returned</label>
            </div>
            <Field label="Notes"><Input value={form.notes} onChange={set('notes')} placeholder="Final settlement notes" /></Field>
            <div className="modal-foot" style={{ padding: 0, border: 'none', marginTop: 8 }}>
              <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
              <Button type="submit" loading={loading}>Complete move-out</Button>
            </div>
          </form>
        </>
      ) : null}
    </Modal>
  );
}