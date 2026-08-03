// studio/src/sections/Selfies.jsx
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { T, S, Card, Eyebrow, Field, colors } from '../ui';

const sans = "'DM Sans', system-ui, sans-serif";
const mono = "'DM Mono', 'Courier New', monospace";

const today = () => new Date().toISOString().slice(0, 10);

async function uploadImage(file) {
  const { uploadUrl, publicUrl } = await api.post('/api/upload/presign', {
    filename: file.name, contentType: file.type, context: 'content',
  });
  const res = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
  if (!res.ok) throw new Error('Upload failed');
  return publicUrl;
}

export function Selfies() {
  const [selfies, setSelfies] = useState([]);
  const [passes,  setPasses]  = useState(0);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');

  const [file,    setFile]    = useState(null);
  const [preview, setPreview] = useState('');
  const [caption, setCaption] = useState('');
  const [date,    setDate]    = useState(today());
  const [posting, setPosting] = useState(false);
  const fileRef = useRef(null);

  const load = () => api.get('/api/studio/selfies')
    .then((d) => { setSelfies(d.selfies || []); setPasses(d.activePasses || 0); });

  useEffect(() => { load().catch((e) => setError(e.message)).finally(() => setLoading(false)); }, []);

  const pick = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const post = async () => {
    setPosting(true); setError(''); setSuccess('');
    try {
      const imageKey = await uploadImage(file);
      await api.post('/api/studio/selfies', { imageKey, caption, selfieDate: date });
      setFile(null); setPreview(''); setCaption(''); setDate(today());
      setSuccess('Posted.');
      load();
    } catch (err) { setError(err.message); } finally { setPosting(false); }
  };

  const toggleVisible = async (s) => {
    setError('');
    try {
      await api.patch(`/api/studio/selfies/${s.id}`, { visible: !s.visible });
      load();
    } catch (err) { setError(err.message); }
  };

  const remove = async (s) => {
    setError('');
    try {
      await api.delete(`/api/studio/selfies/${s.id}`);
      setSuccess('Removed.');
      load();
    } catch (err) { setError(err.message); }
  };

  if (loading) return <T.muted>Loading…</T.muted>;

  const taken = new Set(selfies.map((s) => String(s.selfie_date).slice(0, 10)));
  const clash = taken.has(date);

  return (
    <div>
      <Eyebrow>Selfie of the day</Eyebrow>
      <T.title>Selfies</T.title>

      {error   && <div style={S.error}>{error}</div>}
      {success && <div style={S.success}>{success}</div>}

      <Card style={{ marginBottom: 24 }}>
        <T.sectionTitle>Post today's</T.sectionTitle>
        <p style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginBottom: 14, lineHeight: 1.6 }}>
          One a day. Fans unlock a single one, or hold a pass that covers everything
          posted while it runs. Supreme members see them all at no cost.
        </p>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={pick} />
            {preview
              ? <img src={preview} alt="" onClick={() => fileRef.current?.click()}
                     style={{ width: 150, height: 190, objectFit: 'cover', borderRadius: 8, cursor: 'pointer', border: `1px solid ${colors.border}` }} />
              : <button onClick={() => fileRef.current?.click()}
                        style={{ ...S.ghostBtn, width: 150, height: 190, borderStyle: 'dashed' }}>
                  Choose photo
                </button>}
          </div>

          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={S.formGrid}>
              <Field label="Date">
                <input style={S.input} type="date" value={date} max={today()}
                       onChange={(e) => setDate(e.target.value)} />
              </Field>
            </div>
            {clash && (
              <div style={{ fontFamily: sans, fontSize: 12, color: '#D9A45C', marginTop: 6 }}>
                There's already one for this date.
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              <Field label="Caption — optional, the date shows either way">
                <input style={S.input} value={caption} maxLength={120}
                       onChange={(e) => setCaption(e.target.value)}
                       placeholder="Say something, or leave it" />
              </Field>
            </div>
            <button onClick={post} disabled={posting || !file || clash}
                    style={{ ...S.btn, marginTop: 14, opacity: (posting || !file || clash) ? 0.5 : 1 }}>
              {posting ? 'Posting…' : 'Post it'}
            </button>
          </div>
        </div>
      </Card>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 10 }}>
        <T.sectionTitle>Posted ({selfies.length})</T.sectionTitle>
        {passes > 0 && (
          <span style={{ fontFamily: sans, fontSize: 12, color: colors.accent }}>
            {passes} active pass{passes === 1 ? '' : 'es'}
          </span>
        )}
      </div>

      {selfies.length === 0 ? <T.muted>Nothing posted yet.</T.muted> : (
        <div style={grid}>
          {selfies.map((s) => (
            <div key={s.id} style={{ ...tile, opacity: s.visible ? 1 : 0.45 }}>
              <img src={s.image_key} alt="" loading="lazy" style={thumb} />
              <div style={{ fontFamily: mono, fontSize: 10, color: colors.muted, marginTop: 6 }}>
                {new Date(s.selfie_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                {s.unlocks > 0 && <span style={{ color: colors.accent }}> · {s.unlocks} unlocked</span>}
                {!s.visible && ' · hidden'}
              </div>
              {s.caption && (
                <div style={{ fontFamily: sans, fontSize: 11, color: colors.muted, marginTop: 3, lineHeight: 1.5 }}>
                  {s.caption}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button onClick={() => toggleVisible(s)}
                        style={{ ...S.ghostBtn, fontSize: 10, padding: '4px 8px' }}>
                  {s.visible ? 'Hide' : 'Show'}
                </button>
                <button onClick={() => remove(s)}
                        style={{ ...S.ghostBtn, fontSize: 10, padding: '4px 8px', color: '#D99A9A' }}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const grid  = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 14 };
const tile  = { background: 'rgba(255,255,255,0.02)', border: `1px solid ${colors.border}`, borderRadius: 8, padding: 10 };
const thumb = { width: '100%', aspectRatio: '4/5', objectFit: 'cover', borderRadius: 6, display: 'block' };