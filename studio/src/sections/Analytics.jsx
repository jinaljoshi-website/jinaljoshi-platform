// studio/src/sections/Analytics.jsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import { T, S, Card, Eyebrow, colors } from '../ui';

const sans    = "'DM Sans', system-ui, sans-serif";
const mono    = "'DM Mono', 'Courier New', monospace";
const display = "'Cormorant Garamond', Georgia, serif";

const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

// The ledger's own vocabulary, in words Jinal would use.
const SPEND_LABELS = {
  dm_charge:         'Messages',
  chat_media_unlock: 'Media in chat',
  content_unlock:    'Gallery and selfies',
  call_charge:       'Calls',
  merch_purchase:    'Merchandise and outfits',
  custom_request:    'Custom requests',
  membership_purchase: 'Memberships',
  membership_upgrade:  'Upgrades',
  membership_extend:   'Extensions',
};
const label = (t) => SPEND_LABELS[t] || t.replace(/_/g, ' ');

function Stat({ head, value, sub, tone }) {
  return (
    <div style={S.statCard}>
      <div style={aLabel}>{head}</div>
      <div style={{ ...aValue, ...(tone ? { color: tone } : {}) }}>{value}</div>
      {sub && <div style={aSub}>{sub}</div>}
    </div>
  );
}

// A row of the same shape used for both spend breakdowns, so purchased and
// gifted can be compared at a glance rather than read separately.
function SpendRow({ item, total }) {
  const pct = total > 0 ? Math.round((item.tokens / total) * 100) : 0;
  return (
    <div style={spendRow}>
      <div style={{ flex: 1, minWidth: 160 }}>
        <div style={{ fontFamily: sans, fontSize: 13, color: colors.text }}>{label(item.type)}</div>
        <div style={{ ...barTrack }}>
          <div style={{ ...barFill, width: `${pct}%` }} />
        </div>
      </div>
      <div style={{ textAlign: 'right', minWidth: 110 }}>
        <div style={{ fontFamily: sans, fontSize: 14, color: colors.text }}>{item.tokens} tokens</div>
        <div style={{ fontFamily: mono, fontSize: 10, color: colors.muted, marginTop: 2 }}>
          {pct}% · {item.count} time{item.count === 1 ? '' : 's'}
        </div>
      </div>
    </div>
  );
}

