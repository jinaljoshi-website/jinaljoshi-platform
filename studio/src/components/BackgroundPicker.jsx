// studio/src/components/BackgroundPicker.jsx
// Setting the wallpaper for a room, from inside that room.
//
// This lived in Settings, which is now behind the admin door — so changing the
// background of a conversation meant leaving it, going through an admin screen,
// and coming back. Nobody walks to another building to move a picture.
import { useRef, useState } from 'react';
import { api } from '../api';
import { S, colors } from '../ui';
import CropTool from './CropTool';

const sans = "'DM Sans', system-ui, sans-serif";

async function uploadToR2(file, context, apiInstance) {
  const { uploadUrl, publicUrl } = await apiInstance.post('/api/upload/presign', {
    filename: file.name, contentType: file.type, context,
  });
  await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
  return publicUrl;
}

export default function BackgroundPicker({ type, current, onChange, label }) {
  const [cropFile, setCropFile] = useState(null);
  const [busy,     setBusy]     = useState(false);
  const [note,     setNote]     = useState('');
  const [error,    setError]    = useState('');
  const fileRef = useRef(null);

  const pick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(''); setNote('');
    setCropFile(file);
  };

  const cropped = async (file) => {
    setCropFile(null); setBusy(true); setError(''); setNote('');
    try {
      const publicUrl = await uploadToR2(file, 'background', api);
      await api.post('/api/upload/confirm-background', { publicUrl, type });
      onChange?.(publicUrl);
      setNote('Live now.');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true); setError(''); setNote('');
    try {
      // A genuine null, not an empty string — an empty string reads as
      // "present" to the COALESCE on the other side and defeats the fallback.
      await api.post('/api/studio/chat-bg', { type, value: null });
      onChange?.(null);
      setNote('Removed.');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div style={row}>
      {current
        ? <img src={current} alt="" style={thumb} />
        : <div style={{ ...thumb, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: sans, fontSize: 9, color: colors.muted }}>none</div>}

      <div style={{ flex: 1, minWidth: 140 }}>
        <div style={{ fontFamily: sans, fontSize: 12, color: colors.text }}>{label}</div>
        <div style={{ fontFamily: sans, fontSize: 11, color: error ? '#D99A9A' : colors.muted, marginTop: 2 }}>
          {error || note || (current ? 'Tap to change' : 'Add one to give the room its own look')}
        </div>
      </div>

      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={pick} />
      <button onClick={() => fileRef.current?.click()} disabled={busy}
              style={{ ...S.ghostBtn, fontSize: 11, padding: '6px 12px', opacity: busy ? 0.5 : 1 }}>
        {busy ? '…' : current ? 'Change' : 'Add'}
      </button>
      {current && (
        <button onClick={remove} disabled={busy}
                style={{ ...S.ghostBtn, fontSize: 11, padding: '6px 12px', color: '#D99A9A' }}>
          Remove
        </button>
      )}

      {cropFile && (
        <CropTool
          file={cropFile}
          aspectRatio={type === 'community' ? 16 / 9 : 9 / 16}
          outputWidth={type === 'community' ? 900 : 720}
          onCancel={() => setCropFile(null)}
          onCropComplete={cropped}
        />
      )}
    </div>
  );
}

const row   = { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                background: 'rgba(255,255,255,0.02)', border: `1px solid ${colors.border}`,
                borderRadius: 10, padding: '10px 14px', marginBottom: 14 };
const thumb = { width: 34, height: 52, objectFit: 'cover', borderRadius: 5, flexShrink: 0,
                border: `1px solid ${colors.border}` };