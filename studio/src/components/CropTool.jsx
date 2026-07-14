// studio/src/components/CropTool.jsx
// A lightweight, fixed-aspect-ratio crop tool: drag to pan, slider to zoom, no external deps.
import { useEffect, useRef, useState } from 'react';
import { colors } from '../ui';

const sans = "'DM Sans', system-ui, sans-serif";

export default function CropTool({ file, aspectRatio, outputWidth = 800, onCancel, onCropComplete }) {
  const [imgUrl, setImgUrl] = useState('');
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);      // user zoom multiplier on top of the base "cover" scale
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, offX: 0, offY: 0 });
  const imgRef = useRef(null);

  const containerW = 260;
  const containerH = Math.round(containerW / aspectRatio);

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

  // Base scale makes the image fully cover the crop frame (like background-size: cover),
  // scale slider then zooms in further from there.
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

  const confirmCrop = () => {
    setProcessing(true);
    const outH = Math.round(outputWidth / aspectRatio);
    const canvas = document.createElement('canvas');
    canvas.width = outputWidth;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');

    // Map the on-screen crop-frame geometry to the output canvas resolution
    const outScale = outputWidth / containerW;
    const drawW = dispW * outScale;
    const drawH = dispH * outScale;
    const drawX = outputWidth / 2 - drawW / 2 + offset.x * outScale;
    const drawY = outH / 2 - drawH / 2 + offset.y * outScale;

    ctx.drawImage(imgRef.current, drawX, drawY, drawW, drawH);
    canvas.toBlob((blob) => {
      const croppedFile = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
      setProcessing(false);
      onCropComplete(croppedFile);
    }, 'image/jpeg', 0.88);
  };

  return (
    <div style={overlay}>
      <div style={panel}>
        <div style={{ fontFamily: sans, fontSize: 14, color: colors.text, fontWeight: 600, marginBottom: 4 }}>Adjust photo</div>
        <div style={{ fontFamily: sans, fontSize: 11, color: colors.muted, marginBottom: 14 }}>Drag to reposition, use the slider to zoom</div>

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
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
          <span style={{ fontFamily: sans, fontSize: 11, color: colors.muted }}>Zoom</span>
          <input type="range" min="1" max="3" step="0.05" value={scale} onChange={(e) => handleZoom(parseFloat(e.target.value))} style={{ flex: 1 }} />
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button onClick={onCancel} style={cancelBtn}>Cancel</button>
          <button onClick={confirmCrop} disabled={processing} style={{ ...confirmBtn, opacity: processing ? 0.6 : 1 }}>
            {processing ? 'Processing…' : 'Use this crop'}
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