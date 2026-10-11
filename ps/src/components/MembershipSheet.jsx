// ps/src/components/MembershipSheet.jsx
//
// The membership comparison, over whatever the fan was already looking at.
//
// Sending somebody from a locked set to the Membership page costs them their
// place in it. On a set of forty-eight photographs that is a real loss, and
// the back button does not reliably return them to the same scroll position.
// A sheet keeps the set underneath, so declining costs one tap.
//
// It owns the buying because the gallery should not have to know the
// difference between joining, upgrading and a trial. Which of the three it is
// comes from the server on status.options, exactly as the Membership page
// reads it — no pricing rule is reimplemented here.

import { useEffect, useState } from 'react';
import { api } from '../api';
import { C, F } from '../tokens';
import TierComparison from './TierComparison';
import TopUpModal from './TopUpModal';

export default function MembershipSheet({ open, onClose, onChanged, heading, subheading }) {
  const [status, setStatus]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [term, setTerm]       = useState('monthly');
  const [busy, setBusy]       = useState(null);
  const [error, setError]     = useState('');
  const [done, setDone]       = useState('');
  const [topUp, setTopUp]     = useState(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.get('/api/membership/status')
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, [open]);

  // Escape closes, and the page behind does not scroll while this is up.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const isActive = !!status?.isActive;

  const choose = async (tierId) => {
    setError(''); setDone(''); setBusy(tierId);
    const opt  = status?.options?.[tierId];
    const path = !isActive              ? '/api/membership/purchase'
               : opt?.route === 'trial' ? '/api/membership/trial'
               :                          '/api/membership/upgrade';
    const body = !isActive ? { tier: tierId, term } : { newTier: tierId, term };
    try {
      await api.post(path, body);
      setDone('That is active now. Everything at that level is open to you.');
      const fresh = await api.get('/api/membership/status').catch(() => null);
      if (fresh) setStatus(fresh);
      if (onChanged) await onChanged();
    } catch (err) {
      if (err.code === 'INSUFFICIENT_TOKENS') setTopUp(opt?.cost ?? null);
      else setError(err.message || 'That did not go through.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={overlay} onClick={onClose} role="dialog" aria-modal="true" aria-label="Memberships">
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        <div style={sheetHead}>
          <div style={{ minWidth: 0 }}>
            <div style={title}>{heading || 'Memberships'}</div>
            {subheading && <div style={sub}>{subheading}</div>}
          </div>
          <button type="button" onClick={onClose} style={closeBtn} aria-label="Close">✕</button>
        </div>

        <div style={body}>
          {loading ? (
            <div style={muted}>Loading…</div>
          ) : (
            <>
              {error && <div style={errorBox}>{error}</div>}
              {done  && <div style={doneBox}>{done}</div>}
              <TierComparison
                currentTierId={status?.tier || null}
                isActive={isActive}
                term={term}
                onTermChange={setTerm}
                onChoose={choose}
                busyTier={busy}
                options={status?.options || {}}
              />
              <p style={footNote}>
                Memberships open everything at your own level. Anything above it, and anything
                marked purchase-only, is still bought separately at any tier.
              </p>
            </>
          )}
        </div>
      </div>

      {topUp !== null && (
        <TopUpModal requiredTokens={topUp || 0}
                    onClose={() => setTopUp(null)}
                    onSuccess={() => setTopUp(null)} />
      )}
    </div>
  );
}

const overlay = {
  position: 'fixed', inset: 0, zIndex: 120,
  background: 'rgba(8,7,6,0.72)',
  backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)',
  display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
  padding: '24px 0 0',
};

// Anchored to the bottom so a thumb reaches the close button, and capped so
// the set underneath stays visible — this is a comparison, not a destination.
const sheet = {
  width: '100%', maxWidth: 980, maxHeight: '92vh',
  background: C.bg, border: `1px solid ${C.border}`,
  borderRadius: '16px 16px 0 0',
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
};

const sheetHead = {
  display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16,
  padding: '18px 20px 14px', borderBottom: `1px solid ${C.border}`,
};

const title = { fontFamily: F.display, fontSize: 26, color: C.text, lineHeight: 1.1 };
const sub   = { fontFamily: F.sans, fontSize: 13, color: C.muted, marginTop: 6, lineHeight: 1.6 };

const closeBtn = {
  flexShrink: 0, background: 'transparent', border: `1px solid ${C.border}`,
  color: C.muted, borderRadius: 999, width: 34, height: 34, cursor: 'pointer',
  fontFamily: F.sans, fontSize: 14, lineHeight: 1,
};

const body  = { padding: '16px 20px 28px', overflowY: 'auto' };
const muted = { fontFamily: F.sans, fontSize: 14, color: C.muted, padding: '20px 0' };

const errorBox = {
  fontFamily: F.sans, fontSize: 13, color: '#D99A9A', lineHeight: 1.6,
  border: '1px solid rgba(156,90,90,0.4)', borderRadius: 8, padding: '10px 12px', marginBottom: 14,
};
const doneBox = {
  fontFamily: F.sans, fontSize: 13, color: C.soft, lineHeight: 1.6,
  border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', marginBottom: 14,
};

const footNote = {
  fontFamily: F.sans, fontSize: 12, color: C.muted, lineHeight: 1.7,
  margin: '16px 0 0', maxWidth: 70 * 8,
};
