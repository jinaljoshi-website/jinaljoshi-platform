// studio/src/sections/Traffic.jsx
//
// How many people arrive, and what they do before they decide anything.
//
// The two sites are shown one at a time rather than added together, because
// they answer different questions. The portfolio has no accounts and nothing to
// buy, so its numbers are about reach: who arrived, from where, and whether
// they came back. Personal Space has a funnel, so its numbers are about
// persuasion — and the top of that funnel was, until now, the one figure
// nobody had.
//
// Where a number is an estimate or a proxy it says so. A dashboard that reports
// a soft number in the same voice as a hard one teaches you to distrust both.

import { useEffect, useState } from 'react';
import { api } from '../api';
import { T, S, Card, Eyebrow, colors } from '../ui';

const sans    = "'DM Sans', system-ui, sans-serif";
const display = "'Cormorant Garamond', Georgia, serif";
const mono = "'DM Mono', 'Courier New', monospace";

const SITES = [
  { key: 'ps',        label: 'Personal Space', host: 'ps.jinaljoshi.in' },
  { key: 'portfolio', label: 'Portfolio',      host: 'jinaljoshi.in' },
];

const RANGES = [
  { key: 7,  label: '7 days'  },
  { key: 30, label: '30 days' },
  { key: 90, label: '90 days' },
];

// Named so they read as things somebody did, not as the labels a developer
// chose. An event nobody can interpret is an event nobody will act on.
const EVENT_LABELS = {
  nav_click:       'Moved between sections',
  work_click:      'Opened a piece of work',
  set_preview:     'Looked at a locked set',
  topup_opened:    'Opened the top-up box',
  topup_abandoned: 'Closed it without paying',
  call_started:    'Chose a call type',
  gallery_scroll:  'Reached the end of a gallery',
  outbound:        'Followed a link away',
  error:           'Something broke',
};

export function Traffic() {
  const [site,  setSite]  = useState('ps');
  const [days,  setDays]  = useState(30);
  const [d,     setD]     = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setD(null); setError('');
    api.get(`/api/studio/analytics/traffic?site=${site}&days=${days}`)
      .then(setD)
      .catch((e) => setError(e.message));
  }, [site, days]);

  const t = d?.totals;
  const peak = Math.max(1, ...(d?.byDay || []).map((r) => r.views));

  return (
    <div>
      <Eyebrow>Who came</Eyebrow>
      <T.title>Traffic</T.title>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '18px 0 10px' }}>
        {SITES.map((s) => (
          <button key={s.key} onClick={() => setSite(s.key)}
                  style={{ ...pill, ...(site === s.key ? pillOn : {}) }}>
            {s.label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        {RANGES.map((r) => (
          <button key={r.key} onClick={() => setDays(r.key)}
                  style={{ ...pill, fontSize: 10, ...(days === r.key ? pillOn : {}) }}>
            {r.label}
          </button>
        ))}
      </div>

      <div style={{ fontFamily: mono, fontSize: 10, color: colors.muted, marginBottom: 16 }}>
        {SITES.find((s) => s.key === site)?.host}
      </div>

      {error && <div style={S.error}>{error}</div>}
      {!d && !error && <T.muted>Counting…</T.muted>}

      {d && t && (
        <>
          <div style={S.statsRow}>
            <Stat head="Visitors" value={t.visitors}
                  sub={`${t.views} page view${t.views === 1 ? '' : 's'}`} />
            <Stat head="Came back" value={`${t.returningPct}%`}
                  sub={`${t.returning} on more than one day`} />
            <Stat head="Did something" value={`${t.clickedPct}%`}
                  sub={`${t.clickers} of ${t.visitors} went beyond looking`} />
            <Stat head="Actions each" value={t.clicksPerVisitor}
                  sub={`${t.clicks} counted in total`} />
            {site === 'ps' && (
              <Stat head="Signed in" value={t.members}
                    sub="the rest were anonymous" />
            )}
          </div>

          {t.visitors === 0 && (
            <div style={{ fontFamily: sans, fontSize: 13, color: colors.muted, margin: '18px 0', lineHeight: 1.7 }}>
              Nothing counted yet for this site. Counting began when this was built,
              so the first days will be thin, and anything before that is simply
              not recorded — there is no history to backfill.
            </div>
          )}

          {/* A day at a time. Deliberately plain bars: the shape of a week is
              the point, and a chart library would be a dependency to maintain
              for something a div does honestly. */}
          {d.byDay.length > 0 && (
            <Card style={{ marginTop: 18 }}>
              <T.sectionTitle>By day</T.sectionTitle>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 120, marginTop: 12 }}>
                {d.byDay.map((row) => (
                  <div key={row.day} title={`${row.day} · ${row.views} views · ${row.visitors} visitors`}
                       style={{ flex: 1, minWidth: 4, background: colors.accent, opacity: 0.75,
                                height: `${Math.max(2, (row.views / peak) * 100)}%`, borderRadius: 2 }} />
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                <span style={dayLabel}>{d.byDay[0]?.day}</span>
                <span style={dayLabel}>{d.byDay[d.byDay.length - 1]?.day}</span>
              </div>
            </Card>
          )}

          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', marginTop: 16 }}>
            <Panel title="Where they came from"
                   note="The host only — enough to know the channel, not the post."
                   rows={d.sources.map((r) => [r.source, r.visits])} />

            <Panel title="Most visited"
                   rows={d.pages.map((r) => [r.path, `${r.visitors} visitor${r.visitors === 1 ? '' : 's'}`])} />

            <Panel title="On what"
                   rows={d.devices.map((r) => [r.device, r.visitors])} />

            <Panel title="What they did"
                   note="Only what the API never hears about — a set opened or a message sent is recorded properly elsewhere."
                   rows={d.events.map((r) => [EVENT_LABELS[r.event] || r.event, r.times])} />
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ head, value, sub }) {
  return (
    <div style={S.statCard}>
      <div style={statHead}>{head}</div>
      <div style={statValue}>{value}</div>
      {sub && <div style={statSub}>{sub}</div>}
    </div>
  );
}

function Panel({ title, note, rows }) {
  return (
    <Card>
      <T.sectionTitle>{title}</T.sectionTitle>
      {note && (
        <div style={{ fontFamily: sans, fontSize: 11, color: colors.muted, marginBottom: 10, lineHeight: 1.5 }}>
          {note}
        </div>
      )}
      {rows.length === 0 ? <T.muted>Nothing yet.</T.muted> : (
        <div style={{ display: 'grid', gap: 6 }}>
          {rows.map(([left, right], i) => (
            <div key={i} style={panelRow}>
              <span style={{ fontFamily: sans, fontSize: 13, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {left}
              </span>
              <span style={{ fontFamily: mono, fontSize: 12, color: colors.muted, flexShrink: 0, marginLeft: 12 }}>
                {right}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// Matching the shapes Money already uses, so the two screens read as one
// product rather than two.
const statHead  = { fontFamily: mono, fontSize: 10, color: colors.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 };
const statValue = { fontFamily: display, fontSize: 30, color: colors.text, fontWeight: 300 };
const statSub   = { fontFamily: sans, fontSize: 11, color: colors.muted, marginTop: 6, lineHeight: 1.5 };

const pill    = { fontFamily: sans, fontSize: 11, padding: '5px 12px', borderRadius: 999, cursor: 'pointer', background: 'transparent', border: `1px solid ${colors.border}`, color: colors.muted };
const pillOn  = { color: colors.accent, borderColor: colors.accent };
const dayLabel = { fontFamily: mono, fontSize: 9, color: colors.muted };
const panelRow = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: `1px solid ${colors.border}` };