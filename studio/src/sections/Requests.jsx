// studio/src/sections/Requests.jsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import { T, S, Eyebrow, Badge, colors } from '../ui';

export function Requests() {
  const [requests, setRequests] = useState([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    api.get('/api/studio/requests')
      .then((d) => setRequests(d.requests || []))
      .finally(() => setLoading(false));
  }, []);

  const updateStatus = async (id, status) => {
    try {
      const data = await api.patch(`/api/studio/requests/${id}`, { status });
      setRequests((prev) => prev.map((r) => r.id === id ? data.request : r));
    } catch (err) { alert(err.message); }
  };

  if (loading) return <T.muted>Loading requests…</T.muted>;

  const pending = requests.filter((r) => r.status === 'pending');
  const others  = requests.filter((r) => r.status !== 'pending');

  return (
    <div>
      <Eyebrow>Custom requests</Eyebrow>
      <T.title>Requests</T.title>

      {requests.length === 0 && <T.muted>No requests yet.</T.muted>}

      {pending.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <T.sectionTitle>Pending ({pending.length})</T.sectionTitle>
          <div style={{ display: 'grid', gap: 10 }}>
            {pending.map((r) => <RequestRow key={r.id} request={r} onUpdate={updateStatus} />)}
          </div>
        </div>
      )}

      {others.length > 0 && (
        <div>
          <T.sectionTitle>All requests</T.sectionTitle>
          <div style={{ display: 'grid', gap: 10 }}>
            {others.map((r) => <RequestRow key={r.id} request={r} onUpdate={updateStatus} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function RequestRow({ request: r, onUpdate }) {
  return (
    <div style={S.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={S.rowTitle}>{r.display_name || r.email} — {r.type}</div>
          <div style={{ ...S.rowSub, display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            {r.coins_charged} tokens · {new Date(r.created_at).toLocaleDateString()} · <Badge tier={r.tier} />
          </div>
        </div>
        <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 12, color: statusColor(r.status), textTransform: 'capitalize', alignSelf: 'flex-start' }}>
          {r.status}
        </div>
      </div>
      <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 14, color: colors.text, lineHeight: 1.6, padding: '10px 14px', background: '#0D0C0A', borderRadius: 8, marginBottom: 12 }}>
        {r.details}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {['confirmed', 'completed', 'cancelled'].map((s) => (
          <button
            key={s}
            onClick={() => onUpdate(r.id, s)}
            style={{
              ...S.btn,
              background: r.status === s ? '#C17D4A' : 'transparent',
              color:      r.status === s ? '#1A1714' : '#9B8F83',
              border:     '1px solid rgba(242,235,224,0.08)',
              fontSize:   12,
              padding:    '6px 10px',
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function statusColor(status) {
  if (status === 'completed')  return '#8FC88F';
  if (status === 'cancelled')  return '#D99A9A';
  if (status === 'confirmed')  return '#C17D4A';
  return '#9B8F83';
}