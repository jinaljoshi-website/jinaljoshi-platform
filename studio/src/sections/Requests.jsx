// studio/src/sections/Requests.jsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import { T, S, Eyebrow, Badge, colors } from '../ui';

export function Requests() {
  const [requests, setRequests] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [rejecting, setRejecting] = useState(null); // id of request being rejected
  const [reason,    setReason]    = useState('');
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

  if (loading) return <T.muted>Loading requests…</T.muted>;

  const pending = requests.filter((r) => r.status === 'pending');
  const others  = requests.filter((r) => r.status !== 'pending');

  return (
    <div>
      <Eyebrow>Custom requests</Eyebrow>
      <T.title>Requests</T.title>

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
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RequestRow({ request: r, onUpdate, rejecting, onStartReject, onCancelReject, onConfirmReject, reason, onReasonChange }) {
  const sans = "'DM Sans', system-ui, sans-serif";

  return (
    <div style={S.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={S.rowTitle}>{r.display_name || r.email} — {r.type}</div>
          <div style={{ ...S.rowSub, display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            {r.coins_charged} tokens · {new Date(r.created_at).toLocaleDateString()} · <Badge tier={r.tier} />
          </div>
        </div>
        <div style={{ fontFamily: sans, fontSize: 12, color: statusColor(r.status), textTransform: 'capitalize', alignSelf: 'flex-start' }}>
          {r.status}
        </div>
      </div>

      <div style={{ fontFamily: sans, fontSize: 14, color: colors.text, lineHeight: 1.6, padding: '10px 14px', background: '#0D0C0A', borderRadius: 8, marginBottom: 10 }}>
        {r.details}
      </div>

      {r.reference_url && (
        <div style={{ fontFamily: sans, fontSize: 13, marginBottom: 10 }}>
          <span style={{ color: colors.muted }}>Reference: </span>
          <a href={r.reference_url} target="_blank" rel="noopener noreferrer" style={{ color: colors.accent, wordBreak: 'break-all' }}>{r.reference_url}</a>
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
            placeholder="Reason for declining (shown to the fan, and their tokens will be refunded)"
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
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {r.status === 'pending' && (
            <>
              <button onClick={() => onUpdate(r.id, 'confirmed')} style={{ ...S.btn, fontSize: 12, padding: '6px 12px' }}>Accept</button>
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
  return '#9B8F83';
}