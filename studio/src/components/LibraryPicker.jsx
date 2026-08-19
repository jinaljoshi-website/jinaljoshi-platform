// studio/src/components/LibraryPicker.jsx
//
// Choosing from what is already on the platform, rather than uploading it again.
//
// Chat stores a media URL rather than an upload, so anything already in R2 can
// be sent by handing over the URL it already has. Nothing is copied, nothing is
// stored twice, and a photograph sent in a message is the same object the
// gallery serves.
//
// Grouped the way the money works rather than the way the tables do — free,
// paid, and the private collection — because the thing worth knowing while
// picking is what somebody would otherwise have paid for it. Each set carries
// its price and each photograph the set it came from, so giving something away
// is a decision made with the number in view rather than found out later.

import { useEffect, useState } from 'react';
import { api } from '../api';
import { T, S, colors } from '../ui';

// The set-items endpoint returns raw rows — r2_key, not a URL. Every other
// screen that uses it builds the URL itself, and this one did not: the images
// were given undefined and rendered blank, and worse, every item was stored
// with url: undefined so they all compared equal and selecting one selected
// the lot.
const toUrl = (k) => (!k ? null : String(k).startsWith('http') ? k : `${import.meta.env.VITE_R2_PUBLIC_URL || ''}/${k}`);

const sans = "'DM Sans', system-ui, sans-serif";
const mono = "'DM Mono', 'Courier New', monospace";

const GROUPS = [
  { key: 'all',        label: 'Everything' },
  { key: 'free',       label: 'Free' },
  { key: 'paid',       label: 'Paid' },
  { key: 'collection', label: 'Collection' },
];

