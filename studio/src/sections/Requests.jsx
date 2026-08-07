// studio/src/sections/Requests.jsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Extras } from './Extras';
import { SectionTabs } from '../components/SectionTabs';
import { T, S, Eyebrow, Badge, colors } from '../ui';

export function Requests({ openWith }) {
  // What can be asked for, and what has been asked for. Two screens for one
  // subject meant editing the menu and reading the replies were separate trips.
  const [tab, setTab] = useState(openWith?.filter === 'menu' ? 'menu' : 'inbox');
  const [requests, setRequests] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [rejecting, setRejecting] = useState(null);
  const [countering, setCountering] = useState(null); // id of request being countered
  const [reason,    setReason]    = useState('');
  const [counterAmount, setCounterAmount] = useState('');
  const [counterNote,   setCounterNote]   = useState('');
  const [error,     setError]     = useState('');

  useEffect(() => {
    api.get('/api/studio/requests')
      .then((d) => setRequests(d.requests || []))
      .finally(() => setLoading(false));
  }, []);

  const updateStatus = async (id, status, reasonText) => {
    setError('');
    try {
      const data = await api.patch(`/api/studio/requests/${id}`, { status, reason: reasonText });
      setRequests((prev) => prev.map((r) => r.id === id ? data.request : r));
      setRejecting(null);
      setReason('');
    } catch (err) {
      setError(err.message);
    }
  };

  const startReject = (id) => {
    setRejecting(id);
    setReason('');
  };

  const confirmReject = (id) => {
    if (!reason.trim()) return;
    updateStatus(id, 'rejected', reason.trim());
  };

  const startCounter = (r) => {
    setCountering(r.id);
    setCounterAmount(String(r.offered_price_coins || r.coins_charged));
    setCounterNote('');
  };

  const submitCounter = async (id) => {
    const price = parseInt(counterAmount);
    if (!price || price < 0) return;
    setError('');
    try {
      const data = await api.post(`/api/studio/requests/${id}/counter`, { counterPrice: price, note: counterNote.trim() || undefined });
      // Refresh the single request from the list source, since coins_charged/status may have changed
      const refreshed = await api.get('/api/studio/requests');
      setRequests(refreshed.requests || []);
      setCountering(null);
      setCounterAmount('');
      setCounterNote('');
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <T.muted>Loading requests…</T.muted>;

  const pending = requests.filter((r) => r.status === 'pending');
  const others  = requests.filter((r) => r.status !== 'pending');

  return (
    <div>
      <Eyebrow>Custom requests</Eyebrow>
      <T.title>Custom Requests</T.title>

      <SectionTabs
        tabs={[
          { key: 'inbox', label: 'Received', count: pending.length },
          { key: 'menu',  label: 'What can be asked for' },
        ]}
        active={tab} onChange={setTab}
      />

      {tab === 'menu' && <Extras />}

      {tab === 'inbox' && <>

      {error && <div style={S.error}>{error}</div>}
      {requests.length === 0 && <T.muted>No requests yet.</T.muted>}

      {pending.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <T.sectionTitle>Pending ({pending.length})</T.sectionTitle>
          <div style={{ display: 'grid', gap: 10 }}>
            {pending.map((r) => (
              <RequestRow
                key={r.id}
                request={r}
                onUpdate={updateStatus}
                rejecting={rejecting === r.id}
                onStartReject={() => startReject(r.id)}
                onCancelReject={() => { setRejecting(null); setReason(''); }}
                onConfirmReject={() => confirmReject(r.id)}
                reason={reason}
                onReasonChange={setReason}
                countering={countering === r.id}
                onStartCounter={() => startCounter(r)}
                onCancelCounter={() => { setCountering(null); setCounterAmount(''); setCounterNote(''); }}
                onSubmitCounter={() => submitCounter(r.id)}
                counterAmount={counterAmount}
                onCounterAmountChange={setCounterAmount}
                counterNote={counterNote}
                onCounterNoteChange={setCounterNote}
              />
            ))}
          </div>
        </div>
      )}

      {others.length > 0 && (
        <div>
          <T.sectionTitle>All requests</T.sectionTitle>
          <div style={{ display: 'grid', gap: 10 }}>
            {others.map((r) => (
              <RequestRow
                key={r.id}
                request={r}
                onUpdate={updateStatus}
                rejecting={rejecting === r.id}
                onStartReject={() => startReject(r.id)}
                onCancelReject={() => { setRejecting(null); setReason(''); }}
                onConfirmReject={() => confirmReject(r.id)}
                reason={reason}
                onReasonChange={setReason}
                countering={false}
                onStartCounter={() => {}}
                onCancelCounter={() => {}}
                onSubmitCounter={() => {}}
                counterAmount=""
                onCounterAmountChange={() => {}}
                counterNote=""
                onCounterNoteChange={() => {}}
              />
            ))}
          </div>
        </div>
      )}
    </>}
    </div>
  );
}

function RequestRow({
  request: r, onUpdate, rejecting, onStartReject, onCancelReject, onConfirmReject, reason, onReasonChange,
  countering, onStartCounter, onCancelCounter, onSubmitCounter, counterAmount, onCounterAmountChange, counterNote, onCounterNoteChange,
}) {
  const sans = "'DM Sans', system-ui, sans-serif";

  return (
    <div style={S.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={S.rowTitle}>{r.display_name || r.email} — {r.topic || r.type}</div>
          <div style={{ ...S.rowSub, display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
            {r.type} · {r.coins_charged} tokens{r.offered_price_coins && r.offered_price_coins !== r.coins_charged ? ` (offered ${r.offered_price_coins})` : ''} · {new Date(r.created_at).toLocaleDateString()} · <Badge tier={r.tier} />
            {r.expected_delivery_date && <span> · needed by {new Date(r.expected_delivery_date).toLocaleDateString()}</span>}
          </div>
          {r.delivery_channel && (
            <div style={{ fontFamily: sans, fontSize: 13, color: colors.accent, marginBottom: 10 }}>
              Deliver via {r.delivery_channel === 'email' ? 'Email' : 'WhatsApp'}: {r.delivery_channel === 'email' ? r.delivery_email : r.delivery_whatsapp}
            </div>
          )}
        </div>
        <div style={{ fontFamily: sans, fontSize: 12, color: statusColor(r.status), textTransform: 'capitalize', alignSelf: 'flex-start' }}>
          {r.status}
        </div>
      </div>

      <div style={{ fontFamily: sans, fontSize: 14, color: colors.text, lineHeight: 1.6, padding: '10px 14px', background: '#0D0C0A', borderRadius: 8, marginBottom: 10 }}>
        {r.details}
      </div>

      {r.reference_image_key && (
        <div style={{ marginBottom: 10 }}>
          <img src={r.reference_image_key} alt="reference" style={{ maxWidth: 160, maxHeight: 160, borderRadius: 8, border: `1px solid ${colors.border}`, display: 'block' }} />
        </div>
      )}

      {r.reference_url && (
        <div style={{ fontFamily: sans, fontSize: 13, marginBottom: 10 }}>
          <span style={{ color: colors.muted }}>Reference: </span>
          <a href={r.reference_url} target="_blank" rel="noopener noreferrer" style={{ color: colors.accent, wordBreak: 'break-all' }}>{r.reference_url}</a>
        </div>
      )}

      {r.status === 'countered' && (
        <div style={{ fontFamily: sans, fontSize: 13, color: '#D9A45C', background: 'rgba(217,164,92,0.08)', border: '1px solid rgba(217,164,92,0.25)', borderRadius: 8, padding: '8px 12px', marginBottom: 10 }}>
          Countered at {r.counter_price_coins} tokens — awaiting the fan's response.
        </div>
      )}

      {r.status === 'rejected' && r.rejection_reason && (
        <div style={{ fontFamily: sans, fontSize: 13, color: '#D99A9A', background: 'rgba(156,90,90,0.08)', border: '1px solid rgba(156,90,90,0.25)', borderRadius: 8, padding: '8px 12px', marginBottom: 10 }}>
          Declined: {r.rejection_reason}
        </div>
      )}

      {rejecting ? (
        <div>
          <textarea
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            placeholder="Reason for declining (shown to the fan, and their tokens will be refunded as credit)"
            style={{ width: '100%', boxSizing: 'border-box', background: '#0D0C0A', border: `1px solid rgba(156,90,90,0.3)`, color: colors.text, fontFamily: sans, fontSize: 13, padding: '10px 12px', borderRadius: 8, outline: 'none', resize: 'vertical', marginBottom: 10 }}
            rows={2}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onConfirmReject} disabled={!reason.trim()} style={{ ...S.btn, background: '#9C5A5A', border: 'none', fontSize: 12, padding: '6px 12px', opacity: reason.trim() ? 1 : 0.5 }}>
              Confirm decline &amp; refund
            </button>
            <button onClick={onCancelReject} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px' }}>Cancel</button>
          </div>
        </div>
      ) : countering ? (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <input
              type="number" min={0} value={counterAmount} onChange={(e) => onCounterAmountChange(e.target.value)}
              placeholder="Counter price (tokens)"
              style={{ width: 160, boxSizing: 'border-box', background: '#0D0C0A', border: `1px solid rgba(217,164,92,0.3)`, color: colors.text, fontFamily: sans, fontSize: 13, padding: '8px 12px', borderRadius: 8, outline: 'none' }}
            />
            <input
              value={counterNote} onChange={(e) => onCounterNoteChange(e.target.value)}
              placeholder="Note to the fan (optional)"
              style={{ flex: 1, minWidth: 160, boxSizing: 'border-box', background: '#0D0C0A', border: `1px solid rgba(217,164,92,0.3)`, color: colors.text, fontFamily: sans, fontSize: 13, padding: '8px 12px', borderRadius: 8, outline: 'none' }}
            />
          </div>
          <p style={{ fontFamily: sans, fontSize: 11, color: colors.muted, marginBottom: 10 }}>
            A lower price than what's charged confirms automatically with a partial refund. A higher price is sent to the fan for their confirmation before any additional charge.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onSubmitCounter} disabled={!counterAmount} style={{ ...S.btn, background: '#D9A45C', border: 'none', color: '#1A1714', fontSize: 12, padding: '6px 12px', opacity: counterAmount ? 1 : 0.5 }}>
              Send counter-offer
            </button>
            <button onClick={onCancelCounter} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px' }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {r.status === 'pending' && (
            <>
              <button onClick={() => onUpdate(r.id, 'confirmed')} style={{ ...S.btn, fontSize: 12, padding: '6px 12px' }}>Accept</button>
              <button onClick={onStartCounter} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px', color: '#D9A45C', border: '1px solid rgba(217,164,92,0.3)' }}>Counter</button>
              <button onClick={onStartReject} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px', color: '#D99A9A', border: '1px solid rgba(156,90,90,0.3)' }}>Reject</button>
            </>
          )}
          {r.status === 'confirmed' && (
            <button onClick={() => onUpdate(r.id, 'completed')} style={{ ...S.btn, fontSize: 12, padding: '6px 12px' }}>Mark complete</button>
          )}
        </div>
      )}
    </div>
  );
}

function statusColor(status) {
  if (status === 'completed')  return '#8FC88F';
  if (status === 'rejected')   return '#D99A9A';
  if (status === 'cancelled')  return '#D99A9A';
  if (status === 'confirmed')  return '#C17D4A';
  if (status === 'countered')  return '#D9A45C';
  return '#9B8F83';
}