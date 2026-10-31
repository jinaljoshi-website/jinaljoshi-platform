// ps/src/components/PhotoUnlock.jsx
//
// What opens when somebody taps a photograph they cannot see yet.
//
// ── Why a panel and not a price on every tile ───────────────────────
//
// A set page can hold two hundred photographs. Putting a price on each
// locked one turns the grid into a price list and makes the pictures the
// smaller half of what is on screen. The price belongs at the moment somebody
// wants a particular photograph, which is this.
//
// ── Why all three options together ──────────────────────────────────
//
// One photograph, the rest of the set, or the membership that covers the
// whole grade. They are three different sizes of the same want, and shown
// side by side the right one is obvious without anybody doing arithmetic.
//
// It also means no price guard is needed anywhere. On a cheap set the
// photograph can cost nearly as much as the set, and rather than capping the
// price or hiding the option, the panel simply shows the set beside it and
// lets the comparison do the work — which converts somebody who came for one
// photograph into somebody who bought the set.

import { C, F } from '../tokens';
import { tierEconomics } from '../data';
import { WonderCoinAmount } from './WonderCoin';

const GRADE_LABEL = {
  insider: 'Insider',
  premium: 'Premium',
  supreme: 'Supreme',
  purchase_only: 'Purchase only',
};

export default function PhotoUnlock({
  item,               // the locked photograph that was tapped
  set,                // the set it belongs to
  lockedCount,        // how many photographs are still locked in this set
  upsellPrice,        // what the rest costs, already credited for anything bought
  photosPaid,         // what has been spent on single photographs here so far
  balance,
  busy,
  tierPrice,          // what opening the set costs, 0 where the membership covers it
  tierOnCredit,       // true when opening it spends an allowance rather than tokens
  onBuyPhoto,
  onBuySet,
  onOpenSet,          // open the set at this member's own level
  onUpgrade,
  onClose,
}) {
  if (!item) return null;

  const grade      = item.tier_category;
  const gradeLabel = GRADE_LABEL[grade] || grade;
  const photoPrice = item.price;

  // Locked, but not because of the grade.
  //
  // Everything at or below a member's own level is locked until the set is
  // opened and included the moment it is. Telling them it is "not in your
  // membership category" would be untrue, and offering to sell it to them
  // would be charging for what they already pay for. One action, and it is
  // the same one at the top of the page.
  const withinTier = !!item.withinTier;

  // The membership that would reach this grade, priced from the same config
  // the membership page reads. Absent rather than guessed if it is unknown.
  const econ        = tierEconomics(grade);
  const monthlyCost = econ && econ.monthlyCost > 0 ? econ.monthlyCost : null;

  // Can this one actually be bought on its own? The last photograph above a
  // member's grade is never for sale — a set cannot be assembled piece by
  // piece — so the panel says so rather than offering a button that fails.
  const isLastOne = lockedCount <= 1;
  const canBuyOne = !isLastOne && Number.isFinite(photoPrice) && photoPrice > 0;

  // Where the set is the better buy. Not a warning so much as the honest
  // comparison: more photographs for the same money or less.
  const setIsBetter = canBuyOne && Number.isFinite(upsellPrice) && upsellPrice <= photoPrice;

  const stop = (e) => e.stopPropagation();

  return (
    <div style={overlay} onClick={onClose} role="dialog" aria-modal="true" aria-label="Unlock this photograph">
      <div style={panel} onClick={stop}>
        <button onClick={onClose} aria-label="Close" style={closeX}>×</button>

        <div style={eyebrow}>{gradeLabel} photograph</div>
        <div style={heading}>
          {withinTier
            ? 'This set is not open yet.'
            : 'This image is not in your membership category.'}
        </div>

        {/* A reminder of what they are looking at, as blurred here as it is
            on the grid. Without it the panel is three prices and no subject. */}
        {item.blur_url && (
          <img src={item.blur_url} alt="" aria-hidden style={blurPeek} />
        )}

        <div style={optionList}>
          {/* Within their own grade: one action, the same one at the top of
              the page, and no prices at all. */}
          {withinTier ? (
            <button onClick={onOpenSet} disabled={busy} style={{ ...option, ...optionPrimary }}>
              <span style={optionName}>
                {tierOnCredit ? 'Unlock set with your membership' : 'Unlock this set'}
                <span style={optionSub}>
                  {tierOnCredit
                    ? 'This photograph is included at your level'
                    : 'This photograph is included once the set is open'}
                </span>
              </span>
              {!tierOnCredit && Number.isFinite(tierPrice) && tierPrice > 0 && (
                <span style={optionPrice}><WonderCoinAmount amount={tierPrice} size={14} fontSize={15} /></span>
              )}
            </button>
          ) : (<>
          {/* 1 — this one photograph */}
          {canBuyOne ? (
            <button onClick={() => onBuyPhoto(item)} disabled={busy}
                    style={{ ...option, ...(setIsBetter ? {} : optionPrimary) }}>
              <span style={optionName}><span style={optionNum}>1</span>Unlock this photo</span>
              <span style={optionPrice}><WonderCoinAmount amount={photoPrice} size={14} fontSize={15} /></span>
            </button>
          ) : (
            <div style={{ ...option, ...optionDisabled }}>
              <span style={optionName}>
                <span style={optionNum}>1</span>
                {isLastOne ? 'This is the last one left' : 'Not sold on its own'}
                {isLastOne && <span style={optionSub}>It comes with the rest of the set</span>}
              </span>
            </div>
          )}

          {/* 2 — everything still locked here */}
          {Number.isFinite(upsellPrice) && upsellPrice > 0 && (
            <button onClick={onBuySet} disabled={busy}
                    style={{ ...option, ...(setIsBetter ? optionPrimary : {}) }}>
              <span style={optionName}>
                <span style={optionNum}>2</span>Unlock complete set
                <span style={optionSub}>{lockedCount} photograph{lockedCount === 1 ? '' : 's'} still locked</span>
              </span>
              <span style={optionPrice}><WonderCoinAmount amount={upsellPrice} size={14} fontSize={15} /></span>
            </button>
          )}

          {/* 3 — the membership that covers the grade */}
          {monthlyCost && (
            <button onClick={onUpgrade} disabled={busy} style={{ ...option, ...optionQuiet }}>
              <span style={optionName}>
                <span style={optionNum}>3</span>Upgrade membership
                <span style={optionSub}>Reaches all {gradeLabel} content</span>
              </span>
              {/* Spelled out. Every other figure in this panel carries the coin
                  and its rupee value, and a bare number beside them reads as
                  the same unit at a glance when it is a monthly subscription. */}
              <span style={optionNote}>{monthlyCost} tokens a month</span>
            </button>
          )}
          </>)}
        </div>

        {setIsBetter && !withinTier && (
          <div style={betterNote}>
            The rest of the set costs the same or less than this one photograph — and you get
            {' '}{lockedCount} instead of 1.
          </div>
        )}

        {photosPaid > 0 && (
          <div style={creditNote}>
            The {photosPaid} you have spent on photographs here already comes off the set.
          </div>
        )}

        <div style={balanceNote}>
          You have <WonderCoinAmount amount={balance || 0} size={11} fontSize={12} /> available.
        </div>
      </div>
    </div>
  );
}

