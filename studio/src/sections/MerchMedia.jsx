// studio/src/sections/MerchMedia.jsx
// Photos uploaded ahead of the listings that will use them.
//
// A one-of-one listing needs its photograph before it needs anything else, and
// there are a hundred of them. Uploading through the create form means a
// hundred trips through it; uploading everything first and matching afterwards
// means two passes instead.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { T, S, Eyebrow, colors } from '../ui';
import { createCompressPool } from '../workers/compressPool';

const sans = "'DM Sans', system-ui, sans-serif";
const mono = "'DM Mono', 'Courier New', monospace";

// Matches what the gallery does. Full-resolution originals would be several
// gigabytes across a hundred outfits, and nothing on a product page shows an
// image larger than this.
const MAX_PX  = 2048;
const JPEG_Q  = 0.85;

export function MerchMedia() {
  const [media,   setMedia]   = useState([]);
  const [page,    setPage]    = useState(1);
  const [pages,   setPages]   = useState(1);
  const [total,   setTotal]   = useState(0);
  const [unattachedCount, setUnattachedCount] = useState(0);
  const [onlyUnattached, setOnlyUnattached]   = useState(false);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');

  // Per-file state, so a silent failure inside a batch of a hundred is visible
  // rather than being a number that quietly does not add up.
  const [queue,   setQueue]   = useState([]);   // [{ name, status, error }]
  const [busy,    setBusy]    = useState(false);

  const fileRef = useRef(null);
  const poolRef = useRef(null);

  useEffect(() => {
    try { poolRef.current = createCompressPool({ maxPx: MAX_PX, quality: JPEG_Q }); }
    catch { poolRef.current = null; }
    return () => poolRef.current?.dispose();
  }, []);

  const load = (p = page, filter = onlyUnattached) => {
    setLoading(true);
    api.get(`/api/studio/merch/media?page=${p}${filter ? '&unattached=1' : ''}`)
      .then((d) => {
        setMedia(d.media || []);
        setPages(d.totalPages || 1);
        setTotal(d.total || 0);
        setUnattachedCount(d.unattached || 0);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(page, onlyUnattached); }, [page, onlyUnattached]);

  const pick = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;

    setError(''); setSuccess(''); setBusy(true);
    setQueue(files.map((f) => ({ name: f.name, status: 'waiting' })));

    const recorded = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const mark = (status, err) => setQueue((q) =>
        q.map((row, n) => (n === i ? { ...row, status, error: err } : row)));

      try {
        mark('working');
        const out = poolRef.current ? await poolRef.current.compress(file) : { file };
        const toUpload = out.file || file;

        const { uploadUrl, publicUrl } = await api.post('/api/upload/presign', {
          filename: file.name, contentType: 'image/jpeg', context: 'content',
        });
        const put = await fetch(uploadUrl, {
          method: 'PUT', body: toUpload, headers: { 'Content-Type': 'image/jpeg' },
        });
        if (!put.ok) throw new Error(`storage refused it (${put.status})`);

        recorded.push({
          r2Key: publicUrl,
          // The original name, not the compressed one. This is what a
          // description will be matched against later.
          originalFilename: file.name,
          bytes: toUpload.size,
        });
        mark('done');
      } catch (err) {
        mark('failed', err.message);
      }
    }

    if (recorded.length) {
      try {
        await api.post('/api/studio/merch/media', { items: recorded });
        setSuccess(`${recorded.length} photo${recorded.length === 1 ? '' : 's'} added to the library.`);
        load(1, onlyUnattached);
        setPage(1);
      } catch (err) { setError(err.message); }
    }
    setBusy(false);
  };

  const remove = async (m) => {
    if (!window.confirm(`Remove ${m.original_filename || 'this photo'} from the library?`)) return;
    setError('');
    try {
      await api.delete(`/api/studio/merch/media/${m.id}`);
      load(page, onlyUnattached);
    } catch (err) { setError(err.message); }
  };

  const failed = queue.filter((q) => q.status === 'failed');
  const done   = queue.filter((q) => q.status === 'done').length;

  return (
    <div>
      <Eyebrow>Merchandise</Eyebrow>
      <T.title>Media library</T.title>

      {error   && <div style={S.error}>{error}</div>}
      {success && <div style={S.success}>{success}</div>}

      <div style={uploadBox}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={pick} />
          <button onClick={() => fileRef.current?.click()} disabled={busy}
                  style={{ ...S.btn, opacity: busy ? 0.5 : 1 }}>
            {busy ? 'Uploading…' : 'Choose photos'}
          </button>
          <span style={{ fontFamily: sans, fontSize: 12, color: colors.muted, lineHeight: 1.6, maxWidth: 460 }}>
            Select a whole folder at once. Compressed on the way up, same as the gallery —
            the original filename is kept so a description can be matched to it later.
          </span>
        </div>

        {queue.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginBottom: 8 }}>
              {done} of {queue.length} done
              {failed.length > 0 && <span style={{ color: '#D99A9A' }}> · {failed.length} failed</span>}
            </div>
            <div style={{ height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: 3, width: `${(done / queue.length) * 100}%`, background: colors.accent, transition: 'width 0.2s' }} />
            </div>

            {/* Only the failures are listed. A hundred green ticks is not
                information; the three that did not land is. */}
            {failed.length > 0 && (
              <div style={{ marginTop: 10, maxHeight: 140, overflowY: 'auto' }}>
                {failed.map((f, i) => (
                  <div key={i} style={{ fontFamily: mono, fontSize: 11, color: '#D99A9A', padding: '3px 0' }}>
                    {f.name} — {f.error}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <button onClick={() => { setOnlyUnattached(!onlyUnattached); setPage(1); }}
                style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px',
                         ...(onlyUnattached ? { color: colors.accent, borderColor: colors.accent } : {}) }}>
          {onlyUnattached ? 'Show everything' : `Not yet used · ${unattachedCount}`}
        </button>
        <span style={{ fontFamily: sans, fontSize: 12, color: colors.muted }}>
          {total} photo{total === 1 ? '' : 's'} in the library
        </span>
      </div>

      {loading ? <T.muted>Loading…</T.muted>
       : media.length === 0 ? <T.muted>{onlyUnattached ? 'Every photo is attached to a listing.' : 'Nothing uploaded yet.'}</T.muted>
       : (
        <div style={grid}>
          {media.map((m) => (
            <div key={m.id} style={tile}>
              {/* The full-size URL is in the markup rather than assembled in
                  JavaScript when clicked, so the library can be read
                  programmatically as well as by eye. */}
              <a href={m.r2_key} data-src={m.r2_key} data-uuid={m.id}
                 data-filename={m.original_filename || ''}
                 target="_blank" rel="noopener noreferrer">
                <img src={m.r2_key} alt={m.original_filename || ''} loading="lazy"
                     style={{ width: '100%', aspectRatio: '3 / 4', objectFit: 'cover', borderRadius: 6, display: 'block' }} />
              </a>

              <div style={{ fontFamily: sans, fontSize: 11, color: colors.text, marginTop: 6,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.original_filename || '—'}
              </div>
              <div style={{ fontFamily: mono, fontSize: 9, color: colors.muted, marginTop: 2,
                            overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {m.id}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginTop: 5 }}>
                <span style={{ fontFamily: sans, fontSize: 10, color: m.attached ? colors.success : colors.muted }}>
                  {m.attached ? (m.merch_title || 'in use') : 'not used'}
                </span>
                {!m.attached && (
                  <button onClick={() => remove(m)} style={tinyBtn}>remove</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {pages > 1 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 18, flexWrap: 'wrap' }}>
          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}
                  style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px', opacity: page === 1 ? 0.4 : 1 }}>
            ← Previous
          </button>
          <span style={{ fontFamily: sans, fontSize: 12, color: colors.muted }}>Page {page} of {pages}</span>
          <button onClick={() => setPage(Math.min(pages, page + 1))} disabled={page === pages}
                  style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px', opacity: page === pages ? 0.4 : 1 }}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

const uploadBox = { background: 'rgba(255,255,255,0.02)', border: `1px solid ${colors.border}`, borderRadius: 10, padding: 18, marginBottom: 20 };
const grid      = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 };
const tile      = { background: 'rgba(255,255,255,0.02)', border: `1px solid ${colors.border}`, borderRadius: 8, padding: 8 };
const tinyBtn   = { background: 'none', border: 'none', color: '#D99A9A', fontFamily: sans, fontSize: 10, cursor: 'pointer', padding: 0 };