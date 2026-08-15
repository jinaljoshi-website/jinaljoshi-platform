// studio/src/components/ShareLink.jsx
// Copies a shareable link for a set, a merchandise item or an outfit.
//
// The link points at /s/… rather than straight at /platform/…, because only the
// /s route returns a page carrying preview tags. A crawler will not sign in and
// does not run JavaScript, so a link into the app itself previews as a bare
// address wherever it is pasted. /s answers with the title, the description and
// a picture, then sends the person who clicked on to the real page.
//
// The domain is ps.jinaljoshi.in either way — a rewrite in ps/vercel.json passes
// /s through to the backend — so nothing about the link tells the fan that a
// second service was involved.
import { useState } from 'react';
import { colors } from '../ui';

const sans = "'DM Sans', system-ui, sans-serif";
const mono = "'DM Mono', 'Courier New', monospace";

const PS_BASE = 'https://ps.jinaljoshi.in';

// Gallery sets, merchandise, outfits. Outfits and merchandise are one table told
// apart by is_auction_item, and the backend works out which section to land on —
// but the prefix is kept distinct so a link that came from the Shoot Wardrobe
// still reads as one wherever somebody pastes it.
const PREFIX = { gallery: 'g', merch: 'm', outfit: 'o' };

function shareUrlFor(kind, id) {
  return `${PS_BASE}/s/${PREFIX[kind] || 'g'}/${id}`;
}

export default function ShareLink({ kind, id, label = 'Share', title }) {
  const [state, setState] = useState('idle');   // idle | copied | failed
  if (!id) return null;

  const url = shareUrlFor(kind, id);

  const copy = async (e) => {
    // These buttons sit inside rows that open something when clicked, so the
    // click must stop here or copying a link also navigates away from the list.
    e.stopPropagation();
    e.preventDefault();
    try {
      // The share sheet where there is one — on a phone that is the difference
      // between copying a link and actually sending it to somebody.
      if (navigator.share) {
        await navigator.share({ title: title || 'Personal Space', url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setState('copied');
      setTimeout(() => setState('idle'), 1600);
    } catch (err) {
      // A cancelled share sheet is not a failure and should say nothing.
      if (err?.name === 'AbortError') return;
      // clipboard.writeText needs a secure context and permission, and refuses
      // in some embedded browsers. Falling back to a prompt means the link is
      // always obtainable, even where copying silently will not work.
      try {
        window.prompt('Copy this link', url);
      } catch {
        setState('failed');
        setTimeout(() => setState('idle'), 2200);
      }
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={url}
      style={{
        fontFamily: sans,
        fontSize: 11,
        padding: '5px 11px',
        borderRadius: 6,
        cursor: 'pointer',
        background: state === 'copied' ? 'rgba(126,186,134,0.14)' : 'transparent',
        border: `1px solid ${state === 'copied' ? 'rgba(126,186,134,0.45)' : colors.border}`,
        color: state === 'copied' ? '#7EBA86' : colors.muted,
        transition: 'background 120ms, border-color 120ms, color 120ms',
        whiteSpace: 'nowrap',
      }}
    >
      {state === 'copied' ? 'Link copied' : state === 'failed' ? 'Could not copy' : label}
    </button>
  );
}