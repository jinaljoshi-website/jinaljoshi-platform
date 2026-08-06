// ps/src/components/HowUnlocking.jsx
// How unlocking works, in the fan's own terms.
//
// The pricing is genuinely reasonable but not self-evident: a set splits into a
// part your membership reaches and a part above it, each priced by how many
// photos are in it. Nobody worked that out from a price tag, and a fan who does
// not understand what they are buying tends not to buy.
//
// Collapsed by default and placed where the question arises, rather than on a
// page nobody visits.
import { useState } from 'react';
import { C, F } from '../tokens';

export default function HowUnlocking({ tier, creditsRemaining, creditsMax }) {
  const [open, setOpen] = useState(false);
  const isGuest = !tier || tier === 'guest';

  return (
    <div style={box}>
      <button onClick={() => setOpen(!open)} style={head}>
        <span>How unlocking works</span>
        <span style={{ color: C.accent, fontSize: 12 }}>{open ? 'Hide' : 'Read this first'}</span>
      </button>

      {open && (
        <div style={{ marginTop: 14 }}>
          <p style={p}>
            Every set is split into parts by who they are meant for. Some photos are free for
            everyone. Others are for members, and the higher your tier the more of them you can
            reach. A few sets are kept aside and bought outright by anyone.
          </p>

          <div style={rule} />

          <div style={pointRow}>
            <div style={num}>01</div>
            <div>
              <div style={h}>Free photos are always free</div>
              <div style={sub}>You see them without spending anything, member or not.</div>
            </div>
          </div>

          <div style={pointRow}>
            <div style={num}>02</div>
            <div>
              <div style={h}>Your membership reaches part of each set</div>
              <div style={sub}>
                {isGuest
                  ? 'Members reach the photos meant for their tier and everything below it. As a guest you can still buy any set outright.'
                  : `As ${tier}, you reach the photos meant for ${tier} and every tier below it. That part is what your monthly unlocks pay for.`}
              </div>
            </div>
          </div>

          <div style={pointRow}>
            <div style={num}>03</div>
            <div>
              <div style={h}>The rest can be bought separately</div>
              <div style={sub}>
                Photos meant for tiers above yours are priced on their own. You never have to
                buy them, and the set works without them.
              </div>
            </div>
          </div>

          <div style={pointRow}>
            <div style={num}>04</div>
            <div>
              <div style={h}>Prices follow the number of photos</div>
              <div style={sub}>
                A set's price is spread across everything in it, so you pay for the share you
                are actually opening — not the whole set to see part of it.
              </div>
            </div>
          </div>

          {!isGuest && creditsMax > 0 && (
            <>
              <div style={rule} />
              <div style={{ ...h, marginBottom: 6 }}>Your monthly unlocks</div>
              <p style={{ ...sub, marginBottom: 10 }}>
                You have <strong style={{ color: C.accent }}>{creditsRemaining} of {creditsMax}</strong> left
                this month. They open the part of a set your tier reaches, at no cost. They refresh
                every month and do not carry over.
              </p>
              {/* Said plainly, because it is the one thing that surprises people
                  later and is much better known before than discovered after. */}
              <p style={{ ...sub, color: '#D9A45C' }}>
                A set opened with a monthly unlock stays yours while your membership is active.
                A set you pay tokens for is yours permanently, whatever happens to your membership.
              </p>
            </>
          )}

          {isGuest && (
            <>
              <div style={rule} />
              <p style={sub}>
                Members get a number of free unlocks every month and pay less for everything else.
                As a guest you can still buy any set, at a slightly higher price.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const box      = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, marginBottom: 20 };
const head     = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: F.sans, fontSize: 14, color: C.text };
const p        = { fontFamily: F.sans, fontSize: 14, color: C.muted, lineHeight: 1.8, margin: 0 };
const rule     = { height: 1, background: C.border, margin: '16px 0' };
const pointRow = { display: 'flex', gap: 14, alignItems: 'baseline', marginBottom: 14 };
const num      = { fontFamily: F.mono, fontSize: 10, color: C.accent, letterSpacing: '0.1em', flexShrink: 0 };
const h        = { fontFamily: F.sans, fontSize: 14, color: C.text, marginBottom: 3 };
const sub      = { fontFamily: F.sans, fontSize: 13, color: C.muted, lineHeight: 1.7, margin: 0 };