

Clamped · JSX
// ps/src/components/Clamped.jsx
// Long text cut to a few lines with a way to read the rest.
//
// Whether text actually overflows depends on the container width, not its
// length — so it is measured rather than guessed from a character count. A
// two-line description on a wide screen shows no button; the same text on a
// phone does.
import { useEffect, useRef, useState } from 'react';
import { C, F } from '../tokens';
 
export default function Clamped({ text, lines = 3, style, moreLabel = 'Show more', lessLabel = 'Show less' }) {
  const [open, setOpen]           = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef(null);
 
  useEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const check = () => setOverflows(el.scrollHeight > el.clientHeight + 2);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, open, lines]);
 
  if (!text) return null;
 
  return (
    <div style={{ marginBottom: 10 }}>
      <div
        ref={ref}
        style={{
          ...style,
          ...(open ? {} : {
            display: '-webkit-box',
            WebkitLineClamp: lines,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }),
        }}
      >
        {text}
      </div>
      {(overflows || open) && (
        <button onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }} style={moreBtn}>
          {open ? lessLabel : moreLabel}
        </button>
      )}
    </div>
  );
}
 
const moreBtn = {
  background: 'none', border: 'none', color: C.accent, fontFamily: F.sans,
  fontSize: 12, cursor: 'pointer', padding: '4px 0 0', textDecoration: 'underline',
};