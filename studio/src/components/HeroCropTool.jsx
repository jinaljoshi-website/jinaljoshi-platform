// studio/src/components/HeroCropTool.jsx
// Lets Jinal see, before uploading, what a hero photo will actually look like on both a
// tall phone (which crops the sides, keeping full height) and a wide desktop (which crops
// the bottom, keeping full width, since the site uses object-position: center top). Drag
// to reposition, zoom with the slider, and aim to keep her face inside both guide zones.
import { useEffect, useRef, useState } from 'react';
import { colors } from '../ui';

const sans = "'DM Sans', system-ui, sans-serif";

// A generous working canvas — wide enough to show the desktop-safe band, tall enough to
// show the phone-safe band, without forcing either to the extreme.
const CANVAS_RATIO = 4 / 5; // width / height
const OUTPUT_WIDTH = 1600;

// Roughly a modern tall phone screen (portrait) and a common laptop screen (landscape) —
// these define the two guide zones shown inside the canvas.
const PHONE_RATIO   = 9 / 19.5;
const DESKTOP_RATIO = 16 / 9;

export default function HeroCropTool({ file, onCancel, onCropComplete }) {
  const [imgUrl, setImgUrl] = useState('');
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, offX: 0, offY: 0 });
  const imgRef = useRef(null);

  const containerW = 260;
  const containerH = containerW / CANVAS_RATIO;

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImgUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const handleImgLoad = () => {
    const img = imgRef.current;
    setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  const baseScale = natural.w && natural.h ? Math.max(containerW / natural.w, containerH / natural.h) : 1;
  const effectiveScale = baseScale * scale;
  const dispW = natural.w * effectiveScale;
  const dispH = natural.h * effectiveScale;

  const clampOffset = (x, y, w = dispW, h = dispH) => {
    const maxX = Math.max(0, (w - containerW) / 2);
    const maxY = Math.max(0, (h - containerH) / 2);
    return { x: Math.min(maxX, Math.max(-maxX, x)), y: Math.min(maxY, Math.max(-maxY, y)) };
  };

  const startDrag = (clientX, clientY) => {
    setDragging(true);
    dragStart.current = { x: clientX, y: clientY, offX: offset.x, offY: offset.y };
  };
  const moveDrag = (clientX, clientY) => {
    if (!dragging) return;
    const dx = clientX - dragStart.current.x;
    const dy = clientY - dragStart.current.y;
    setOffset(clampOffset(dragStart.current.offX + dx, dragStart.current.offY + dy));
  };
  const endDrag = () => setDragging(false);

  const handleZoom = (newScale) => {
    setScale(newScale);
    const newDispW = natural.w * baseScale * newScale;
    const newDispH = natural.h * baseScale * newScale;
    setOffset((prev) => clampOffset(prev.x, prev.y, newDispW, newDispH));
  };

  // Guide zone sizes, within the same containerW/containerH box shown on screen
  const phoneGuideW = containerH * PHONE_RATIO;
  const desktopGuideH = containerW / DESKTOP_RATIO;

  const confirmCrop = () => {
    setProcessing(true);
    const outH = OUTPUT_WIDTH / CANVAS_RATIO;
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_WIDTH;
    canvas.height = Math.round(outH);
    const ctx = canvas.getContext('2d');

    const outScale = OUTPUT_WIDTH / containerW;
    const drawW = dispW * outScale;
    const drawH = dispH * outScale;
    const drawX = OUTPUT_WIDTH / 2 - drawW / 2 + offset.x * outScale;
    const drawY = outH / 2 - drawH / 2 + offset.y * outScale;

    ctx.drawImage(imgRef.current, drawX, drawY, drawW, drawH);
    canvas.toBlob((blob) => {
      const croppedFile = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
      setProcessing(false);
      onCropComplete(croppedFile);
    }, 'image/jpeg', 0.9);
  };

  return (
    <div style={overlay}>
      <div style={panel}>
        <div style={{ fontFamily: sans, fontSize: 14, color: colors.text, fontWeight: 600, marginBottom: 4 }}>Position hero photo</div>
        <div style={{ fontFamily: sans, fontSize: 11, color: colors.muted, marginBottom: 14, lineHeight: 1.5 }}>
          Drag and zoom so her face sits inside both guide boxes — the <span style={{ color: '#8FBFC1' }}>narrow one</span> shows what phone visitors see, the <span style={{ color: '#D9A45C' }}>wide one at top</span> shows what desktop visitors see.
        </div>

        <div
          style={{ ...frame, width: containerW, height: containerH }}
          onMouseDown={(e) => startDrag(e.clientX, e.clientY)}
          onMouseMove={(e) => moveDrag(e.clientX, e.clientY)}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
          onTouchStart={(e) => startDrag(e.touches[0].clientX, e.touches[0].clientY)}
          onTouchMove={(e) => moveDrag(e.touches[0].clientX, e.touches[0].clientY)}
          onTouchEnd={endDrag}
        >
          {imgUrl && (
            <img
              ref={imgRef}
              src={imgUrl}
              alt=""
              onLoad={handleImgLoad}
              draggable={false}
              style={{
                position: 'absolute',
                left: '50%', top: '50%',
                width: dispW, height: dispH,
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                userSelect: 'none', pointerEvents: 'none',
              }}
            />
          )}

          {/* Phone-safe guide — full height, narrow width, centered */}
          <div style={{
            position: 'absolute', top: 0, bottom: 0, left: '50%',
            width: phoneGuideW, transform: 'translateX(-50%)',
            border: '2px dashed #8FBFC1', pointerEvents: 'none',
          }} />

          {/* Desktop-safe guide — full width, anchored to the top */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0,
            height: desktopGuideH,
            border: '2px dashed #D9A45C', pointerEvents: 'none',
          }} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
          <span style={{ fontFamily: sans, fontSize: 11, color: colors.muted }}>Zoom</span>
          <input type="range" min="1" max="3" step="0.05" value={scale} onChange={(e) => handleZoom(parseFloat(e.target.value))} style={{ flex: 1 }} />
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button onClick={onCancel} style={cancelBtn}>Cancel</button>
          <button onClick={confirmCrop} disabled={processing} style={{ ...confirmBtn, opacity: processing ? 0.6 : 1 }}>
            {processing ? 'Processing…' : 'Use this photo'}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 };
const panel   = { background: colors.surface || '#161410', border: `1px solid ${colors.border}`, borderRadius: 12, padding: 20, maxWidth: 340 };
const frame   = { position: 'relative', overflow: 'hidden', borderRadius: 8, background: '#000', cursor: 'grab', margin: '0 auto', border: `1px solid ${colors.border}` };
const cancelBtn  = { flex: 1, background: 'transparent', border: `1px solid ${colors.border}`, color: colors.muted, padding: '10px 0', borderRadius: 8, fontFamily: sans, fontSize: 13, cursor: 'pointer' };
const confirmBtn = { flex: 1, background: colors.accent, border: 'none', color: '#1A1714', padding: '10px 0', borderRadius: 8, fontFamily: sans, fontSize: 13, fontWeight: 700, cursor: 'pointer' };