export default function LibraryPicker({ onCancel, onPick }) {
  const [tab,      setTab]      = useState('sets');   // 'sets' | 'recent'
  const [group,    setGroup]    = useState('all');
  const [sets,     setSets]     = useState([]);
  const [recent,   setRecent]   = useState([]);
  const [openSet,  setOpenSet]  = useState(null);
  const [items,    setItems]    = useState([]);
  const [chosen,   setChosen]   = useState([]);       // whole objects, not ids —
                                                      // the send needs the urls
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  useEffect(() => {
    setLoading(true);
    const q = tab === 'recent' ? 'scope=recent&limit=200' : `scope=sets&group=${group}`;
    api.get(`/api/studio/library?${q}`)
      .then((d) => { setSets(d.sets || []); setRecent(d.items || []); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [tab, group]);

  const openOne = async (set) => {
    setOpenSet(set); setItems([]); setError('');
    try {
      const d = await api.get(`/api/studio/content/${set.id}/items`);
      setItems((d.items || [])
        .filter((i) => i.review_flag !== 'remove')
        .map((i) => ({ ...i, url: i.media_url || toUrl(i.r2_key) })));
    } catch (err) { setError(err.message); }
  };

  const toggle = (item, set) => {
    const url = item.url || item.media_url || toUrl(item.r2_key);
    // Without a url there is nothing to send, and storing undefined made every
    // item compare equal to every other.
    if (!url) return;
    setChosen((prev) => prev.some((c) => c.url === url)
      ? prev.filter((c) => c.url !== url)
      : [...prev, {
          url,
          type: (item.mediaType || item.media_type) === 'video' ? 'video' : 'image',
          setTitle: item.setTitle || set?.title || null,
          priceCoins: item.priceCoins ?? set?.priceCoins ?? null,
          group: item.group || set?.group || null,
        }]);
  };

  const isChosen = (item) => {
    const url = item.url || item.media_url || toUrl(item.r2_key);
    return Boolean(url) && chosen.some((c) => c.url === url);
  };

  // What is being given away, so it is visible while choosing rather than
  // discovered afterwards.
  const paidCount = chosen.filter((c) => c.group !== 'free').length;

  return (
    <div style={wrap}>
      <div style={head}>
        <div style={{ display: 'flex', gap: 6 }}>
          {[['sets', 'By set'], ['recent', 'Recent']].map(([k, label]) => (
            <button key={k} onClick={() => { setTab(k); setOpenSet(null); }}
                    style={{ ...pill, ...(tab === k ? pillOn : {}) }}>{label}</button>
          ))}
        </div>
        <button onClick={onCancel} style={{ ...pill, marginLeft: 'auto' }}>Close</button>
      </div>

      {tab === 'sets' && !openSet && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          {GROUPS.map((g) => (
            <button key={g.key} onClick={() => setGroup(g.key)}
                    style={{ ...pill, ...(group === g.key ? pillOn : {}) }}>{g.label}</button>
          ))}
        </div>
      )}

      {error && <div style={S.error}>{error}</div>}
      {loading && <T.muted>Loading…</T.muted>}

      {/* Sets, by cover */}
      {tab === 'sets' && !openSet && !loading && (
        <div style={grid}>
          {sets.map((s) => (
            <button key={s.id} onClick={() => openOne(s)} style={card}>
              {s.coverUrl
                ? <img src={s.coverUrl} alt="" style={cover} />
                : <div style={{ ...cover, background: 'rgba(255,255,255,0.04)' }} />}
              <div style={cardName}>{s.title}</div>
              <div style={cardMeta}>
                {s.itemCount} · {s.group === 'free' ? 'free' : s.group === 'collection' ? 'collection' : `${s.priceCoins} tokens`}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Inside one set */}
      {tab === 'sets' && openSet && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <button onClick={() => setOpenSet(null)} style={pill}>← Sets</button>
            <span style={{ fontFamily: sans, fontSize: 13, color: colors.text }}>{openSet.title}</span>
            <span style={{ fontFamily: mono, fontSize: 10, color: colors.muted }}>
              {openSet.group === 'free' ? 'free' : openSet.group === 'collection' ? 'collection' : `${openSet.priceCoins} tokens`}
            </span>
          </div>
          <div style={thumbGrid}>
            {items.map((it) => (
              <button key={it.id} onClick={() => toggle(it, openSet)}
                      style={{ ...thumbBtn, borderColor: isChosen(it) ? colors.accent : 'transparent' }}>
                <img src={it.url} alt="" style={thumb} />
                {isChosen(it) && <span style={tick}>✓</span>}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Everything, newest first */}
      {tab === 'recent' && !loading && (
        <div style={thumbGrid}>
          {recent.map((it) => (
            <button key={it.id} onClick={() => toggle(it)}
                    style={{ ...thumbBtn, borderColor: isChosen(it) ? colors.accent : 'transparent' }}>
              <img src={it.url} alt="" style={thumb} />
              {it.group !== 'free' && <span style={paidDot} title={`${it.setTitle} · ${it.priceCoins} tokens`} />}
              {isChosen(it) && <span style={tick}>✓</span>}
            </button>
          ))}
        </div>
      )}

      {chosen.length > 0 && (
        <div style={bar}>
          <span style={{ fontFamily: sans, fontSize: 13, color: colors.text }}>
            {chosen.length} chosen
            {paidCount > 0 && (
              <span style={{ color: colors.accent }}>
                {' '}· {paidCount} from paid content
              </span>
            )}
          </span>
          <button onClick={() => onPick(chosen, { locked: false })} style={{ ...S.btn, fontSize: 12, padding: '7px 14px' }}>
            Send free
          </button>
          <button onClick={() => onPick(chosen, { locked: true })} style={{ ...S.ghostBtn, fontSize: 12, padding: '7px 14px' }}>
            Send locked
          </button>
          <button onClick={() => setChosen([])} style={{ ...S.ghostBtn, fontSize: 12, padding: '7px 12px' }}>Clear</button>
        </div>
      )}
    </div>
  );
}

const wrap  = { border: `1px solid ${colors.border}`, borderRadius: 10, padding: 12, marginBottom: 10, background: 'rgba(22,20,16,0.6)', maxHeight: '58vh', overflowY: 'auto' };
const head  = { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 };
const pill  = { fontFamily: sans, fontSize: 11, padding: '5px 11px', borderRadius: 999, cursor: 'pointer', background: 'transparent', border: `1px solid ${colors.border}`, color: colors.muted };
const pillOn = { color: colors.accent, borderColor: colors.accent };
const grid  = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(116px,1fr))', gap: 10 };
const card  = { background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' };
const cover = { width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 6, display: 'block' };
const cardName = { fontFamily: sans, fontSize: 12, color: colors.text, marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const cardMeta = { fontFamily: mono, fontSize: 9, color: colors.muted, marginTop: 2 };
const thumbGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(78px,1fr))', gap: 6 };
const thumbBtn = { position: 'relative', padding: 0, background: 'none', border: '2px solid transparent', borderRadius: 5, cursor: 'pointer' };
const thumb = { width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 3, display: 'block' };
const tick  = { position: 'absolute', top: 3, right: 3, fontSize: 10, color: '#1A1714', background: colors.accent, borderRadius: 999, width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' };
const paidDot = { position: 'absolute', bottom: 4, left: 4, width: 6, height: 6, borderRadius: 999, background: colors.accent };
const bar = { position: 'sticky', bottom: 0, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 12, paddingTop: 10, borderTop: `1px solid ${colors.border}`, background: 'rgba(22,20,16,0.95)' };