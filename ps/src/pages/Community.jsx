import { useEffect, useRef, useState } from 'react';
import { C, F } from '../tokens';
import { api, getUser } from '../api';
import { COMMUNITY_CHAT } from '../data';
import { WonderCoinAmount } from '../components/WonderCoin';

export default function Community() {
  const [posts, setPosts]           = useState([]);
  const [chatStatus, setChatStatus] = useState(null);
  const [message, setMessage]       = useState('');
  const [loading, setLoading]       = useState(true);
  const [sending, setSending]       = useState(false);
  const [error, setError]           = useState('');
  const bottomRef                   = useRef(null);
  const currentUser                 = getUser();

  // Load posts + chat status on mount
  useEffect(() => {
    Promise.all([
      api.get('/api/community/posts'),
      api.get('/api/community/chat-status'),
    ])
      .then(([postsData, statusData]) => {
        setPosts(postsData.posts || []);
        setChatStatus(statusData);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Auto-scroll to bottom when new posts arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [posts]);

  const handleSend = async () => {
    if (!message.trim()) return;
    setError('');
    setSending(true);
    try {
      const data = await api.post('/api/community/post', { content: message.trim() });
      setPosts((prev) => [...prev, {
        ...data.post,
        display_name: currentUser?.display_name || currentUser?.email || 'You',
        is_artist:    false,
      }]);
      setMessage('');
      // Refresh chat status (counter updates)
      api.get('/api/community/chat-status').then(setChatStatus).catch(() => {});
    } catch (err) {
      if (err.message === 'RATE_LIMIT_HOUR') {
        setError(`Fair use limit reached — max ${COMMUNITY_CHAT.maxPerHour} messages per hour.`);
      } else if (err.message === 'RATE_LIMIT_DAY') {
        setError(`Daily limit reached — max ${COMMUNITY_CHAT.maxPerDay} messages per day.`);
      } else if (err.message === 'INSUFFICIENT_TOKENS') {
        setError(`Community chat costs ${COMMUNITY_CHAT.guestCostPerDay} tokens/day for guests. Top up your balance.`);
      } else {
        setError(err.message);
      }
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isGuest      = chatStatus?.userTier === 'guest';
  const guestPaid    = chatStatus?.guestPaidToday;
  const atHourLimit  = chatStatus && chatStatus.messagesThisHour >= COMMUNITY_CHAT.maxPerHour;
  const atDayLimit   = chatStatus && chatStatus.messagesToday   >= COMMUNITY_CHAT.maxPerDay;
  const canPost      = chatStatus?.canPost;

  if (loading) return <div style={{ color: C.muted, fontFamily: F.sans, padding: 24 }}>Loading community…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '80vh' }}>

      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={eyebrow}>Community</div>
        <h1 style={title}>Member community</h1>
        <p style={subtext}>
          Jinal and all paid members in one space. Fair use: {COMMUNITY_CHAT.maxPerHour} messages/hour,{' '}
          {COMMUNITY_CHAT.maxPerDay}/day.
        </p>
      </div>

      {/* Status bar */}
      {chatStatus && (
        <div style={statusBar}>
          <span style={{ fontFamily: F.sans, fontSize: 12, color: C.muted }}>
            {chatStatus.messagesThisHour}/{COMMUNITY_CHAT.maxPerHour} this hour ·{' '}
            {chatStatus.messagesToday}/{COMMUNITY_CHAT.maxPerDay} today
          </span>
          {isGuest && (
            <span style={{ fontFamily: F.sans, fontSize: 12, color: guestPaid ? C.accent : C.muted }}>
              {guestPaid
                ? '✓ Chat access paid for today'
                : <>Guest · <WonderCoinAmount amount={COMMUNITY_CHAT.guestCostPerDay} size={12} fontSize={12} /> /day</>
              }
            </span>
          )}
        </div>
      )}

      {/* Posts feed */}
      <div style={feed}>
        {posts.length === 0 && (
          <div style={{ color: C.muted, fontFamily: F.sans, fontSize: 14, textAlign: 'center', paddingTop: 40 }}>
            No messages yet. Be the first to say something.
          </div>
        )}
        {posts.map((post) => {
          const isArtist  = post.is_artist;
          const isMe      = post.display_name === (currentUser?.display_name || currentUser?.email);
          return (
            <div
              key={post.id}
              style={{
                ...postRow,
                alignSelf: isMe ? 'flex-end' : 'flex-start',
                maxWidth: '75%',
              }}
            >
              {!isMe && (
                <div style={{ fontFamily: F.sans, fontSize: 11, color: isArtist ? C.accent : C.muted, marginBottom: 4 }}>
                  {isArtist ? '★ Jinal Joshi' : (post.display_name || 'Member')}
                </div>
              )}
              <div style={{
                ...bubble,
                background: isArtist ? 'rgba(193,125,74,0.12)' : isMe ? 'rgba(242,235,224,0.06)' : C.surface,
                border: isArtist ? `1px solid rgba(193,125,74,0.3)` : `1px solid ${C.border}`,
              }}>
                {post.content}
              </div>
              <div style={{ fontFamily: F.sans, fontSize: 10, color: C.muted, marginTop: 4 }}>
                {new Date(post.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Error */}
      {error && (
        <div style={errorBox}>{error}</div>
      )}

      {/* Composer */}
      <div style={composer}>
        {atHourLimit || atDayLimit ? (
          <div style={{ fontFamily: F.sans, fontSize: 13, color: C.muted, textAlign: 'center', width: '100%', padding: '12px 0' }}>
            {atDayLimit ? `Daily limit reached (${COMMUNITY_CHAT.maxPerDay} messages).` : `Hourly limit reached (${COMMUNITY_CHAT.maxPerHour} messages). Try again shortly.`}
          </div>
        ) : (
          <>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                isGuest && !guestPaid
                  ? `Chat costs ${COMMUNITY_CHAT.guestCostPerDay} tokens today (first message charges you)`
                  : 'Say something… (Enter to send)'
              }
              style={composerInput}
              rows={2}
            />
            <button
              onClick={handleSend}
              disabled={sending || !message.trim()}
              style={{
                ...sendBtn,
                opacity: (sending || !message.trim()) ? 0.5 : 1,
                cursor:  (sending || !message.trim()) ? 'default' : 'pointer',
              }}
            >
              {sending ? '…' : 'Send'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── STYLES ──────────────────────────────────

const eyebrow  = { fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 8 };
const title    = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(24px, 4vw, 42px)', margin: '0 0 6px' };
const subtext  = { fontFamily: F.sans, fontSize: 13, color: C.muted, lineHeight: 1.6, margin: 0 };

const statusBar = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '8px 12px', background: C.surface, border: `1px solid ${C.border}`,
  borderRadius: 8, marginBottom: 12,
};

const feed = {
  flex: 1,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: '12px 0',
  marginBottom: 12,
};

const postRow = {
  display: 'flex',
  flexDirection: 'column',
};

const bubble = {
  fontFamily: F.sans,
  fontSize: 14,
  color: C.text,
  lineHeight: 1.6,
  padding: '10px 14px',
  borderRadius: 10,
  wordBreak: 'break-word',
};

const errorBox = {
  background: 'rgba(156,90,90,0.12)',
  border: '1px solid rgba(156,90,90,0.35)',
  color: '#D99A9A',
  padding: 10,
  borderRadius: 8,
  marginBottom: 8,
  fontFamily: F.sans,
  fontSize: 13,
};

const composer = {
  display: 'flex',
  gap: 10,
  alignItems: 'flex-end',
  borderTop: `1px solid ${C.border}`,
  paddingTop: 12,
};

const composerInput = {
  flex: 1,
  background: C.surface,
  border: `1px solid ${C.border}`,
  color: C.text,
  fontFamily: F.sans,
  fontSize: 14,
  padding: '10px 14px',
  borderRadius: 8,
  resize: 'none',
  outline: 'none',
  lineHeight: 1.5,
};

const sendBtn = {
  background: C.accent,
  border: 'none',
  color: '#1A1714',
  fontFamily: F.sans,
  fontSize: 14,
  fontWeight: 700,
  padding: '10px 20px',
  borderRadius: 8,
  flexShrink: 0,
};