// studio/src/sections/Content.jsx
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { createCompressPool } from '../workers/compressPool';
import { Selfies } from './Selfies';
import { SectionTabs } from '../components/SectionTabs';
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
const UPLOAD_CONCURRENCY = 6;
const UPLOAD_RETRIES     = 2;

// Compression on the main thread was the ceiling on every large upload: five
// uploads ran in parallel but all queued behind one thread doing the JPEG
// encode, so throughput sat around 39 photos a minute and Studio froze while it
// worked. The pool spreads it across cores instead.
//
// Falls back to the main thread where workers are unavailable, so nothing
// depends on them existing.
async function compressOnMainThread(file) {
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

export function Content({ openWith }) {
  // Mirrors what fans see: sets and Selfie of the Day are one Gallery to them,
  // so they should be one screen here too.
  const [tab, setTab] = useState(openWith?.filter === 'selfies' ? 'selfies' : 'sets');
  const [sets,    setSets]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');

  const [form, setForm] = useState({ title: '', description: '', price_coins: '0', visible: false, category: CONTENT_CATEGORIES[0].key, photographerNames: [] });

  // Names already used, so the same person is picked rather than retyped —
  // a second spelling would become a second photographer with separate earnings.
  const [photographers, setPhotographers] = useState([]);
  const [descOpen,      setDescOpen]      = useState(null);

  // What every tier actually pays. The figure on the form is a base that gets
  // split by how many photos sit at each level, then discounted or multiplied
  // by who is looking — so the number typed here is not a number any fan sees.
  const [pricingFor,  setPricingFor]  = useState(null);
  const [pricingData, setPricingData] = useState(null);

  const openPricing = async (set) => {
    if (pricingFor === set.id) { setPricingFor(null); return; }
    setPricingFor(set.id); setPricingData(null); setError('');
    try {
      setPricingData(await api.get(`/api/studio/content/${set.id}/pricing`));
    } catch (err) { setError(err.message); }
  };

  const poolRef = useRef(null);
  useEffect(() => {
    if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
      try { poolRef.current = createCompressPool({ maxPx: MAX_IMG_PX, quality: JPEG_Q }); }
      catch (err) { console.warn('compression pool unavailable, using the main thread:', err.message); }
    }
    return () => poolRef.current?.dispose();
  }, []);

  // A 24-pixel version of the cover, as a data URI. Sent with the set and
  // served in place of the real image when a fan cannot see inside — the detail
  // is genuinely absent rather than hidden by a filter that a reader mode or a
  // dev tools panel can remove.
  const makeCoverBlur = async (file) => {
    try {
      const bitmap = await createImageBitmap(file);
      const w = 24, h = Math.max(1, Math.round((bitmap.height / bitmap.width) * w));
      const canvas = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(w, h)
        : Object.assign(document.createElement('canvas'), { width: w, height: h });
      canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
      bitmap.close?.();
      const blob = canvas.convertToBlob
        ? await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.6 })
        : await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.6));
      return await new Promise((res) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = () => res(null);
        r.readAsDataURL(blob);
      });
    } catch { return null; }
  };

  // Sets uploaded before blurred covers existed have none stored, so a locked
  // cover shows nothing at all. This reads each one back from storage and makes
  // the small version — done here rather than on the server because the browser
  // already has the canvas, and there is no image library on the backend.
  const [backfilling, setBackfilling] = useState(false);
  const backfillCovers = async () => {
    setBackfilling(true); setError(''); setSuccess('');
    let done = 0, failed = 0;
    try {
      const targets = sets.filter((s) => !s.cover_blur && (s.cover_url || s.cover_key));
      for (const set of targets) {
        try {
          // Fetched through the backend rather than straight from storage, so
          // the browser treats it as same-origin and no bucket CORS policy is
          // needed — that would have required a Cloudflare token the platform
          // does not hold.
          const res = await fetch(
            `${import.meta.env.VITE_API_URL}/api/studio/content/${set.id}/cover-image`,
            { headers: { Authorization: `Bearer ${localStorage.getItem('jwt')}` } }
          );
          if (!res.ok) { failed += 1; continue; }
          const blob = await res.blob();
          const dataUri = await makeCoverBlur(new File([blob], 'cover.jpg', { type: blob.type }));
          if (!dataUri) { failed += 1; continue; }
          await api.patch(`/api/studio/content/${set.id}`, { cover_blur: dataUri });
          done += 1;
        } catch { failed += 1; }
      }
      setSuccess(`Made blurred covers for ${done} set${done === 1 ? '' : 's'}${failed ? `, ${failed} could not be read` : ''}.`);
      loadSets();
    } catch (err) { setError(err.message); } finally { setBackfilling(false); }
  };

  const compressImage = async (file) =>
    poolRef.current
      ? poolRef.current.compress(file)
      : { file: await compressOnMainThread(file), metrics: null };

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
  const loadPhotographers = () => api.get('/api/studio/photographers')
    .then((d) => setPhotographers(d.photographers || [])).catch(() => {});

  useEffect(() => { loadSets().finally(() => setLoading(false)); loadPhotographers(); }, []);

  const totalFileCount = Object.values(filesByCategory).reduce((sum, arr) => sum + arr.length, 0);

  // Reviewing an existing set: its actual items, loaded on demand.
  const [reviewSet,     setReviewSet]     = useState(null);
  const [reviewItems,   setReviewItems]   = useState([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [deletingItem,  setDeletingItem]  = useState(null);
  const [lightbox,      setLightbox]      = useState(null);
  const [selected,      setSelected]      = useState([]);   // ordered, so shift-click has an anchor
  const [bulkBusy,      setBulkBusy]      = useState(false);

  const clearSelection = () => setSelected([]);

  // The order fans actually see. Arranged in a flat list rather than the
  // tier-grouped grid, because those are different orders — arranging within
  // tiers would mean arranging something other than what a fan looks at.
  const [ordering, setOrdering] = useState(false);
  const [orderBusy, setOrderBusy] = useState(false);

  const saveOrder = async (items) => {
    setOrderBusy(true); setError('');
    try {
      await api.post('/api/studio/content/items/reorder', {
        setId: reviewSet.id,
        orderedIds: items.map((i) => i.id),
      });
      setReviewItems(items);
      setSuccess('Order saved. The first photo is now the cover.');
      loadSets();
    } catch (err) {
      setError(err.message);
      // Put the list back rather than leaving the screen showing an order that
      // was never written.
      openReview(reviewSet);
    } finally { setOrderBusy(false); }
  };

  const bulkMove = async (tierCategory) => {
    setBulkBusy(true); setError('');
    try {
      const d = await api.post('/api/studio/content/items/move', { itemIds: selected, tierCategory });
      setReviewItems((prev) => prev.map((i) =>
        selected.includes(i.id) ? { ...i, tier_category: tierCategory } : i));
      setSuccess(`Moved ${d.moved} item${d.moved === 1 ? '' : 's'}.`);
      clearSelection();
      loadSets();
    } catch (err) { setError(err.message); } finally { setBulkBusy(false); }
  };

  const bulkDelete = async () => {
    setBulkBusy(true); setError('');
    try {
      const d = await api.post('/api/studio/content/items/delete', { itemIds: selected });
      setReviewItems((prev) => prev.filter((i) => !selected.includes(i.id)));
      setSuccess(`Removed ${d.deleted}. ${d.remaining} left in this set.`);
      clearSelection();
      loadSets();
    } catch (err) { setError(err.message); } finally { setBulkBusy(false); }
  };

  // Adding to a set that already exists — the recovery path when an upload was
  // interrupted, and the normal way to extend a set later.
  const [addingTo, setAddingTo] = useState(null);

  // Unlock history, loaded per set on demand rather than with the list — most
  // of the time nobody is looking at it.
  const [unlocksFor,  setUnlocksFor]  = useState(null);
  const [unlockData,  setUnlockData]  = useState(null);
  const [unlockBusy,  setUnlockBusy]  = useState(false);

  const openUnlocks = async (set) => {
    if (unlocksFor === set.id) { setUnlocksFor(null); return; }
    setUnlocksFor(set.id); setUnlockData(null); setUnlockBusy(true); setError('');
    try {
      setUnlockData(await api.get(`/api/studio/content/${set.id}/unlocks`));
    } catch (err) { setError(err.message); } finally { setUnlockBusy(false); }
  };

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
        releasePreviews(filesByCategory); setFilesByCategory(emptyCategoryFiles());
        setAddingTo(null);
      }
      loadSets();
    } catch (err) {
      setError(err.message);
      setUploadProgress('');
    } finally { setCreating(false); }
  };

  const openReview = async (set) => {
    setReviewSet(set); setReviewItems([]); setReviewLoading(true); setError(''); setSelected([]);
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
  // Anything still held when the form is cleared or the section is left.
  const releasePreviews = (byCat) => {
    Object.values(byCat || {}).forEach((arr) =>
      (arr || []).forEach((it) => { if (it.preview) URL.revokeObjectURL(it.preview); }));
  };

  useEffect(() => () => releasePreviews(filesByCategory), []);

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
    let firstImageFile = null;
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
        // Measured while the photo is already decoded for compression, so
        // flagging costs nothing beyond what the upload was doing anyway.
        let metrics = null;
        const publicUrl = await withRetry(async () => {
          let fileToUpload = item.file;
          if (!item.isVideo) {
            const out = await compressImage(item.file);
            fileToUpload = out.file || out;
            metrics = out.metrics || null;
          }
          try {
            return await uploadFile(fileToUpload, 'content');
          } finally {
            // Dropped immediately so the compressed copy can be collected
            // rather than lingering while the rest of the batch runs.
            fileToUpload = null;
          }
        });
        await withRetry(() => api.post('/api/studio/content/item', {
          setId, type: item.isVideo ? 'video' : 'image', r2Key: publicUrl,
          position: startPosition + n, tierCategory: cat,
          quality: metrics,
        }));
        if (!firstImageUrl && !item.isVideo) {
          firstImageUrl = publicUrl;
          // Kept so the blurred version can be made from the original rather
          // than downloading the uploaded copy back again.
          firstImageFile = item.file;
        }
        uploaded += 1;
        // Released the moment the file is safely uploaded. The thumbnail is
        // gone from that tile, which is also the clearest signal it is done.
        if (item.preview) URL.revokeObjectURL(item.preview);
        mark(cat, i, { status: 'done', publicUrl, preview: null });
      } catch (err) {
        mark(cat, i, { status: 'error', error: err.message });
      }
    });

    await runPool(tasks, UPLOAD_CONCURRENCY, () => {
      done += 1;
      setUploadProgress(`Uploaded ${done} of ${total}…`);
    });

    return { uploaded, firstImageUrl, firstImageFile, failed: total - uploaded };
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
        photographerNames: form.photographerNames,
      });
      const setId = setData.set.id;

      let coverUrl = null;
      if (coverFile) {
        setUploadProgress('Uploading cover image…');
        const compressed = await compressImage(coverFile);
        coverUrl = await uploadFile(compressed, 'content');
        await api.patch(`/api/studio/content/${setId}`, {
          cover_key: coverUrl,
          cover_blur: await makeCoverBlur(coverFile),
        });
      }

      const { uploaded, firstImageUrl, firstImageFile } = await uploadAllPending(setId, 0);
      if (!coverUrl && firstImageUrl) {
        coverUrl = firstImageUrl;
        await api.patch(`/api/studio/content/${setId}`, {
          cover_key: firstImageUrl,
          cover_blur: firstImageFile ? await makeCoverBlur(firstImageFile) : null,
        });
      }
      const position = uploaded;

      setUploadProgress('');
      setSuccess(`"${form.title}" created with ${position} item${position !== 1 ? 's' : ''}.`);
      setSets((prev) => [{ ...setData.set, cover_url: coverUrl }, ...prev]);
      setForm({ title: '', description: '', price_coins: '0', visible: false, category: CONTENT_CATEGORIES[0].key, photographerNames: [] });
      loadPhotographers();
      releasePreviews(filesByCategory); setFilesByCategory(emptyCategoryFiles());
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
    setEditForm({ title: set.title, description: set.description || '', price_coins: set.price_coins, visible: set.visible, category: set.category || CONTENT_CATEGORIES[0].key, photographerNames: set.photographer ? set.photographer.split(',').map((n) => n.trim()) : [] });
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
      <Eyebrow>Gallery</Eyebrow>
      <T.title>Gallery</T.title>

      <SectionTabs
        tabs={[
          { key: 'sets',    label: 'Media' },
          { key: 'selfies', label: 'Selfie of the Day' },
        ]}
        active={tab} onChange={setTab}
      />

      {tab === 'selfies' && <Selfies />}

      {tab === 'sets' && <>

      {error   && <div style={S.error}>{error}</div>}
      {success && <div style={S.success}>{success}</div>}

      {sets.some((s) => !s.cover_blur && (s.cover_url || s.cover_key)) && (
        <div style={{ ...storageBox, marginBottom: 16 }}>
          <div style={{ fontFamily: sans, fontSize: 13, color: colors.text, marginBottom: 6 }}>
            Blurred covers missing
          </div>
          <div style={{ fontFamily: sans, fontSize: 12, color: colors.muted, lineHeight: 1.6, marginBottom: 10 }}>
            {sets.filter((s) => !s.cover_blur && (s.cover_url || s.cover_key)).length} set(s) were
            uploaded before locked covers were blurred properly, so their cards show nothing to
            anyone who cannot see inside. This makes the small version from each existing cover.
          </div>
          <button onClick={backfillCovers} disabled={backfilling}
                  style={{ ...S.btn, fontSize: 12, opacity: backfilling ? 0.5 : 1 }}>
            {backfilling ? 'Working…' : 'Generate them'}
          </button>
        </div>
      )}


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
          <Field label="Photographers — shown on the set">
            <PhotographerPicker names={form.photographerNames} options={photographers}
                                onChange={(names) => setForm({ ...form, photographerNames: names })} />
          </Field>
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
                    <button onClick={() => { setAddingTo(null); releasePreviews(filesByCategory); setFilesByCategory(emptyCategoryFiles()); }}
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
                    <Field label="Photographers — shown on the set">
                      <PhotographerPicker names={editForm.photographerNames || []} options={photographers}
                                          onChange={(names) => setEditForm({ ...editForm, photographerNames: names })} />
                    </Field>
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
                <>
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
                      <div style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginBottom: 4, fontStyle: 'italic',
                                    ...(descOpen === set.id ? {} : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 460 }) }}>
                        {set.description}
                      </div>
                    )}
                    {set.description && set.description.length > 70 && (
                      <button onClick={() => setDescOpen(descOpen === set.id ? null : set.id)}
                              style={{ background: 'none', border: 'none', color: colors.accent, fontFamily: sans,
                                       fontSize: 11, cursor: 'pointer', padding: '0 0 4px', textDecoration: 'underline' }}>
                        {descOpen === set.id ? 'Show less' : 'Read caption'}
                      </button>
                    )}
                    <div style={S.rowSub}>
                      {set.photographer && <span style={{ color: colors.accent }}>{set.photographer} · </span>}
                      Base price {set.price_coins} tokens
                      {summary && ` · ${summary}`}
                    </div>
                  </div>
                  {/* Live or hidden stays on the title row — it is a property of
                      the set, not an action. */}
                  <span style={{ fontFamily: sans, fontSize: 12, flexShrink: 0,
                                 color: set.visible ? colors.success : colors.muted }}>
                    {set.visible ? 'Live' : 'Hidden'}
                  </span>
                </div>

                <div style={rowActions}>
                  <button onClick={() => openReview(set)} style={actionBtn}>Review</button>
                  <button onClick={() => { setAddingTo(addingTo === set.id ? null : set.id); releasePreviews(filesByCategory); setFilesByCategory(emptyCategoryFiles()); }}
                          style={actionBtn}>
                    {addingTo === set.id ? 'Cancel' : 'Add photos'}
                  </button>
                  <button onClick={() => startEdit(set)} style={actionBtn}>Edit</button>
                  <button onClick={() => openPricing(set)} style={actionBtn}>
                    {pricingFor === set.id ? 'Hide pricing' : 'Pricing'}
                  </button>
                  <button onClick={() => openUnlocks(set)} style={actionBtn}>
                    {unlocksFor === set.id ? 'Hide unlocks' : 'Unlocks'}
                  </button>
                  {/* Pushed to the far end, away from the things used constantly. */}
                  <button onClick={() => setConfirmDelete(set.id)}
                          style={{ ...actionBtn, marginLeft: 'auto', color: '#D99A9A', borderColor: 'rgba(156,90,90,0.35)' }}>
                    Delete
                  </button>
                </div>

                {pricingFor === set.id && (
                  <div style={pricingBox}>
                    {!pricingData ? <T.muted>Working it out…</T.muted>
                     : pricingData.itemCount === 0 ? <T.muted>Nothing uploaded yet.</T.muted>
                     : (
                      <>
                        <div style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginBottom: 10, lineHeight: 1.6 }}>
                          Base {pricingData.basePrice} tokens across {pricingData.itemCount} items
                          {pricingData.freeCount > 0 && `, ${pricingData.freeCount} free to everyone`}.
                        </div>
                        <div style={{ overflowX: 'auto' }}>
                          <table style={priceTbl}>
                            <thead>
                              <tr>{['Tier', 'Free', 'Included', 'Extra to buy', 'They pay'].map((h) => (
                                <th key={h} style={priceTh}>{h}</th>
                              ))}</tr>
                            </thead>
                            <tbody>
                              {pricingData.tiers.map((t) => (
                                <tr key={t.tier}>
                                  <td style={{ ...priceTd, textTransform: 'capitalize' }}>{t.tier}</td>
                                  <td style={{ ...priceTd, textAlign: 'right' }}>{t.freeCount || '—'}</td>
                                  <td style={{ ...priceTd, textAlign: 'right', color: t.includedCount ? colors.success : colors.muted }}>
                                    {t.includedCount || '—'}
                                  </td>
                                  <td style={{ ...priceTd, textAlign: 'right' }}>
                                    {t.upsellCount ? `${t.upsellCount} · ${t.upsellPrice}` : '—'}
                                  </td>
                                  <td style={{ ...priceTd, textAlign: 'right', color: colors.text }}>
                                    {t.totalToSeeAll > 0
                                      ? <>{t.totalToSeeAll} tokens
                                          <div style={{ fontSize: 10, color: colors.muted }}>₹{t.totalInr.toLocaleString('en-IN')}</div></>
                                      : <span style={{ color: colors.success }}>nothing</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </div>
                )}
                </>
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

      {/* Unlock history */}
      {unlocksFor && (
        <div style={unlockOverlay} onClick={(e) => e.target === e.currentTarget && setUnlocksFor(null)}>
          <div style={unlockModal}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
              <div>
                <div style={{ fontFamily: display, fontSize: 22, color: colors.text }}>
                  {sets.find((s) => s.id === unlocksFor)?.title}
                </div>
                <div style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginTop: 3 }}>
                  Who has opened it, who has unlocked it, and what it earned
                </div>
              </div>
              <button onClick={() => setUnlocksFor(null)} style={{ ...S.ghostBtn, fontSize: 14, padding: '6px 12px' }}>✕</button>
            </div>

            {unlockBusy ? <T.muted>Loading…</T.muted>
             : !unlockData ? null
             : unlockData.unlocks.length === 0 && unlockData.views.length === 0
               ? <T.muted>Nobody has opened this yet.</T.muted>
             : (
              <>
                <div style={S.statsRow}>
                  {/* Two different things, and conflating them made a paid set
                      nobody had bought describe itself as free. Opening the page
                      is not unlocking: somebody who looked at a locked set and
                      left is a visitor, not a customer. */}
                  <div style={S.statCard}>
                    <div style={uLabel}>Looked at it</div>
                    <div style={uValue}>{unlockData.totals.views}</div>
                    <div style={uSub}>opened the set, whatever they could see</div>
                  </div>
                  <div style={S.statCard}>
                    <div style={uLabel}>Actually unlocked</div>
                    <div style={{ ...uValue, color: unlockData.totals.unlocks > 0 ? colors.text : colors.muted }}>
                      {unlockData.totals.unlocks}
                    </div>
                    <div style={uSub}>
                      {unlockData.totals.unlocks > 0
                        ? `${unlockData.totals.byAllowance} through membership`
                        : 'nobody yet'}
                    </div>
                  </div>
                  <div style={S.statCard}>
                    <div style={uLabel}>Tokens spent</div>
                    <div style={uValue}>{unlockData.totals.tokens}</div>
                    <div style={uSub}>
                      {unlockData.totals.fromPurchased} purchased · {unlockData.totals.fromGifted} gifted
                    </div>
                  </div>
                  <div style={S.statCard}>
                    <div style={uLabel}>Earned</div>
                    <div style={{ ...uValue, color: colors.success }}>
                      ₹{unlockData.totals.revenueInr.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </div>
                    <div style={uSub}>
                      purchased tokens only, at ₹{unlockData.totals.tokenRate}/token
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gap: 6, marginTop: 16 }}>
                  {/* With no unlocks the view list is the whole story. Shown
                      only then, so nobody is listed twice on a set that has
                      both. */}
                  {unlockData.unlocks.length === 0 && unlockData.views.map((v, i) => (
                    <div key={i} style={unlockRow}>
                      <div style={{ flex: 1, minWidth: 180 }}>
                        <div style={{ fontFamily: sans, fontSize: 13, color: colors.text }}>{v.who}</div>
                        <div style={{ fontFamily: mono, fontSize: 10, color: colors.muted, marginTop: 2 }}>
                          {new Date(v.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          {' · '}{v.tier}
                        </div>
                      </div>
                      <span style={{ fontFamily: sans, fontSize: 12, color: colors.muted }}>
                        looked, did not unlock
                      </span>
                    </div>
                  ))}

                  {unlockData.unlocks.map((u) => (
                    <div key={u.id} style={unlockRow}>
                      <div style={{ flex: 1, minWidth: 180 }}>
                        <div style={{ fontFamily: sans, fontSize: 13, color: colors.text }}>{u.who}</div>
                        <div style={{ fontFamily: mono, fontSize: 10, color: colors.muted, marginTop: 2 }}>
                          {new Date(u.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          {' · '}{u.tier}{u.scope ? ` · ${u.scope}` : ''}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', fontFamily: sans, fontSize: 12 }}>
                        {u.viaAllowance
                          ? <span style={{ color: colors.muted }}>membership allowance</span>
                          : <div style={{ color: colors.text }}>{u.tokens} tokens</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {reviewSet && (
        <ReviewPanel
          set={reviewSet}
          items={reviewItems}
          loading={reviewLoading}
          onClose={() => { setReviewSet(null); setLightbox(null); clearSelection(); setOrdering(false); }}
          ordering={ordering}
          setOrdering={setOrdering}
          onSaveOrder={saveOrder}
          orderBusy={orderBusy}
          selected={selected}
          setSelected={setSelected}
          onBulkMove={bulkMove}
          onBulkDelete={bulkDelete}
          bulkBusy={bulkBusy}
          onDelete={deleteItem}
          onRetier={retierItem}
          deletingItem={deletingItem}
          lightbox={lightbox}
          setLightbox={setLightbox}
          mediaUrl={toUrl}
          categories={CATEGORIES}
        />
      )}
    </>}
    </div>
  );
}

// A grid of 271 thumbnails would otherwise fire 271 requests for full-size
// originals at once — around 120MB to fill boxes 60px wide. The browser's own
// lazy loading barely defers anything inside a scrolling modal, so the image is
// held back until it is actually near view, and kept once loaded so scrolling
// back is instant.
function LazyThumb({ src, alt, onClick, style }) {
  const ref = useRef(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || show) return;
    const io = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setShow(true); io.disconnect(); } },
      // A generous margin so images are ready before they scroll into view
      // rather than popping in underneath the cursor.
      { root: el.closest('[data-review-scroll]') || null, rootMargin: '600px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [show]);

  return show
    ? <img ref={ref} src={src} alt={alt} onClick={onClick} style={style} />
    : <div ref={ref} onClick={onClick} style={{ ...style, background: 'rgba(255,255,255,0.04)' }} />;
}

// The order a fan sees, flat and in sequence. Drag for a local move, the arrow
// for the common case of promoting one photo to the front — dragging item 200
// up to position 3 across a long grid is miserable, and that is the move people
// actually want to make.
function SequenceView({ items, mediaUrl, busy, onSave }) {
  const [list, setList] = useState(items);
  const [dragging, setDragging] = useState(null);
  const dirty = list.some((it, i) => it.id !== items[i]?.id);

  useEffect(() => { setList(items); }, [items]);

  const move = (from, to) => {
    if (to < 0 || to >= list.length || from === to) return;
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setList(next);
  };

  return (
    <div>
      <div style={seqGrid}>
        {list.map((item, idx) => (
          <div
            key={item.id}
            draggable
            onDragStart={() => setDragging(idx)}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragging !== null && dragging !== idx) { move(dragging, idx); setDragging(idx); }
            }}
            onDragEnd={() => setDragging(null)}
            style={{ ...seqTile, opacity: dragging === idx ? 0.4 : 1 }}
          >
            {item.media_type === 'video' || item.type === 'video'
              ? <div style={{ ...reviewThumb, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🎬</div>
              : <LazyThumb src={mediaUrl(item.r2_key)} alt="" style={reviewThumb} />}

            <div style={seqBadge}>{idx + 1}</div>
            {idx === 0 && <div style={seqCover}>cover</div>}

            <button onClick={() => move(idx, 0)} title="Send to front"
                    style={seqToFront} disabled={idx === 0}>↑</button>
          </div>
        ))}
      </div>

      {dirty && (
        <div style={seqBar}>
          <span style={{ fontFamily: sans, fontSize: 13, color: colors.text }}>
            Order changed
          </span>
          <button onClick={() => onSave(list)} disabled={busy}
                  style={{ ...S.btn, fontSize: 12, padding: '7px 16px', opacity: busy ? 0.5 : 1 }}>
            {busy ? 'Saving…' : 'Save this order'}
          </button>
          <button onClick={() => setList(items)} disabled={busy}
                  style={{ ...S.ghostBtn, fontSize: 12, padding: '7px 14px' }}>
            Undo
          </button>
        </div>
      )}
    </div>
  );
}

function PhotographerPicker({ names, onChange, options }) {
  const [draft, setDraft] = useState('');

  const add = (raw) => {
    const name = String(raw || draft).trim();
    if (!name) return;
    // Case-insensitive, matching the server — otherwise the same person could be
    // added twice under two spellings and the split would be wrong.
    if (!names.some((n) => n.toLowerCase() === name.toLowerCase())) onChange([...names, name]);
    setDraft('');
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: names.length ? 8 : 0 }}>
        {names.map((n) => (
          <span key={n} style={photogChip}>
            {n}
            <button onClick={() => onChange(names.filter((x) => x !== n))}
                    style={chipX} title="Remove">×</button>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input style={{ ...S.input, flex: 1 }} list="photographer-names"
               value={draft}
               onChange={(e) => setDraft(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
               placeholder={names.length ? 'Add another' : 'Who shot this'} />
        <button onClick={() => add()} disabled={!draft.trim()}
                style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 14px', opacity: draft.trim() ? 1 : 0.5 }}>
          Add
        </button>
      </div>
      {names.length > 1 && (
        <div style={{ fontFamily: sans, fontSize: 11, color: colors.muted, marginTop: 6 }}>
          What this set earns is split equally between {names.length}.
        </div>
      )}
      <datalist id="photographer-names">
        {options.map((p) => <option key={p.id} value={p.name} />)}
      </datalist>
    </div>
  );
}

function ReviewPanel({ set, items, loading, onClose, onDelete, onRetier, deletingItem, lightbox, setLightbox, mediaUrl, categories,
                       selected, setSelected, onBulkMove, onBulkDelete, bulkBusy,
                       ordering, setOrdering, onSaveOrder, orderBusy }) {
  // Grouped for the grid, but navigation runs across the whole set in the order
  // shown. A shoot produces near-identical frames, so being able to step through
  // them without leaving the large view is the only way to tell them apart.
  const byTier = {};
  items.forEach((i) => { (byTier[i.tier_category] ||= []).push(i); });
  const ordered = categories.flatMap((cat) => byTier[cat.key] || []);

  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const flaggedCount = items.filter((i) => i.quality?.flag).length;

  const at = typeof lightbox === 'number' ? lightbox : -1;
  const current = at >= 0 ? ordered[at] : null;

  const selecting = selected.length > 0;
  const isSelected = (id) => selected.includes(id);

  // Shift extends from the last thing clicked, in the order shown on screen —
  // which is how every file manager behaves and how a couple of hundred photos
  // become selectable in two clicks rather than two hundred.
  const toggle = (item, shiftKey) => {
    const idx = ordered.findIndex((i) => i.id === item.id);
    if (shiftKey && selected.length) {
      const lastIdx = ordered.findIndex((i) => i.id === selected[selected.length - 1]);
      if (lastIdx >= 0) {
        const [a, b] = lastIdx < idx ? [lastIdx, idx] : [idx, lastIdx];
        const range = ordered.slice(a, b + 1).map((i) => i.id);
        setSelected([...new Set([...selected, ...range])]);
        return;
      }
    }
    setSelected(isSelected(item.id)
      ? selected.filter((id) => id !== item.id)
      : [...selected, item.id]);
  };

  const selectTier = (key) => {
    const ids = (byTier[key] || []).map((i) => i.id);
    const allIn = ids.every((id) => selected.includes(id));
    setSelected(allIn ? selected.filter((id) => !ids.includes(id))
                      : [...new Set([...selected, ...ids])]);
  };

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

  // Warm the next image so stepping forward feels instant. Deliberately modest:
  // holding down the arrow key through a few hundred photos would otherwise
  // queue up more requests than the connection can finish, and the picture you
  // are actually looking at ends up behind them all. Delayed slightly so a fast
  // scroll past a photo does not fetch it at all.
  useEffect(() => {
    if (at < 0) return;
    const t = setTimeout(() => {
      [ordered[at + 1], ordered[at - 1]].forEach((it) => {
        if (it && it.media_type !== 'video') { const img = new Image(); img.src = mediaUrl(it.r2_key); }
      });
    }, 250);
    return () => clearTimeout(t);
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
      <div style={reviewModal} data-review-scroll>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 12 }}>
          <div>
            <div style={{ fontFamily: display, fontSize: 22, color: colors.text }}>{set.title}</div>
            <div style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginTop: 3 }}>
              {items.length} item{items.length === 1 ? '' : 's'} · tap any photo to open the reviewer
            </div>
          </div>
          <button onClick={onClose} style={{ ...S.ghostBtn, fontSize: 14, padding: '6px 12px' }}>✕</button>
        </div>

        {!loading && items.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <button onClick={() => { setOrdering(!ordering); setSelected([]); }}
                    style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px',
                             ...(ordering ? { color: colors.accent, borderColor: colors.accent } : {}) }}>
              {ordering ? 'Done arranging' : 'Arrange order'}
            </button>
            {ordering && (
              <span style={{ fontFamily: sans, fontSize: 12, color: colors.muted, alignSelf: 'center' }}>
                Drag to move, or use ↑ to send a photo to the front. The first is the cover.
              </span>
            )}
          </div>
        )}

        {flaggedCount > 0 && !ordering && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
            <button onClick={() => setOnlyFlagged(!onlyFlagged)}
                    style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px',
                             ...(onlyFlagged ? { color: '#D9A45C', borderColor: 'rgba(217,164,92,0.4)' } : {}) }}>
              {onlyFlagged ? 'Show everything' : `Needs a look · ${flaggedCount}`}
            </button>
            <span style={{ fontFamily: sans, fontSize: 11, color: colors.muted }}>
              Soft focus or odd exposure. Measured, not judged — keep whatever you meant to keep.
            </span>
          </div>
        )}

        {ordering ? (
          <SequenceView items={ordered} mediaUrl={mediaUrl} busy={orderBusy} onSave={onSaveOrder} />
        ) : loading ? <div style={{ fontFamily: sans, fontSize: 13, color: colors.muted }}>Loading…</div>
         : items.length === 0 ? <div style={{ fontFamily: sans, fontSize: 13, color: colors.muted }}>This set has no items yet.</div>
         : categories.filter((cat) => byTier[cat.key]?.length).map((cat) => (
          <div key={cat.key} style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ fontFamily: mono, fontSize: 10, color: colors.muted, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                {cat.label} · {byTier[cat.key].length}
              </span>
              <button onClick={() => selectTier(cat.key)}
                      style={{ ...S.ghostBtn, fontSize: 10, padding: '2px 8px' }}>
                {(byTier[cat.key] || []).every((i) => isSelected(i.id)) ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div style={reviewGrid}>
              {(onlyFlagged ? byTier[cat.key].filter((i) => i.quality?.flag) : byTier[cat.key]).map((item) => (
                <div key={item.id} style={{ position: 'relative' }}>
                  {/* Once anything is selected, clicking selects rather than opens —
                      otherwise a stray click mid-selection loses the lot. */}
                  {item.media_type === 'video' || item.type === 'video' ? (
                    <div onClick={(e) => selecting ? toggle(item, e.shiftKey) : setLightbox(ordered.indexOf(item))}
                         style={{ ...reviewThumb, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, cursor: 'pointer',
                                  outline: isSelected(item.id) ? `2px solid ${colors.accent}` : 'none', outlineOffset: -2 }}>🎬</div>
                  ) : (
                    <LazyThumb src={mediaUrl(item.r2_key)} alt=""
                               onClick={(e) => selecting ? toggle(item, e.shiftKey) : setLightbox(ordered.indexOf(item))}
                               style={{ ...reviewThumb, cursor: 'pointer',
                                        outline: isSelected(item.id) ? `2px solid ${colors.accent}` : 'none', outlineOffset: -2,
                                        opacity: selecting && !isSelected(item.id) ? 0.55 : 1 }} />
                  )}
                  {item.quality?.flag && (
                    <div style={flagChip}>{item.quality.flag}</div>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); toggle(item, e.shiftKey); }}
                          title={isSelected(item.id) ? 'Deselect' : 'Select'}
                          style={{ ...selectDot, background: isSelected(item.id) ? colors.accent : 'rgba(0,0,0,0.55)',
                                   color: isSelected(item.id) ? '#1A1714' : '#fff' }}>
                    {isSelected(item.id) ? '✓' : ''}
                  </button>
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

        {selected.length > 0 && (
          <div style={bulkBar}>
            <span style={{ fontFamily: sans, fontSize: 13, color: colors.text }}>
              {selected.length} selected
            </span>
            <select defaultValue="" disabled={bulkBusy}
                    onChange={(e) => { if (e.target.value) { onBulkMove(e.target.value); e.target.value = ''; } }}
                    style={{ ...S.input, width: 'auto', padding: '6px 10px', fontSize: 12 }}>
              <option value="">Move to…</option>
              {categories.map((c2) => <option key={c2.key} value={c2.key}>{c2.label}</option>)}
            </select>
            <button onClick={onBulkDelete} disabled={bulkBusy}
                    style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px', color: '#D99A9A',
                             borderColor: 'rgba(156,90,90,0.35)', opacity: bulkBusy ? 0.5 : 1 }}>
              {bulkBusy ? '…' : `Remove ${selected.length}`}
            </button>
            <button onClick={() => setSelected([])} disabled={bulkBusy}
                    style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px' }}>
              Cancel
            </button>
          </div>
        )}

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
                : <img key={current.id} src={mediaUrl(current.r2_key)} alt=""
                       onLoad={(e) => { e.target.style.opacity = 1; }}
                       style={{ ...lightboxMedia, opacity: 0, transition: 'opacity 0.15s' }} />}

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
const seqGrid   = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 10 };
const seqTile   = { position: 'relative', cursor: 'grab', borderRadius: 6, overflow: 'hidden' };
const seqBadge  = { position: 'absolute', bottom: 4, left: 4, background: 'rgba(0,0,0,0.7)', color: '#fff', fontFamily: mono, fontSize: 10, padding: '2px 6px', borderRadius: 4 };
const seqCover  = { position: 'absolute', top: 4, left: 4, background: colors.accent, color: '#1A1714', fontFamily: sans, fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4 };
const seqToFront = { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 12, cursor: 'pointer', padding: 0, lineHeight: 1 };
const seqBar    = { position: 'sticky', bottom: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: '#100F0C', border: `1px solid ${colors.accent}`, borderRadius: 10, padding: '12px 14px', marginTop: 16, zIndex: 5 };

const reviewGrid    = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 10 };
const reviewThumb   = { width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 6, border: `1px solid ${colors.border}`, background: 'rgba(255,255,255,0.03)', display: 'block' };
const flagChip  = { position: 'absolute', bottom: 4, left: 4, background: 'rgba(217,164,92,0.9)', color: '#1A1714', fontFamily: sans, fontSize: 9, padding: '2px 6px', borderRadius: 4, pointerEvents: 'none' };
const selectDot = { position: 'absolute', top: 4, left: 4, width: 20, height: 20, borderRadius: '50%', border: `1px solid rgba(255,255,255,0.35)`, fontSize: 11, lineHeight: 1, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' };
const bulkBar   = { position: 'sticky', bottom: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: '#100F0C', border: `1px solid ${colors.accent}`, borderRadius: 10, padding: '12px 14px', marginTop: 16, zIndex: 5 };
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

const uLabel      = { fontFamily: mono, fontSize: 10, color: colors.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 };
const uValue      = { fontFamily: display, fontSize: 28, color: colors.text, fontWeight: 300 };
const uSub        = { fontFamily: sans, fontSize: 11, color: colors.muted, marginTop: 6, lineHeight: 1.5 };
const unlockRow   = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: 'rgba(255,255,255,0.02)', border: `1px solid ${colors.border}`, borderRadius: 8, padding: '10px 12px' };
const unlockOverlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)', zIndex: 250, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 };
const unlockModal = { width: '100%', maxWidth: 760, maxHeight: '86vh', overflowY: 'auto', background: '#161410', border: `1px solid ${colors.border}`, borderRadius: 14, padding: 24 };

const photogChip = { display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(193,125,74,0.12)', border: `1px solid rgba(193,125,74,0.3)`, color: colors.accent, fontFamily: sans, fontSize: 12, padding: '4px 8px 4px 10px', borderRadius: 999 };
const chipX      = { background: 'none', border: 'none', color: colors.accent, fontSize: 14, cursor: 'pointer', padding: 0, lineHeight: 1 };

const pricingBox = { marginTop: 12, background: 'rgba(255,255,255,0.02)', border: `1px solid ${colors.border}`, borderRadius: 8, padding: 14 };
const priceTbl   = { width: '100%', borderCollapse: 'collapse', fontFamily: sans, fontSize: 12 };
const priceTh    = { textAlign: 'left', padding: '6px 8px', borderBottom: `1px solid ${colors.border}`, color: colors.muted, fontFamily: mono, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' };
const priceTd    = { padding: '7px 8px', borderBottom: `1px solid ${colors.border}`, color: colors.muted, verticalAlign: 'top' };

const rowActions = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTop: `1px solid ${colors.border}` };
const actionBtn  = { ...S.ghostBtn, fontSize: 12, padding: '6px 12px', whiteSpace: 'nowrap' };

const storageBox = { background: 'rgba(255,255,255,0.02)', border: `1px solid ${colors.border}`, borderRadius: 10, padding: 16, marginTop: 28 };

const addPanel = { background: 'rgba(193,125,74,0.05)', border: '1px solid rgba(193,125,74,0.2)', borderRadius: 8, padding: 16, marginBottom: 14 };

const fieldLabel = { fontFamily: sans, fontSize: 12, color: colors.muted, marginBottom: 6 };
const fileGrid   = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 6 };
const fileCard   = { background: '#0D0C0A', border: '1px solid', borderRadius: 6, padding: 6, position: 'relative' };
const removeBtn  = { position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.6)', border: 'none', color: '#F2EBE0', fontSize: 10, padding: '2px 5px', borderRadius: 4, cursor: 'pointer' };