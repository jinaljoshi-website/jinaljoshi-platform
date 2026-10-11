// ps/src/components/TierComparison.jsx
//
// The four memberships side by side, as a grid.
//
// They were only ever shown as four stacked cards, which asks a reader to hold
// three of them in their head while reading the fourth. Almost nobody does, so
// almost nobody compares — and the gallery made that worse by naming a single
// tier and quoting its price, so a guest looking at one Supreme photograph in
// a set of forty-eight was shown Supreme's price as though it were the price
// of joining.
//
// Presentational. It is given a term, a status and a callback, and it decides
// nothing about money: every cost comes from status.options, which the server
// works out. The page or sheet that wraps this owns the buying.

import { TIERS, tierDescription, tierComparisonRows, termMultiplier, termSaving,
         cfgNum, money } from '../data';
import { C, F } from '../tokens';

const TERMS = [
  { id: 'monthly',   label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'annual',    label: 'Annual' },
];

const TIER_ORDER = ['community', 'insider', 'premium', 'supreme'];

export default function TierComparison({
  tiers = TIER_ORDER,
  currentTierId = null,
  isActive = false,
  term = 'monthly',
  onTermChange,
  onChoose,
  busyTier = null,
  options = {},
  compact = false,
}) {
  const rows      = tierComparisonRows(tiers);
  const tokenRate = cfgNum('token_rate_inr');
  if (!rows.length) return null;

  const currentIdx = TIER_ORDER.indexOf(currentTierId);

  // What this tier costs on the chosen term. While a membership is running the
  // server has already worked out the real figure — pro-rated, or credited for
  // what is unused — and that number wins over anything computed here.
  const costFor = (tierId) => {
    if (isActive && options[tierId] && typeof options[tierId].cost === 'number') {
      return options[tierId].cost;
    }
    const base = cfgNum(`${tierId}_monthly_cost`);
    const mult = termMultiplier(term);
    if (base === null || mult === null) return null;
    return Math.ceil(base * mult);
  };

  // Join, upgrade, already yours, or not a step up at all.
  const actionFor = (tierId) => {
    const idx = TIER_ORDER.indexOf(tierId);
    if (isActive && tierId === currentTierId) return { label: 'Your membership', disabled: true, current: true };
    if (isActive && idx < currentIdx)         return { label: 'Below yours',     disabled: true };
    const cost = costFor(tierId);
    if (cost === null)                        return { label: 'Unavailable',     disabled: true };
    const opt = options[tierId];
    const verb = !isActive ? 'Join' : opt?.route === 'trial' ? `Try ${opt.days} days` : 'Upgrade';
    return { label: verb, cost, disabled: false, trial: opt?.route === 'trial' };
  };

  const saving = termSaving(term);

  return (
    <div>
      {/* Term first. It changes every price in the table, so it cannot sit
          underneath them. */}
      <div style={termRow}>
        <div style={termGroup} role="group" aria-label="Billing term">
          {TERMS.map((t) => (
            <button key={t.id} type="button"
                    onClick={() => onTermChange && onTermChange(t.id)}
                    aria-pressed={term === t.id}
                    style={term === t.id ? termOn : termOff}>
              {t.label}
            </button>
          ))}
        </div>
        {saving && <span style={savingChip}>{saving}</span>}
      </div>

      <div style={scroller}>
        <div style={{ ...gridStyle(tiers.length), minWidth: compact ? 620 : 680 }}>

          {/* ── header ── */}
          <div style={{ ...cell, ...stickyLabel, ...headCell }} />
          {tiers.map((tierId) => {
            const act  = actionFor(tierId);
            const cost = act.cost ?? costFor(tierId);
            const mine = isActive && tierId === currentTierId;
            return (
              <div key={tierId} style={{ ...cell, ...headCell, ...(mine ? mineCol : null) }}>
                <div style={{ ...tierName, color: TIERS[tierId]?.color || C.accent }}>
                  {TIERS[tierId]?.name || tierId}
                </div>
                <div style={tierBlurb}>{tierDescription(tierId)}</div>

                <div style={priceBlock}>
                  <div style={priceTokens}>{cost === null ? '—' : `${cost} tokens`}</div>
                  {cost !== null && tokenRate !== null && (
                    <div style={priceInr}>{money(cost * tokenRate)}</div>
                  )}
                </div>

                <button type="button"
                        disabled={act.disabled || busyTier === tierId}
                        onClick={() => !act.disabled && onChoose && onChoose(tierId)}
                        style={act.current ? btnCurrent : act.disabled ? btnDisabled : btnBuy}>
                  {busyTier === tierId ? 'One moment…' : act.label}
                </button>
              </div>
            );
          })}

          {/* ── feature rows ── */}
          {rows.map((r, ri) => (
            <Row key={r.key} row={r} tiers={tiers} zebra={ri % 2 === 1}
                 currentTierId={isActive ? currentTierId : null} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ row, tiers, zebra, currentTierId }) {
  return (
    <>
      <div style={{ ...cell, ...stickyLabel, ...(zebra ? zebraBg : null) }}>
        <div style={rowLabel}>{row.label}</div>
        {row.help && <div style={rowHelp}>{row.help}</div>}
      </div>
      {tiers.map((tierId) => {
        const v    = row.values[tierId];
        const mine = tierId === currentTierId;
        return (
          <div key={tierId} style={{ ...cell, ...valueCell, ...(zebra ? zebraBg : null), ...(mine ? mineCol : null) }}>
            {v === true  ? <span style={tick} aria-label="Included">✓</span>
             : v === false ? <span style={dash} aria-label="Not included">—</span>
             : <span style={valueText}>{v}</span>}
          </div>
        );
      })}
    </>
  );
}

/* ── styles ─────────────────────────────────────────────────────────────── */

const gridStyle = (n) => ({
  display: 'grid',
  gridTemplateColumns: `minmax(176px, 1.5fr) repeat(${n}, minmax(108px, 1fr))`,
  alignItems: 'stretch',
});

// Horizontal scroll rather than a stack. Four columns will not fit a phone at
// a readable size, and a stack is the card layout this exists to replace.
const scroller = {
  overflowX: 'auto',
  WebkitOverflowScrolling: 'touch',
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  background: C.surface,
};

const cell = { padding: '12px 14px', borderBottom: `1px solid ${C.border}`, minWidth: 0 };

const stickyLabel = {
  position: 'sticky',
  left: 0,
  zIndex: 2,
  background: C.surface,
  borderRight: `1px solid ${C.border}`,
};

const headCell = {
  position: 'sticky',
  top: 0,
  zIndex: 3,
  background: C.surface,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  paddingTop: 16,
  paddingBottom: 16,
};

const mineCol   = { background: 'rgba(193,125,74,0.06)' };
const zebraBg   = { background: 'rgba(255,255,255,0.015)' };

const tierName  = { fontFamily: F.display, fontSize: 22, lineHeight: 1.1 };
const tierBlurb = { fontFamily: F.sans, fontSize: 11.5, color: C.muted, lineHeight: 1.5, minHeight: 34 };

const priceBlock  = { marginTop: 'auto', paddingTop: 6 };
const priceTokens = { fontFamily: F.mono, fontSize: 14, color: C.text };
const priceInr    = { fontFamily: F.sans, fontSize: 12, color: C.muted, marginTop: 2 };

const btnBase = {
  marginTop: 10, width: '100%', borderRadius: 999, padding: '9px 10px',
  fontFamily: F.sans, fontSize: 13, cursor: 'pointer', border: '1px solid transparent',
};
const btnBuy      = { ...btnBase, background: C.accent, color: '#17120D', fontWeight: 500 };
const btnCurrent  = { ...btnBase, background: 'transparent', color: C.soft, borderColor: C.accent, cursor: 'default' };
const btnDisabled = { ...btnBase, background: 'transparent', color: C.muted, borderColor: C.border, cursor: 'not-allowed' };

const rowLabel = { fontFamily: F.sans, fontSize: 13, color: C.text, lineHeight: 1.35 };
const rowHelp  = { fontFamily: F.sans, fontSize: 11, color: C.muted, lineHeight: 1.5, marginTop: 3 };

const valueCell = { display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' };
const valueText = { fontFamily: F.sans, fontSize: 12.5, color: C.text, lineHeight: 1.4 };
const tick      = { fontFamily: F.sans, fontSize: 15, color: C.accent };
const dash      = { fontFamily: F.sans, fontSize: 14, color: C.muted };

const termRow   = { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 };
const termGroup = { display: 'inline-flex', border: `1px solid ${C.border}`, borderRadius: 999, padding: 3, gap: 2 };
const termBase  = { border: 'none', borderRadius: 999, padding: '7px 16px', fontFamily: F.sans, fontSize: 13, cursor: 'pointer' };
const termOn    = { ...termBase, background: C.accent, color: '#17120D' };
const termOff   = { ...termBase, background: 'transparent', color: C.muted };
const savingChip = {
  fontFamily: F.mono, fontSize: 11, color: C.soft,
  border: `1px solid ${C.border}`, borderRadius: 999, padding: '4px 10px',
};