const overlay = {
  position: 'fixed', inset: 0, zIndex: 1100,
  background: 'rgba(12,10,8,0.82)', backdropFilter: 'blur(4px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
};

const panel = {
  position: 'relative', width: '100%', maxWidth: 380,
  background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14,
  padding: '22px 20px 18px', boxSizing: 'border-box',
};

const closeX = {
  position: 'absolute', top: 10, right: 10, width: 32, height: 32,
  background: 'transparent', border: 'none', color: C.muted,
  fontSize: 22, lineHeight: 1, cursor: 'pointer',
};

const eyebrow = { fontFamily: F.mono, fontSize: 11, letterSpacing: '0.08em',
                  textTransform: 'uppercase', color: C.accent, marginBottom: 6 };
const heading = { fontFamily: F.display, fontSize: 19, color: C.text, lineHeight: 1.3, marginBottom: 14 };

const blurPeek = { width: '100%', height: 120, objectFit: 'cover',
                   borderRadius: 10, marginBottom: 16, display: 'block' };

const optionList = { display: 'grid', gap: 9 };

const option = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
  width: '100%', textAlign: 'left', boxSizing: 'border-box',
  padding: '12px 14px', borderRadius: 10,
  background: 'transparent', border: `1px solid ${C.border}`,
  color: C.text, cursor: 'pointer', fontFamily: F.sans, fontSize: 13,
};
const optionPrimary  = { border: `1px solid ${C.accent}`, background: 'rgba(193,125,74,0.10)' };
const optionQuiet    = { borderStyle: 'dashed' };
const optionDisabled = { cursor: 'default', opacity: 0.6, display: 'grid', gap: 2 };

const optionName  = { fontFamily: F.sans, fontSize: 13, color: C.text,
                      display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 9, alignItems: 'baseline' };

// The options are numbered because they are a ranked list of three ways out
// of the same situation, and a number is read before the words are.
const optionNum = { fontFamily: F.mono, fontSize: 11, color: C.muted,
                    gridRow: '1 / span 2', alignSelf: 'center' };

// The second line of an option: what it covers, in the quieter voice, so the
// name stays the thing that is scanned.
const optionSub = { gridColumn: 2, fontFamily: F.sans, fontSize: 11,
                    color: C.muted, marginTop: 2 };

const optionPrice = { flexShrink: 0 };
const optionNote  = { fontFamily: F.sans, fontSize: 12, color: C.muted, flexShrink: 0 };

const betterNote = { fontFamily: F.sans, fontSize: 12, color: C.accent,
                     lineHeight: 1.55, marginTop: 12 };
const creditNote = { fontFamily: F.sans, fontSize: 12, color: C.muted,
                     lineHeight: 1.55, marginTop: 8 };
const balanceNote = { fontFamily: F.sans, fontSize: 11, color: C.muted, marginTop: 12 };