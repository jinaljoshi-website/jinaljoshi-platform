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
  const [hideSystemPosts, setHideSystemPosts] = useState(false);
  const [reportingId, setReportingId] = useState(null);
  const [reportReason, setReportReason] = useState('');
  const [reportSending, setReportSending] = useState(false);
  const [reportMsg, setReportMsg] = useState('');
  const bottomRef  = useRef(null);
  const isAtBottom = useRef(true);
  const currentUser = getUser();

  const load = (silent = false) => api.get('/api/community/posts')
    .then((d) => {
      setPosts(d.posts || []);
      if (!silent) setLoading(false);
    })
    .catch((err) => { if (!silent) setError(err.message); setLoading(false); });

  const loadStatus = () => api.get('/api/community/status')
    .then((d) => {
      setCommunityBg(d.communityBg || '');
      setHideSystemPosts(!!d.hideSystemPosts);
    })
    .catch(() => {});

  useEffect(() => {
    load();
    loadStatus();
    const interval = setInterval(() => load(true), 8000);
    return () => clearInterval(interval);
  }, []);

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

  const toggleSystemPosts = async () => {
    const next = !hideSystemPosts;
    setHideSystemPosts(next);
    try {
      await api.post('/api/community/preferences', { hideSystemPosts: next });
    } catch (err) {
      setHideSystemPosts(!next);
    }
  };

  const startReport = (postId) => {
    setReportingId(postId);
    setReportReason('');
    setReportMsg('');
  };

  const cancelReport = () => {
    setReportingId(null);
    setReportReason('');
  };

  const submitReport = async (postId) => {
    setReportSending(true);
    try {
      const data = await api.post('/api/community/report', { postId, reason: reportReason.trim() || undefined });
      setReportMsg(data.message);
      setReportingId(null);
      setReportReason('');
    } catch (err) {
      setReportMsg(err.message);
    } finally {
      setReportSending(false);
    }
  };

  if (loading) return <div style={{ color: C.muted, fontFamily: F.sans, padding: 24 }}>Loading community…</div>;

  const visiblePosts = hideSystemPosts ? posts.filter((p) => !p.is_system) : posts;

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', background: C.bg, borderRadius: communityBg ? 10 : 0, overflow: 'hidden' }}>
      {/* Header — always solid, never carries the background photo */}
      <div style={{ ...stickyHeader, padding: '10px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <div>
            <div style={eyebrow}>Updates</div>
            <h1 style={title}>Public Corner</h1>
          </div>
          <button onClick={toggleSystemPosts} style={systemToggleBtn}>
            <span style={{ ...toggleDot, background: hideSystemPosts ? C.muted : C.accent }} />
            {hideSystemPosts ? 'Updates hidden' : 'Updates shown'}
          </button>
        </div>
        {error && <div style={{ ...errorBox, marginTop: 8 }}>{error}</div>}
        {reportMsg && <div style={{ ...successBox, marginTop: 8 }}>{reportMsg}</div>}
      </div>

      {/* Feed — the ONLY area the background photo ever renders in.
          Uses CSS Grid layer-stacking instead of position:absolute — see Chat.jsx for why. */}
      <div style={{ flex: 1, minHeight: 0, display: 'grid', overflow: 'hidden' }}>
        {communityBg && (
          <>
            <div style={{ gridArea: '1 / 1', backgroundImage: `url(${communityBg})`, backgroundSize: 'cover', backgroundPosition: 'center', filter: 'blur(28px)', transform: 'scale(1.15)', zIndex: 0 }} />
            <div style={{ gridArea: '1 / 1', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 0, overflow: 'hidden' }}>
              <img src={communityBg} alt="" style={{ height: '100%', width: 'auto', maxWidth: 'none', display: 'block' }} />
            </div>
            <div style={{ gridArea: '1 / 1', background: 'rgba(10,9,8,0.55)', zIndex: 1 }} />
          </>
        )}

        <div style={{ gridArea: '1 / 1', zIndex: 2, height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 16px' }} onScroll={handleScroll}>
          {visiblePosts.length === 0 && (
            <div style={{ color: C.muted, fontFamily: F.sans, fontSize: 14, textAlign: 'center', paddingTop: 40 }}>
              {posts.length === 0 ? 'Be the first to say something!' : 'No messages to show right now.'}
            </div>
          )}
          {visiblePosts.map((post) => (
            <PostBubble
              key={post.id}
              post={post}
              artistId={ARTIST_ID}
              isOwn={currentUser?.id === post.user_id}
              isReporting={reportingId === post.id}
              reportReason={reportReason}
              onReportReasonChange={setReportReason}
              onStartReport={() => startReport(post.id)}
              onCancelReport={cancelReport}
              onSubmitReport={() => submitReport(post.id)}
              reportSending={reportSending}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Footer / composer — always solid, always pinned to the bottom of the available space */}
      <div style={{ ...composer, padding: '10px 16px', flexShrink: 0 }}>
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
  );
}

function PostBubble({ post, artistId, isOwn, isReporting, reportReason, onReportReasonChange, onStartReport, onCancelReport, onSubmitReport, reportSending }) {
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={timestamp}>{new Date(post.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        {!isOwn && !isReporting && (
          <button onClick={onStartReport} style={reportLink}>Report</button>
        )}
      </div>
      {isReporting && (
        <div style={reportBox}>
          <input
            value={reportReason}
            onChange={(e) => onReportReasonChange(e.target.value)}
            placeholder="Why are you reporting this? (optional)"
            style={reportInput}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button onClick={onSubmitReport} disabled={reportSending} style={{ ...reportSubmitBtn, opacity: reportSending ? 0.5 : 1 }}>
              {reportSending ? '…' : 'Submit'}
            </button>
            <button onClick={onCancelReport} style={reportCancelBtn}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

const eyebrow      = { fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 6 };
const title        = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(18px,2.4vw,26px)', margin: '0 0 4px' };
const stickyHeader = { flexShrink: 0, background: 'rgba(13,12,10,1)', borderBottom: `1px solid ${C.border}` };
const systemToggleBtn = { display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, fontFamily: F.sans, fontSize: 11, padding: '6px 10px', borderRadius: 999, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' };
const toggleDot     = { width: 7, height: 7, borderRadius: '50%', display: 'inline-block' };
const bubble       = { fontFamily: F.sans, fontSize: 14, color: C.text, lineHeight: 1.6, padding: '10px 14px', borderRadius: 10, wordBreak: 'break-word' };
const systemBubble = { fontFamily: F.sans, fontSize: 12, color: C.muted, background: 'rgba(242,235,224,0.04)', border: `1px solid ${C.border}`, borderRadius: 999, padding: '5px 14px', fontStyle: 'italic' };
const timestamp    = { fontFamily: F.sans, fontSize: 10, color: C.muted, marginTop: 3 };
const errorBox     = { background: 'rgba(156,90,90,0.12)', border: '1px solid rgba(156,90,90,0.35)', color: '#D99A9A', padding: 12, borderRadius: 8, fontFamily: F.sans, fontSize: 13 };
const successBox   = { background: 'rgba(100,160,100,0.1)', border: '1px solid rgba(100,160,100,0.3)', color: '#8FC88F', padding: 12, borderRadius: 8, fontFamily: F.sans, fontSize: 13 };
const composer     = { flexShrink: 0, borderTop: `1px solid ${C.border}`, background: 'rgba(13,12,10,1)' };
const composerInput = { flex: 1, width: '100%', background: 'rgba(22,20,16,0.9)', border: `1px solid ${C.border}`, color: C.text, fontFamily: F.sans, fontSize: 16, padding: '10px 14px', borderRadius: 8, resize: 'none', outline: 'none', lineHeight: 1.5, boxSizing: 'border-box' };
const sendBtn      = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 14, fontWeight: 700, padding: '10px 20px', borderRadius: 8, flexShrink: 0, cursor: 'pointer' };
const reportLink   = { fontFamily: F.sans, fontSize: 10, color: C.muted, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0, marginTop: 3 };
const reportBox    = { marginTop: 6, maxWidth: '75%' };
const reportInput  = { width: '100%', boxSizing: 'border-box', background: 'rgba(22,20,16,0.9)', border: `1px solid ${C.border}`, color: C.text, fontFamily: F.sans, fontSize: 13, padding: '8px 10px', borderRadius: 6, outline: 'none' };
const reportSubmitBtn = { background: '#9C5A5A', border: 'none', color: '#fff', fontFamily: F.sans, fontSize: 11, fontWeight: 700, padding: '6px 12px', borderRadius: 6, cursor: 'pointer' };
const reportCancelBtn = { background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, fontFamily: F.sans, fontSize: 11, padding: '6px 12px', borderRadius: 6, cursor: 'pointer' };