import { useEffect, useRef, useState } from 'react';
import { C, F } from '../tokens';
import { api } from '../api';
import { WonderCoinAmount } from '../components/WonderCoin';
import { TIERS } from '../data';
import { useUpload } from '../hooks/useUpload';
import TopUpModal from '../components/TopUpModal';
import { StreamChat } from 'stream-chat';

export default function Chat() {
  const [messages,   setMessages]   = useState([]);
  const [status,     setStatus]     = useState(null);
  const [message,    setMessage]    = useState('');
  const [loading,    setLoading]    = useState(true);
  const [sending,    setSending]    = useState(false);
  const [typing,     setTyping]     = useState(false);
  const [error,      setError]      = useState('');
  const [topUp,      setTopUp]      = useState(null);
  const bottomRef   = useRef(null);
  const fileRef     = useRef(null);
  const channelRef  = useRef(null);
  const scClientRef = useRef(null);
  const myIdRef     = useRef(null);
  const typingTimer = useRef(null);
  const { upload, uploading } = useUpload();

  // Only called on mount and after TopUp success — never after sending
  const loadStatus = () => api.get('/api/chat/status').then(setStatus).catch(() => {});

  const msgToLocal = (m, myId) => ({
    id:             m.id,
    stream_id:      m.id,
    sender_id:      m.user?.id,
    content:        m.text || null,
    media_url:      m.attachments?.[0]?.image_url || m.attachments?.[0]?.asset_url || null,
    media_type:     m.attachments?.[0]?.type === 'video' ? 'video' : m.attachments?.[0]?.image_url ? 'image' : null,
    tokens_charged: m.tokens_charged || 0,
    created_at:     m.created_at,
    is_mine:        m.user?.id === myId,
    status:         'delivered',
  });

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        const [statusData, tokenData] = await Promise.all([
          api.get('/api/chat/status'),
          api.post('/api/stream-chat/token', {}),
        ]);
        if (!mounted) return;

        setStatus(statusData);
        myIdRef.current = tokenData.userId;

        const scClient = StreamChat.getInstance(tokenData.apiKey);
        scClientRef.current = scClient;

        if (!scClient.userID) {
          await scClient.connectUser(
            { id: tokenData.userId, name: tokenData.userName },
            tokenData.token
          );
        }

        const ids = [tokenData.userId, tokenData.artistId].sort();
        const channelId = 'dm' + ids[0].replace(/-/g, '').slice(0, 12) + ids[1].replace(/-/g, '').slice(0, 12);

        const channel = scClient.channel('messaging', channelId, {
          members: [tokenData.userId, tokenData.artistId],
        });

        channel.on('message.new', (event) => {
          if (!mounted) return;
          const msg = event.message;
          setMessages((prev) => {
            if (prev.find((m) => m.stream_id === msg.id)) return prev;
            return [...prev, msgToLocal(msg, tokenData.userId)];
          });
          channel.markRead().catch(() => {});
        });

        channel.on('typing.start', (event) => {
          if (mounted && event.user?.id !== tokenData.userId) setTyping(true);
        });
        channel.on('typing.stop', (event) => {
          if (mounted && event.user?.id !== tokenData.userId) setTyping(false);
        });
        channel.on('message.read', () => {
          if (mounted) setMessages((prev) => prev.map((m) => m.is_mine ? { ...m, status: 'read' } : m));
        });

        channelRef.current = channel;

        const state = await channel.watch();
        if (!mounted) return;

        setMessages((state.messages || []).map((m) => msgToLocal(m, tokenData.userId)));
        channel.markRead().catch(() => {});
      } catch (err) {
        console.error('Chat init error:', err);
        if (!mounted) return;
        try {
          const msgData = await api.get('/api/chat/messages');
          if (mounted) setMessages(msgData.messages || []);
        } catch {}
        if (mounted) setError('Live updates unavailable — messages load on refresh.');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    init();
    return () => {
      mounted = false;
      clearTimeout(typingTimer.current);
      channelRef.current?.stopWatching().catch(() => {});
      if (scClientRef.current?.userID) scClientRef.current.disconnectUser().catch(() => {});
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing]);

  const handleTyping = () => {
    channelRef.current?.keystroke().catch(() => {});
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      channelRef.current?.stopTyping().catch(() => {});
    }, 2000);
  };

  const sendMessage = async (content = null, mediaUrl = null, mediaType = null) => {
    setError('');
    setSending(true);

    // Optimistically update both counters BEFORE the API call
    // so there's no flicker — state is set once and stays
    setStatus((prev) => {
      if (!prev || prev.tier === 'guest') return prev;
      const wasFreeDM   = prev.freeRemaining > 0 && prev.dailyRemaining > 0;
      const newFreeRem  = wasFreeDM ? Math.max(0, prev.freeRemaining - 1) : prev.freeRemaining;
      const newDailyRem = Math.max(0, prev.dailyRemaining - 1);
      const newIsFree   = newFreeRem > 0 && newDailyRem > 0;
      return {
        ...prev,
        freeRemaining:  newFreeRem,
        dailyRemaining: newDailyRem,
        nextIsFree:     newIsFree,
        nextCost:       newIsFree ? 0 : prev.overageCost,
      };
    });

    try {
      const data = await api.post('/api/chat/send', {
        content:   content || undefined,
        mediaUrl:  mediaUrl || undefined,
        mediaType: mediaType || undefined,
      });
      setMessage('');

      if (channelRef.current) {
        const streamMsg = { id: data.message.id, tokens_charged: data.tokensCharged };
        if (content) streamMsg.text = content;
        if (mediaUrl) {
          streamMsg.attachments = [{
            type: mediaType === 'video' ? 'video' : 'image',
            [mediaType === 'video' ? 'asset_url' : 'image_url']: mediaUrl,
          }];
        }
        await channelRef.current.sendMessage(streamMsg);
      } else {
        setMessages((prev) => [...prev, { ...data.message, status: 'sent' }]);
      }
    } catch (err) {
      // On error, revert the optimistic update
      setStatus((prev) => {
        if (!prev || prev.tier === 'guest') return prev;
        const revertFreeRem  = prev.nextIsFree ? prev.freeRemaining + 1 : prev.freeRemaining;
        const revertDailyRem = prev.dailyRemaining + 1;
        const revertIsFree   = revertFreeRem > 0 && revertDailyRem > 0;
        return {
          ...prev,
          freeRemaining:  revertFreeRem,
          dailyRemaining: revertDailyRem,
          nextIsFree:     revertIsFree,
          nextCost:       revertIsFree ? 0 : prev.overageCost,
        };
      });
      if (err.message === 'INSUFFICIENT_TOKENS') {
        setTopUp(status?.nextCost || 1);
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
      if (message.trim()) sendMessage(message.trim());
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const result = await upload(file, 'chat_media');
    if (result) await sendMessage(null, result.publicUrl, result.mediaType);
  };

  if (loading) return <div style={{ color: C.muted, fontFamily: F.sans, padding: 24 }}>Connecting to chat…</div>;

  const isGuest        = status?.tier === 'guest';
  const nextIsFree     = status?.nextIsFree;
  const nextCost       = status?.nextCost || 0;
  const freeRemaining  = status?.freeRemaining || 0;
  const dailyRemaining = status?.dailyRemaining || 0;
  const canSendMedia   = status?.canSendMedia;
  const chatBg         = status?.chatBg;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '80vh', background: chatBg || 'transparent', borderRadius: chatBg ? 10 : 0 }}>
      <div style={{ marginBottom: 12, padding: chatBg ? '12px 12px 0' : 0 }}>
        <div style={eyebrow}>Direct messages</div>
        <h1 style={title}>Chat with Jinal</h1>
      </div>

      {status && (
        <div style={{ ...statusBar, margin: chatBg ? '0 12px 12px' : '0 0 12px' }}>
          {isGuest ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: F.sans, fontSize: 12, color: C.muted }}>Guest ·</span>
              <WonderCoinAmount amount={nextCost} size={13} textColor={C.accent} fontSize={13} />
              <span style={{ fontFamily: F.sans, fontSize: 12, color: C.muted }}>per message</span>
              <button onClick={() => setTopUp(nextCost * 5)} style={topUpBtn}>Top up</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={statItem}><span style={statLabel}>Free DMs left</span><span style={{ fontFamily: F.sans, fontSize: 13, color: freeRemaining > 0 ? C.accent : C.muted }}>{freeRemaining} / {status.freeDMsPerMonth}</span></span>
              <span style={statItem}><span style={statLabel}>Today</span><span style={{ fontFamily: F.sans, fontSize: 13, color: dailyRemaining > 0 ? C.accent : C.muted }}>{dailyRemaining} / {status.dailyDMCap}</span></span>
              <span style={statItem}><span style={statLabel}>Next</span>{nextIsFree ? <span style={{ fontFamily: F.sans, fontSize: 13, color: '#8FC88F' }}>Free</span> : <WonderCoinAmount amount={nextCost} size={13} textColor={C.muted} fontSize={13} />}</span>
              <span style={{ fontFamily: F.sans, fontSize: 11, color: C.muted }}>{TIERS[status.tier]?.name} · resets 1st</span>
              <button onClick={() => setTopUp(0)} style={topUpBtn}>Top up</button>
            </div>
          )}
        </div>
      )}

      <div style={{ ...feed, padding: chatBg ? '0 12px' : '0' }}>
        {messages.length === 0 && (
          <div style={{ color: C.muted, fontFamily: F.sans, fontSize: 14, textAlign: 'center', paddingTop: 40 }}>No messages yet. Say hello!</div>
        )}
        {messages.map((msg) => <MessageBubble key={msg.stream_id || msg.id} msg={msg} />)}
        {typing && (
          <div style={{ alignSelf: 'flex-start' }}>
            <div style={{ fontFamily: F.sans, fontSize: 11, color: C.accent, marginBottom: 3 }}>★ Jinal Joshi</div>
            <div style={{ ...bubble, background: C.surface, border: `1px solid ${C.border}`, color: C.muted, fontStyle: 'italic', padding: '10px 14px' }}>typing…</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <div style={{ ...errorBox, margin: chatBg ? '0 12px 8px' : '0 0 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <span>{error}</span>
          {error.includes('tokens') && <button onClick={() => setTopUp(nextCost)} style={inlineTopUp}>Top up now</button>}
        </div>
      )}

      <div style={{ ...composer, padding: chatBg ? '12px' : '12px 0 0' }}>
        {!nextIsFree && nextCost > 0 && (
          <div style={costPreview}>
            <WonderCoinAmount amount={nextCost} size={13} textColor={C.muted} fontSize={13} />
            <span style={{ fontFamily: F.sans, fontSize: 12, color: C.muted }}>{isGuest ? ' per message' : ' per message (quota used)'}</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          {canSendMedia && (
            <>
              <input ref={fileRef} type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={handleFileChange} />
              <button onClick={() => fileRef.current?.click()} disabled={uploading || sending} style={{ ...attachBtn, opacity: (uploading || sending) ? 0.5 : 1 }}>
                {uploading ? '…' : '📎'}
              </button>
            </>
          )}
          <textarea value={message} onChange={(e) => { setMessage(e.target.value); handleTyping(); }} onKeyDown={handleKeyDown} placeholder={nextIsFree ? `Message Jinal… (${freeRemaining} free remaining)` : isGuest ? `Message Jinal… (${nextCost} tokens each)` : `Message Jinal… (${nextCost} token${nextCost > 1 ? 's' : ''} each)`} style={composerInput} rows={2} />
          <button onClick={() => { if (message.trim()) sendMessage(message.trim()); }} disabled={sending || uploading || !message.trim()} style={{ ...sendBtn, opacity: (sending || uploading || !message.trim()) ? 0.5 : 1 }}>
            {sending ? '…' : 'Send'}
          </button>
        </div>
      </div>

      {topUp !== null && (
        <TopUpModal requiredTokens={topUp} onClose={() => setTopUp(null)} onSuccess={() => { setTopUp(null); loadStatus(); }} />
      )}
    </div>
  );
}

function MessageBubble({ msg }) {
  const isMe = msg.is_mine;
  return (
    <div style={{ alignSelf: isMe ? 'flex-end' : 'flex-start', maxWidth: '75%', display: 'flex', flexDirection: 'column' }}>
      {!isMe && <div style={{ fontFamily: F.sans, fontSize: 11, color: C.accent, marginBottom: 3 }}>★ Jinal Joshi</div>}
      <div style={{ ...bubble, background: isMe ? 'rgba(193,125,74,0.1)' : C.surface, border: isMe ? `1px solid rgba(193,125,74,0.25)` : `1px solid ${C.border}`, padding: msg.media_url ? 6 : '10px 14px', overflow: 'hidden' }}>
        {msg.media_url && msg.media_type === 'image' && <img src={msg.media_url} alt="" style={{ width: '100%', maxWidth: 280, borderRadius: 8, display: 'block', marginBottom: msg.content ? 8 : 0 }} />}
        {msg.media_url && msg.media_type === 'video' && <video src={msg.media_url} controls style={{ width: '100%', maxWidth: 280, borderRadius: 8, display: 'block', marginBottom: msg.content ? 8 : 0 }} />}
        {msg.content && <div style={{ padding: msg.media_url ? '0 8px 8px' : 0 }}>{msg.content}</div>}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 3, alignSelf: isMe ? 'flex-end' : 'flex-start' }}>
        <span style={{ fontFamily: F.sans, fontSize: 10, color: C.muted }}>{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        {isMe && <span style={{ fontSize: 11, color: msg.status === 'read' ? C.accent : C.muted }}>{msg.status === 'read' ? '✓✓' : msg.status === 'delivered' ? '✓✓' : '✓'}</span>}
        {msg.tokens_charged > 0 && isMe && <span style={{ fontFamily: F.sans, fontSize: 10, color: C.muted, display: 'flex', alignItems: 'center', gap: 2 }}>· <WonderCoinAmount amount={msg.tokens_charged} size={10} textColor={C.muted} fontSize={10} /> charged</span>}
      </div>
    </div>
  );
}

const eyebrow      = { fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 8 };
const title        = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(24px,4vw,42px)', margin: 0 };
const statusBar    = { padding: '8px 12px', background: 'rgba(22,20,16,0.85)', border: `1px solid ${C.border}`, borderRadius: 8, backdropFilter: 'blur(8px)' };
const statItem     = { display: 'flex', flexDirection: 'column', gap: 2 };
const statLabel    = { fontFamily: F.sans, fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' };
const topUpBtn     = { background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, fontFamily: F.sans, fontSize: 11, padding: '4px 8px', borderRadius: 6, cursor: 'pointer' };
const inlineTopUp  = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap' };
const feed         = { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 8, paddingBottom: 8, marginBottom: 8 };
const bubble       = { fontFamily: F.sans, fontSize: 14, color: C.text, lineHeight: 1.6, borderRadius: 10, wordBreak: 'break-word' };
const errorBox     = { background: 'rgba(156,90,90,0.12)', border: '1px solid rgba(156,90,90,0.35)', color: '#D99A9A', padding: '10px 14px', borderRadius: 8, fontFamily: F.sans, fontSize: 13 };
const costPreview  = { display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 };
const composer     = { borderTop: `1px solid ${C.border}` };
const composerInput = { flex: 1, width: '100%', background: 'rgba(22,20,16,0.9)', border: `1px solid ${C.border}`, color: C.text, fontFamily: F.sans, fontSize: 14, padding: '10px 14px', borderRadius: 8, resize: 'none', outline: 'none', lineHeight: 1.5, boxSizing: 'border-box' };
const sendBtn      = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 14, fontWeight: 700, padding: '10px 20px', borderRadius: 8, flexShrink: 0, cursor: 'pointer' };
const attachBtn    = { background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, fontSize: 16, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', flexShrink: 0 };