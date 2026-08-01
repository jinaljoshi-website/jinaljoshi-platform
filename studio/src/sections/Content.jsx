// studio/src/sections/Content.jsx
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { T, S, Card, Eyebrow, Field, TokenField, colors } from '../ui';

const TOKEN_RATE   = 66;
const MAX_IMG_PX   = 2048;
const JPEG_Q       = 0.85;
const MAX_VIDEO_MB = 500;
const R2_PUBLIC_URL = import.meta.env.VITE_R2_PUBLIC_URL || '';

const CATEGORIES = [
  { key: 'free',          label: 'Free',           color: '#8FC88F' },
  { key: 'community',     label: 'Community',      color: '#9B8F83' },
  { key: 'insider',       label: 'Insider',        color: '#C17D4A' },
  { key: 'premium',       label: 'Premium',        color: '#D9A45C' },
  { key: 'supreme',       label: 'Supreme',        color: '#EBC49A' },
  { key: 'purchase_only', label: 'Purchase-only',  color: '#D99A9A' },
];

// Content categories — what KIND of set this is, shown to fans for browsing.
// Fully separate from the tier categories above, which govern pricing/access.
const CONTENT_CATEGORIES = [
  { key: 'behind_the_scenes', label: 'Behind-the-Scenes' },
  { key: 'vlog_style',        label: 'Vlog-Style' },
  { key: 'photos_videos',     label: 'Photos & Videos' },
];

const sans    = "'DM Sans', system-ui, sans-serif";
const mono    = "'DM Mono', 'Courier New', monospace";
const display = "'Cormorant Garamond', Georgia, serif";

function toUrl(key) {
  if (!key) return null;
  if (key.startsWith('http')) return key;
  return `${R2_PUBLIC_URL}/${key}`;
}

// How many files move at once. Most of the time per file is spent waiting on two
// round trips to the backend, not transferring bytes — so running several in
// parallel fills that dead time. Capped at 5: beyond that a home upload
// connection saturates and requests start timing out, which is worse than slow.
const UPLOAD_CONCURRENCY = 5;
const UPLOAD_RETRIES     = 2;

// createImageBitmap decodes off the main thread and is hardware-accelerated,
// so it is several times faster than the old Image + canvas.drawImage path and
// does not freeze the tab while a large photo is processed.
async function compressImage(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale  = Math.min(1, MAX_IMG_PX / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h });
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob = canvas.convertToBlob
      ? await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_Q })
      : await new Promise((res) => canvas.toBlob(res, 'image/jpeg', JPEG_Q));

    return new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
  } catch {
    // Some formats (HEIC on older browsers) cannot be decoded this way. Sending
    // the original is better than failing the upload.
    return file;
  }
}

async function uploadFile(file, context = 'content') {
  const { uploadUrl, publicUrl } = await api.post('/api/upload/presign', {
    filename: file.name, contentType: file.type, context,
  });
  const res = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
  // A failed PUT used to pass silently, leaving a database row pointing at an
  // object that was never stored — a broken image with no error anywhere.
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  return publicUrl;
}

// A transient network blip should not permanently cost a photo.
async function withRetry(fn, attempts = UPLOAD_RETRIES) {
  let lastErr;
  for (let n = 0; n <= attempts; n++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      if (n < attempts) await new Promise((r) => setTimeout(r, 600 * (n + 1)));
    }
  }
  throw lastErr;
}

// Runs tasks with a fixed number in flight. Workers pull from a shared index, so
// a slow file holds up only itself rather than a whole batch.
async function runPool(tasks, limit, onEach) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const i = next++;
      await tasks[i]();
      onEach?.();
    }
  });
  await Promise.all(workers);
}

function emptyCategoryFiles() {
  const obj = {};
  CATEGORIES.forEach((c) => { obj[c.key] = []; });
  return obj;
}

