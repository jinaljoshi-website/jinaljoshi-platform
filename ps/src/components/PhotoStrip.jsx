// ps/src/components/PhotoStrip.jsx
// A small photo viewer for shop and wardrobe cards. One image shows plainly; more
// than one gets arrows, dots and thumbnails — a one-of-one garment sells on its
// photographs, so they need to be browsable without leaving the card.
import { useState } from 'react';
import { C, F } from '../tokens';

export default function PhotoStrip({ images = [], alt = '', height = 200, showThumbs = true }) {
  const [i, setI] = useState(0);
  const list = (images || []).filter(Boolean);
  if (!list.length) return null;

  const go = (next) => setI((prev) => (next + list.length) % list.length);

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ position: 'relative' }}>
        <img
          src={list[i]}
          alt={alt}
          style={{ width: '100%', height, objectFit: 'cover', borderRadius: 6, display: 'block', background: '#100F0C' }}
        />
        {list.length > 1 && (
          <>
            <button onClick={() => go(i - 1)} style={{ ...arrow, left: 8 }} aria-label="Previous photo">‹</button>
            <button onClick={() => go(i + 1)} style={{ ...arrow, right: 8 }} aria-label="Next photo">›</button>
            <div style={dots}>
              {list.map((_, n) => (
                <span key={n} style={{ ...dot, background: n === i ? C.accent : 'rgba(255,255,255,0.4)' }} />
              ))}
            </div>
          </>
        )}
      </div>

      {showThumbs && list.length > 1 && (
        <div style={thumbRow}>
          {list.map((url, n) => (
            <img
              key={n}
              src={url}
              alt=""
              onClick={() => setI(n)}
              style={{
                ...thumb,
                borderColor: n === i ? C.accent : C.border,
                opacity: n === i ? 1 : 0.6,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const arrow = {
  position: 'absolute', top: '50%', transform: 'translateY(-50%)',
  width: 30, height: 30, borderRadius: '50%', border: 'none',
  background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 20, lineHeight: 1,
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
};
const dots = {
  position: 'absolute', bottom: 8, left: 0, right: 0,
  display: 'flex', justifyContent: 'center', gap: 5,
};
const dot = { width: 6, height: 6, borderRadius: '50%', display: 'block' };
const thumbRow = { display: 'flex', gap: 6, marginTop: 6, overflowX: 'auto' };
const thumb = {
  width: 44, height: 44, objectFit: 'cover', borderRadius: 4,
  border: '1px solid', cursor: 'pointer', flexShrink: 0,
};