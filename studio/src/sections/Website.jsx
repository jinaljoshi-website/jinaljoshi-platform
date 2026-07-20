// studio/src/sections/Website.jsx
// Manages the public jinaljoshi.in portfolio site — hero slides and works entries
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { T, S, Card, Eyebrow, Field, colors } from '../ui';
import HeroCropTool from '../components/HeroCropTool';

const sans = "'DM Sans', system-ui, sans-serif";

const CATEGORIES = [
  { key: 'films',        label: 'Films' },
  { key: 'web_series',    label: 'Web Series' },
  { key: 'music_videos',  label: 'Music Videos' },
  { key: 'ad_films',      label: 'Ad Films' },
  { key: 'short_films',   label: 'Short Films' },
  { key: 'skits',         label: 'Skits / Short Videos' },
];

async function uploadImage(file) {
  const { uploadUrl, publicUrl } = await api.post('/api/upload/presign', {
    filename: file.name, contentType: file.type, context: 'portfolio',
  });
  await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
  return publicUrl;
}

export function Website() {
  const [slides,  setSlides]  = useState([]);
  const [works,   setWorks]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [uploadingSlide, setUploadingSlide] = useState(false);
  const [heroCropFile, setHeroCropFile] = useState(null);
  const slideFileRef = useRef(null);

  const [activeCategory, setActiveCategory] = useState('films');
  const [newWork, setNewWork] = useState({ title: '', year: '', character: '', watch_now_url: '', trailer_url: '' });
  const [newWorkFile, setNewWorkFile] = useState(null);
  const [newWorkPreview, setNewWorkPreview] = useState('');
  const [savingWork, setSavingWork] = useState(false);
  const newWorkFileRef = useRef(null);

  const [editingWork, setEditingWork] = useState(null);
  const [editForm, setEditForm] = useState({});

  const load = () => Promise.all([
    api.get('/api/studio/portfolio/hero-slides'),
    api.get('/api/studio/portfolio/works'),
  ]).then(([s, w]) => {
    setSlides(s.slides || []);
    setWorks(w.works || []);
  }).finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  // ── Hero slides ──
  const handleSlideFilePick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setHeroCropFile(file);
  };

  const handleHeroCropComplete = async (croppedFile) => {
    setHeroCropFile(null);
    setUploadingSlide(true); setError('');
    try {
      const publicUrl = await uploadImage(croppedFile);
      await api.post('/api/studio/portfolio/hero-slides', { image_key: publicUrl });
      load();
    } catch (err) { setError(err.message); }
    finally { setUploadingSlide(false); }
  };

  const moveSlide = async (slide, direction) => {
    const idx = slides.findIndex((s) => s.id === slide.id);
    const swapWith = slides[idx + direction];
    if (!swapWith) return;
    await Promise.all([
      api.patch(`/api/studio/portfolio/hero-slides/${slide.id}`, { position: swapWith.position }),
      api.patch(`/api/studio/portfolio/hero-slides/${swapWith.id}`, { position: slide.position }),
    ]);
    load();
  };

  const deleteSlide = async (id) => {
    await api.delete(`/api/studio/portfolio/hero-slides/${id}`);
    load();
  };

  // ── Works ──
  const worksInCategory = works.filter((w) => w.category === activeCategory);

  const handleNewWorkFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setNewWorkFile(file);
    setNewWorkPreview(URL.createObjectURL(file));
  };

  const handleAddWork = async () => {
    if (!newWork.title.trim()) return;
    setSavingWork(true); setError('');
    try {
      let imageKey = null;
      if (newWorkFile) imageKey = await uploadImage(newWorkFile);
      await api.post('/api/studio/portfolio/works', { category: activeCategory, ...newWork, image_key: imageKey });
      setNewWork({ title: '', year: '', character: '', watch_now_url: '', trailer_url: '' });
      setNewWorkFile(null); setNewWorkPreview('');
      load();
    } catch (err) { setError(err.message); }
    finally { setSavingWork(false); }
  };

  const startEdit = (work) => { setEditingWork(work.id); setEditForm({ ...work }); };

  const handleSaveEdit = async (id) => {
    await api.patch(`/api/studio/portfolio/works/${id}`, editForm);
    setEditingWork(null);
    load();
  };

  const moveWork = async (work, direction) => {
    const list = works.filter((w) => w.category === work.category);
    const idx = list.findIndex((w) => w.id === work.id);
    const swapWith = list[idx + direction];
    if (!swapWith) return;
    await Promise.all([
      api.patch(`/api/studio/portfolio/works/${work.id}`, { position: swapWith.position }),
      api.patch(`/api/studio/portfolio/works/${swapWith.id}`, { position: work.position }),
    ]);
    load();
  };

  const deleteWork = async (id) => {
    await api.delete(`/api/studio/portfolio/works/${id}`);
    load();
  };

  if (loading) return <T.muted>Loading website content…</T.muted>;

  return (
    <div>
      <Eyebrow>jinaljoshi.in</Eyebrow>
      <T.title>Website content</T.title>

      {error && <div style={S.error}>{error}</div>}

      {/* Hero slides */}
      <Card style={{ marginBottom: 28 }}>
        <T.sectionTitle>Hero slideshow</T.sectionTitle>
        <p style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginBottom: 14 }}>
          Photos shown in rotation on the homepage. Use the arrows to reorder.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          {slides.map((slide, i) => (
            <div key={slide.id} style={{ position: 'relative' }}>
              <img src={slide.image_key} alt="" style={{ width: 90, height: 120, objectFit: 'cover', borderRadius: 6, border: `1px solid ${colors.border}` }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <button onClick={() => moveSlide(slide, -1)} disabled={i === 0} style={miniBtn}>←</button>
                <button onClick={() => deleteSlide(slide.id)} style={{ ...miniBtn, color: '#D99A9A' }}>✕</button>
                <button onClick={() => moveSlide(slide, 1)} disabled={i === slides.length - 1} style={miniBtn}>→</button>
              </div>
            </div>
          ))}
        </div>
        <input ref={slideFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleSlideFilePick} />
        <button onClick={() => slideFileRef.current?.click()} disabled={uploadingSlide} style={{ ...S.btn, opacity: uploadingSlide ? 0.5 : 1 }}>
          {uploadingSlide ? 'Uploading…' : '+ Add photo'}
        </button>
      </Card>

      {heroCropFile && (
        <HeroCropTool
          file={heroCropFile}
          onCancel={() => setHeroCropFile(null)}
          onCropComplete={handleHeroCropComplete}
        />
      )}

      {/* Works */}
      <Card>
        <T.sectionTitle>Works</T.sectionTitle>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20, borderBottom: `1px solid ${colors.border}`, paddingBottom: 16 }}>
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              onClick={() => setActiveCategory(c.key)}
              style={{
                background: activeCategory === c.key ? 'rgba(193,125,74,0.12)' : 'transparent',
                border: activeCategory === c.key ? '1px solid rgba(193,125,74,0.3)' : `1px solid ${colors.border}`,
                color: activeCategory === c.key ? colors.accent : colors.muted,
                fontFamily: sans, fontSize: 13, padding: '7px 14px', borderRadius: 999, cursor: 'pointer',
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Add new work */}
        <div style={{ background: '#0D0C0A', border: `1px solid ${colors.border}`, borderRadius: 8, padding: 16, marginBottom: 20 }}>
          <div style={S.formGrid}>
            <Field label="Title"><input style={S.input} value={newWork.title} onChange={(e) => setNewWork({ ...newWork, title: e.target.value })} /></Field>
            <Field label="Year"><input style={S.input} value={newWork.year} onChange={(e) => setNewWork({ ...newWork, year: e.target.value })} /></Field>
            <Field label="Character (optional)"><input style={S.input} value={newWork.character} onChange={(e) => setNewWork({ ...newWork, character: e.target.value })} /></Field>
            <Field label="Watch Now link"><input style={S.input} value={newWork.watch_now_url} onChange={(e) => setNewWork({ ...newWork, watch_now_url: e.target.value })} /></Field>
            <Field label="Trailer link (optional)"><input style={S.input} value={newWork.trailer_url} onChange={(e) => setNewWork({ ...newWork, trailer_url: e.target.value })} /></Field>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
            <input ref={newWorkFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleNewWorkFile} />
            <button onClick={() => newWorkFileRef.current?.click()} style={S.ghostBtn}>Browse poster</button>
            {newWorkPreview && <img src={newWorkPreview} alt="" style={{ width: 48, height: 64, objectFit: 'cover', borderRadius: 4 }} />}
            <button onClick={handleAddWork} disabled={savingWork || !newWork.title.trim()} style={{ ...S.btn, opacity: (savingWork || !newWork.title.trim()) ? 0.5 : 1 }}>
              {savingWork ? 'Adding…' : `+ Add to ${CATEGORIES.find((c) => c.key === activeCategory)?.label}`}
            </button>
          </div>
        </div>

        {/* Existing entries */}
        <div style={{ display: 'grid', gap: 10 }}>
          {worksInCategory.length === 0 && <T.muted>Nothing added to this category yet.</T.muted>}
          {worksInCategory.map((work, i) => (
            <div key={work.id} style={S.card}>
              {editingWork === work.id ? (
                <div>
                  <div style={S.formGrid}>
                    <Field label="Title"><input style={S.input} value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} /></Field>
                    <Field label="Year"><input style={S.input} value={editForm.year || ''} onChange={(e) => setEditForm({ ...editForm, year: e.target.value })} /></Field>
                    <Field label="Character"><input style={S.input} value={editForm.character || ''} onChange={(e) => setEditForm({ ...editForm, character: e.target.value })} /></Field>
                    <Field label="Watch Now"><input style={S.input} value={editForm.watch_now_url || ''} onChange={(e) => setEditForm({ ...editForm, watch_now_url: e.target.value })} /></Field>
                    <Field label="Trailer"><input style={S.input} value={editForm.trailer_url || ''} onChange={(e) => setEditForm({ ...editForm, trailer_url: e.target.value })} /></Field>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button onClick={() => handleSaveEdit(work.id)} style={S.btn}>Save</button>
                    <button onClick={() => setEditingWork(null)} style={S.ghostBtn}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  {work.image_key && <img src={work.image_key} alt="" style={{ width: 48, height: 64, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />}
                  <div style={{ flex: 1 }}>
                    <div style={S.rowTitle}>{work.title}</div>
                    <div style={S.rowSub}>{[work.year, work.character].filter(Boolean).join(' · ')}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button onClick={() => moveWork(work, -1)} disabled={i === 0} style={miniBtn}>↑</button>
                    <button onClick={() => moveWork(work, 1)} disabled={i === worksInCategory.length - 1} style={miniBtn}>↓</button>
                    <button onClick={() => startEdit(work)} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 10px' }}>Edit</button>
                    <button onClick={() => deleteWork(work.id)} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 10px', color: '#D99A9A' }}>Delete</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

const miniBtn = { background: 'transparent', border: `1px solid ${colors.border}`, color: colors.muted, fontSize: 12, padding: '4px 8px', borderRadius: 6, cursor: 'pointer' };