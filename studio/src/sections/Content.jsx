// studio/src/sections/Content.jsx
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { T, S, Card, Eyebrow, Field, TokenField, colors } from '../ui';

const TOKEN_RATE   = 66;
const MAX_ITEMS    = 100;
const MAX_IMG_PX   = 2048;
const JPEG_Q       = 0.85;
const MAX_VIDEO_MB = 500;
const R2_PUBLIC_URL = import.meta.env.VITE_R2_PUBLIC_URL || '';

function toUrl(key) {
  if (!key) return null;
  if (key.startsWith('http')) return key;
  return `${R2_PUBLIC_URL}/${key}`;
}

async function compressImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { width, height } = img;
      const scale  = Math.min(1, MAX_IMG_PX / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(width  * scale);
      canvas.height = Math.round(height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })),
        'image/jpeg', JPEG_Q
      );
    };
    img.src = url;
  });
}

async function uploadFile(file, context = 'content') {
  const { uploadUrl, publicUrl } = await api.post('/api/upload/presign', {
    filename: file.name, contentType: file.type, context,
  });
  await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
  return publicUrl;
}

export function Content() {
  const [sets,    setSets]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');

  const [form, setForm] = useState({
    title: '', description: '', type: 'photo_set', price_coins: '0',
    min_tier: 'community', use_unlock_credit: true, visible: false,
  });

  const [files,          setFiles]          = useState([]);
  const [coverFile,      setCoverFile]      = useState(null);
  const [coverPreview,   setCoverPreview]   = useState('');
  const [creating,       setCreating]       = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [editing,        setEditing]        = useState(null);
  const [editForm,       setEditForm]       = useState({});
  const [deleting,       setDeleting]       = useState(null);
  const [confirmDelete,  setConfirmDelete]  = useState(null);

  const filesRef = useRef(null);
  const coverRef = useRef(null);

  useEffect(() => {
    api.get('/api/studio/content')
      .then((d) => setSets(d.sets || []))
      .finally(() => setLoading(false));
  }, []);

  const handleFilePick = async (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (picked.length + files.length > MAX_ITEMS) {
      setError(`Maximum ${MAX_ITEMS} items per set.`);
      return;
    }
    const newFiles = picked.map((f) => ({
      file: f,
      preview:  f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
      isVideo:  f.type.startsWith('video/'),
      status:   'pending',
      publicUrl: null,
      sizeMB:   (f.size / 1024 / 1024).toFixed(1),
    }));
    setFiles((prev) => [...prev, ...newFiles]);
  };

  const handleCoverPick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = '';
    setCoverFile(f);
    setCoverPreview(URL.createObjectURL(f));
  };

  const removeFile = (idx) => {
    setFiles((prev) => {
      const updated = [...prev];
      if (updated[idx].preview) URL.revokeObjectURL(updated[idx].preview);
      updated.splice(idx, 1);
      return updated;
    });
  };

  const handleCreate = async () => {
    setError(''); setSuccess(''); setCreating(true);
    try {
      const setData = await api.post('/api/studio/content', {
        title:             form.title,
        description:       form.description || null,
        type:              form.type,
        price_coins:       parseInt(form.price_coins) || 0,
        min_tier:          form.min_tier,
        use_unlock_credit: form.use_unlock_credit,
        visible:           form.visible,
      });
      const setId = setData.set.id;

      let coverUrl = null;

      // Upload cover if provided, otherwise use first image as cover
      if (coverFile) {
        setUploadProgress('Uploading cover image…');
        const compressed = await compressImage(coverFile);
        coverUrl = await uploadFile(compressed, 'content');
        await api.patch(`/api/studio/content/${setId}`, { cover_key: coverUrl });
      }

      const total = files.length;
      for (let i = 0; i < total; i++) {
        const item = files[i];
        setUploadProgress(`Uploading item ${i + 1} of ${total}…`);

        if (item.isVideo && parseFloat(item.sizeMB) > MAX_VIDEO_MB) {
          setFiles((prev) => { const u = [...prev]; u[i] = { ...u[i], status: 'skipped', error: `File too large (max ${MAX_VIDEO_MB}MB)` }; return u; });
          continue;
        }

        try {
          const fileToUpload = item.isVideo ? item.file : await compressImage(item.file);
          const publicUrl = await uploadFile(fileToUpload, 'content');

          await api.post('/api/studio/content/item', {
            setId, type: item.isVideo ? 'video' : 'image', r2Key: publicUrl, position: i,
          });

          // Auto-set first image as cover if no cover provided
          if (i === 0 && !coverUrl && !item.isVideo) {
            coverUrl = publicUrl;
            await api.patch(`/api/studio/content/${setId}`, { cover_key: publicUrl });
          }

          setFiles((prev) => { const u = [...prev]; u[i] = { ...u[i], status: 'done', publicUrl }; return u; });
        } catch (err) {
          setFiles((prev) => { const u = [...prev]; u[i] = { ...u[i], status: 'error', error: err.message }; return u; });
        }
      }

      setUploadProgress('');
      setSuccess(`"${form.title}" created with ${total} item${total !== 1 ? 's' : ''}.`);
      setSets((prev) => [{ ...setData.set, cover_url: coverUrl }, ...prev]);
      setForm({ title: '', description: '', type: 'photo_set', price_coins: '0', min_tier: 'community', use_unlock_credit: true, visible: false });
      setFiles([]);
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
    setEditForm({ title: set.title, description: set.description || '', type: set.type, price_coins: set.price_coins, min_tier: set.min_tier, use_unlock_credit: set.use_unlock_credit, visible: set.visible });
  };

  const handleUpdate = async (id) => {
    setError('');
    try {
      const data = await api.patch(`/api/studio/content/${id}`, { ...editForm, price_coins: parseInt(editForm.price_coins) });
      setSets((prev) => prev.map((s) => s.id === id ? { ...data.set, cover_url: s.cover_url } : s));
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

  const hasErrors = files.some((f) => f.status === 'error');
  const canCreate = form.title.trim() && !creating;

  return (
    <div>
      <Eyebrow>Content</Eyebrow>
      <T.title>Upload & manage</T.title>

      {error   && <div style={S.error}>{error}</div>}
      {success && <div style={S.success}>{success}</div>}

      {/* ── Create form ── */}
      <Card style={{ marginBottom: 28 }}>
        <T.sectionTitle>New content</T.sectionTitle>

        <div style={S.formGrid}>
          <Field label="Title">
            <input style={S.input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Behind the scenes — June shoot" />
          </Field>
          <Field label="Type">
            <select style={S.input} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="photo_set">Photo set</option>
              <option value="video">Video</option>
              <option value="bts">Behind the scenes</option>
            </select>
          </Field>
          <TokenField label="Price in tokens (0 = free for paid members)" value={form.price_coins} onChange={(v) => setForm({ ...form, price_coins: v })} tokenRateInr={TOKEN_RATE} />
          <Field label="Minimum membership tier">
            <select style={S.input} value={form.min_tier} onChange={(e) => setForm({ ...form, min_tier: e.target.value })}>
              <option value="none">No membership required</option>
              <option value="community">Community</option>
              <option value="insider">Insider</option>
              <option value="premium">Premium</option>
              <option value="supreme">Supreme</option>
            </select>
          </Field>
          <Field label="Allow monthly unlock credits?">
            <select style={S.input} value={form.use_unlock_credit ? 'yes' : 'no'} onChange={(e) => setForm({ ...form, use_unlock_credit: e.target.value === 'yes' })}>
              <option value="yes">Yes — members can use unlock credits</option>
              <option value="no">No — token purchase only</option>
            </select>
          </Field>
        </div>

        {/* Description */}
        <div style={{ marginTop: 16, marginBottom: 16 }}>
          <div style={fieldLabel}>Description (shown to fans in gallery)</div>
          <textarea
            style={{ ...S.input, resize: 'vertical', minHeight: 72, lineHeight: 1.6 }}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="A short description of what's in this set…"
            rows={3}
          />
        </div>

        {/* Cover image */}
        <div style={{ marginTop: 0, marginBottom: 16 }}>
          <div style={fieldLabel}>Cover image (optional — first photo used if not set)</div>
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
          <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 11, color: colors.muted, marginTop: 4 }}>
            Compressed automatically to max 2048px · JPEG 85%
          </div>
        </div>

        {/* Media files */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={fieldLabel}>Media files ({files.length} / {MAX_ITEMS})</div>
            <button onClick={() => filesRef.current?.click()} disabled={files.length >= MAX_ITEMS} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px', opacity: files.length >= MAX_ITEMS ? 0.5 : 1 }}>
              + Add files
            </button>
          </div>
          <input ref={filesRef} type="file" accept="image/*,video/*" multiple style={{ display: 'none' }} onChange={handleFilePick} />

          {files.length > 0 ? (
            <div style={fileGrid}>
              {files.map((f, i) => (
                <div key={i} style={{ ...fileCard, borderColor: f.status === 'done' ? 'rgba(100,160,100,0.4)' : f.status === 'error' ? 'rgba(156,90,90,0.4)' : colors.border }}>
                  {f.preview
                    ? <img src={f.preview} alt="" style={{ width: '100%', height: 70, objectFit: 'cover', borderRadius: 4, marginBottom: 4 }} />
                    : <div style={{ width: '100%', height: 70, background: 'rgba(255,255,255,0.03)', borderRadius: 4, marginBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🎬</div>
                  }
                  <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 10, color: colors.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file.name}</div>
                  <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 10, color: f.status === 'done' ? '#8FC88F' : f.status === 'error' ? '#D99A9A' : colors.muted }}>
                    {f.status === 'done' ? '✓ Uploaded' : f.status === 'error' ? `✗ ${f.error || 'Failed'}` : f.status === 'skipped' ? '⚠ Skipped' : `${f.sizeMB}MB`}
                  </div>
                  {f.status === 'pending' && (
                    <button onClick={() => removeFile(i)} style={{ ...removeBtn, position: 'relative', top: 'auto', right: 'auto', marginTop: 4, width: '100%' }}>Remove</button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <button onClick={() => filesRef.current?.click()} style={dropZone}>
              <div style={{ fontSize: 24, marginBottom: 6 }}>📁</div>
              <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13, color: colors.muted }}>Click to add photos or videos</div>
              <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 11, color: colors.muted, marginTop: 4, opacity: 0.7 }}>
                Up to {MAX_ITEMS} items · Images compressed automatically · Videos max {MAX_VIDEO_MB}MB
              </div>
            </button>
          )}
        </div>

        {uploadProgress && (
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: colors.accent, marginBottom: 12, padding: '8px 12px', background: 'rgba(193,125,74,0.08)', borderRadius: 6 }}>
            {uploadProgress}
          </div>
        )}

        {hasErrors && (
          <div style={{ ...S.error, marginBottom: 12 }}>Some files failed to upload. The set was still created — you can retry failed items later.</div>
        )}

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <label style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13, color: colors.muted, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
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
        {sets.map((set) => (
          <div key={set.id} style={S.card}>
            {confirmDelete === set.id ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 14, color: '#D99A9A' }}>
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
                  <Field label="Type">
                    <select style={S.input} value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}>
                      <option value="photo_set">Photo set</option>
                      <option value="video">Video</option>
                      <option value="bts">Behind the scenes</option>
                    </select>
                  </Field>
                  <TokenField label="Price (tokens)" value={editForm.price_coins} onChange={(v) => setEditForm({ ...editForm, price_coins: v })} tokenRateInr={TOKEN_RATE} />
                  <Field label="Min tier">
                    <select style={S.input} value={editForm.min_tier} onChange={(e) => setEditForm({ ...editForm, min_tier: e.target.value })}>
                      <option value="none">No membership required</option>
                      <option value="community">Community</option>
                      <option value="insider">Insider</option>
                      <option value="premium">Premium</option>
                      <option value="supreme">Supreme</option>
                    </select>
                  </Field>
                  <Field label="Unlock credits?">
                    <select style={S.input} value={editForm.use_unlock_credit ? 'yes' : 'no'} onChange={(e) => setEditForm({ ...editForm, use_unlock_credit: e.target.value === 'yes' })}>
                      <option value="yes">Yes</option>
                      <option value="no">No — purchase only</option>
                    </select>
                  </Field>
                </div>
                {/* Description in edit */}
                <div style={{ margin: '12px 0' }}>
                  <div style={fieldLabel}>Description</div>
                  <textarea
                    style={{ ...S.input, resize: 'vertical', minHeight: 60, lineHeight: 1.6 }}
                    value={editForm.description || ''}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    rows={2}
                  />
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <label style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13, color: colors.muted, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
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
                  <div style={S.rowTitle}>{set.title}</div>
                  {set.description && (
                    <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 12, color: colors.muted, marginBottom: 4, fontStyle: 'italic' }}>{set.description}</div>
                  )}
                  <div style={S.rowSub}>
                    {set.type?.replace('_', ' ')} · {set.min_tier === 'none' ? 'no membership required' : `${set.min_tier}+`} ·{' '}
                    {set.price_coins === 0 ? 'Free for members' : `${set.price_coins} tokens`} ·{' '}
                    {set.use_unlock_credit ? 'Credits OK' : 'Purchase only'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                  <span style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 12, color: set.visible ? colors.success : colors.muted }}>
                    {set.visible ? 'Live' : 'Hidden'}
                  </span>
                  <button onClick={() => startEdit(set)} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px' }}>Edit</button>
                  <button onClick={() => setConfirmDelete(set.id)} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px', color: '#D99A9A', borderColor: 'rgba(156,90,90,0.35)' }}>Delete</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const fieldLabel = { fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 12, color: colors.muted, marginBottom: 6 };
const fileGrid   = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8, marginBottom: 12 };
const fileCard   = { background: '#0D0C0A', border: '1px solid', borderRadius: 6, padding: 8, position: 'relative' };
const removeBtn  = { position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.6)', border: 'none', color: '#F2EBE0', fontSize: 10, padding: '2px 5px', borderRadius: 4, cursor: 'pointer' };
const dropZone   = { width: '100%', border: `2px dashed ${colors.border}`, borderRadius: 8, padding: '28px 20px', background: 'transparent', cursor: 'pointer', textAlign: 'center', color: colors.muted };