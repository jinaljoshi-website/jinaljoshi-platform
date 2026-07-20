import { useEffect, useRef, useState } from 'react';
import { C, F } from '../tokens';
import { api } from '../api';
import { WonderCoinAmount } from '../components/WonderCoin';
import { TIERS } from '../data';
import TopUpModal from '../components/TopUpModal';
import { StreamChat } from 'stream-chat';

const MAX_VOICE_SECONDS = 60;

export default function Chat() {
  const [messages,   setMessages]   = useState([]);
  const [status,     setStatus]     = useState(null);
  const [message,    setMessage]    = useState('');
  const [loading,    setLoading]    = useState(true);
  const [sending,    setSending]    = useState(false);
  const [typing,     setTyping]     = useState(false);
  const [error,      setError]      = useState('');
  const [topUp,      setTopUp]      = useState(null);
  const [unlocking,  setUnlocking]  = useState(null);
  const [recording,  setRecording]  = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const bottomRef   = useRef(null);
  const channelRef  = useRef(null);
  const scClientRef = useRef(null);
  const myIdRef     = useRef(null);
  const typingTimer = useRef(null);
  const statusRef   = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef   = useRef([]);
  const recordTimerRef   = useRef(null);
  const textareaRef = useRef(null);

  const [feedRect, setFeedRect] = useState(null);
  const feedElRef = useRef(null);
  const feedObserverRef = useRef(null);

  const recomputeFeedRect = () => {
    if (feedElRef.current) setFeedRect(feedElRef.current.getBoundingClientRect());
  };

  const feedRef = (node) => {
    if (feedObserverRef.current) {
      feedObserverRef.current.disconnect();
      feedObserverRef.current = null;
    }
    feedElRef.current = node;
    if (node) {
      const observer = new ResizeObserver(() => recomputeFeedRect());
      observer.observe(node);
      feedObserverRef.current = observer;
      recomputeFeedRect();
    }
  };

  useEffect(() => {
    window.addEventListener('resize', recomputeFeedRect);
    window.addEventListener('scroll', recomputeFeedRect, true);
    return () => {
      window.removeEventListener('resize', recomputeFeedRect);
      window.removeEventListener('scroll', recomputeFeedRect, true);
    };
  }, []);

  const loadStatus = () => api.get('/api/chat/status').then((d) => {
    setStatus(d);
    statusRef.current = d;
  }).catch(() => {});

  // Periodic refresh — catches a background change or quota update Jinal makes while this
  // tab is already open, without requiring a manual page refresh.
  useEffect(() => {
    const interval = setInterval(() => loadStatus(), 20000);
    return () => clearInterval(interval);
  }, []);

  const msgToLocal = (m, myId) => {
    if (m.locked_media) {
      return {
        id:                m.db_message_id || m.id,
        stream_id:         m.id,
        sender_id:         m.user?.id,
        content:           m.text || null,
        is_locked_media:   true,
        locked_price:      m.locked_price,
        locked_item_count: m.locked_item_count,
        unlocked_media:    null,
        created_at:        m.created_at,
        is_mine:           m.user?.id === myId,
        status:            'delivered',
      };
    }
    return {
      id:             m.id,
      stream_id:      m.id,
      sender_id:      m.user?.id,
      content:        m.text || null,
      media_url:      m.attachments?.[0]?.image_url || m.attachments?.[0]?.asset_url || null,
      media_type:     m.attachments?.[0]?.type === 'audio' ? 'audio' : m.attachments?.[0]?.type === 'video' ? 'video' : m.attachments?.[0]?.image_url ? 'image' : null,
      tokens_charged: m.tokens_charged || 0,
      created_at:     m.created_at,
      is_mine:        m.user?.id === myId,
      status:         'delivered',
    };
  };

  // Reconciles DB (source of truth) with whatever Stream has delivered — used both at
  // initial load and whenever the tab becomes visible again after being backgrounded.
  const syncMessages = async (myId) => {
    try {
      const state = channelRef.current ? { messages: channelRef.current.state.messages } : { messages: [] };
      const streamMessages = (state.messages || []).map((m) => msgToLocal(m, myId));
      const dbData = await api.get('/api/chat/messages');
      const dbMessages = dbData.messages || [];
      const streamIds = new Set(streamMessages.map((m) => m.id));

      const dbToLocal = (m) => ({
        id:                m.id,
        stream_id:         m.id,
        sender_id:         m.sender_id,
        content:           m.content,
        is_locked_media:   !!m.is_locked && m.unlock_price_coins != null,
        locked_price:      m.unlock_price_coins,
        locked_item_count: m.locked_item_count,
        unlocked_media:    m.locked_media_urls || null,
        media_url:         m.media_url,
        media_type:        m.media_type,
        tokens_charged:    m.tokens_charged || 0,
        created_at:        m.created_at,
        is_mine:           m.is_mine,
        status:            'delivered',
      });

      const missingFromStream = dbMessages.filter((m) => !streamIds.has(m.id)).map(dbToLocal);
      const dbById = new Map(dbMessages.map((m) => [m.id, m]));
      const patchedStreamMessages = streamMessages.map((m) => {
        if (!m.is_locked_media) return m;
        const dbMsg = dbById.get(m.id);
        if (dbMsg && dbMsg.locked_media_urls) return { ...m, unlocked_media: dbMsg.locked_media_urls };
        return m;
      });

      const finalMessages = [...patchedStreamMessages, ...missingFromStream]
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      setMessages(finalMessages);
    } catch (err) {
      console.error('Failed to sync messages:', err);
    }
  };

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
        statusRef.current = statusData;
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

        await channel.watch();
        if (!mounted) return;

        await syncMessages(tokenData.userId);
        channel.markRead().catch(() => {});
      } catch (err) {
        console.error('Chat init error:', err);
        if (!mounted) return;
        try {
          const msgData = await api.get('/api/chat/messages');
          if (mounted) {
            setMessages((msgData.messages || []).map((m) => ({
              ...m,
              is_locked_media: !!m.is_locked && m.unlock_price_coins != null,
              locked_price: m.unlock_price_coins,
              locked_item_count: m.locked_item_count,
              unlocked_media: m.locked_media_urls || null,
            })));
          }
        } catch {}
        if (mounted) setError('Live updates unavailable — messages load on refresh.');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    init();

    // Catches the case where the tab was backgrounded/suspended for a while and Stream's
    // websocket went stale without visibly disconnecting — resync the moment it's visible again.
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && myIdRef.current) {
        syncMessages(myIdRef.current);
        loadStatus();
        channelRef.current?.markRead().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);

    return () => {
      mounted = false;
      clearTimeout(typingTimer.current);
      clearInterval(recordTimerRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
      channelRef.current?.stopWatching().catch(() => {});
      if (scClientRef.current?.userID) scClientRef.current.disconnectUser().catch(() => {});
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing]);

  useEffect(() => {
    if (!loading) recomputeFeedRect();
  }, [loading]);

  const handleTyping = () => {
    channelRef.current?.keystroke().catch(() => {});
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      channelRef.current?.stopTyping().catch(() => {});
    }, 2000);
  };

  const autoGrow = (el) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  };

  const unlockMedia = async (dbMessageId) => {
    setUnlocking(dbMessageId);
    setError('');
    try {
      const data = await api.post(`/api/chat/messages/${dbMessageId}/unlock`, {});
      setMessages((prev) => prev.map((m) =>
        m.id === dbMessageId ? { ...m, unlocked_media: data.lockedMediaUrls } : m
      ));
      if (data.newBalance !== undefined) {
        setStatus((prev) => ({ ...prev, coinBalance: data.newBalance }));
        statusRef.current = { ...statusRef.current, coinBalance: data.newBalance };
      }
    } catch (err) {
      if (err.message === 'INSUFFICIENT_TOKENS') {
        const msg = messages.find((m) => m.id === dbMessageId);
        setTopUp(msg?.locked_price || 0);
      } else {
        setError(err.message);
      }
    } finally {
      setUnlocking(null);
    }
  };

  const sendMessage = async (content = null, mediaUrl = null, mediaType = null) => {
    setError('');

    const snap = statusRef.current;
    if (!snap) return;

    const willBeFree = snap.freeRemaining > 0 && snap.dailyRemaining > 0;
    const cost = willBeFree ? 0 : (snap.overageCost || 1);
    if (!willBeFree && snap.coinBalance < cost) {
      setTopUp(cost);
      return;
    }

    setSending(true);

    const newFreeRem  = willBeFree ? Math.max(0, snap.freeRemaining - 1) : snap.freeRemaining;
    const newDailyRem = Math.max(0, snap.dailyRemaining - 1);
    const newIsFree   = newFreeRem > 0 && newDailyRem > 0;
    const newBalance  = snap.coinBalance - cost;
    const newStatus   = {
      ...snap,
      freeRemaining:  newFreeRem,
      dailyRemaining: newDailyRem,
      nextIsFree:     newIsFree,
      nextCost:       newIsFree ? 0 : snap.overageCost,
      coinBalance:    newBalance,
    };
    setStatus(newStatus);
    statusRef.current = newStatus;

    try {
      const data = await api.post('/api/chat/send', {
        content:   content || undefined,
        mediaUrl:  mediaUrl || undefined,
        mediaType: mediaType || undefined,
      });
      setMessage('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';

      if (data.newBalance !== undefined) {
        setStatus((prev) => ({ ...prev, coinBalance: data.newBalance }));
        statusRef.current = { ...statusRef.current, coinBalance: data.newBalance };
      }

      if (channelRef.current) {
        const streamMsg = { id: data.message.id, tokens_charged: data.tokensCharged };
        if (content) streamMsg.text = content;
        if (mediaUrl) {
          streamMsg.attachments = [{
            type: mediaType === 'audio' ? 'audio' : mediaType === 'video' ? 'video' : 'image',
            [mediaType === 'video' || mediaType === 'audio' ? 'asset_url' : 'image_url']: mediaUrl,
          }];
        }
        await channelRef.current.sendMessage(streamMsg);
      } else {
        setMessages((prev) => [...prev, { ...data.message, status: 'sent' }]);
      }
    } catch (err) {
      setStatus(snap);
      statusRef.current = snap;
      if (err.message === 'INSUFFICIENT_TOKENS') {
        setTopUp(cost);
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

  // ── Voice notes ──
  const startRecording = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        if (blob.size > 0) uploadAndSendVoiceNote(blob);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setRecordSeconds(0);
      recordTimerRef.current = setInterval(() => {
        setRecordSeconds((s) => {
          if (s + 1 >= MAX_VOICE_SECONDS) {
            stopRecording();
            return MAX_VOICE_SECONDS;
          }
          return s + 1;
        });
      }, 1000);
    } catch (err) {
      setError('Microphone access is needed to record a voice note.');
    }
  };

  const stopRecording = () => {
    clearInterval(recordTimerRef.current);
    if (mediaRecorderRef.current?.state !== 'inactive') mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  const cancelRecording = () => {
    clearInterval(recordTimerRef.current);
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.onstop = null;
      if (mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream?.getTracks().forEach((t) => t.stop());
    }
    setRecording(false);
    setRecordSeconds(0);
  };

  const uploadAndSendVoiceNote = async (blob) => {
    setSending(true);
    try {
      const file = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
      const { uploadUrl, publicUrl } = await api.post('/api/upload/presign', {
        filename: file.name, contentType: file.type, context: 'chat_media',
      });
      await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      await sendMessage(null, publicUrl, 'audio');
    } catch (err) {
      setError('Failed to send voice note.');
    } finally {
      setSending(false);
      setRecordSeconds(0);
    }
  };

  if (loading) return <div style={{ color: C.muted, fontFamily: F.sans, padding: 24 }}>Connecting to chat…</div>;

  const isGuest        = status?.tier === 'guest';
  const nextIsFree     = status?.nextIsFree;
  const nextCost       = status?.nextCost || 0;
  const freeRemaining  = status?.freeRemaining || 0;
  const dailyRemaining = status?.dailyRemaining || 0;
  const chatBg         = status?.chatBg;

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', background: C.bg, borderRadius: chatBg ? 10 : 0, overflow: 'hidden' }}>
      <div style={{ ...stickyHeader, padding: '10px 16px' }}>
        <div style={{ marginBottom: 6 }}>
          <div style={eyebrow}>Direct messages</div>
          <h1 style={title}>Chat with Jinal</h1>
        </div>

        {status && (
          <div style={statusBar}>
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

        {error && (
          <div style={{ ...errorBox, marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <span>{error}</span>
            {error.includes('tokens') && <button onClick={() => setTopUp(nextCost)} style={inlineTopUp}>Top up now</button>}
          </div>
        )}
      </div>

      <div ref={feedRef} style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        {chatBg && feedRect && (
          <div style={{ position: 'fixed', top: feedRect.top, left: feedRect.left, width: feedRect.width, height: feedRect.height, overflow: 'hidden', zIndex: 0, pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${chatBg})`, backgroundSize: 'cover', backgroundPosition: 'center', filter: 'blur(28px)', transform: 'scale(1.15)' }} />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              <img src={chatBg} alt="" style={{ height: '100%', width: 'auto', maxWidth: 'none', display: 'block' }} />
            </div>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(10,9,8,0.55)' }} />
          </div>
        )}

        <div style={{ position: 'relative', zIndex: 2, height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 16px' }}>
          {messages.length === 0 && (
            <div style={{ color: C.muted, fontFamily: F.sans, fontSize: 14, textAlign: 'center', paddingTop: 40 }}>No messages yet. Say hello!</div>
          )}
          {messages.map((msg) => (
            <MessageBubble
              key={msg.stream_id || msg.id}
              msg={msg}
              onUnlock={() => unlockMedia(msg.id)}
              unlocking={unlocking === msg.id}
            />
          ))}
          {typing && (
            <div style={{ alignSelf: 'flex-start' }}>
              <div style={{ fontFamily: F.sans, fontSize: 11, color: C.accent, marginBottom: 3 }}>★ Jinal Joshi</div>
              <div style={{ ...bubble, background: C.surface, border: `1px solid ${C.border}`, color: C.muted, fontStyle: 'italic', padding: '10px 14px' }}>typing…</div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div style={{ ...composer, padding: '10px 16px', flexShrink: 0 }}>
        {!nextIsFree && nextCost > 0 && (
          <div style={costPreview}>
            <WonderCoinAmount amount={nextCost} size={13} textColor={C.muted} fontSize={13} />
            <span style={{ fontFamily: F.sans, fontSize: 12, color: C.muted }}>{isGuest ? ' per message' : ' per message (quota used)'}</span>
          </div>
        )}

        {recording ? (
          <div style={recordingBar}>
            <div style={recordingDot} />
            <span style={{ fontFamily: F.mono, fontSize: 14, color: C.text }}>
              {String(Math.floor(recordSeconds / 60)).padStart(2, '0')}:{String(recordSeconds % 60).padStart(2, '0')} / 01:00
            </span>
            <div style={{ flex: 1 }} />
            <button onClick={cancelRecording} style={cancelRecordBtn}>Cancel</button>
            <button onClick={stopRecording} style={sendBtn}>Send</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <button onClick={startRecording} disabled={sending} style={{ ...micBtn, opacity: sending ? 0.5 : 1 }} title="Record a voice note">🎙️</button>
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => { setMessage(e.target.value); handleTyping(); autoGrow(e.target); }}
              onKeyDown={handleKeyDown}
              placeholder={nextIsFree ? `Message Jinal… (${freeRemaining} free remaining)` : isGuest ? `Message Jinal… (${nextCost} tokens each)` : `Message Jinal… (${nextCost} token${nextCost > 1 ? 's' : ''} each)`}
              style={composerInput}
              rows={2}
            />
            <button onClick={() => { if (message.trim()) sendMessage(message.trim()); }} disabled={sending || !message.trim()} style={{ ...sendBtn, opacity: (sending || !message.trim()) ? 0.5 : 1 }}>
              {sending ? '…' : 'Send'}
            </button>
          </div>
        )}
      </div>

      {topUp !== null && (
        <TopUpModal requiredTokens={topUp} onClose={() => setTopUp(null)} onSuccess={() => { setTopUp(null); loadStatus(); }} />
      )}
    </div>
  );
}

function MessageBubble({ msg, onUnlock, unlocking }) {
  const isMe = msg.is_mine;

  if (msg.is_locked_media) {
    const isUnlocked = !!msg.unlocked_media;
    return (
      <div style={{ alignSelf: isMe ? 'flex-end' : 'flex-start', maxWidth: '75%', display: 'flex', flexDirection: 'column' }}>
        {!isMe && <div style={{ fontFamily: F.sans, fontSize: 11, color: C.accent, marginBottom: 3 }}>★ Jinal Joshi</div>}
        <div style={{ ...bubble, background: isMe ? 'rgba(193,125,74,0.1)' : C.surface, border: isMe ? `1px solid rgba(193,125,74,0.25)` : `1px solid ${C.border}`, padding: 10, overflow: 'hidden' }}>
          {isUnlocked ? (
            <div style={{ display: 'grid', gridTemplateColumns: msg.unlocked_media.length > 1 ? '1fr 1fr' : '1fr', gap: 6 }}>
              {msg.unlocked_media.map((item, i) => (
                item.type === 'video'
                  ? <video key={i} src={item.url} controls style={{ width: '100%', borderRadius: 6, display: 'block' }} />
                  : item.type === 'audio'
                    ? <audio key={i} src={item.url} controls style={{ width: '100%' }} />
                    : <img key={i} src={item.url} alt="" style={{ width: '100%', borderRadius: 6, display: 'block' }} />
              ))}
            </div>
          ) : (
            <div style={{ position: 'relative', width: 220, height: 160, borderRadius: 8, background: 'rgba(0,0,0,0.4)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <div style={{ fontSize: 28 }}>{msg.locked_price > 0 ? '🔒' : '🎁'}</div>
              <div style={{ fontFamily: F.sans, fontSize: 12, color: C.text }}>
                {msg.locked_item_count} item{msg.locked_item_count === 1 ? '' : 's'}
              </div>
              {!isMe && (
                <>
                  <button onClick={onUnlock} disabled={unlocking} style={{ ...sendBtn, padding: '8px 16px', fontSize: 12, opacity: unlocking ? 0.6 : 1 }}>
                    {unlocking ? '…' : msg.locked_price > 0 ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        Unlock for <WonderCoinAmount amount={msg.locked_price} size={12} fontSize={12} textColor="#1A1714" />
                      </span>
                    ) : 'View'}
                  </button>
                  <div style={{ fontFamily: F.sans, fontSize: 9, color: C.muted, textAlign: 'center' }}>Chat messages, including unlocked media, are removed after 30 days</div>
                </>
              )}
            </div>
          )}
          {msg.content && <div style={{ marginTop: 8 }}>{msg.content}</div>}
        </div>
        <div style={{ fontFamily: F.sans, fontSize: 10, color: C.muted, marginTop: 3, alignSelf: isMe ? 'flex-end' : 'flex-start' }}>
          {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    );
  }

  return (
    <div style={{ alignSelf: isMe ? 'flex-end' : 'flex-start', maxWidth: '75%', display: 'flex', flexDirection: 'column' }}>
      {!isMe && <div style={{ fontFamily: F.sans, fontSize: 11, color: C.accent, marginBottom: 3 }}>★ Jinal Joshi</div>}
      <div style={{ ...bubble, background: isMe ? 'rgba(193,125,74,0.1)' : C.surface, border: isMe ? `1px solid rgba(193,125,74,0.25)` : `1px solid ${C.border}`, padding: msg.media_url ? 6 : '10px 14px', overflow: 'hidden' }}>
        {msg.media_url && msg.media_type === 'image' && <img src={msg.media_url} alt="" style={{ width: '100%', maxWidth: 280, borderRadius: 8, display: 'block', marginBottom: msg.content ? 8 : 0 }} />}
        {msg.media_url && msg.media_type === 'video' && <video src={msg.media_url} controls style={{ width: '100%', maxWidth: 280, borderRadius: 8, display: 'block', marginBottom: msg.content ? 8 : 0 }} />}
        {msg.media_url && msg.media_type === 'audio' && <audio src={msg.media_url} controls style={{ width: '100%', minWidth: 220 }} />}
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

const eyebrow      = { fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 6 };
const title        = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(18px,2.4vw,26px)', margin: 0 };
const stickyHeader = { flexShrink: 0, background: 'rgba(13,12,10,1)', borderBottom: `1px solid ${C.border}` };
const statusBar    = { padding: '8px 12px', background: 'rgba(22,20,16,0.85)', border: `1px solid ${C.border}`, borderRadius: 8 };
const statItem     = { display: 'flex', flexDirection: 'column', gap: 2 };
const statLabel    = { fontFamily: F.sans, fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' };
const topUpBtn     = { background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, fontFamily: F.sans, fontSize: 11, padding: '4px 8px', borderRadius: 6, cursor: 'pointer' };
const inlineTopUp  = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap' };
const bubble       = { fontFamily: F.sans, fontSize: 14, color: C.text, lineHeight: 1.6, borderRadius: 10, wordBreak: 'break-word', textAlign: 'left' };
const errorBox     = { background: 'rgba(156,90,90,0.12)', border: '1px solid rgba(156,90,90,0.35)', color: '#D99A9A', padding: '10px 14px', borderRadius: 8, fontFamily: F.sans, fontSize: 13 };
const costPreview  = { display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 };
const composer     = { flexShrink: 0, borderTop: `1px solid ${C.border}`, background: 'rgba(13,12,10,1)' };
const composerInput = { flex: 1, width: '100%', background: 'rgba(22,20,16,0.9)', border: `1px solid ${C.border}`, color: C.text, fontFamily: F.sans, fontSize: 16, padding: '10px 14px', borderRadius: 8, resize: 'none', outline: 'none', lineHeight: 1.5, boxSizing: 'border-box', textAlign: 'left', maxHeight: 160 };
const sendBtn      = { background: C.accent, border: 'none', color: '#1A1714', fontFamily: F.sans, fontSize: 14, fontWeight: 700, padding: '10px 20px', borderRadius: 8, flexShrink: 0, cursor: 'pointer' };
const micBtn       = { background: 'transparent', border: `1px solid ${C.border}`, color: C.text, fontSize: 18, padding: '8px 12px', borderRadius: 8, cursor: 'pointer', flexShrink: 0 };
const recordingBar = { display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(156,90,90,0.1)', border: '1px solid rgba(156,90,90,0.3)', borderRadius: 8, padding: '10px 14px' };
const recordingDot = { width: 10, height: 10, borderRadius: '50%', background: '#D99A9A', flexShrink: 0 };
const cancelRecordBtn = { background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, fontFamily: F.sans, fontSize: 13, padding: '8px 14px', borderRadius: 8, cursor: 'pointer' };