// studio/src/sections/Content.jsx
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { createCompressPool } from '../workers/compressPool';
import { Selfies } from './Selfies';
import { SectionTabs } from '../components/SectionTabs';
import ShareLink from '../components/ShareLink';
import { T, S, Card, Eyebrow, Field, TokenField, colors } from '../ui';

const TOKEN_RATE   = 66;
const MAX_IMG_PX   = 2048;
const JPEG_Q       = 0.85;
const MAX_VIDEO_MB = 500;
const R2_PUBLIC_URL = import.meta.env.VITE_R2_PUBLIC_URL || '';

// Every tier a photo can sit in. Used by the review screen and the per-item
// menus — not by the upload form, which no longer asks.
const CATEGORIES = [
  { key: 'free',          label: 'Free',           color: '#8FC88F' },
  { key: 'community',     label: 'Community',      color: '#9B8F83' },
  { key: 'insider',       label: 'Insider',        color: '#C17D4A' },
  { key: 'premium',       label: 'Premium',        color: '#D9A45C' },
  { key: 'supreme',       label: 'Supreme',        color: '#EBC49A' },
  { key: 'purchase_only', label: 'Purchase-only',  color: '#D99A9A' },
];

// What the upload form asks, which is only the one thing it has to: whether
// this is an ordinary set or a purchase-only one. Those two cannot mix, so it
// is a real decision. Which tier each photo belongs to is not — that is decided
// while looking at the photo, in the review pass, and sorting several hundred
// files into five folders beforehand was work done blind.
//
// Ordinary uploads land at Supreme, the most restrictive tier, and the review
// moves them down. Anything not yet looked at is therefore never more visible
// than it should be, and a set cannot go live while any photo is still there.
const UPLOAD_BUCKETS = [
  { key: 'unsorted',      label: 'Photos & videos', color: '#D9A45C',
    note: 'No tier yet — one is given to each while reviewing.' },
  { key: 'purchase_only', label: 'Purchase-only',   color: '#D99A9A',
    note: 'Bought outright. Never mixes with the above.' },
];

// Content categories — what KIND of set this is, shown to fans for browsing.
// Fully separate from the tier categories above, which govern pricing/access.
// A collection set is bought whole, so there are no tiers to sort into and no
// purchase-only distinction to draw — everything here is purchased. One place
// to put files is the entire question.
const COLLECTION_BUCKETS = [
  { key: 'unsorted', label: 'Files', color: '#D9A45C', note: 'Reviewed before it goes out.' },
];

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
  // Both what the upload form offers and every tier, because a set opened for
  // editing may still hold files picked under an older shape.
  [...UPLOAD_BUCKETS, ...CATEGORIES].forEach((c) => { obj[c.key] ||= []; });
  return obj;
}