export function Content() {
  const [sets,    setSets]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');

  const [form, setForm] = useState({ title: '', description: '', price_coins: '0', visible: false, category: CONTENT_CATEGORIES[0].key });

  const [filesByCategory, setFilesByCategory] = useState(emptyCategoryFiles());
  const [coverFile,      setCoverFile]      = useState(null);
  const [coverPreview,   setCoverPreview]   = useState('');
  const [creating,       setCreating]       = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [editing,        setEditing]        = useState(null);
  const [editForm,       setEditForm]       = useState({});
  const [deleting,       setDeleting]       = useState(null);
  const [confirmDelete,  setConfirmDelete]  = useState(null);

  const coverRef = useRef(null);
  const categoryRefs = useRef({});

  const loadSets = () => api.get('/api/studio/content').then((d) => setSets(d.sets || []));

  useEffect(() => { loadSets().finally(() => setLoading(false)); }, []);

  const totalFileCount = Object.values(filesByCategory).reduce((sum, arr) => sum + arr.length, 0);

  // Reviewing an existing set: its actual items, loaded on demand.
  const [reviewSet,     setReviewSet]     = useState(null);
  const [reviewItems,   setReviewItems]   = useState([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [deletingItem,  setDeletingItem]  = useState(null);
  const [lightbox,      setLightbox]      = useState(null);

  // Adding to a set that already exists — the recovery path when an upload was
  // interrupted, and the normal way to extend a set later.
  const [addingTo, setAddingTo] = useState(null);

  // Storage housekeeping. Deleting a photo now clears the file too, but years of
  // earlier deletions left objects behind, and a failed cleanup can still leave one.
  const [storage,  setStorage]  = useState(null);
  const [scanning, setScanning] = useState(false);
  const [purging,  setPurging]  = useState(false);

  const scanStorage = async () => {
    setScanning(true); setError(''); setStorage(null);
    try { setStorage(await api.get('/api/studio/storage/orphans')); }
    catch (err) { setError(err.message); } finally { setScanning(false); }
  };

  // One category at a time. Stranded uploads are plainly waste; replaced
  // portfolio images are public marketing files. A single button would force
  // those two very different judgements into one decision.
  const purgeStorage = async (prefix) => {
    setPurging(prefix);
    setError('');
    try {
      const d = await api.post('/api/studio/storage/orphans/purge', { prefixes: [prefix] });
      setSuccess(d.message);
      setStorage(await api.get('/api/studio/storage/orphans'));
    } catch (err) { setError(err.message); } finally { setPurging(null); }
  };

  // An upload in progress is the one thing worth interrupting a tab close for.
  useEffect(() => {
    if (!uploadProgress) return;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [uploadProgress]);

  const handleAddToSet = async (set) => {
    setError(''); setSuccess(''); setCreating(true);
    try {
      const existing = Object.values(set.categoryCounts || {}).reduce((a, b) => a + b, 0);
      const { uploaded, failed, firstImageUrl } = await uploadAllPending(set.id, existing);

      if (!set.cover_key && firstImageUrl) {
        await api.patch(`/api/studio/content/${set.id}`, { cover_key: firstImageUrl });
      }
      setUploadProgress('');
      setSuccess(failed
        ? `Added ${uploaded}. ${failed} failed — the ones still showing an error can be retried.`
        : `Added ${uploaded} item${uploaded === 1 ? '' : 's'} to "${set.title}".`);

      if (!failed) {
        setFilesByCategory(emptyCategoryFiles());
        setAddingTo(null);
      }
      loadSets();
    } catch (err) {
      setError(err.message);
      setUploadProgress('');
    } finally { setCreating(false); }
  };

  const openReview = async (set) => {
    setReviewSet(set); setReviewItems([]); setReviewLoading(true); setError('');
    try {
      const d = await api.get(`/api/studio/content/${set.id}/items`);
      setReviewItems(d.items || []);
    } catch (err) { setError(err.message); } finally { setReviewLoading(false); }
  };

  const deleteItem = async (item, opts = {}) => {
    setDeletingItem(item.id); setError('');
    try {
      const d = await api.delete(`/api/studio/content/item/${item.id}`);
      setReviewItems((prev) => prev.filter((i) => i.id !== item.id));
      setSets((prev) => prev.map((s) => s.id === item.set_id
        ? { ...s, categoryCounts: { ...s.categoryCounts, [item.tier_category]: Math.max(0, (s.categoryCounts?.[item.tier_category] || 1) - 1) } }
        : s));
      setSuccess(`Removed. ${d.remaining} item${d.remaining === 1 ? '' : 's'} left in this set.`);
      // Deleting from the large view keeps you in it — the reviewer decides where
      // to land next, since the indexes shift underneath.
      if (!opts.keepLightbox) setLightbox(null);
    } catch (err) { setError(err.message); } finally { setDeletingItem(null); }
  };

  const retierItem = async (item, tierCategory) => {
    setError('');
    try {
      const d = await api.patch(`/api/studio/content/item/${item.id}`, { tierCategory });
      setReviewItems((prev) => prev.map((i) => i.id === item.id ? d.item : i));
      setSuccess('Moved.');
    } catch (err) { setError(err.message); }
  };

  const handleCategoryFilePick = (categoryKey, e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    const newFiles = picked.map((f) => ({
      file: f,
      preview:  f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
      isVideo:  f.type.startsWith('video/'),
      status:   'pending',
      publicUrl: null,
      sizeMB:   (f.size / 1024 / 1024).toFixed(1),
    }));
    setFilesByCategory((prev) => ({ ...prev, [categoryKey]: [...prev[categoryKey], ...newFiles] }));
  };

  const removeFile = (categoryKey, idx) => {
    setFilesByCategory((prev) => {
      const updated = { ...prev, [categoryKey]: [...prev[categoryKey]] };
      if (updated[categoryKey][idx].preview) URL.revokeObjectURL(updated[categoryKey][idx].preview);
      updated[categoryKey].splice(idx, 1);
      return updated;
    });
  };

  const handleCoverPick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = '';
    setCoverFile(f);
    setCoverPreview(URL.createObjectURL(f));
  };

  // Shared by set creation and by adding to an existing set. Uploads run several
  // at a time and each file is retried, so a blip costs a moment rather than a
  // photo. Every file that lands is saved immediately, so an interrupted run
  // leaves a valid set that can simply be topped up.
  const uploadAllPending = async (setId, startPosition) => {
    const queue = [];
    CATEGORIES.forEach((cat) => {
      (filesByCategory[cat.key] || []).forEach((item, i) => {
        if (item.status === 'done') return;
        queue.push({ cat: cat.key, catLabel: cat.label, i, item });
      });
    });

    const total = queue.length;
    let done = 0;
    let firstImageUrl = null;
    let uploaded = 0;

    const mark = (cat, i, patch) => setFilesByCategory((prev) => {
      const upd = { ...prev, [cat]: [...prev[cat]] };
      upd[cat][i] = { ...upd[cat][i], ...patch };
      return upd;
    });

    const tasks = queue.map(({ cat, i, item }, n) => async () => {
      if (item.isVideo && parseFloat(item.sizeMB) > MAX_VIDEO_MB) {
        mark(cat, i, { status: 'skipped', error: `File too large (max ${MAX_VIDEO_MB}MB)` });
        return;
      }
      mark(cat, i, { status: 'uploading' });
      try {
        const publicUrl = await withRetry(async () => {
          const fileToUpload = item.isVideo ? item.file : await compressImage(item.file);
          return uploadFile(fileToUpload, 'content');
        });
        await withRetry(() => api.post('/api/studio/content/item', {
          setId, type: item.isVideo ? 'video' : 'image', r2Key: publicUrl,
          position: startPosition + n, tierCategory: cat,
        }));
        if (!firstImageUrl && !item.isVideo) firstImageUrl = publicUrl;
        uploaded += 1;
        mark(cat, i, { status: 'done', publicUrl });
      } catch (err) {
        mark(cat, i, { status: 'error', error: err.message });
      }
    });

    await runPool(tasks, UPLOAD_CONCURRENCY, () => {
      done += 1;
      setUploadProgress(`Uploaded ${done} of ${total}…`);
    });

    return { uploaded, firstImageUrl, failed: total - uploaded };
  };

  const handleCreate = async () => {
    setError(''); setSuccess(''); setCreating(true);
    try {
      const setData = await api.post('/api/studio/content', {
        title:       form.title,
        description: form.description || null,
        price_coins: parseInt(form.price_coins) || 0,
        visible:     form.visible,
        category:    form.category,
      });
      const setId = setData.set.id;

      let coverUrl = null;
      if (coverFile) {
        setUploadProgress('Uploading cover image…');
        const compressed = await compressImage(coverFile);
        coverUrl = await uploadFile(compressed, 'content');
        await api.patch(`/api/studio/content/${setId}`, { cover_key: coverUrl });
      }

      const { uploaded, firstImageUrl } = await uploadAllPending(setId, 0);
      if (!coverUrl && firstImageUrl) {
        coverUrl = firstImageUrl;
        await api.patch(`/api/studio/content/${setId}`, { cover_key: firstImageUrl });
      }
      const position = uploaded;

      setUploadProgress('');
      setSuccess(`"${form.title}" created with ${position} item${position !== 1 ? 's' : ''}.`);
      setSets((prev) => [{ ...setData.set, cover_url: coverUrl }, ...prev]);
      setForm({ title: '', description: '', price_coins: '0', visible: false, category: CONTENT_CATEGORIES[0].key });
      setFilesByCategory(emptyCategoryFiles());
      setCoverFile(null);
      setCoverPreview('');
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
      setUploadProgress('');
    }
  };

  const startEdit = (set) => {
    setEditing(set.id);
    setEditForm({ title: set.title, description: set.description || '', price_coins: set.price_coins, visible: set.visible, category: set.category || CONTENT_CATEGORIES[0].key });
  };

  const handleUpdate = async (id) => {
    setError('');
    try {
      const data = await api.patch(`/api/studio/content/${id}`, { ...editForm, price_coins: parseInt(editForm.price_coins) });
      setSets((prev) => prev.map((s) => s.id === id ? { ...data.set, cover_url: s.cover_url, categoryCounts: s.categoryCounts } : s));
      setEditing(null);
      setSuccess('Updated.');
    } catch (err) { setError(err.message); }
  };

  const handleDelete = async (setId) => {
    setDeleting(setId);
    setError('');
    try {
      await api.post(`/api/studio/content/${setId}/delete`, {});
      setSets((prev) => prev.filter((s) => s.id !== setId));
      setConfirmDelete(null);
      setSuccess('Set deleted.');
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(null);
    }
  };

  if (loading) return <T.muted>Loading content…</T.muted>;

  const canCreate = form.title.trim() && !creating && totalFileCount > 0;

  return (
    <div>
      <Eyebrow>Content</Eyebrow>
      <T.title>Upload & manage</T.title>

      {error   && <div style={S.error}>{error}</div>}
      {success && <div style={S.success}>{success}</div>}

      {/* ── Create form ── */}
      <Card style={{ marginBottom: 28 }}>
        <T.sectionTitle>New content</T.sectionTitle>
        <p style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginBottom: 16, lineHeight: 1.6 }}>
          Upload photos/videos into whichever category buckets they belong to below. One base price covers the whole set — each membership tier's price and any upsell for higher-tier or purchase-only content is calculated automatically.
        </p>

        <div style={S.formGrid}>
          <Field label="Title">
            <input style={S.input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Behind the scenes — June shoot" />
          </Field>
          <TokenField label="Base price for the full set (tokens)" value={form.price_coins} onChange={(v) => setForm({ ...form, price_coins: v })} tokenRateInr={TOKEN_RATE} />
        </div>

        <div style={{ marginTop: 16 }}>
          <Field label="Content category — how this set is browsed by fans">
            <select style={S.input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CONTENT_CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
          </Field>
        </div>

        <div style={{ marginTop: 16, marginBottom: 20 }}>
          <div style={fieldLabel}>Description (shown to fans in gallery)</div>
          <textarea
            style={{ ...S.input, resize: 'vertical', minHeight: 72, lineHeight: 1.6 }}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="A short description of what's in this set…"
            rows={3}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={fieldLabel}>Cover image (optional — first uploaded photo used if not set)</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <input ref={coverRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleCoverPick} />
            <button onClick={() => coverRef.current?.click()} style={S.ghostBtn}>Browse cover photo</button>
            {coverPreview && (
              <div style={{ position: 'relative' }}>
                <img src={coverPreview} alt="cover" style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 6, border: `1px solid ${colors.border}` }} />
                <button onClick={() => { setCoverFile(null); setCoverPreview(''); }} style={removeBtn}>✕</button>
              </div>
            )}
          </div>
        </div>

        {/* Category-tagged upload zones */}
        <div style={{ marginBottom: 16 }}>
          <div style={fieldLabel}>
            Media by tier ({totalFileCount} {totalFileCount === 1 ? 'item' : 'items'})
          </div>
          <p style={{ fontFamily: sans, fontSize: 11, color: colors.muted, marginBottom: 10, lineHeight: 1.5 }}>
            A set is either tier-segmented (Free through Supreme) or Purchase-only, never both — adding a file to one side locks the other, so the base price never gets split unexpectedly.
          </p>
          <div style={{ display: 'grid', gap: 14 }}>
            {CATEGORIES.map((cat) => {
              const files = filesByCategory[cat.key];
              const isPurchaseOnly = cat.key === 'purchase_only';
              const tierCategoriesHaveFiles = CATEGORIES.filter((c) => c.key !== 'purchase_only').some((c) => filesByCategory[c.key].length > 0);
              const purchaseOnlyHasFiles = filesByCategory.purchase_only.length > 0;
              const isLocked = isPurchaseOnly ? tierCategoriesHaveFiles : purchaseOnlyHasFiles;

              return (
                <div key={cat.key} style={{ border: `1px solid ${colors.border}`, borderRadius: 8, padding: 12, opacity: isLocked ? 0.4 : 1, pointerEvents: isLocked ? 'none' : 'auto' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: files.length > 0 ? 10 : 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: cat.color, display: 'inline-block' }} />
                      <span style={{ fontFamily: sans, fontSize: 13, color: colors.text, fontWeight: 600 }}>{cat.label}</span>
                      <span style={{ fontFamily: sans, fontSize: 11, color: colors.muted }}>({files.length})</span>
                      {isLocked && <span style={{ fontFamily: sans, fontSize: 10, color: '#D99A9A' }}>— unavailable for this set</span>}
                    </div>
                    <input
                      ref={(el) => { categoryRefs.current[cat.key] = el; }}
                      type="file" accept="image/*,video/*" multiple style={{ display: 'none' }}
                      onChange={(e) => handleCategoryFilePick(cat.key, e)}
                    />
                    <button
                      onClick={() => categoryRefs.current[cat.key]?.click()}
                      disabled={isLocked}
                      style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 10px', opacity: isLocked ? 0.5 : 1 }}
                    >
                      + Add {cat.label}
                    </button>
                  </div>
                  {files.length > 0 && (
                    <div style={fileGrid}>
                      {files.map((f, i) => (
                        <div key={i} style={{ ...fileCard, borderColor: f.status === 'done' ? 'rgba(100,160,100,0.4)' : f.status === 'error' ? 'rgba(156,90,90,0.4)' : colors.border }}>
                          {f.preview
                            ? <img src={f.preview} alt="" style={{ width: '100%', height: 60, objectFit: 'cover', borderRadius: 4, marginBottom: 4 }} />
                            : <div style={{ width: '100%', height: 60, background: 'rgba(255,255,255,0.03)', borderRadius: 4, marginBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🎬</div>
                          }
                          <div style={{ fontFamily: sans, fontSize: 9, color: colors.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file.name}</div>
                          <div style={{ fontFamily: sans, fontSize: 9, color: f.status === 'done' ? '#8FC88F' : f.status === 'error' ? '#D99A9A' : colors.muted }}>
                            {f.status === 'done' ? '✓' : f.status === 'error' ? `✗ ${f.error || 'Failed'}` : f.status === 'skipped' ? '⚠ Skipped' : `${f.sizeMB}MB`}
                          </div>
                          {f.status === 'pending' && (
                            <button onClick={() => removeFile(cat.key, i)} style={{ ...removeBtn, position: 'relative', top: 'auto', right: 'auto', marginTop: 3, width: '100%', fontSize: 9 }}>Remove</button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {uploadProgress && (
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: colors.accent, marginBottom: 12, padding: '8px 12px', background: 'rgba(193,125,74,0.08)', borderRadius: 6 }}>
            {uploadProgress}
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <label style={{ fontFamily: sans, fontSize: 13, color: colors.muted, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.visible} onChange={(e) => setForm({ ...form, visible: e.target.checked })} />
            Publish immediately
          </label>
          <button onClick={handleCreate} disabled={!canCreate} style={{ ...S.btn, opacity: !canCreate ? 0.5 : 1 }}>
            {creating ? uploadProgress || 'Creating…' : 'Create set'}
          </button>
        </div>
      </Card>

      {/* ── Content list ── */}
      <T.sectionTitle>All content ({sets.length})</T.sectionTitle>
      <div style={{ display: 'grid', gap: 10 }}>
        {sets.length === 0 && <T.muted>No content yet.</T.muted>}
        {sets.map((set) => {
          const counts = set.categoryCounts || {};
          const summary = CATEGORIES
            .filter((c) => counts[c.key] > 0)
            .map((c) => `${counts[c.key]} ${c.label}`)
            .join(' · ');
          const contentCatLabel = CONTENT_CATEGORIES.find((c) => c.key === set.category)?.label;
          return (
            <div key={set.id} style={S.card}>
              {addingTo === set.id && (
                <div style={addPanel}>
                  <div style={{ fontFamily: sans, fontSize: 13, color: colors.text, marginBottom: 4 }}>
                    Add photos to "{set.title}"
                  </div>
                  <div style={{ fontFamily: sans, fontSize: 11, color: colors.muted, marginBottom: 12, lineHeight: 1.6 }}>
                    New items are appended to the tier you choose. Existing items are untouched, so
                    this is also how you finish a set whose upload was interrupted.
                  </div>
                  <div style={{ display: 'grid', gap: 10 }}>
                    {CATEGORIES.filter((cat) => {
                      // Respect the same lock as creation: a set is tier-segmented
                      // or purchase-only, never both.
                      const hasPurchase = (counts.purchase_only || 0) > 0;
                      const hasTiered   = CATEGORIES.some((c2) => c2.key !== 'purchase_only' && counts[c2.key] > 0);
                      if (hasPurchase) return cat.key === 'purchase_only';
                      if (hasTiered)   return cat.key !== 'purchase_only';
                      return true;
                    }).map((cat) => (
                      <div key={cat.key} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <input
                          ref={(el) => { categoryRefs.current[`add-${set.id}-${cat.key}`] = el; }}
                          type="file" accept="image/*,video/*" multiple style={{ display: 'none' }}
                          onChange={(e) => handleCategoryFilePick(cat.key, e)}
                        />
                        <button onClick={() => categoryRefs.current[`add-${set.id}-${cat.key}`]?.click()}
                                style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 10px', minWidth: 130, textAlign: 'left' }}>
                          + Add {cat.label}
                        </button>
                        <span style={{ fontFamily: sans, fontSize: 11, color: colors.muted }}>
                          {counts[cat.key] || 0} already · {(filesByCategory[cat.key] || []).length} queued
                        </span>
                      </div>
                    ))}
                  </div>

                  {uploadProgress && (
                    <div style={{ fontFamily: mono, fontSize: 12, color: colors.accent, marginTop: 12 }}>{uploadProgress}</div>
                  )}

                  <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                    <button onClick={() => handleAddToSet(set)}
                            disabled={creating || totalFileCount === 0}
                            style={{ ...S.btn, opacity: (creating || totalFileCount === 0) ? 0.5 : 1 }}>
                      {creating ? 'Uploading…' : `Upload ${totalFileCount} item${totalFileCount === 1 ? '' : 's'}`}
                    </button>
                    <button onClick={() => { setAddingTo(null); setFilesByCategory(emptyCategoryFiles()); }}
                            disabled={creating} style={S.ghostBtn}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {confirmDelete === set.id ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontFamily: sans, fontSize: 14, color: '#D99A9A' }}>
                    Delete <strong>"{set.title}"</strong>? This will permanently remove the set and all items. Cannot be undone.
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={() => handleDelete(set.id)} disabled={deleting === set.id} style={{ ...S.btn, background: '#8B3A3A', opacity: deleting === set.id ? 0.6 : 1 }}>
                      {deleting === set.id ? 'Deleting…' : 'Yes, delete permanently'}
                    </button>
                    <button onClick={() => setConfirmDelete(null)} style={S.ghostBtn}>Cancel</button>
                  </div>
                </div>
              ) : editing === set.id ? (
                <div>
                  <div style={S.formGrid}>
                    <Field label="Title">
                      <input style={S.input} value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
                    </Field>
                    <TokenField label="Base price (tokens)" value={editForm.price_coins} onChange={(v) => setEditForm({ ...editForm, price_coins: v })} tokenRateInr={TOKEN_RATE} />
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <Field label="Content category">
                      <select style={S.input} value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}>
                        {CONTENT_CATEGORIES.map((c) => (
                          <option key={c.key} value={c.key}>{c.label}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div style={{ margin: '12px 0' }}>
                    <div style={fieldLabel}>Description</div>
                    <textarea
                      style={{ ...S.input, resize: 'vertical', minHeight: 60, lineHeight: 1.6 }}
                      value={editForm.description || ''}
                      onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                      rows={2}
                    />
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <button onClick={() => openReview(set)} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px' }}>
                      Review photos in this set
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <label style={{ fontFamily: sans, fontSize: 13, color: colors.muted, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input type="checkbox" checked={editForm.visible} onChange={(e) => setEditForm({ ...editForm, visible: e.target.checked })} />
                      Visible
                    </label>
                    <button onClick={() => handleUpdate(set.id)} style={S.btn}>Save</button>
                    <button onClick={() => setEditing(null)} style={S.ghostBtn}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  {(set.cover_url || set.cover_key) && (
                    <img src={set.cover_url || toUrl(set.cover_key)} alt="" style={{ width: 60, height: 50, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <div style={S.rowTitle}>{set.title}</div>
                      {contentCatLabel && (
                        <span style={{ fontFamily: sans, fontSize: 10, color: colors.accent, background: 'rgba(193,125,74,0.1)', border: '1px solid rgba(193,125,74,0.25)', borderRadius: 999, padding: '2px 8px' }}>
                          {contentCatLabel}
                        </span>
                      )}
                    </div>
                    {set.description && (
                      <div style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginBottom: 4, fontStyle: 'italic' }}>{set.description}</div>
                    )}
                    <div style={S.rowSub}>
                      Base price {set.price_coins} tokens
                      {summary && ` · ${summary}`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                    <span style={{ fontFamily: sans, fontSize: 12, color: set.visible ? colors.success : colors.muted }}>
                      {set.visible ? 'Live' : 'Hidden'}
                    </span>
                    <button onClick={() => { setAddingTo(addingTo === set.id ? null : set.id); setFilesByCategory(emptyCategoryFiles()); }}
                            style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px' }}>
                      {addingTo === set.id ? 'Cancel' : 'Add photos'}
                    </button>
                    <button onClick={() => openReview(set)} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px' }}>Review</button>
                    <button onClick={() => startEdit(set)} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px' }}>Edit</button>
                    <button onClick={() => setConfirmDelete(set.id)} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px', color: '#D99A9A', borderColor: 'rgba(156,90,90,0.35)' }}>Delete</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Storage housekeeping */}
      <div style={storageBox}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontFamily: sans, fontSize: 13, color: colors.text }}>Unused files</div>
            <div style={{ fontFamily: sans, fontSize: 11, color: colors.muted, marginTop: 3, lineHeight: 1.6, maxWidth: 560 }}>
              Deleting a photo now removes the stored file as well. This finds anything left over
              from earlier deletions. Files uploaded in the last day are never touched, in case an
              upload is still running.
            </div>
          </div>
          <button onClick={scanStorage} disabled={scanning}
                  style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px', opacity: scanning ? 0.5 : 1 }}>
            {scanning ? 'Scanning…' : 'Scan storage'}
          </button>
        </div>

        {storage && (
          <div style={{ marginTop: 12, borderTop: `1px solid ${colors.border}`, paddingTop: 12 }}>
            <div style={{ fontFamily: sans, fontSize: 12, color: colors.muted, lineHeight: 1.7 }}>
              {storage.totalObjects} files in storage · {storage.referenced} in use
              {storage.recentSkipped > 0 && ` · ${storage.recentSkipped} too recent to judge`}
            </div>
            {storage.orphanCount === 0 ? (
              <div style={{ fontFamily: sans, fontSize: 13, color: colors.success, marginTop: 8 }}>
                Nothing to clean up.
              </div>
            ) : (
              <>
                <div style={{ fontFamily: sans, fontSize: 14, color: '#D9A45C', marginTop: 8 }}>
                  {storage.orphanCount} unused file{storage.orphanCount === 1 ? '' : 's'} · {storage.orphanMB} MB
                </div>
                <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                  {(storage.byPrefix || []).map((g) => {
                    const meta = PREFIX_LABELS[g.prefix] || { label: g.prefix, note: '' };
                    return (
                      <div key={g.prefix} style={prefixRow}>
                        <div style={{ flex: 1, minWidth: 200 }}>
                          <div style={{ fontFamily: sans, fontSize: 13, color: colors.text }}>{meta.label}</div>
                          <div style={{ fontFamily: sans, fontSize: 11, color: colors.muted, marginTop: 2 }}>
                            {g.count} file{g.count === 1 ? '' : 's'} · {g.mb} MB{meta.note ? ` · ${meta.note}` : ''}
                          </div>
                        </div>
                        <button onClick={() => purgeStorage(g.prefix)} disabled={!!purging}
                                style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 10px', color: '#D99A9A',
                                         borderColor: 'rgba(156,90,90,0.35)', opacity: purging ? 0.5 : 1 }}>
                          {purging === g.prefix ? 'Removing…' : 'Clear these'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {reviewSet && (
        <ReviewPanel
          set={reviewSet}
          items={reviewItems}
          loading={reviewLoading}
          onClose={() => { setReviewSet(null); setLightbox(null); }}
          onDelete={deleteItem}
          onRetier={retierItem}
          deletingItem={deletingItem}
          lightbox={lightbox}
          setLightbox={setLightbox}
          mediaUrl={toUrl}
          categories={CATEGORIES}
        />
      )}
    </div>
  );
}

function ReviewPanel({ set, items, loading, onClose, onDelete, onRetier, deletingItem, lightbox, setLightbox, mediaUrl, categories }) {
  // Grouped for the grid, but navigation runs across the whole set in the order
  // shown. A shoot produces near-identical frames, so being able to step through
  // them without leaving the large view is the only way to tell them apart.
  const byTier = {};
  items.forEach((i) => { (byTier[i.tier_category] ||= []).push(i); });
  const ordered = categories.flatMap((cat) => byTier[cat.key] || []);

  const at = typeof lightbox === 'number' ? lightbox : -1;
  const current = at >= 0 ? ordered[at] : null;

  const go = (delta) => {
    if (at < 0) return;
    const next = at + delta;
    if (next >= 0 && next < ordered.length) setLightbox(next);
  };

  // Arrow keys to move, Escape to leave. Deliberately no keyboard shortcut for
  // deleting — moving fast through similar photos is exactly when an accidental
  // keypress would remove the wrong one.
  useEffect(() => {
    if (at < 0) return;
    const onKey = (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); go(-1); }
      if (e.key === 'Escape')     { e.preventDefault(); setLightbox(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [at, ordered.length]);

  // Warm the neighbours so stepping through feels instant rather than blank.
  useEffect(() => {
    if (at < 0) return;
    [ordered[at + 1], ordered[at + 2], ordered[at - 1]].forEach((it) => {
      if (it && it.media_type !== 'video') { const img = new Image(); img.src = mediaUrl(it.r2_key); }
    });
  }, [at]);

  // Deleting from the large view should keep you where you are rather than
  // throwing you back to the grid — the point is to work through a set in a pass.
  const deleteHere = async () => {
    if (!current) return;
    const wasLast = at >= ordered.length - 1;
    await onDelete(current, { keepLightbox: true });
    if (ordered.length <= 1) setLightbox(null);
    else if (wasLast) setLightbox(at - 1);
  };

  const tierLabel = (key) => categories.find((c2) => c2.key === key)?.label || key;

  return (
    <div style={reviewOverlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={reviewModal}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 12 }}>
          <div>
            <div style={{ fontFamily: display, fontSize: 22, color: colors.text }}>{set.title}</div>
            <div style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginTop: 3 }}>
              {items.length} item{items.length === 1 ? '' : 's'} · tap any photo to open the reviewer
            </div>
          </div>
          <button onClick={onClose} style={{ ...S.ghostBtn, fontSize: 14, padding: '6px 12px' }}>✕</button>
        </div>

        {loading ? <div style={{ fontFamily: sans, fontSize: 13, color: colors.muted }}>Loading…</div>
         : items.length === 0 ? <div style={{ fontFamily: sans, fontSize: 13, color: colors.muted }}>This set has no items yet.</div>
         : categories.filter((cat) => byTier[cat.key]?.length).map((cat) => (
          <div key={cat.key} style={{ marginBottom: 20 }}>
            <div style={{ fontFamily: mono, fontSize: 10, color: colors.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
              {cat.label} · {byTier[cat.key].length}
            </div>
            <div style={reviewGrid}>
              {byTier[cat.key].map((item) => (
                <div key={item.id} style={{ position: 'relative' }}>
                  {item.media_type === 'video' || item.type === 'video' ? (
                    <div onClick={() => setLightbox(ordered.indexOf(item))} style={{ ...reviewThumb, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, cursor: 'pointer' }}>🎬</div>
                  ) : (
                    <img src={mediaUrl(item.r2_key)} alt="" loading="lazy"
                         onClick={() => setLightbox(ordered.indexOf(item))}
                         style={{ ...reviewThumb, cursor: 'pointer' }} />
                  )}
                  <button onClick={() => onDelete(item)} disabled={deletingItem === item.id}
                          title="Remove this item"
                          style={{ ...itemDeleteBtn, opacity: deletingItem === item.id ? 0.5 : 1 }}>
                    {deletingItem === item.id ? '…' : '×'}
                  </button>
                  <select value={item.tier_category} onChange={(e) => onRetier(item, e.target.value)} style={tierSelect}>
                    {categories.map((c2) => <option key={c2.key} value={c2.key}>{c2.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
        ))}

        {current && (
          <div style={lightboxOverlay} onClick={(e) => e.target === e.currentTarget && setLightbox(null)}>
            <div style={lbBar}>
              <span style={{ fontFamily: mono, fontSize: 12, color: '#B8AFA4' }}>
                {at + 1} of {ordered.length} · {tierLabel(current.tier_category)}
              </span>
              <button onClick={() => setLightbox(null)} style={lbClose}>✕</button>
            </div>

            <div style={lbStage}>
              <button onClick={() => go(-1)} disabled={at === 0}
                      style={{ ...lbArrow, left: 8, opacity: at === 0 ? 0.25 : 1 }} aria-label="Previous">‹</button>

              {current.media_type === 'video' || current.type === 'video'
                ? <video key={current.id} src={mediaUrl(current.r2_key)} controls style={lightboxMedia} />
                : <img key={current.id} src={mediaUrl(current.r2_key)} alt="" style={lightboxMedia} />}

              <button onClick={() => go(1)} disabled={at >= ordered.length - 1}
                      style={{ ...lbArrow, right: 8, opacity: at >= ordered.length - 1 ? 0.25 : 1 }} aria-label="Next">›</button>
            </div>

            <div style={lbActions}>
              <label style={{ fontFamily: sans, fontSize: 12, color: '#B8AFA4', display: 'flex', alignItems: 'center', gap: 8 }}>
                Access level
                <select value={current.tier_category}
                        onChange={(e) => onRetier(current, e.target.value)}
                        style={lbSelect}>
                  {categories.map((c2) => <option key={c2.key} value={c2.key}>{c2.label}</option>)}
                </select>
              </label>
              <button onClick={deleteHere} disabled={deletingItem === current.id}
                      style={{ ...lightboxDelete, opacity: deletingItem === current.id ? 0.5 : 1 }}>
                {deletingItem === current.id ? 'Removing…' : 'Remove this photo'}
              </button>
            </div>

            <div style={{ fontFamily: sans, fontSize: 11, color: '#7C736A' }}>
              Arrow keys to move · Esc to close
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const reviewOverlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 };
const reviewModal   = { width: '100%', maxWidth: 900, maxHeight: '88vh', overflowY: 'auto', background: '#161410', border: `1px solid ${colors.border}`, borderRadius: 14, padding: 24 };
const reviewGrid    = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 10 };
const reviewThumb   = { width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 6, border: `1px solid ${colors.border}`, background: 'rgba(255,255,255,0.03)', display: 'block' };
const itemDeleteBtn = { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.7)', color: '#D99A9A', fontSize: 14, lineHeight: 1, cursor: 'pointer', padding: 0 };
const tierSelect    = { width: '100%', marginTop: 4, background: '#100F0C', border: `1px solid ${colors.border}`, color: colors.muted, fontFamily: sans, fontSize: 10, padding: '3px 4px', borderRadius: 4, outline: 'none' };
const lightboxOverlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.94)', zIndex: 400, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '16px 20px' };
const lbBar        = { width: '100%', maxWidth: 900, display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
const lbClose      = { background: 'transparent', border: '1px solid rgba(255,255,255,0.18)', color: '#E8E1D8', fontSize: 14, padding: '5px 11px', borderRadius: 8, cursor: 'pointer' };
const lbStage      = { position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', flex: 1, minHeight: 0 };
const lbArrow      = { position: 'absolute', top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 24, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, zIndex: 2 };
const lbActions    = { display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' };
const lbSelect     = { background: '#100F0C', border: '1px solid rgba(255,255,255,0.18)', color: '#E8E1D8', fontFamily: sans, fontSize: 12, padding: '6px 10px', borderRadius: 6, outline: 'none' };
const lightboxMedia = { maxWidth: 'min(92vw, 900px)', maxHeight: '70vh', objectFit: 'contain', borderRadius: 8, display: 'block' };
const lightboxDelete = { background: '#9C5A5A', border: 'none', color: '#fff', fontFamily: sans, fontSize: 13, fontWeight: 700, padding: '9px 18px', borderRadius: 8, cursor: 'pointer' };

// What each storage folder actually is, so the report reads as something other
// than internal path names.
const PREFIX_LABELS = {
  content:     { label: 'Gallery uploads that never joined a set',   note: 'Stranded by the upload bug — safe to clear' },
  background:  { label: 'Chat backgrounds replaced since',           note: 'Superseded by newer ones' },
  chat_media:  { label: 'Chat media from deleted accounts',          note: 'Left behind when test users were removed' },
  merch_image: { label: 'Product photos no longer used',             note: '' },
  portfolio:   { label: 'Portfolio images replaced since',           note: 'Public marketing files — check the site first' },
};

const prefixRow = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', background: 'rgba(255,255,255,0.02)', border: `1px solid ${colors.border}`, borderRadius: 8, padding: '10px 12px' };

const storageBox = { background: 'rgba(255,255,255,0.02)', border: `1px solid ${colors.border}`, borderRadius: 10, padding: 16, marginTop: 28 };

const addPanel = { background: 'rgba(193,125,74,0.05)', border: '1px solid rgba(193,125,74,0.2)', borderRadius: 8, padding: 16, marginBottom: 14 };

const fieldLabel = { fontFamily: sans, fontSize: 12, color: colors.muted, marginBottom: 6 };
const fileGrid   = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 6 };
const fileCard   = { background: '#0D0C0A', border: '1px solid', borderRadius: 6, padding: 6, position: 'relative' };
const removeBtn  = { position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.6)', border: 'none', color: '#F2EBE0', fontSize: 10, padding: '2px 5px', borderRadius: 4, cursor: 'pointer' };