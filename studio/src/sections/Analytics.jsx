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
      <div style={{ textAlign: 'right', minWidth: 120 }}>
        <div style={{ fontFamily: sans, fontSize: 14, color: colors.text }}>{item.tokens} tokens</div>
        <div style={{ fontFamily: mono, fontSize: 10, color: colors.muted, marginTop: 2 }}>
          {pct}% · {item.count} time{item.count === 1 ? '' : 's'}
        </div>
        {item.giftedTokens > 0 && (
          <div style={{ fontFamily: mono, fontSize: 10, color: '#8FC88F', marginTop: 2 }}>
            {item.giftedTokens} gifted
          </div>
        )}
      </div>
    </div>
  );
}

export function Analytics() {
  const [tab,  setTab]  = useState('money');
  const [data, setData] = useState({});
  const [error, setError] = useState('');

  useEffect(() => {
    if (data[tab]) return;
    const path = tab === 'money'     ? 'money'
               : tab === 'purchased' ? 'purchased'
               : tab === 'gifted'    ? 'gifted'
               : tab === 'activity'  ? 'activity'
               : 'sets';
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
          { key: 'money',     label: 'The position'     },
          { key: 'purchased', label: 'Purchased tokens' },
          { key: 'gifted',    label: 'Gifted tokens'    },
          { key: 'sets',      label: 'Sets'             },
          { key: 'activity',  label: 'Set unlock history' },
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

      {!d ? <T.muted>Loading…</T.muted> : tab === 'money' ? (
        <>
          <div style={S.statsRow}>
            <Stat head="Collected" value={rupees(d.collected)}
                  sub={`${d.invoices} invoice${d.invoices === 1 ? '' : 's'} · everything charged`} />
            <Stat head="GST collected" value={rupees(d.gstCollected)} tone="#D9A45C"
                  sub="the government's, not yours — set it aside" />
            <Stat head="May be reclaimed" value={rupees(d.gstRefundable)} tone="#D9A45C"
                  sub={`${d.exportWithTaxCount} export${d.exportWithTaxCount === 1 ? '' : 's'} paid in rupees · claim against the FIRC, subject to approval`} />
            <Stat head="Zero-rated" value={rupees(d.zeroRated)}
                  sub={`${d.exportCount} export${d.exportCount === 1 ? '' : 's'} in foreign currency · no tax at all`} />
          </div>

          {/* The figure that answers "what did I actually keep" — which none of
              the four above does on its own. */}
          <div style={netBox}>
            <div style={{ fontFamily: mono, fontSize: 10, color: colors.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
              Yours, after tax
            </div>
            <div style={{ fontFamily: display, fontSize: 34, color: colors.success, fontWeight: 300 }}>
              {rupees(d.netOfTax)}
            </div>
            <div style={{ fontFamily: sans, fontSize: 11, color: colors.muted, marginTop: 6, lineHeight: 1.6 }}>
              Everything collected, less all the GST. Nothing reclaimable is counted here — that
              has to be claimed and approved first, and until it arrives it is not yours.
            </div>
            {d.gstRefundable > 0 && (
              <div style={{ fontFamily: sans, fontSize: 11, color: '#D9A45C', marginTop: 8, lineHeight: 1.6 }}>
                {rupees(d.gstRefundable)} may come back on top, if the refund claim is approved.
              </div>
            )}
          </div>

          {d.donations.pledged > 0 && (
            <>
              <T.sectionTitle style={{ marginTop: 26 }}>Pledged to charity</T.sectionTitle>
              <p style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginBottom: 12, maxWidth: 620, lineHeight: 1.6 }}>
                From outfit sales. Collected as part of the sale but never income — it is money
                passing through, and the outstanding figure is what still has to be sent on.
              </p>
              <div style={S.statsRow}>
                <Stat head="Pledged"     value={rupees(d.donations.pledged)}
                      sub={`across ${d.donations.sales} sale${d.donations.sales === 1 ? '' : 's'}`} />
                <Stat head="Sent"        value={rupees(d.donations.settled)} tone={colors.success} />
                <Stat head="Still to go" value={rupees(d.donations.outstanding)}
                      tone={d.donations.outstanding > 0 ? '#D9A45C' : colors.muted} />
              </div>
            </>
          )}

          <T.sectionTitle style={{ marginTop: 26 }}>By month</T.sectionTitle>
          <div style={{ overflowX: 'auto', marginTop: 10 }}>
            <table style={actTbl}>
              <thead>
                <tr>{['Month', 'Collected', 'GST', 'Refundable', 'Zero-rated'].map((h) => (
                  <th key={h} style={actTh}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {d.byMonth.length === 0 ? (
                  <tr><td colSpan={5} style={{ ...actTd, color: colors.muted }}>Nothing yet.</td></tr>
                ) : d.byMonth.map((m) => (
                  <tr key={m.month}>
                    <td style={actTd}>
                      {new Date(m.month + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                    </td>
                    <td style={{ ...actTd, textAlign: 'right' }}>{rupees(m.collected)}</td>
                    <td style={{ ...actTd, textAlign: 'right', color: '#D9A45C' }}>{rupees(m.gst)}</td>
                    <td style={{ ...actTd, textAlign: 'right', color: colors.success }}>{m.refundable ? rupees(m.refundable) : '—'}</td>
                    <td style={{ ...actTd, textAlign: 'right' }}>{m.zeroRated ? rupees(m.zeroRated) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : tab === 'purchased' ? (
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

          <T.sectionTitle>What fans spend their tokens on</T.sectionTitle>
          <p style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginBottom: 12, lineHeight: 1.6, maxWidth: 620 }}>
            All spending, whatever the tokens cost to obtain — most have been gifted or granted
            rather than bought. This is where attention goes, not where money came from; revenue
            is the figure above.
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
      ) : tab === 'activity' ? (
        <>
          <div style={S.statsRow}>
            <Stat head="Sets opened" value={d.totalUnlocks + d.totalViews}
                  sub={`${d.totalUnlocks} unlocked · ${d.totalViews} opened free`} />
            <Stat head="Tokens spent" value={d.totalPurchasedTokens}
                  sub="purchased tokens — money that came in" tone={colors.success} />
            <Stat head="Gifted tokens spent" value={d.totalGiftedTokens}
                  sub="given, not earned — no revenue" tone="#8FC88F" />
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={actTbl}>
              <thead>
                <tr>{['When', 'Who', 'Tier', 'Set', 'How', 'Tokens', 'Gifted'].map((h) => (
                  <th key={h} style={actTh}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {d.rows.length === 0 ? (
                  <tr><td colSpan={7} style={{ ...actTd, color: colors.muted }}>Nothing yet.</td></tr>
                ) : d.rows.map((r, i) => (
                  <tr key={i}>
                    <td style={{ ...actTd, fontFamily: mono, fontSize: 11, whiteSpace: 'nowrap' }}>
                      {new Date(r.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td style={{ ...actTd, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.who}</td>
                    <td style={{ ...actTd, color: colors.muted, fontSize: 11 }}>{r.tier}</td>
                    <td style={actTd}>
                      {r.setTitle}
                      {r.isVault && <span style={{ color: colors.accent, fontSize: 10 }}> · vault</span>}
                      {r.scope === 'upsell' && <span style={{ color: colors.muted, fontSize: 10 }}> · exclusive</span>}
                    </td>
                    <td style={{ ...actTd, fontSize: 11,
                                 color: r.how === 'tokens' ? colors.text : colors.muted }}>
                      {r.how === 'tokens' ? 'paid' : r.how === 'membership' ? 'membership' : 'free set'}
                    </td>
                    {/* Kept apart, because one is revenue and the other is a
                        gift coming back — a single column merging them would
                        hide the only distinction that matters here. */}
                    <td style={{ ...actTd, textAlign: 'right' }}>{r.purchasedTokens || '—'}</td>
                    <td style={{ ...actTd, textAlign: 'right', color: r.giftedTokens ? '#8FC88F' : colors.muted }}>
                      {r.giftedTokens || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.hasMore && (
            <div style={{ fontFamily: sans, fontSize: 11, color: colors.muted, marginTop: 10 }}>
              Showing the most recent {d.rows.length}.
            </div>
          )}
        </>
      ) : (
        <>
          <div style={S.statsRow}>
            <Stat head="Earned by the gallery" value={rupees(d.totalRevenueInr)} tone={colors.success}
                  sub="tokens spent opening sets, net of GST" />
          </div>
          <p style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginBottom: 14, lineHeight: 1.6, maxWidth: 640 }}>
            What sets have earned directly — tokens somebody spent to open them, net of {d.gstPct}%
            GST. Sets opened on a membership are counted but carry no figure: that fee buys access
            to the platform rather than the set. Gifted tokens are excluded; they were given, not
            earned.
          </p>
          <div style={{ display: 'grid', gap: 6 }}>
            {d.sets.length === 0 ? <T.muted>No sets yet.</T.muted> : d.sets.map((s) => (
              <div key={s.id} style={spendRow}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontFamily: sans, fontSize: 13, color: colors.text }}>{s.title}</div>
                  <div style={{ fontFamily: mono, fontSize: 10, color: colors.muted, marginTop: 2 }}>
                    {s.photographer ? `${s.photographer} · ` : ''}{s.unlocks} unlock{s.unlocks === 1 ? '' : 's'}
                    {s.creditUnlocks > 0 && ` · ${s.creditUnlocks} on a membership`}
                    {s.giftedTokens > 0 && ` · ${s.giftedTokens} gifted`}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: sans, fontSize: 14, color: colors.text }}>{rupees(s.revenueInr)}</div>
                  {s.purchasedTokens > 0 && (
                    <div style={{ fontFamily: mono, fontSize: 10, color: colors.muted, marginTop: 2 }}>
                      {s.purchasedTokens} token{s.purchasedTokens === 1 ? '' : 's'} spent
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const netBox = { background: 'rgba(143,200,143,0.06)', border: '1px solid rgba(143,200,143,0.25)', borderRadius: 12, padding: '18px 22px', marginTop: 16 };

const actTbl = { width: '100%', borderCollapse: 'collapse', fontFamily: sans, fontSize: 12 };
const actTh  = { textAlign: 'left', padding: '8px 10px', borderBottom: `1px solid ${colors.border}`, color: colors.muted, fontFamily: mono, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' };
const actTd  = { padding: '9px 10px', borderBottom: `1px solid ${colors.border}`, color: colors.text, verticalAlign: 'top' };

const aLabel   = { fontFamily: mono, fontSize: 10, color: colors.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 };
const aValue   = { fontFamily: display, fontSize: 30, color: colors.text, fontWeight: 300 };
const aSub     = { fontFamily: sans, fontSize: 11, color: colors.muted, marginTop: 6, lineHeight: 1.5 };
const spendRow = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap', background: 'rgba(255,255,255,0.02)', border: `1px solid ${colors.border}`, borderRadius: 8, padding: '11px 14px' };
const barTrack = { height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, marginTop: 6, overflow: 'hidden' };
const barFill  = { height: 3, background: colors.accent, borderRadius: 2, transition: 'width 0.3s' };
const nudgeBox = { fontFamily: sans, fontSize: 13, color: colors.muted, lineHeight: 1.7, background: 'rgba(217,164,92,0.08)', border: '1px solid rgba(217,164,92,0.3)', borderRadius: 10, padding: '14px 16px', marginBottom: 24 };