// One screen, two lists. `collection` decides which the page asks for and which
// a new set is created in — from the page itself rather than from a control on
// it, so there is nothing to tick wrongly and no way to upload to one list while
// looking at the other.
export function Content({ openWith, collection = false }) {
  // Nothing in a collection is free, so free is not a tier that can be picked
  // there by accident.
  const reviewCategories = collection ? CATEGORIES.filter((c) => c.key !== 'free') : CATEGORIES;
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

  // How much of the original survives into the shared link preview, as a
  // percentage of the cover's width. The card is built by shrinking to this and
  // then stretching back up, so the detail that is gone is genuinely gone — it
  // is not a filter sitting over a full-resolution image that a reader mode or a
  // dev tools panel could strip away.
  //
  // 3% of a 2400px cover is 72px. Lower reads as pure colour; higher starts to
  // resolve into a recognisable photograph, and a link preview is public — it
  // appears in group chats and timelines belonging to people who have not paid
  // and have not chosen to look.
  const OG_PERCENT = 3;

  // The preview image for a shared gallery link. Written to storage as a real
  // file with a real URL, because a data URI cannot be used here: no platform
  // will fetch one as a preview image, which is why cover_blur cannot serve.
  //
  // 1200x630 is the size every platform expects, and images much smaller than
  // that are refused outright. So the tiny version is drawn back up to full card
  // size — a large file carrying very little information.
  const makeShareCard = async (file) => {
    try {
      const bitmap = await createImageBitmap(file);
      const W = 1200, H = 630;

      const smallW = Math.max(8, Math.round((bitmap.width * OG_PERCENT) / 100));
      const smallH = Math.max(8, Math.round((bitmap.height / bitmap.width) * smallW));

      const mk = (w, h) => (typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(w, h)
        : Object.assign(document.createElement('canvas'), { width: w, height: h }));

      // Down first, then up. Drawing straight to 1200x630 from the original
      // would simply be the photograph at card size.
      const small = mk(smallW, smallH);
      small.getContext('2d').drawImage(bitmap, 0, 0, smallW, smallH);

      const card = mk(W, H);
      const ctx  = card.getContext('2d');
      ctx.fillStyle = '#1A1714';
      ctx.fillRect(0, 0, W, H);

      // Cover the card rather than stretch to it, so the proportions of the
      // original are kept and a portrait cover is not squashed into landscape.
      const scale = Math.max(W / smallW, H / smallH);
      const dw = smallW * scale, dh = smallH * scale;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(small, (W - dw) / 2, (H - dh) / 2, dw, dh);
      bitmap.close?.();

      const blob = card.convertToBlob
        ? await card.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
        : await new Promise((res) => card.toBlob(res, 'image/jpeg', 0.8));
      if (!blob) return null;
      // The name is only read for its extension — presign assigns the actual
      // object key as a fresh uuid, so nothing here has to be unique.
      return await uploadFile(new File([blob], 'share-card.jpg', { type: 'image/jpeg' }), 'content');
    } catch { return null; }
  };

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
      const targets = sets.filter((s) => (!s.cover_blur || !s.cover_og_key) && (s.cover_url || s.cover_key));
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
          const file = new File([blob], 'cover.jpg', { type: blob.type });

          // Only what is actually missing is regenerated, so re-running this
          // after adding share cards does not redo work already done — and does
          // not upload a second copy of an image already sitting in storage.
          const patch = {};
          if (!set.cover_blur)   patch.cover_blur   = await makeCoverBlur(file);
          if (!set.cover_og_key) patch.cover_og_key = await makeShareCard(file);

          if (!patch.cover_blur && !patch.cover_og_key) { failed += 1; continue; }
          await api.patch(`/api/studio/content/${set.id}`, patch);
          done += 1;
        } catch { failed += 1; }
      }
      setSuccess(`Updated ${done} set${done === 1 ? '' : 's'}${failed ? `, ${failed} could not be read` : ''}.`);
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

  const loadSets = () => api.get(`/api/studio/content${collection ? '?collection=1' : ''}`).then((d) => setSets(d.sets || []));
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

  // Applied in place rather than by refetching. A pass through a few hundred
  // photos flags one every second or two, and reloading the whole set each time
  // would put the grid behind the person using it.
  const [removingMarked, setRemovingMarked] = useState(false);
  const [publishPrompt,  setPublishPrompt]  = useState(null);

  // The marked pile, removed together. Kept here rather than in the panel
  // because it changes the set the parent holds, and the panel should not be
  // reaching around it to say so.
  const deleteMarked = async () => {
    if (!reviewSet) return;
    setRemovingMarked(true);
    setError('');
    try {
      const d = await api.post(`/api/studio/content/${reviewSet.id}/delete-marked`, {});
      setReviewItems((prev) => prev.filter((i) => i.review_flag !== 'remove'));
      setSuccess(`Removed ${d.deleted} photo${d.deleted === 1 ? '' : 's'}.`);
    } catch (err) { setError(err.message); }
    finally { setRemovingMarked(false); }
  };

  const applyItemPatch = (ids, patch) => {
    setReviewItems((prev) => prev.map((i) => (ids.includes(i.id) ? { ...i, ...patch } : i)));
  };
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

  const bulkMove = async (target) => {
    setBulkBusy(true); setError('');
    try {
      // Two queues in a collection, tiers everywhere else. The same control,
      // moving whatever that library actually has to move between.
      if (target === '__keep' || target === '__remove') {
        const flag = target === '__remove' ? 'remove' : null;
        const d = await api.post('/api/studio/content/items/flag', { itemIds: selected, flag });
        const patch = { review_flag: flag, reviewed_at: new Date().toISOString() };
        setReviewItems((prev) => prev.map((i) => selected.includes(i.id) ? { ...i, ...patch } : i));
        setSuccess(`Moved ${d.updated} item${d.updated === 1 ? '' : 's'}.`);
      } else {
        const d = await api.post('/api/studio/content/items/move', { itemIds: selected, tierCategory: target });
        setReviewItems((prev) => prev.map((i) =>
          selected.includes(i.id) ? { ...i, tier_category: target } : i));
        setSuccess(`Moved ${d.moved} item${d.moved === 1 ? '' : 's'}.`);
      }
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
      // No toast. This now fires once per keystroke through a whole set, and a
      // message that appears several hundred times says nothing.
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
    // Both, so anything picked under the older six-bucket form still uploads.
    [...UPLOAD_BUCKETS, ...CATEGORIES].forEach((cat) => {
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
          // 'unsorted' is the form's word for having made no choice, so it goes
          // as null. The column stays empty until the review gives it a tier,
          // which is what puts the photo in the Unsorted section rather than
          // hiding it inside whichever tier it was defaulted to.
          position: startPosition + n, tierCategory: cat === 'unsorted' ? null : cat,
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
        isCollection: collection,
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
          cover_og_key: await makeShareCard(coverFile),
        });
      }

      const { uploaded, firstImageUrl, firstImageFile } = await uploadAllPending(setId, 0);
      if (!coverUrl && firstImageUrl) {
        coverUrl = firstImageUrl;
        await api.patch(`/api/studio/content/${setId}`, {
          cover_key: firstImageUrl,
          cover_blur: firstImageFile ? await makeCoverBlur(firstImageFile) : null,
          cover_og_key: firstImageFile ? await makeShareCard(firstImageFile) : null,
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
      await pushSetEdit(id, {});
    } catch (err) { setError(err.message); }
  };

  // Publishing can come back asking a question rather than refusing.
  //
  // Unsorted photos are a refusal — there is nothing to decide, the work simply
  // is not done. Marked ones are a question: they are going either way, and the
  // only thing in doubt is whether to look at them once more first. So the
  // second case asks, and carries the answer back as removeMarked.
  const pushSetEdit = async (id, extra) => {
    try {
      const data = await api.patch(`/api/studio/content/${id}`, {
        ...editForm, price_coins: parseInt(editForm.price_coins), ...extra,
      });
      setSets((prev) => prev.map((s2) => s2.id === id
        ? { ...data.set, cover_url: s2.cover_url, categoryCounts: s2.categoryCounts } : s2));
      setEditing(null);
      setSuccess(extra.removeMarked ? 'Marked photos removed, and the set is live.' : 'Updated.');
    } catch (err) {
      if (err.code === 'MARKED_ITEMS') { setPublishPrompt({ id, marked: err.body?.marked || 0 }); return; }
      throw err;
    }
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
      <Eyebrow>{collection ? 'Collections' : 'Gallery'}</Eyebrow>
      <T.title>{collection ? 'Collections' : 'Gallery'}</T.title>

      {collection && (
        <p style={{ fontFamily: sans, fontSize: 13, color: colors.muted, lineHeight: 1.7, marginBottom: 18, maxWidth: 660 }}>
          Seen only by members who have earned it, and never announced — no drop
          message, nothing in the gallery, nothing in a share link. Everything here
          is bought; there is no free tier and no allowance.
        </p>
      )}

      {/* Selfie of the Day belongs to the gallery. Offering it here would be a
          second way to put something in the wrong place, which is the thing
          having two pages is meant to prevent. */}
      {!collection && (
        <SectionTabs
          tabs={[
            { key: 'sets',    label: 'Media' },
            { key: 'selfies', label: 'Selfie of the Day' },
          ]}
          active={tab} onChange={setTab}
        />
      )}

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

        {/* The gallery sorts sets into browsing categories. A collection has
            two sections and works out which from what the set holds, so there
            is nothing to choose. */}
        {!collection && (
          <div style={{ marginTop: 16 }}>
            <Field label="Content category — how this set is browsed by fans">
              <select style={S.input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CONTENT_CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </Field>
          </div>
        )}

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
            Media ({totalFileCount} {totalFileCount === 1 ? 'item' : 'items'})
          </div>
          <p style={{ fontFamily: sans, fontSize: 11, color: colors.muted, marginBottom: 10, lineHeight: 1.5 }}>
            A set is either an ordinary one or purchase-only, never both — adding a file to one side locks the other, so the base price never gets split unexpectedly.
          </p>
          <div style={{ display: 'grid', gap: 14 }}>
            {(collection ? COLLECTION_BUCKETS : UPLOAD_BUCKETS).map((cat) => {
              const files = filesByCategory[cat.key];
              const isPurchaseOnly = cat.key === 'purchase_only';
              const tierCategoriesHaveFiles = filesByCategory.unsorted.length > 0
                || CATEGORIES.filter((c) => c.key !== 'purchase_only').some((c) => filesByCategory[c.key].length > 0);
              const purchaseOnlyHasFiles = filesByCategory.purchase_only.length > 0;
              const isLocked = isPurchaseOnly ? tierCategoriesHaveFiles : purchaseOnlyHasFiles;

              return (
                <div key={cat.key} style={{ border: `1px solid ${colors.border}`, borderRadius: 8, padding: 12, opacity: isLocked ? 0.4 : 1, pointerEvents: isLocked ? 'none' : 'auto' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: files.length > 0 ? 10 : 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: cat.color, display: 'inline-block' }} />
                      <span style={{ fontFamily: sans, fontSize: 13, color: colors.text, fontWeight: 600 }}>{cat.label}</span>
                      <span style={{ fontFamily: sans, fontSize: 11, color: colors.muted }}>({files.length})</span>
                      <span style={{ fontFamily: sans, fontSize: 10, color: colors.muted }}>· {cat.note}</span>
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
                    {collection
                      ? 'New photos are added unreviewed, and go through the same pass as the rest. Existing ones are untouched, so this is also how you finish an interrupted upload.'
                      : 'New items are appended to the tier you choose. Existing items are untouched, so this is also how you finish a set whose upload was interrupted.'}
                  </div>
                  <div style={{ display: 'grid', gap: 10 }}>
                    {/* A collection set has one place for files. Offering the
                        tier list here offered to put photos somewhere it does
                        not have, which is how a set ends up with items nothing
                        will ever show. */}
                    {(collection ? COLLECTION_BUCKETS : CATEGORIES).filter((cat) => {
                      if (collection) return true;
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

              {publishPrompt?.id === set.id ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontFamily: sans, fontSize: 14, color: colors.text }}>
                    {publishPrompt.marked} photo{publishPrompt.marked === 1 ? ' is' : 's are'} marked for removal in <strong>"{set.title}"</strong>.
                  </div>
                  <div style={{ fontFamily: sans, fontSize: 12, color: colors.muted }}>
                    Publishing will remove them first. They cannot be recovered.
                  </div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button onClick={async () => {
                              const id = publishPrompt.id;
                              setPublishPrompt(null);
                              try { await pushSetEdit(id, { removeMarked: true }); }
                              catch (err) { setError(err.message); }
                            }}
                            style={{ ...S.btn }}>
                      Remove them and publish
                    </button>
                    <button onClick={() => { setPublishPrompt(null); setEditing(null); openReview(set); }} style={S.ghostBtn}>
                      Look at them first
                    </button>
                    <button onClick={() => setPublishPrompt(null)} style={S.ghostBtn}>Cancel</button>
                  </div>
                </div>
              ) : confirmDelete === set.id ? (
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
                  {/* Only for a published set. A link to something still hidden
                      would land the person on a page that will not show it, and
                      the preview would fall back to the site's own card. */}
                  {set.visible && <ShareLink kind="gallery" id={set.id} title={set.title} />}
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
          onItemsChanged={applyItemPatch}
          onDeleteMarked={deleteMarked}
          removingMarked={removingMarked}
          mediaUrl={toUrl}
          categories={reviewCategories}
          collection={collection}
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
function SequenceView({ items, mediaUrl, busy, onSave, groupOf = {} }) {
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

  // Frames of the same moment brought together, keeping the order they were
  // taken in and holding each run where its first frame already sat. A burst
  // scattered through a set reads as repetition; the same frames adjacent read
  // as a sequence, which is what they are.
  const gatherAlike = () => {
    const runs = new Map();
    const singles = [];
    list.forEach((it) => {
      const g = groupOf[it.id];
      if (g === undefined) { singles.push(it); return; }
      if (!runs.has(g)) runs.set(g, []);
      runs.get(g).push(it);
    });
    const out = [];
    const placed = new Set();
    list.forEach((it) => {
      const g = groupOf[it.id];
      if (g === undefined) { out.push(it); return; }
      if (placed.has(g)) return;
      placed.add(g);
      out.push(...runs.get(g));
    });
    setList(out);
  };

  // Whether any run is currently split apart in this order. A run whose frames
  // already sit together needs no gathering, and a button that cannot change
  // anything should not be offered — the previous version was shown whenever a
  // run existed at all, and because runs were then found among consecutive
  // frames only, they were always already adjacent. It could never do anything.
  const runCount = new Set(Object.values(groupOf)).size;

  const scattered = (() => {
    const seen = new Map();
    for (let i = 0; i < list.length; i++) {
      const g = groupOf[list[i].id];
      if (g === undefined) continue;
      if (seen.has(g) && seen.get(g) !== i - 1) return true;   // a gap opened
      seen.set(g, i);
    }
    return false;
  })();

  return (
    <div>
      {/* Says what was found either way. A button that simply is not there gives
          no clue whether nothing matched, or everything matched and is already
          in order — and those need different responses from whoever is looking. */}
      {runCount > 0 && (
        <div style={{ fontFamily: mono, fontSize: 10, color: colors.muted, marginBottom: 8 }}>
          {runCount} similar run{runCount === 1 ? '' : 's'} found
          {scattered ? ' · some are split up' : ' · already together'}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {scattered && (
          <button onClick={gatherAlike} disabled={busy} style={seqAction}>
            Bring similar shots together
          </button>
        )}
        {/* A camera or a card reader hands files over newest first often enough
            that fixing it by dragging is not worth anybody's afternoon. This is
            the whole of the fix, and like every other change here it waits to
            be saved — so a wrong guess costs one press of Undo. */}
        {list.length > 1 && (
          <button onClick={() => setList([...list].reverse())} disabled={busy} style={seqAction}>
            Reverse the order
          </button>
        )}
      </div>
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

function ReviewPanel({ set, items, loading, onClose, onDelete, onRetier, onItemsChanged, onDeleteMarked, removingMarked, deletingItem, collection = false, lightbox, setLightbox, mediaUrl, categories,
                       selected, setSelected, onBulkMove, onBulkDelete, bulkBusy,
                       ordering, setOrdering, onSaveOrder, orderBusy }) {
  // Grouped for the grid, but navigation runs across the whole set in the order
  // shown. A shoot produces near-identical frames, so being able to step through
  // them without leaving the large view is the only way to tell them apart.
  // Unsorted is its own section, not a count. A photo that has not been looked
  // at needs to be findable and openable, and a number at the top of the screen
  // is neither — it says work remains without saying which work.
  //
  // It is a view rather than a stored value: an unreviewed photo still carries
  // the tier it was uploaded at, so nothing in pricing has to learn a new
  // category. Assigning a tier sets reviewed_at, and the photo leaves this
  // section for its own.
  // A collection set is bought whole, so its photos have no tier to be sorted
  // into and nothing to be unsorted from. The only distinction left is whether
  // a photo is staying.
  // A collection photo has no tier, so the only question is whether it stays.
  // Three states, not two: one nobody has looked at is not the same as one that
  // has been kept, and without the distinction there is no way to tell how much
  // of a set is still to go through.
  const REVIEW_SECTIONS = collection
    ? [
        { key: '__unsorted', label: 'Not yet reviewed', color: '#D9A45C' },
        { key: '__all',      label: 'Keeping',          color: '#8FC88F' },
        { key: '__remove',   label: 'To be removed',    color: '#D99A9A' },
      ]
    : [
        { key: '__unsorted', label: 'Unsorted', color: '#D9A45C' },
        ...categories,
        { key: '__remove',   label: 'To be removed', color: '#D99A9A' },
      ];

  // Where a photo sits is decided by what it has, not by a separate record of
  // whether somebody looked. A photo arrives with no tier at all and sits in
  // Unsorted until one is given; marked ones gather at the bottom whatever tier
  // they had. Grouping on the same fields the keys write means the sections
  // cannot disagree with the data.
  const byTier = {};
  items.forEach((i) => {
    const key = i.review_flag === 'remove' ? '__remove'
              : collection                  ? (i.reviewed_at ? '__all' : '__unsorted')
              : !i.tier_category            ? '__unsorted'
              :                               i.tier_category;
    (byTier[key] ||= []).push(i);
  });
  // Unsorted first, so opening the first photo starts where the work is.
  const ordered = REVIEW_SECTIONS.flatMap((cat) => byTier[cat.key] || []);
  const [blurThreshold, setBlurThreshold] = useState(null);

  useEffect(() => {
    api.get('/api/studio/config')
      .then((d) => setBlurThreshold(Number(d.config?.quality_blur_threshold) || 60))
      .catch(() => setBlurThreshold(60));
  }, []);

  // The only filter left. A photo marked for removal is the one thing that
  // still needs finding again after the pass.

  // How many bits two hashes may differ by and still be the same moment.
  //
  // Twelve of sixty-four for frames that sit next to each other: loose enough
  // that a burst holds together when the exposure shifted between frames, and
  // that a slow pan does not break into pieces halfway through.
  const NEAR = 12;

  // Six for frames that do not. A burst can arrive split — half of it uploaded,
  // something else in between, the rest after — and those halves belong
  // together. But comparing every frame with every other is exactly what the
  // consecutive-only rule was avoiding: 250 photos of one outfit against one
  // background are all somewhat alike, and at twelve bits the whole set becomes
  // a single run.
  //
  // So the far comparison is held to half the distance. Six of sixty-four means
  // the same framing and the same pose, which two genuinely different shots do
  // not share — a change of pose alone moves far more than six bits.
  const NEAR_FAR = 6;

  // The most frames one moment can hold. A burst is a moment, not a shoot — a
  // group past this is the distance drifting rather than a run, and refusing
  // the join is better than declaring half a set one moment.
  //
  // Applies only to the far pass. A long consecutive run found by the neighbour
  // pass is trustworthy on its own and is left alone however long it is.
  const MAX_RUN = 40;

  const hamming = (a, b) => {
    if (!a || !b || a.length !== b.length) return 99;
    let d = 0;
    for (let i = 0; i < a.length; i++) {
      let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
      while (x) { d += x & 1; x >>= 1; }
    }
    return d;
  };

  // Runs of near-identical frames, in two passes.
  //
  // The first walks the photos in order and joins each to the one before it
  // where they are close. That is what a burst is, and comparing neighbours is
  // what keeps a long sequence of similar work from collapsing into one lump.
  //
  // The second compares every remaining pair regardless of position, at the
  // tighter distance, so a burst that arrived in two pieces is recognised as
  // one. Both passes feed the same union-find, so a frame joined by either
  // route ends up in the same group as everything else that moment contains.
  const nearGroups = (() => {
    const seq = items.filter((i) => i.quality?.hash);
    if (seq.length < 2) return [];

    const parent = seq.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };

    // Pass one — neighbours.
    for (let i = 1; i < seq.length; i++) {
      if (hamming(seq[i - 1].quality.hash, seq[i].quality.hash) <= NEAR) union(i - 1, i);
    }

    // Pass two — everything else, best matches first.
    //
    // Not a straight sweep of every pair, because union-find is transitive: if
    // A matches B and B matches C, all three merge even where A and C are
    // nothing alike. Across a few hundred photos of one outfit in one room that
    // chains, and the whole set becomes a single group.
    //
    // So candidates are collected, sorted by how close they are, and applied
    // tightest first — and any join that would push a group past MAX_RUN is
    // refused. A burst is a moment, not a shoot; beyond a few dozen frames the
    // match is drift rather than sameness.
    const candidates = [];
    for (let i = 0; i < seq.length; i++) {
      for (let j = i + 2; j < seq.length; j++) {
        const d = hamming(seq[i].quality.hash, seq[j].quality.hash);
        if (d <= NEAR_FAR) candidates.push([d, i, j]);
      }
    }
    candidates.sort((a, b) => a[0] - b[0]);

    const sizeOf = {};
    seq.forEach((_, i) => { sizeOf[find(i)] = (sizeOf[find(i)] || 0) + 1; });
    let farJoins = 0;
    for (const [, i, j] of candidates) {
      const ra = find(i), rb = find(j);
      if (ra === rb) continue;
      if ((sizeOf[ra] || 1) + (sizeOf[rb] || 1) > MAX_RUN) continue;
      const merged = (sizeOf[ra] || 1) + (sizeOf[rb] || 1);
      union(i, j);
      const nr = find(i);
      sizeOf[nr] = merged;
      farJoins += 1;
    }

    // Kept in the order the photos appear, so a run's position in the set is
    // the position of its first frame.
    const byRoot = new Map();
    seq.forEach((it, i) => {
      const r = find(i);
      if (!byRoot.has(r)) byRoot.set(r, []);
      byRoot.get(r).push(it);
    });
    const groups = [...byRoot.values()].filter((g) => g.length > 1);
    groups.farJoins = farJoins;
    return groups;
  })();

  const groupOf = {};
  nearGroups.forEach((g, gi) => g.forEach((it) => { groupOf[it.id] = gi; }));
  const markedCount   = items.filter((i) => i.review_flag === 'remove').length;
  // In a collection, unreviewed means nobody has pressed 1 or 0 on it yet.
  // Elsewhere it means no tier has been given.
  const unsortedCount = collection
    ? items.filter((i) => !i.reviewed_at && i.review_flag !== 'remove').length
    : items.filter((i) => !i.tier_category && i.review_flag !== 'remove').length;

  // The sequence stepped through, fixed for as long as the large view is open.
  //
  // ordered is rebuilt from the sections on every render, and giving a photo a
  // tier moves it out of Unsorted into its own section further down. Everything
  // after it shifts up by one, so the next photo slides into the index just
  // used — and advancing by one stepped straight over it. Every second photo
  // went unseen, which is why Unsorted never emptied however many passes were
  // made.
  //
  // Frozen, the sequence is whatever was on screen when the view opened, and a
  // keystroke always lands on the photo being looked at.
  const [frozenOrder, setFrozenOrder] = useState(null);
  useEffect(() => {
    if (typeof lightbox === 'number') setFrozenOrder((prev) => prev || ordered);
    else setFrozenOrder(null);
  }, [lightbox]);
  const walk = frozenOrder || ordered;

  const at = typeof lightbox === 'number' ? lightbox : -1;
  // Position comes from the frozen sequence; the tier and mark shown are read
  // back from the live items, so the footer reflects what was just pressed.
  const walkItem = at >= 0 ? walk[at] : null;
  const current = walkItem ? (items.find((i) => i.id === walkItem.id) || walkItem) : null;

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

  // Takes the rows rather than a tier key, because Unsorted is a section on the
  // screen and not a tier anything is stored in.
  const selectSection = (rows) => {
    const ids = rows.map((i) => i.id);
    const allIn = ids.every((id) => selected.includes(id));
    setSelected(allIn ? selected.filter((id) => !ids.includes(id))
                      : [...new Set([...selected, ...ids])]);
  };

  const go = (delta) => {
    if (at < 0) return;
    const next = at + delta;
    if (next >= 0 && next < walk.length) setLightbox(next);
  };

  // Sorting the photo in front of you, by number.
  //
  // A number sets the tier and moves on. Doing it here rather than afterwards
  // means the set is sorted by the time the pass ends, instead of leaving a few
  // hundred photos to be dragged into place later — which is the part of this
  // job nobody does willingly.
  //
  // 0 marks for removal rather than deleting. Every other key is reversible: a
  // mis-hit tier is fixed by pressing the right one. Deletion is not, and a pass
  // through near-identical frames at one keystroke a second is exactly when a
  // finger lands one key across. The marked photos gather in their own tab and
  // go in a single deliberate act, once somebody has looked at the pile.
  const TIER_KEYS = { 1: 'free', 2: 'community', 3: 'insider', 4: 'premium', 5: 'supreme' };

  const sortHere = async (tier) => {
    if (!current) return;
    try {
      await onRetier(current, tier, { keepLightbox: true });
      onItemsChanged?.([current.id], { tier_category: tier, review_flag: null, reviewed_at: new Date().toISOString() });
    } catch { /* the tier is unchanged and the pass can go on */ }
    go(1);
  };

  // Kept: reviewed, and not going. Also the way back out of the removal queue,
  // which had no way back at all — a mis-hit 0 could only be undone by leaving
  // the photo there.
  const keepHere = async () => {
    if (!current) return;
    try {
      await api.post('/api/studio/content/items/flag', { itemIds: [current.id], flag: null });
      onItemsChanged?.([current.id], { review_flag: null, reviewed_at: new Date().toISOString() });
    } catch { /* leaving it unreviewed is safe */ }
    go(1);
  };

  const markRemove = async () => {
    if (!current) return;
    try {
      await api.post('/api/studio/content/items/flag', { itemIds: [current.id], flag: 'remove' });
      onItemsChanged?.([current.id], { review_flag: 'remove', reviewed_at: new Date().toISOString() });
    } catch { /* leaving it unmarked is safe */ }
    go(1);
  };

  useEffect(() => {
    if (at < 0) return;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // In a collection there is no tier to assign, so 1 is the whole of the
      // other answer: keep it. Anywhere else the numbers are tiers.
      if (collection && e.key === '1') { e.preventDefault(); keepHere(); return; }
      if (!collection && TIER_KEYS[e.key]) { e.preventDefault(); sortHere(TIER_KEYS[e.key]); return; }
      if (e.key === '0')    { e.preventDefault(); markRemove(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); go(-1); }
      if (e.key === 'Escape')     { e.preventDefault(); setLightbox(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [at, walk.length, current]);

  // Warm the next image so stepping forward feels instant. Deliberately modest:
  // holding down the arrow key through a few hundred photos would otherwise
  // queue up more requests than the connection can finish, and the picture you
  // are actually looking at ends up behind them all. Delayed slightly so a fast
  // scroll past a photo does not fetch it at all.
  useEffect(() => {
    if (at < 0) return;
    const t = setTimeout(() => {
      [walk[at + 1], walk[at - 1]].forEach((it) => {
        if (it && it.media_type !== 'video') { const img = new Image(); img.src = mediaUrl(it.r2_key); }
      });
    }, 250);
    return () => clearTimeout(t);
  }, [at]);

  // Deleting from the large view should keep you where you are rather than
  // throwing you back to the grid — the point is to work through a set in a pass.
  const deleteHere = async () => {
    if (!current) return;
    const wasLast = at >= walk.length - 1;
    await onDelete(current, { keepLightbox: true });
    if (walk.length <= 1) setLightbox(null);
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

        {/* The one destructive act in the screen. Marking is a keystroke made at
            speed; removing is not, so the marked photos gather in their own
            section and go together, once the pile has been seen. */}
        {!ordering && markedCount > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
            <button onClick={onDeleteMarked} disabled={removingMarked}
                    style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px', color: '#D99A9A', borderColor: 'rgba(217,154,154,0.5)' }}>
              {removingMarked ? 'Removing…' : `Remove all ${markedCount} marked`}
            </button>
            <span style={{ fontFamily: sans, fontSize: 11, color: colors.muted }}>
              Or leave them — publishing will offer to clear them.
            </span>
          </div>
        )}

        {!ordering && unsortedCount > 0 && (
          <div style={{ fontFamily: sans, fontSize: 11, color: colors.muted, marginBottom: 14 }}>
            {unsortedCount} still to review — open the first and press {collection ? '1 to keep, 0 to remove' : '1–5 for its tier, or 0 to mark it for removal'}.
          </div>
        )}

        {ordering ? (
          <SequenceView items={ordered} mediaUrl={mediaUrl} busy={orderBusy} onSave={onSaveOrder} groupOf={groupOf} />
        ) : loading ? <div style={{ fontFamily: sans, fontSize: 13, color: colors.muted }}>Loading…</div>
         : items.length === 0 ? <div style={{ fontFamily: sans, fontSize: 13, color: colors.muted }}>This set has no items yet.</div>
         : REVIEW_SECTIONS.filter((cat) => byTier[cat.key]?.length).map((cat) => (
          <div key={cat.key} style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
                             color: cat.key === '__unsorted' ? '#D9A45C' : colors.muted }}>
                {cat.label} · {byTier[cat.key].length}
              </span>
              {cat.key === '__unsorted' && (
                <span style={{ fontFamily: sans, fontSize: 11, color: colors.muted }}>
                  Open one and press 1–5 for its tier, or 0 to mark it for removal. The set will not publish while any remain.
                </span>
              )}
              <button onClick={() => selectSection(byTier[cat.key] || [])}
                      style={{ ...S.ghostBtn, fontSize: 10, padding: '2px 8px' }}>
                {(byTier[cat.key] || []).every((i) => isSelected(i.id)) ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div style={reviewGrid}>
              {byTier[cat.key].map((item) => (
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
                  {item.review_flag === 'remove' && (
                    <div style={{ ...flagChip, color: '#D99A9A', borderColor: 'rgba(217,154,154,0.5)' }}>to be removed</div>
                  )}
                  {groupOf[item.id] !== undefined && (
                    <div style={{ ...groupChip, background: GROUP_COLOURS[groupOf[item.id] % GROUP_COLOURS.length] }}>
                      {nearGroups[groupOf[item.id]].length} alike
                    </div>
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
                  {/* A select given a null value shows its first option instead,
                      which here is Free — so every untiered photo read as free
                      while the data said it had no tier at all. The placeholder
                      gives null something of its own to display, and being
                      disabled it cannot be chosen back. */}
                  {!collection && (
                  <select value={item.tier_category || ''} onChange={(e) => onRetier(item, e.target.value)} style={tierSelect}>
                    {!item.tier_category && <option value="" disabled>— no tier —</option>}
                    {categories.map((c2) => <option key={c2.key} value={c2.key}>{c2.label}</option>)}
                  </select>
                  )}
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
              {/* A collection has no tiers to move between, only the two
                  queues. Offering the full tier list there was offering to put
                  photos somewhere a collection set does not have. */}
              {collection
                ? [<option key="keep" value="__keep">Keeping</option>,
                   <option key="rm"   value="__remove">To be removed</option>]
                : categories.map((c2) => <option key={c2.key} value={c2.key}>{c2.label}</option>)}
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
                {at + 1} of {walk.length} · {current.tier_category ? tierLabel(current.tier_category) : 'unsorted'}
                {current.review_flag === 'remove' && ' · marked for removal'}
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

              <button onClick={() => go(1)} disabled={at >= walk.length - 1}
                      style={{ ...lbArrow, right: 8, opacity: at >= walk.length - 1 ? 0.25 : 1 }} aria-label="Next">›</button>
            </div>

            <div style={lbActions}>
              {!collection && (
              <label style={{ fontFamily: sans, fontSize: 12, color: '#B8AFA4', display: 'flex', alignItems: 'center', gap: 8 }}>
                Access level
                <select value={current.tier_category || ''}
                        onChange={(e) => onRetier(current, e.target.value)}
                        style={lbSelect}>
                  {!current.tier_category && <option value="" disabled>— no tier —</option>}
                  {categories.map((c2) => <option key={c2.key} value={c2.key}>{c2.label}</option>)}
                </select>
              </label>
              )}
              <button onClick={deleteHere} disabled={deletingItem === current.id}
                      style={{ ...lightboxDelete, opacity: deletingItem === current.id ? 0.5 : 1 }}>
                {deletingItem === current.id ? 'Removing…' : 'Remove this photo'}
              </button>
            </div>

            <div style={{ fontFamily: sans, fontSize: 11, color: '#7C736A' }}>
              {collection ? '1 keep · 0 remove · Arrows to move · Esc to close' : '1 Free · 2 Community · 3 Insider · 4 Premium · 5 Supreme · 0 mark for removal · Arrows to move · Esc to close'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const reviewOverlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 };
const reviewModal   = { width: '100%', maxWidth: 900, maxHeight: '88vh', overflowY: 'auto', background: '#161410', border: `1px solid ${colors.border}`, borderRadius: 14, padding: 24 };
const seqAction = { fontFamily: sans, fontSize: 12, padding: '6px 12px', borderRadius: 999, cursor: 'pointer', background: 'transparent', border: `1px solid ${colors.border}`, color: colors.muted };

const seqGrid   = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 10 };
const seqTile   = { position: 'relative', cursor: 'grab', borderRadius: 6, overflow: 'hidden' };
const seqBadge  = { position: 'absolute', bottom: 4, left: 4, background: 'rgba(0,0,0,0.7)', color: '#fff', fontFamily: mono, fontSize: 10, padding: '2px 6px', borderRadius: 4 };
const seqCover  = { position: 'absolute', top: 4, left: 4, background: colors.accent, color: '#1A1714', fontFamily: sans, fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4 };
const seqToFront = { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 12, cursor: 'pointer', padding: 0, lineHeight: 1 };
const seqBar    = { position: 'sticky', bottom: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: '#100F0C', border: `1px solid ${colors.accent}`, borderRadius: 10, padding: '12px 14px', marginTop: 16, zIndex: 5 };

const reviewGrid    = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 10 };
const reviewThumb   = { width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 6, border: `1px solid ${colors.border}`, background: 'rgba(255,255,255,0.03)', display: 'block' };
// Different colours so two adjacent runs read as two runs rather than one long
// one. Muted deliberately — this is a hint, not an alarm.
const GROUP_COLOURS = ['rgba(139,157,195,0.9)', 'rgba(160,180,150,0.9)', 'rgba(190,160,190,0.9)', 'rgba(200,175,140,0.9)'];
const groupChip = { position: 'absolute', top: 4, left: 4, color: '#1A1714', fontFamily: sans, fontSize: 9, padding: '2px 6px', borderRadius: 4, pointerEvents: 'none' };

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