// ps/src/pages/Community.jsx
import { useEffect, useRef, useState } from 'react';
import { C, F } from '../tokens';
import { api, getUser } from '../api';

const ARTIST_ID = import.meta.env.VITE_ARTIST_USER_ID;

export default function Community() {
  const [posts,   setPosts]   = useState([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error,   setError]   = useState('');
  const [communityBg, setCommunityBg] = useState('');
  const bottomRef  = useRef(null);
  const isAtBottom = useRef(true);

  const load = (silent = false) => api.get('/api/community/posts')
    .then((d) => {
      setPosts(d.posts || []);
      if (!silent) setLoading(false);
    })
    .catch((err) => { if (!silent) setError(err.message); setLoading(false); });

  const loadStatus = () => api.get('/api/community/status')
    .then((d) => setCommunityBg(d.communityBg || ''))
    .catch(() => {});

  useEffect(() => {
    load();
    loadStatus();
    // Poll every 8 seconds for new posts
    const interval = setInterval(() => load(true), 8000);
    return () => clearInterval(interval);
  }, []);

  // Only auto-scroll if user is already at bottom
  useEffect(() => {
    if (isAtBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [posts]);

  const handleScroll = (e) => {
    const el = e.target;
    isAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  const handleSend = async () => {
    if (!message.trim()) return;
    setSending(true); setError('');
    try {
      await api.post('/api/community/post', { content: message.trim() });
      setMessage('');
      isAtBottom.current = true;
      load(true);
    } catch (err) {
      setError(err.message);
    } finally { setSending(false); }
  };

  if (loading) return <div style={{ color: C.muted, fontFamily: F.sans, padding: 24 }}>Loading community…</div>;

  return (
    <div style={{ position: 'relative', height: '100%', minHeight: 0, borderRadius: communityBg ? 10 : 0, overflow: 'hidden' }}>
      {/* Background layer */}
      {communityBg && (
        <>
          <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${communityBg})`, backgroundSize: 'cover', backgroundPosition: 'center', zIndex: 0 }} />
          {/* Auto-contrast overlay — always applied over any uploaded background so text stays legible */}
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(10,9,8,0.55)', zIndex: 1 }} />
        </>
      )}

      {/* Content layer */}
      <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, boxSizing: 'border-box' }}>
        {/* Sticky header — stays pinned regardless of scroll */}
        <div style={{ ...stickyHeader, padding: '12px 16px' }}>
          <div style={eyebrow}>Live space</div>
          <h1 style={title}>Community</h1>
          {error && <div style={{ ...errorBox, marginTop: 10 }}>{error}</div>}
        </div>

        <div style={{ ...feed, padding: '0 16px' }} onScroll={handleScroll}>
          {posts.length === 0 && (
            <div style={{ color: C.muted, fontFamily: F.sans, fontSize: 14, textAlign: 'center', paddingTop: 40 }}>
              Be the first to say something!
            </div>
          )}
          {posts.map((post) => <PostBubble key={post.id} post={post} artistId={ARTIST_ID} />)}
          <div ref={bottomRef} />
        </div>

        <div style={{ ...composer, flexShrink: 0, padding: '12px 16px' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="Say something to the community…"
              style={composerInput}
              rows={2}
            />
            <button
              onClick={handleSend}
              disabled={sending || !message.trim()}
              style={{ ...sendBtn, opacity: (sending || !message.trim()) ? 0.5 : 1 }}
            >
              {sending ? '…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PostBubble({ post, artistId }) {
  const isArtist = post.is_artist || post.user_id === artistId;
  const isSystem = post.is_system;

  if (isSystem) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
        <div style={systemBubble}>{post.content}</div>
      </div>
    );
  }

  if (isArtist) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
        <div style={{ fontFamily: F.sans, fontSize: 11, color: C.accent, marginBottom: 3 }}>★ Jinal Joshi</div>
        <div style={{ ...bubble, background: 'rgba(193,125,74,0.12)', border: `1px solid rgba(193,125,74,0.25)`, maxWidth: '75%' }}>
          {post.content}
        </div>
        <div style={timestamp}>{new Date(post.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
      <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, marginBottom: 3 }}>
        {post.display_name || post.email?.split('@')[0] || 'Member'}
        {post.tier && post.tier !== 'guest' && (
          <span style={{ marginLeft: 6, color: C.accent, fontSize: 10 }}>· {post.tier}</span>
        )}
      </div>
      <div style={{ ...bubble, background: C.surface, border: `1px solid ${C.border}`, maxWidth: '75%' }}>
        {post.content}
      </div>
      <div style={timestamp}>{new Date(post.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
    </div>
  );
}

const eyebrow      = { fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 6 };
const title        = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(22px,4vw,42px)', margin: '0 0 4px' };
const stickyHeader = { position: 'sticky', top: 0, zIndex: 3, flexShrink: 0, background: 'rgba(13,12,10,0.9)', backdropFilter: 'blur(10px)', borderBottom: `1px solid ${C.border}` };
const feed         = { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 12, paddingBottom: 8, minHeight: 0 };
const bubble       = { fontFamily: F.sans, fontSize: 14, color: C.text, lineHeight: 1.6, padding: '10px 14px', borderRadius: 10, wordBreak: 'break-word' };
const systemBubble = { fontFamily: F.sans, fontSize: 12, color: C.muted, background: 'rgba(242,235,224,0.04)', border: `1px solid ${C.border}`, borderRadius: 999, padding: '5px 14px', fontStyle: 'italic' };
const timestamp    = { fontFamily: F.sans, fontSize: 10, color: C.muted, marginTop: 3 };
const errorBox     = { background: 'rgba(156,90,90,0.12)', border: '1px solid rgba(156,90,90,0.35)', color: '#D99A9A', padding: 12, borderRadius: 8, fontFamily: F.sans, fontSize: 13 };
const composer     = { flexShrink: 0, borderTop: `1px solid ${C.border}`, background: 'rgba(13,12,10,0.7)', backdropFilter: 'blur(10px)' };
const composerInput = { flex: 1, width: '100%', background: 'rgba(22,20,16,0.9)', border: `1px solid ${C.border}`, color: C.text, fontFamily: F.sans, fontSize: 14, padding: '10px 14px', borderRadius: 8, resize: 'none', outline: 'none', lineHeight: 1.5, boxSizing: 'border-box' };
const sendBtn      = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 14, fontWeight: 700, padding: '10px 20px', borderRadius: 8, flexShrink: 0, cursor: 'pointer' };