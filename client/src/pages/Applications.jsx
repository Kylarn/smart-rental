import { useEffect, useState } from 'react';
import { Inbox, Mail, Phone, CalendarDays, CheckCircle2, XCircle, UserPlus, MessageSquare } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { kes, date, timeAgo } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Card, Field, Input, Select, Modal, Spinner, EmptyState, StatusBadge, Avatar, Tabs } from '../components/ui.jsx';

export default function Applications() {
  const { user } = useAuth();
  const toast = useToast();
  const isManager = user?.role === 'landlord' || user?.role === 'admin';
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');
  const [assigning, setAssigning] = useState(null);
  const [reviewing, setReviewing] = useState(null);

  const load = () => {
    setLoading(true);
    api
      .get(`/api/applications${qs({ status: tab === 'all' ? '' : tab })}`)
      .then((d) => setApps(d.applications || []))
      .catch(() => setApps([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, [tab]);

  const setStatus = async (app, status, extra = {}) => {
    try {
      await api.patch(`/api/applications/${app.id}`, { status, ...extra });
      toast.success(`Application ${status.replace('_', ' ')}`);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Applications</h1>
          <p>{isManager ? 'Review and assign rental applications.' : 'Track the applications you have submitted.'}</p>
        </div>
      </div>

      <Tabs
        tabs={[
          { value: 'all', label: 'All' },
          { value: 'pending', label: 'Pending' },
          { value: 'under_review', label: 'Review' },
          { value: 'approved', label: 'Approved' },
          { value: 'assigned', label: 'Assigned' },
          { value: 'rejected', label: 'Rejected' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {loading ? (
        <Spinner />
      ) : apps.length === 0 ? (
        <EmptyState icon={Inbox} title="No applications" message={isManager ? 'Applications from the marketplace will appear here.' : 'Browse the marketplace and apply to a property.'} />
      ) : (
        <div className="flex-col">
          {apps.map((a) => (
            <Card key={a.id}>
              <div className="flex-between wrap">
                <div className="avatar-row">
                  <Avatar name={a.full_name} size={46} />
                  <div>
                    <strong>{a.full_name}</strong>
                    <div className="cell-muted">{a.property_name}{a.unit_number ? ` · Unit ${a.unit_number}` : ''}</div>
                  </div>
                </div>
                <div className="flex">
                  <StatusBadge status={a.status} />
                  <span className="cell-muted small">{timeAgo(a.created_at)}</span>
                </div>
              </div>
              <div className="divider" />
              <div className="app-grid">
                <span className="flex small"><Mail size={14} /> {a.email}</span>
                <span className="flex small"><Phone size={14} /> {a.phone}</span>
                <span className="flex small"><CalendarDays size={14} /> Move-in: {date(a.move_in_date)}</span>
                <span className="flex small"><UserPlus size={14} /> {a.occupants} occupant(s)</span>
              </div>
              {a.message ? <p className="muted small mt-8"><MessageSquare size={13} /> {a.message}</p> : null}
              {a.reviewer_notes ? <div className="notice notice-info mt-8">Reviewer: {a.reviewer_notes}</div> : null}
              {isManager && !['assigned', 'rejected'].includes(a.status) ? (
                <div className="flex wrap mt-16">
                  {a.status !== 'under_review' ? <Button size="sm" variant="secondary" onClick={() => setStatus(a, 'under_review')}>Mark under review</Button> : null}
                  {a.status !== 'approved' ? <Button size="sm" variant="secondary" onClick={() => setStatus(a, 'approved')}><CheckCircle2 size={14} /> Approve</Button> : null}
                  <Button size="sm" variant="secondary" onClick={() => setReviewing(a)}><MessageSquare size={14} /> Request info</Button>
                  <Button size="sm" variant="danger" onClick={() => setStatus(a, 'rejected')}><XCircle size={14} /> Reject</Button>
                  <Button size="sm" onClick={() => setAssigning(a)}><UserPlus size={14} /> Assign unit</Button>
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}

      <AssignModal app={assigning} onClose={() => setAssigning(null)} onSaved={() => { setAssigning(null); toast.success('Tenant assigned'); load(); }} />
      <ReviewModal app={reviewing} onClose={() => setReviewing(null)} onSaved={() => { setReviewing(null); toast.success('Reviewer note sent'); load(); }} />
    </>
  );
}

function AssignModal({ app, onClose, onSaved }) {
  const toast = useToast();
  const [units, setUnits] = useState([]);
  const [unitId, setUnitId] = useState('');
  const [endDate, setEndDate] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (app) {
      api.get(`/api/units${qs({ property_id: app.property_id, status: 'vacant' })}`).then((d) => setUnits(d.units || [])).catch(() => {});
      setUnitId(app.unit_id || '');
    }
  }, [app]);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.patch(`/api/applications/${app.id}`, {
        status: 'assigned',
        unit_id: Number(unitId),
        end_date: endDate || undefined,
        applicant_password: app.applicant_id ? undefined : password || undefined,
      });
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={!!app} onClose={onClose} title="Assign unit" size="md">
      {app ? (
        <form onSubmit={submit}>
          <p className="muted small">Assign <strong>{app.full_name}</strong> to a vacant unit at {app.property_name}.</p>
          <Field label="Vacant unit" required>
            <Select value={unitId} onChange={(e) => setUnitId(e.target.value)} required>
              <option value="">Select unit…</option>
              {units.map((u) => <option key={u.id} value={u.id}>Unit {u.unit_number} ({u.unit_type}, {kes(u.rent)})</option>)}
            </Select>
          </Field>
          <Field label="Lease end date" hint="Defaults to one year from move-in">
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
          {!app.applicant_id ? (
            <Field label="Temporary password" required hint="Share with the applicant to log in"><Input value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required /></Field>
          ) : null}
          <div className="modal-foot" style={{ padding: 0, border: 'none', marginTop: 8 }}>
            <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={loading}>Assign & create lease</Button>
          </div>
        </form>
      ) : null}
    </Modal>
  );
}

function ReviewModal({ app, onClose, onSaved }) {
  const toast = useToast();
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => setNotes(''), [app]);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.patch(`/api/applications/${app.id}`, { status: 'info_requested', reviewer_notes: notes });
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={!!app} onClose={onClose} title="Request more information" size="md">
      <form onSubmit={submit}>
        <Field label="Note to applicant" required>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Please provide your payslip or ID copy." required />
        </Field>
        <div className="modal-foot" style={{ padding: 0, border: 'none', marginTop: 8 }}>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>Send request</Button>
        </div>
      </form>
    </Modal>
  );
}
