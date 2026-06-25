// studio/src/sections/Dashboard.jsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import { T, S, Card, Eyebrow, Badge, colors } from '../ui';

export function Dashboard() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/studio/dashboard')
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <T.muted>Loading dashboard…</T.muted>;

  const { notifications, pendingCalls, pendingRequests, recentMembers, unreadDMs } = data;

  return (
    <div>
      <Eyebrow>Overview</Eyebrow>
      <T.title>Dashboard</T.title>

      <div style={S.statsRow}>
        <StatCard label="Unread DMs"       value={unreadDMs?.length || 0}       />
        <StatCard label="Pending calls"    value={pendingCalls?.length || 0}    />
        <StatCard label="Pending requests" value={pendingRequests?.length || 0} />
        <StatCard label="Notifications"    value={notifications?.length || 0}   />
      </div>

      {unreadDMs?.length > 0 && (
        <Card style={{ marginBottom: 20 }}>
          <T.sectionTitle>Unread messages</T.sectionTitle>
          {unreadDMs.map((dm) => (
            <div key={dm.id} style={S.listRow}>
              <div>
                <div style={S.rowTitle}>{dm.display_name || dm.email}</div>
                <div style={S.rowSub}>{dm.content.slice(0, 80)}…</div>
              </div>
              <Badge tier={dm.tier} />
            </div>
          ))}
        </Card>
      )}

      {pendingCalls?.length > 0 && (
        <Card style={{ marginBottom: 20 }}>
          <T.sectionTitle>Pending call requests</T.sectionTitle>
          {pendingCalls.map((c) => (
            <div key={c.id} style={S.listRow}>
              <div>
                <div style={S.rowTitle}>{c.display_name || c.email}</div>
                <div style={S.rowSub}>{c.call_type} · {c.coins_charged} tokens</div>
              </div>
              <Badge tier={c.tier} />
            </div>
          ))}
        </Card>
      )}

      {recentMembers?.length > 0 && (
        <Card>
          <T.sectionTitle>Recent members</T.sectionTitle>
          {recentMembers.map((m) => (
            <div key={m.id} style={S.listRow}>
              <div>
                <div style={S.rowTitle}>{m.display_name || m.email}</div>
                <div style={S.rowSub}>Joined {new Date(m.created_at).toLocaleDateString()}</div>
              </div>
              <Badge tier={m.tier} />
            </div>
          ))}
        </Card>
      )}

      {!unreadDMs?.length && !pendingCalls?.length && !recentMembers?.length && (
        <T.muted>All clear — no pending items.</T.muted>
      )}
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div style={S.statCard}>
      <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 11, color: colors.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</div>
      <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 36, color: colors.text }}>{value}</div>
    </div>
  );
}