export function Analytics() {
  const [tab,  setTab]  = useState('purchased');
  const [data, setData] = useState({});
  const [error, setError] = useState('');

  useEffect(() => {
    if (data[tab]) return;
    const path = tab === 'purchased' ? 'purchased' : tab === 'gifted' ? 'gifted' : 'sets';
    api.get(`/api/studio/analytics/${path}`)
      .then((d) => setData((prev) => ({ ...prev, [tab]: d })))
      .catch((e) => setError(e.message));
  }, [tab]);

  const d = data[tab];

  return (
    <div>
      <Eyebrow>The numbers</Eyebrow>
      <T.title>Analytics</T.title>

      {error && <div style={S.error}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, margin: '18px 0 22px', flexWrap: 'wrap' }}>
        {[
          { key: 'purchased', label: 'Purchased tokens' },
          { key: 'gifted',    label: 'Gifted tokens'    },
          { key: 'sets',      label: 'Sets'             },
        ].map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              fontFamily: sans, fontSize: 13, padding: '8px 18px', borderRadius: 999, cursor: 'pointer',
              background: tab === t.key ? 'rgba(193,125,74,0.12)' : 'transparent',
              border:     tab === t.key ? `1px solid ${colors.accent}` : `1px solid ${colors.border}`,
              color:      tab === t.key ? colors.accent : colors.muted,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {!d ? <T.muted>Loading…</T.muted> : tab === 'purchased' ? (
        <>
          <div style={S.statsRow}>
            <Stat head="Revenue" value={rupees(d.revenueInr)} tone={colors.success}
                  sub={`${d.purchases} purchase${d.purchases === 1 ? '' : 's'} · ${d.tokensSold} tokens sold`} />
            <Stat head="Average per token" value={rupees(d.effectiveRate)}
                  sub={`list price ₹${d.tokenRate} · the gap is bulk discount`} />
            <Stat head="Bought but unspent" value={rupees(d.unspentInr)} tone="#D9A45C"
                  sub={`${d.unspentTokens} tokens still owed to fans`} />
          </div>

          <T.sectionTitle>By month</T.sectionTitle>
          <div style={{ display: 'grid', gap: 6, marginBottom: 26 }}>
            {d.byMonth.length === 0 ? <T.muted>Nothing yet.</T.muted> : d.byMonth.map((m) => (
              <div key={m.month} style={spendRow}>
                <span style={{ fontFamily: sans, fontSize: 13, color: colors.text }}>
                  {new Date(m.month + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                </span>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: sans, fontSize: 14, color: colors.text }}>{rupees(m.revenueInr)}</div>
                  <div style={{ fontFamily: mono, fontSize: 10, color: colors.muted }}>{m.tokens} tokens</div>
                </div>
              </div>
            ))}
          </div>

          <T.sectionTitle>What they spent it on</T.sectionTitle>
          <p style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginBottom: 12, lineHeight: 1.6, maxWidth: 620 }}>
            Counted in tokens, deliberately. Not every token in circulation was sold — some were
            gifted, some granted — so putting a rupee figure against spending would produce a
            number larger than anything actually received. Revenue is the figure above.
          </p>
          <div style={{ display: 'grid', gap: 6, marginBottom: 26 }}>
            {d.spentOn.map((s) => (
              <SpendRow key={s.type} item={s} total={d.spentOn.reduce((a, b) => a + b.tokens, 0)} />
            ))}
          </div>

          {d.topFans.length > 0 && (
            <>
              <T.sectionTitle>Who spends most</T.sectionTitle>
              <div style={{ display: 'grid', gap: 6 }}>
                {d.topFans.map((f, i) => (
                  <div key={i} style={spendRow}>
                    <span style={{ fontFamily: sans, fontSize: 13, color: colors.text }}>
                      {f.who} <span style={{ color: colors.muted, fontSize: 11 }}>· {f.tier}</span>
                    </span>
                    <span style={{ fontFamily: sans, fontSize: 14, color: colors.text }}>{rupees(f.spentInr)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      ) : tab === 'gifted' ? (
        <>
          <div style={S.statsRow}>
            <Stat head="Given away" value={rupees(d.grantedInr)}
                  sub={`${d.grantedTokens} tokens to ${d.people} ${d.people === 1 ? 'person' : 'people'}`} />
            <Stat head="Actually used" value={rupees(d.usedInr)} tone={colors.success}
                  sub={`${d.takeUpPct}% of what was given`} />
            <Stat head="Expired unused" value={`${d.lapsedTokens} tokens`} tone="#D9A45C"
                  sub={`${d.liveTokens} still live`} />
          </div>

          {d.expiringSoon.tokens > 0 && (
            <div style={nudgeBox}>
              <strong style={{ color: colors.text }}>{d.expiringSoon.tokens} gifted tokens</strong> held by{' '}
              {d.expiringSoon.people} {d.expiringSoon.people === 1 ? 'person' : 'people'} expire within a week
              — worth {rupees(d.expiringSoon.valueInr)}. A message now is worth more than a bigger gift later.
            </div>
          )}

          <T.sectionTitle>Where the gifts came from</T.sectionTitle>
          <div style={{ display: 'grid', gap: 6, marginBottom: 26 }}>
            {d.bySource.map((s) => (
              <div key={s.source} style={spendRow}>
                <span style={{ fontFamily: sans, fontSize: 13, color: colors.text }}>
                  {s.source === 'welcome' ? 'Welcome gift' : s.source === 'artist_gift' ? 'Sent by Jinal' : s.source}
                </span>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: sans, fontSize: 14, color: colors.text }}>{s.tokens} tokens</div>
                  <div style={{ fontFamily: mono, fontSize: 10, color: colors.muted }}>
                    {s.grants} grant{s.grants === 1 ? '' : 's'}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <T.sectionTitle>What gifted tokens bought</T.sectionTitle>
          <p style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginBottom: 12 }}>
            None of this is revenue — it is what the generosity actually did.
          </p>
          <div style={{ display: 'grid', gap: 6 }}>
            {d.spentOn.length === 0 ? <T.muted>Nothing spent yet.</T.muted> : d.spentOn.map((s) => (
              <SpendRow key={s.type} item={s} total={d.spentOn.reduce((a, b) => a + b.tokens, 0)} />
            ))}
          </div>
        </>
      ) : (
        <>
          <div style={S.statsRow}>
            <Stat head="Earned by the gallery" value={rupees(d.totalRevenueInr)}
                  sub="purchased tokens only" tone={colors.success} />
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {d.sets.length === 0 ? <T.muted>No sets yet.</T.muted> : d.sets.map((s) => (
              <div key={s.id} style={spendRow}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontFamily: sans, fontSize: 13, color: colors.text }}>{s.title}</div>
                  <div style={{ fontFamily: mono, fontSize: 10, color: colors.muted, marginTop: 2 }}>
                    {s.photographer ? `${s.photographer} · ` : ''}{s.unlocks} unlock{s.unlocks === 1 ? '' : 's'}
                    {s.creditUnlocks > 0 && ` · ${s.creditUnlocks} on credit`}
                    {s.giftedTokens > 0 && ` · ${s.giftedTokens} gifted`}
                  </div>
                </div>
                <span style={{ fontFamily: sans, fontSize: 14, color: colors.text }}>{rupees(s.revenueInr)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const aLabel   = { fontFamily: mono, fontSize: 10, color: colors.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 };
const aValue   = { fontFamily: display, fontSize: 30, color: colors.text, fontWeight: 300 };
const aSub     = { fontFamily: sans, fontSize: 11, color: colors.muted, marginTop: 6, lineHeight: 1.5 };
const spendRow = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap', background: 'rgba(255,255,255,0.02)', border: `1px solid ${colors.border}`, borderRadius: 8, padding: '11px 14px' };
const barTrack = { height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, marginTop: 6, overflow: 'hidden' };
const barFill  = { height: 3, background: colors.accent, borderRadius: 2, transition: 'width 0.3s' };
const nudgeBox = { fontFamily: sans, fontSize: 13, color: colors.muted, lineHeight: 1.7, background: 'rgba(217,164,92,0.08)', border: '1px solid rgba(217,164,92,0.3)', borderRadius: 10, padding: '14px 16px', marginBottom: 24 };