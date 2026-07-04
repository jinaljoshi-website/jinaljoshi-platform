// studio/src/sections/Analytics.jsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import { T, S, Card, Eyebrow, colors } from '../ui';

const sans = "'DM Sans', system-ui, sans-serif";
const mono = "'DM Mono', 'Courier New', monospace";

export function Analytics() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    api.get('/api/studio/analytics')
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <T.muted>Loading analytics…</T.muted>;
  if (error)   return <div style={S.error}>{error}</div>;
  if (!data)   return <T.muted>No data available.</T.muted>;

  const {
    revenueOverview, revenueTrend, tokenUtilization, streamBreakdown,
    topFansByRevenue, topFansByActivity, membershipBreakdown, newMembersTrend,
    galleryStats, communityStats, callStats, requestStats, dmStats,
    demographics, signupTrend, tokenRate, tax,
  } = data;

  const revenueDelta = revenueOverview.lastMonthRevenue > 0
    ? Math.round(((revenueOverview.thisMonthRevenue - revenueOverview.lastMonthRevenue) / revenueOverview.lastMonthRevenue) * 100)
    : null;

  const totalMembers = membershipBreakdown.tiers.reduce((sum, t) => sum + t.count, 0);
  const maxTrendRevenue = Math.max(1, ...revenueTrend.map((d) => d.revenue));
  const maxStreamTokens = Math.max(1, ...streamBreakdown.map((s) => s.tokens));
  const maxDemoCount    = Math.max(1, ...demographics.map((d) => d.count));
  const maxSignupCount  = Math.max(1, ...signupTrend.map((s) => s.count));

  return (
    <div>
      <Eyebrow>Overview</Eyebrow>
      <T.title>Analytics</T.title>

      {/* ── KPI ROW ── */}
      <div style={S.statsRow}>
        <div style={S.statCard}>
          <div style={statLabel}>Total Revenue</div>
          <div style={statValue}>₹{revenueOverview.totalRevenueInr.toLocaleString('en-IN')}</div>
          <div style={statSub}>{revenueOverview.totalRecharges} recharges all-time</div>
        </div>
        <div style={S.statCard}>
          <div style={statLabel}>This Month</div>
          <div style={statValue}>₹{revenueOverview.thisMonthRevenue.toLocaleString('en-IN')}</div>
          {revenueDelta !== null && (
            <div style={{ ...statSub, color: revenueDelta >= 0 ? colors.success : colors.error }}>
              {revenueDelta >= 0 ? '↑' : '↓'} {Math.abs(revenueDelta)}% vs last month
            </div>
          )}
        </div>
        <div style={S.statCard}>
          <div style={statLabel}>Active Members</div>
          <div style={statValue}>{totalMembers}</div>
          <div style={statSub}>+{newMembersTrend.thisMonth} this month · {membershipBreakdown.guests} guests</div>
        </div>
        <div style={S.statCard}>
          <div style={statLabel}>Token Utilization</div>
          <div style={statValue}>{tokenUtilization.utilizationPct}%</div>
          <div style={statSub}>{tokenUtilization.totalIdle.toLocaleString('en-IN')} tokens sitting idle</div>
        </div>
      </div>

      {/* ── REVENUE TREND ── */}
      <Card style={{ marginBottom: 20 }}>
        <T.sectionTitle>Revenue — last 30 days</T.sectionTitle>
        {revenueTrend.length === 0 ? (
          <T.muted>No recharges recorded yet.</T.muted>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 120 }}>
            {revenueTrend.map((d) => (
              <div key={d.day} title={`${d.day}: ₹${d.revenue.toLocaleString('en-IN')}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                <div style={{ background: colors.accent, borderRadius: '3px 3px 0 0', height: `${Math.max(2, (d.revenue / maxTrendRevenue) * 100)}%`, opacity: 0.85 }} />
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── TOKEN FLOW ── */}
      <Card style={{ marginBottom: 20 }}>
        <T.sectionTitle>Token flow</T.sectionTitle>
        <div style={S.statsRow}>
          <div style={miniStat}>
            <div style={statLabel}>Recharged</div>
            <div style={{ ...statValue, fontSize: 22 }}>{tokenUtilization.totalRecharged.toLocaleString('en-IN')}</div>
          </div>
          <div style={miniStat}>
            <div style={statLabel}>Spent</div>
            <div style={{ ...statValue, fontSize: 22 }}>{tokenUtilization.totalSpent.toLocaleString('en-IN')}</div>
          </div>
          <div style={miniStat}>
            <div style={statLabel}>Idle balance</div>
            <div style={{ ...statValue, fontSize: 22 }}>{tokenUtilization.totalIdle.toLocaleString('en-IN')}</div>
          </div>
        </div>
      </Card>

      {/* ── STREAM-WISE BREAKDOWN ── */}
      <Card style={{ marginBottom: 20 }}>
        <T.sectionTitle>Where tokens get spent</T.sectionTitle>
        {streamBreakdown.length === 0 ? (
          <T.muted>No token spending recorded yet.</T.muted>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {streamBreakdown.map((s) => (
              <div key={s.label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontFamily: sans, fontSize: 13, color: colors.text }}>{s.label}</span>
                  <span style={{ fontFamily: sans, fontSize: 12, color: colors.muted }}>
                    {s.tokens.toLocaleString('en-IN')} tokens (₹{Math.round(s.tokens * tokenRate).toLocaleString('en-IN')}) · {s.txCount} transactions
                  </span>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 6, height: 8 }}>
                  <div style={{ background: colors.accent, borderRadius: 6, height: 8, width: `${(s.tokens / maxStreamTokens) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── TOP FANS ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px,1fr))', gap: 16, marginBottom: 20 }}>
        <Card>
          <T.sectionTitle>Top spenders (real ₹)</T.sectionTitle>
          {topFansByRevenue.length === 0 ? <T.muted>No recharges yet.</T.muted> : (
            <div style={{ display: 'grid', gap: 4 }}>
              {topFansByRevenue.map((f, i) => (
                <div key={f.email} style={S.listRow}>
                  <span style={{ fontFamily: sans, fontSize: 13, color: colors.text }}>{i + 1}. {f.name || f.email}</span>
                  <span style={{ fontFamily: mono, fontSize: 12, color: colors.accent }}>₹{f.totalInr.toLocaleString('en-IN')}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <T.sectionTitle>Most active (token usage)</T.sectionTitle>
          {topFansByActivity.length === 0 ? <T.muted>No activity yet.</T.muted> : (
            <div style={{ display: 'grid', gap: 4 }}>
              {topFansByActivity.map((f, i) => (
                <div key={f.email} style={S.listRow}>
                  <span style={{ fontFamily: sans, fontSize: 13, color: colors.text }}>{i + 1}. {f.name || f.email}</span>
                  <span style={{ fontFamily: mono, fontSize: 12, color: colors.accent }}>{f.totalTokens.toLocaleString('en-IN')} tokens</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── MEMBERSHIP BREAKDOWN ── */}
      <Card style={{ marginBottom: 20 }}>
        <T.sectionTitle>Membership tiers</T.sectionTitle>
        <div style={S.statsRow}>
          {['community', 'insider', 'premium', 'supreme'].map((tier) => {
            const found = membershipBreakdown.tiers.find((t) => t.tier === tier);
            return (
              <div key={tier} style={miniStat}>
                <div style={{ ...statLabel, textTransform: 'capitalize' }}>{tier}</div>
                <div style={{ ...statValue, fontSize: 22 }}>{found?.count || 0}</div>
              </div>
            );
          })}
          <div style={miniStat}>
            <div style={statLabel}>Guests</div>
            <div style={{ ...statValue, fontSize: 22 }}>{membershipBreakdown.guests}</div>
          </div>
        </div>
      </Card>

      {/* ── ENGAGEMENT ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px,1fr))', gap: 16, marginBottom: 20 }}>
        <Card>
          <T.sectionTitle>Gallery</T.sectionTitle>
          <div style={S.rowSub}>{galleryStats.totalUnlocks} total unlocks · {galleryStats.last30Days} in last 30 days</div>
          {galleryStats.topSet && (
            <div style={{ ...S.rowSub, marginTop: 8, color: colors.accent }}>
              Most unlocked: "{galleryStats.topSet.title}" ({galleryStats.topSet.unlocks}×)
            </div>
          )}
        </Card>
        <Card>
          <T.sectionTitle>Community</T.sectionTitle>
          <div style={S.rowSub}>{communityStats.totalPosts} posts from fans</div>
          {communityStats.mostActiveFan && (
            <div style={{ ...S.rowSub, marginTop: 8, color: colors.accent }}>
              Most active: {communityStats.mostActiveFan.name} ({communityStats.mostActiveFan.posts} posts)
            </div>
          )}
        </Card>
        <Card>
          <T.sectionTitle>Calls</T.sectionTitle>
          {callStats.length === 0 ? <T.muted>None yet.</T.muted> : callStats.map((c) => (
            <div key={c.status} style={{ ...S.rowSub, textTransform: 'capitalize' }}>{c.status}: {c.count}</div>
          ))}
        </Card>
        <Card>
          <T.sectionTitle>Extras requests</T.sectionTitle>
          {requestStats.length === 0 ? <T.muted>None yet.</T.muted> : requestStats.map((r) => (
            <div key={r.status} style={{ ...S.rowSub, textTransform: 'capitalize' }}>{r.status}: {r.count}</div>
          ))}
        </Card>
      </div>

      {/* ── DEMOGRAPHICS ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px,1fr))', gap: 16, marginBottom: 20 }}>
        <Card>
          <T.sectionTitle>Age distribution</T.sectionTitle>
          {demographics.length === 0 ? <T.muted>Not enough data yet.</T.muted> : (
            <div style={{ display: 'grid', gap: 10 }}>
              {demographics.map((d) => (
                <div key={d.bracket}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontFamily: sans, fontSize: 13, color: colors.text }}>{d.bracket}</span>
                    <span style={{ fontFamily: sans, fontSize: 12, color: colors.muted }}>{d.count}</span>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 6, height: 8 }}>
                    <div style={{ background: colors.accent, borderRadius: 6, height: 8, width: `${(d.count / maxDemoCount) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <T.sectionTitle>New signups — last 6 months</T.sectionTitle>
          {signupTrend.length === 0 ? <T.muted>Not enough data yet.</T.muted> : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 100 }}>
              {signupTrend.map((s) => (
                <div key={s.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}>
                  <div style={{ background: colors.accent, borderRadius: '3px 3px 0 0', width: '70%', height: `${Math.max(4, (s.count / maxSignupCount) * 100)}%`, opacity: 0.85 }} />
                  <div style={{ fontFamily: mono, fontSize: 9, color: colors.muted, marginTop: 4 }}>{s.month}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── DMs (best-effort) ── */}
      {dmStats.total !== null && (
        <Card style={{ marginBottom: 20 }}>
          <T.sectionTitle>Direct messages</T.sectionTitle>
          <div style={S.rowSub}>{dmStats.total} total · {dmStats.last30Days} in last 30 days</div>
        </Card>
      )}

      {/* ── TAX ESTIMATE ── */}
      <Card>
        <T.sectionTitle>Tax estimate</T.sectionTitle>
        <div style={S.rowSub}>
          Estimated GST collected (at {tax.gstRateAssumed}%, inclusive): <strong style={{ color: colors.text }}>₹{tax.estimatedGstCollected.toLocaleString('en-IN')}</strong>
        </div>
        <div style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginTop: 10, lineHeight: 1.6, fontStyle: 'italic' }}>
          {tax.note}
        </div>
      </Card>
    </div>
  );
}

const statLabel = { fontFamily: mono, fontSize: 10, color: colors.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 };
const statValue = { fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 30, color: colors.text, fontWeight: 300 };
const statSub   = { fontFamily: sans, fontSize: 11, color: colors.muted, marginTop: 6 };
const miniStat  = { textAlign: 'left' };