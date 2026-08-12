// studio/src/sections/Messages.jsx
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import BackgroundPicker from '../components/BackgroundPicker';
import { T, S, Card, Eyebrow, Badge, Field, TokenField, colors } from '../ui';
import { StreamChat } from 'stream-chat';
import CropTool from '../components/CropTool';

const TOKEN_RATE = 66;
const CHAT_BG_ASPECT = 9 / 16;
const MAX_VOICE_SECONDS = 60;

async function uploadToR2(file, context) {
  const { uploadUrl, publicUrl } = await api.post('/api/upload/presign', {
    filename: file.name, contentType: file.type, context,
  });
  await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
  return publicUrl;
}

function makeChannelId(id1, id2) {
  const ids = [id1, id2].sort();
  return 'dm' + ids[0].replace(/-/g, '').slice(0, 12) + ids[1].replace(/-/g, '').slice(0, 12);
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
}

function derivePricingMode(fan) {
  if (fan?.custom_messages_per_token) return 'per_token';
  if (fan?.custom_chat_price !== null && fan?.custom_chat_price !== undefined) return 'flat';
  return 'default';
}

function isCurrentlyBlocked(blockedUntil) {
  return blockedUntil && new Date(blockedUntil) > new Date();
}

const mono = "'DM Mono', 'Courier New', monospace";

const msgActionBtn    = { background: 'none', border: 'none', color: '#9B8F83', fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 11, cursor: 'pointer', padding: 0 };
const quotedInStudio  = { borderLeft: '2px solid #C17D4A', paddingLeft: 8, marginBottom: 6, opacity: 0.85 };
const deleteBar       = { position: 'sticky', bottom: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: '#100F0C', border: '1px solid rgba(156,90,90,0.4)', borderRadius: 10, padding: '10px 14px', marginTop: 10, zIndex: 5 };
const studioReplyBar  = { display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(193,125,74,0.08)', borderLeft: '2px solid #C17D4A', borderRadius: 6, padding: '6px 10px', marginBottom: 8 };

function whenLabel(ts) {
  if (!ts) return '';
  const then = new Date(ts);
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1)    return 'now';
  if (mins < 60)   return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)    return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7)    return `${days}d`;
  return then.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function Messages() {
  const [convos,   setConvos]   = useState([]);
  const [selected, setSelected] = useState(null);
  const [thread,   setThread]   = useState([]);
  const [fan,      setFan]      = useState(null);
  // What this fan has left to spend and to say — so a quiet week reads as
  // "out of free messages" rather than "lost interest".
  const [quota,    setQuota]    = useState(null);
  const [reply,    setReply]    = useState('');
  const [sending,  setSending]  = useState(false);
  const [loading,  setLoading]  = useState(true);
  const [typing,   setTyping]   = useState(false);
  const [panel,    setPanel]    = useState(null);
  const [allFans,       setAllFans]       = useState([]);
  const [fanSearch,     setFanSearch]     = useState('');
  const [showNewChat,   setShowNewChat]   = useState(false);
  const [defaultChatBg, setDefaultChatBg] = useState(null);

  const [hoveredMsg, setHoveredMsg] = useState(null);
  const [pickedMsgs, setPickedMsgs] = useState([]);
  const [replyTo,    setReplyTo]    = useState(null);
  const [deleting,   setDeleting]   = useState(false);
  const selecting = pickedMsgs.length > 0;

  // So a reply can show what it answers without another request.
  const msgById = {};
  (thread || []).forEach((x) => { msgById[x.id] = x; });

  const toggleSelect = (id) =>
    setPickedMsgs((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // Marked rather than removed. A message that vanishes without trace leaves
  // the other person wondering whether they imagined it.
  const deleteSelected = async () => {
    setDeleting(true);
    try {
      await api.post('/api/studio/dms/delete', { messageIds: pickedMsgs });
      setPickedMsgs([]);
      if (selected) resyncThread(selected);
    } catch (err) { console.error(err); } finally { setDeleting(false); }
  };

  useEffect(() => {
    api.get('/api/studio/config')
      .then((d) => setDefaultChatBg(d.config?.personal_chat_bg || null))
      .catch(() => {});
  }, []);
  const [fanLastRead,   setFanLastRead]   = useState(null);
  const [recording,     setRecording]     = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const isMobile = useIsMobile();

  const [grantAmt,  setGrantAmt]  = useState('');
  const [grantNote, setGrantNote] = useState('');
  const [granting,  setGranting]  = useState(false);
  const [grantMsg,  setGrantMsg]  = useState('');

  const [bgUploading,   setBgUploading]   = useState(false);
  const [bgPreview,     setBgPreview]     = useState('');
  const [bgCropFile,    setBgCropFile]    = useState(null);
  const [effectiveBg,   setEffectiveBg]   = useState('');
  const [pricingMode,   setPricingMode]   = useState('default');
  const [flatPrice,     setFlatPrice]     = useState('');
  const [perTokenBlock, setPerTokenBlock] = useState('');
  const [mediaEnabled,  setMediaEnabled]  = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);

  const [fanMuted,        setFanMuted]        = useState(false);
  const [fanBlockedUntil, setFanBlockedUntil]  = useState(null);
  const [fanBlockCount,   setFanBlockCount]    = useState(0);
  const [blockReasonInput, setBlockReasonInput] = useState('');
  const [moderationSaving, setModerationSaving] = useState(false);
  const [moderationMsg,    setModerationMsg]    = useState('');

  const [lockedFiles,   setLockedFiles]   = useState([]);
  const [lockedPrice,   setLockedPrice]   = useState('');
  const [lockedCaption, setLockedCaption] = useState('');
  const [sendingLocked, setSendingLocked] = useState(false);

  const lockedFileRef = useRef(null);
  const bgFileRef     = useRef(null);
  const bottomRef     = useRef(null);
  const replyRef      = useRef(null);

  const scClientRef  = useRef(null);
  const channelRef   = useRef(null);
  const artistIdRef  = useRef(null);
  const selectedRef  = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef   = useRef([]);
  const recordTimerRef   = useRef(null);

  useEffect(() => {
    api.get('/api/studio/dms')
      .then((d) => setConvos(d.conversations || []))
      .finally(() => setLoading(false));

    api.get('/api/studio/fans').then((d) => setAllFans(d.fans || [])).catch(() => {});

    initArtistStream();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && selectedRef.current) {
        resyncThread(selectedRef.current);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
      if (channelRef.current) channelRef.current.stopWatching().catch(() => {});
      if (scClientRef.current?.userID) scClientRef.current.disconnectUser().catch(() => {});
    };
  }, []);

  const initArtistStream = async () => {
    try {
      const tokenData = await api.post('/api/stream-chat/token', {});
      artistIdRef.current = tokenData.userId;

      const scClient = StreamChat.getInstance(tokenData.apiKey);
      scClientRef.current = scClient;

      if (!scClient.userID) {
        await scClient.connectUser(
          { id: tokenData.userId, name: tokenData.userName },
          tokenData.token
        );
      }
    } catch (err) {
      console.error('Studio Stream init error:', err);
    }
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread, typing]);

  const resyncThread = async (fanId) => {
    try {
      const data = await api.get(`/api/studio/dms/${fanId}`);
      setThread(data.messages || []);
      channelRef.current?.markRead().catch(() => {});
    } catch {}
  };

  const openConvo = async (fanId) => {
    if (channelRef.current) {
      channelRef.current.off('message.new');
      channelRef.current.off('typing.start');
      channelRef.current.off('typing.stop');
      channelRef.current.off('message.read');
      await channelRef.current.stopWatching().catch(() => {});
      channelRef.current = null;
    }

    setSelected(fanId);
    selectedRef.current = fanId;
    setPanel(null);
    setGrantMsg('');
    setTyping(false);
    setLockedFiles([]);
    setLockedPrice('');
    setLockedCaption('');
    setModerationMsg('');
    setBlockReasonInput('');
    setFanLastRead(null);

    const data = await api.get(`/api/studio/dms/${fanId}`);
    setThread(data.messages || []);
    setFan(data.fan || null);
    setQuota(data.quota || null);
    setBgPreview(data.fan?.personal_chat_bg || '');
    setEffectiveBg(data.fan?.effective_chat_bg || '');
    setMediaEnabled(data.fan?.can_send_media || false);
    setFanMuted(data.fan?.is_muted || false);
    setFanBlockedUntil(data.fan?.blocked_until || null);
    setFanBlockCount(data.fan?.block_count || 0);

    const mode = derivePricingMode(data.fan);
    setPricingMode(mode);
    setFlatPrice(mode === 'flat' ? String(data.fan?.custom_chat_price ?? '') : '');
    setPerTokenBlock(mode === 'per_token' ? String(data.fan?.custom_messages_per_token ?? '') : '');

    try {
      if (!scClientRef.current?.userID) await initArtistStream();
      const artistId = artistIdRef.current;
      if (!artistId || !scClientRef.current) return;

      const channelId = makeChannelId(artistId, fanId);
      const channel = scClientRef.current.channel('messaging', channelId, {
        members: [artistId, fanId],
      });

      channel.on('message.new', (event) => {
        const msg = event.message;
        const isFromFan = msg.user?.id === fanId;
        if (!isFromFan) return;

        setThread((prev) => {
          if (prev.find((m) => m.id === msg.id || m.stream_id === msg.id)) return prev;
          return [...prev, {
            id:         msg.id,
            stream_id:  msg.id,
            sender_id:  msg.user.id,
            content:    msg.text || null,
            media_url:  msg.attachments?.[0]?.image_url || msg.attachments?.[0]?.asset_url || null,
            media_type: msg.attachments?.[0]?.type === 'audio' ? 'audio' : msg.attachments?.[0]?.type === 'video' ? 'video' : msg.attachments?.[0]?.image_url ? 'image' : null,
            created_at: msg.created_at,
            is_mine:    false,
          }];
        });

        api.get('/api/studio/dms').then((d) => setConvos(d.conversations || [])).catch(() => {});
        channel.markRead().catch(() => {});
      });

      channel.on('typing.start', (event) => {
        if (event.user?.id !== artistId) setTyping(true);
      });

      channel.on('typing.stop', (event) => {
        if (event.user?.id !== artistId) setTyping(false);
      });

      // Tracks the fan's read receipt so Jinal's own sent messages can show ✓ vs ✓✓
      channel.on('message.read', (event) => {
        if (event.user?.id === fanId) {
          setFanLastRead(new Date(event.received_at || event.created_at || Date.now()));
        }
      });

      channelRef.current = channel;
      const state = await channel.watch();

      const fanReadState = state.read?.[fanId];
      if (fanReadState?.last_read) setFanLastRead(new Date(fanReadState.last_read));

      channel.markRead().catch(() => {});
    } catch (err) {
      console.error('Studio channel watch error:', err);
    }
  };

  const closeConvo = () => {
    setSelected(null);
    selectedRef.current = null;
    setThread([]);
    setFan(null);
    setPanel(null);
  };

  const startNewChat = (fanId) => {
    setShowNewChat(false);
    setFanSearch('');
    openConvo(fanId);
  };

  const sendReply = async (mediaUrl = null, mediaType = null) => {
    if (!reply.trim() && !mediaUrl) return;
    setSending(true);
    try {
      const data = await api.post(`/api/studio/dms/${selected}/reply`, {
        content:   reply.trim() || undefined,
        mediaUrl:  mediaUrl  || undefined,
        mediaType: mediaType || undefined,
        parentId:  replyTo?.id || undefined,
      });
      setReplyTo(null);

      setThread((prev) => [...prev, data.message]);
      setReply('');
      if (replyRef.current) replyRef.current.style.height = 'auto';

      if (channelRef.current) {
        const streamMsg = {};
        if (reply.trim()) streamMsg.text = reply.trim();
        if (mediaUrl) {
          streamMsg.attachments = [{
            type: mediaType === 'audio' ? 'audio' : mediaType === 'video' ? 'video' : 'image',
            [mediaType === 'video' || mediaType === 'audio' ? 'asset_url' : 'image_url']: mediaUrl,
          }];
        }
        streamMsg.id = data.message.id;
        await channelRef.current.sendMessage(streamMsg).catch(() => {});
      }

      api.get('/api/studio/dms').then((d) => setConvos(d.conversations || [])).catch(() => {});
    } catch (err) { alert(err.message); }
    finally { setSending(false); }
  };

  // ── Voice notes (Jinal's side) ──
  const startRecording = async () => {
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
          if (s + 1 >= MAX_VOICE_SECONDS) { stopRecording(); return MAX_VOICE_SECONDS; }
          return s + 1;
        });
      }, 1000);
    } catch (err) {
      alert('Microphone access is needed to record a voice note.');
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
      const publicUrl = await uploadToR2(file, 'chat_media');
      await sendReply(publicUrl, 'audio');
    } catch (err) {
      alert('Failed to send voice note.');
    } finally {
      setSending(false);
      setRecordSeconds(0);
    }
  };

  const handleLockedFilesChange = (e) => {
    const files = Array.from(e.target.files || []);
    setLockedFiles(files);
    e.target.value = '';
  };

  const handleSendLockedMedia = async () => {
    if (!selected || lockedFiles.length === 0 || lockedPrice === '') return;
    setSendingLocked(true);
    try {
      const mediaItems = [];
      for (const file of lockedFiles) {
        const publicUrl = await uploadToR2(file, 'chat_media');
        const mediaType = file.type.startsWith('video/') ? 'video' : 'image';
        mediaItems.push({ url: publicUrl, type: mediaType });
      }

      const data = await api.post(`/api/studio/dms/${selected}/send-locked-media`, {
        mediaItems,
        priceCoins: parseInt(lockedPrice),
        content: lockedCaption.trim() || undefined,
      });

      setThread((prev) => [...prev, data.message]);

      if (channelRef.current) {
        await channelRef.current.sendMessage({
          id: data.message.id,
          text: lockedCaption.trim() || undefined,
          locked_media: true,
          db_message_id: data.message.id,
          locked_price: parseInt(lockedPrice),
          locked_item_count: mediaItems.length,
        }).catch(() => {});
      }

      api.get('/api/studio/dms').then((d) => setConvos(d.conversations || [])).catch(() => {});

      setLockedFiles([]);
      setLockedPrice('');
      setLockedCaption('');
      setPanel(null);
    } catch (err) {
      alert(err.message);
    } finally {
      setSendingLocked(false);
    }
  };

  const handleGrant = async () => {
    if (!fan || !grantAmt) return;
    setGranting(true);
    try {
      await api.post('/api/studio/grant-tokens', { email: fan.email, amount: parseInt(grantAmt), reason: grantNote || 'Token grant from Jinal' });
      setGrantMsg(`✓ ${grantAmt} tokens sent to ${fan.display_name || fan.email}`);
      setGrantAmt(''); setGrantNote('');
    } catch (err) { setGrantMsg(`Error: ${err.message}`); }
    finally { setGranting(false); }
  };

  const handleBgFilePick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !fan) return;
    setBgCropFile(file);
  };

  const handleBgCropComplete = async (croppedFile) => {
    setBgCropFile(null);
    setBgUploading(true);
    try {
      const publicUrl = await uploadToR2(croppedFile, 'background');
      await api.post('/api/upload/confirm-background', { publicUrl, type: 'fan', fanId: fan.id });
      setBgPreview(publicUrl);
      setEffectiveBg(publicUrl);
    } catch (err) { alert(err.message); }
    finally { setBgUploading(false); }
  };

  const saveSettings = async () => {
    if (!fan) return;
    setSettingsSaving(true);
    try {
      // A genuine null, not an empty string — an empty string would satisfy
      // COALESCE() on the read side and break the fallback to the platform default.
      await api.post('/api/studio/chat-bg', { type: 'fan', value: bgPreview || null, fanId: fan.id });

      const payload = {
        can_send_media: mediaEnabled,
        custom_chat_price: pricingMode === 'flat' ? (flatPrice === '' ? null : parseInt(flatPrice)) : null,
        custom_messages_per_token: pricingMode === 'per_token' ? (perTokenBlock === '' ? null : parseInt(perTokenBlock)) : null,
      };
      await api.patch(`/api/studio/fan-settings/${fan.id}`, payload);
      setEffectiveBg(bgPreview);
    } catch (err) { alert(err.message); }
    finally { setSettingsSaving(false); }
  };

  const toggleFanMute = async () => {
    if (!fan) return;
    setModerationSaving(true);
    setModerationMsg('');
    try {
      await api.post(`/api/studio/fan-settings/${fan.id}/mute`, { muted: !fanMuted });
      setFanMuted((m) => !m);
    } catch (err) {
      setModerationMsg(`Error: ${err.message}`);
    } finally {
      setModerationSaving(false);
    }
  };

  const applyFanBlock = async () => {
    if (!fan) return;
    setModerationSaving(true);
    setModerationMsg('');
    try {
      const data = await api.post(`/api/studio/fan-settings/${fan.id}/block`, { reason: blockReasonInput.trim() || undefined });
      setModerationMsg(data.message);
      setFanBlockedUntil(data.blockedUntil);
      setFanBlockCount((c) => c + 1);
      setBlockReasonInput('');
    } catch (err) {
      setModerationMsg(`Error: ${err.message}`);
    } finally {
      setModerationSaving(false);
    }
  };

  const liftFanBlock = async () => {
    if (!fan) return;
    setModerationSaving(true);
    setModerationMsg('');
    try {
      const data = await api.post(`/api/studio/fan-settings/${fan.id}/unblock`, {});
      setFanBlockedUntil(null);
      setModerationMsg(data.message);
    } catch (err) {
      setModerationMsg(`Error: ${err.message}`);
    } finally {
      setModerationSaving(false);
    }
  };

  const handleTyping = () => {
    if (channelRef.current) channelRef.current.keystroke().catch(() => {});
  };

  const autoGrow = (el) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  };

  if (loading) return <T.muted>Loading messages…</T.muted>;

  const sans = "'DM Sans', system-ui, sans-serif";
  const quotaChip = {
    fontFamily: sans, fontSize: 10, color: colors.muted,
    background: 'rgba(255,255,255,0.04)', border: `1px solid ${colors.border}`,
    borderRadius: 999, padding: '3px 9px', whiteSpace: 'nowrap',
  };
  const showList   = !isMobile || !selected;
  const showThread = !isMobile || !!selected;
  const fanCurrentlyBlocked = isCurrentlyBlocked(fanBlockedUntil);

  return (
    <div style={isMobile
      ? { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }
      : { display: 'grid', gridTemplateColumns: '240px 1fr', gap: 20, height: '100%', minHeight: 0 }
    }>
      {showList && (
        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, flex: isMobile ? 1 : undefined, minHeight: 0 }}>
          {/* Above the conversations, so the default wallpaper for chats is set
              where the chats are rather than through an admin screen. */}
          <BackgroundPicker
            type="personal"
            current={defaultChatBg}
            onChange={setDefaultChatBg}
            label="Default chat background"
          />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <Eyebrow>Conversations</Eyebrow>
            <button onClick={() => setShowNewChat((v) => !v)} style={{ ...S.ghostBtn, fontSize: 12, padding: '5px 10px' }}>+ New</button>
          </div>

          {showNewChat && (
            <Card style={{ marginBottom: 8 }}>
              <input
                autoFocus
                value={fanSearch}
                onChange={(e) => setFanSearch(e.target.value)}
                placeholder="Search by name or email…"
                style={{ ...S.input, width: '100%', marginBottom: 10, boxSizing: 'border-box' }}
              />
              <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {allFans
                  .filter((f) => {
                    const q = fanSearch.trim().toLowerCase();
                    if (!q) return true;
                    return (f.display_name || '').toLowerCase().includes(q) || f.email.toLowerCase().includes(q);
                  })
                  .slice(0, 30)
                  .map((f) => (
                    <button
                      key={f.id}
                      onClick={() => startNewChat(f.id)}
                      style={{ background: 'transparent', border: 'none', borderBottom: `1px solid ${colors.border}`, padding: '8px 4px', textAlign: 'left', cursor: 'pointer', color: colors.text, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}
                    >
                      <span style={{ fontFamily: sans, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {f.display_name || f.email}
                      </span>
                      <Badge tier={f.tier} />
                    </button>
                  ))}
                {allFans.length === 0 && <T.muted>No registered fans yet.</T.muted>}
              </div>
              <button onClick={() => { setShowNewChat(false); setFanSearch(''); }} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 10px', marginTop: 10 }}>Cancel</button>
            </Card>
          )}

          {convos.length === 0 && !showNewChat && <T.muted>No messages yet.</T.muted>}
          {convos.map((c) => (
            <button key={c.fan_id} onClick={() => openConvo(c.fan_id)} style={{ background: selected === c.fan_id ? 'rgba(193,125,74,0.1)' : '#161410', border: selected === c.fan_id ? '1px solid rgba(193,125,74,0.3)' : `1px solid ${colors.border}`, borderRadius: 8, padding: '12px 14px', textAlign: 'left', cursor: 'pointer', color: colors.text }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
                <span style={{ fontFamily: sans, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.display_name || c.email}
                </span>
                {/* How long they have been waiting, which is the thing that
                    decides who to reply to next. */}
                <span style={{ fontFamily: mono, fontSize: 10, color: colors.muted, flexShrink: 0 }}>
                  {whenLabel(c.created_at)}
                </span>
              </div>
              <div style={{ fontFamily: sans, fontSize: 12, color: colors.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.is_mine && <span style={{ color: colors.muted, opacity: 0.7 }}>You: </span>}
                {c.content?.slice(0, 40)}…
              </div>
              {!c.is_mine && !c.read && <div style={{ width: 6, height: 6, borderRadius: '50%', background: colors.accent, marginTop: 5 }} />}
            </button>
          ))}
        </div>
      )}

      {showThread && (
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', minHeight: 0, flex: isMobile ? 1 : undefined, borderRadius: effectiveBg ? 10 : 0, overflow: 'hidden' }}>
          {selected && effectiveBg && (
            <>
              <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${effectiveBg})`, backgroundSize: 'cover', backgroundPosition: 'center', zIndex: 0 }} />
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(10,9,8,0.55)', zIndex: 1 }} />
            </>
          )}

          <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, padding: effectiveBg ? 14 : 0, boxSizing: 'border-box' }}>
            {selected ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    {isMobile && (
                      <button onClick={closeConvo} style={{ background: 'transparent', border: 'none', color: colors.muted, fontSize: 20, cursor: 'pointer', padding: '0 4px 0 0', flexShrink: 0 }}>←</button>
                    )}
                    <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 20, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fan?.display_name || fan?.email}</div>
                    {fan && <Badge tier={fan.tier} />}
                    {fan && !isMobile && quota && (
                      <span style={quotaChip} title="Free messages left this period and today, then what a further message costs them">
                        {quota.tier === 'guest'
                          ? `Guest · ${quota.overageCost}/msg`
                          : `${quota.freeRemaining}/${quota.freeDMsPerMonth} free · ${quota.dailyRemaining}/${quota.dailyDMCap} today`}
                      </span>
                    )}
                    {fan && !isMobile && (
                      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: colors.muted }}>
                        {quota ? quota.purchasedBalance : fan.coin_balance} tokens
                        {quota?.giftedBalance > 0 && (
                          <span style={{ color: '#8FC88F' }}> + {quota.giftedBalance} gifted</span>
                        )}
                      </span>
                    )}
                    {fanMuted && (
                      <span style={{ fontFamily: sans, fontSize: 10, color: '#D9A45C', background: 'rgba(217,164,92,0.1)', border: '1px solid rgba(217,164,92,0.3)', borderRadius: 999, padding: '3px 8px' }}>Muted</span>
                    )}
                    {fanCurrentlyBlocked && (
                      <span style={{ fontFamily: sans, fontSize: 10, color: '#D99A9A', background: 'rgba(156,90,90,0.1)', border: '1px solid rgba(156,90,90,0.3)', borderRadius: 999, padding: '3px 8px' }}>Restricted</span>
                    )}
                    {pricingMode !== 'default' && (
                      <span style={{ fontFamily: sans, fontSize: 10, color: colors.accent, background: 'rgba(193,125,74,0.1)', border: '1px solid rgba(193,125,74,0.25)', borderRadius: 999, padding: '3px 8px' }}>
                        Custom pricing active
                      </span>
                    )}
                  </div>
                  {isMobile && quota && (
                    <div style={{ ...quotaChip, width: '100%', boxSizing: 'border-box', textAlign: 'center' }}>
                      {quota.tier === 'guest'
                        ? `Guest · ${quota.overageCost} per message`
                        : `${quota.freeRemaining} free left · ${quota.dailyRemaining} today`}
                      {' · '}{quota.purchasedBalance} tokens
                      {quota.giftedBalance > 0 && ` + ${quota.giftedBalance} gifted`}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => setPanel(panel === 'grant' ? null : 'grant')} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 10px', color: panel === 'grant' ? colors.accent : colors.muted }}>Send tokens</button>
                    <button onClick={() => setPanel(panel === 'settings' ? null : 'settings')} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 10px', color: panel === 'settings' ? colors.accent : colors.muted }}>Chat settings</button>
                  </div>
                </div>

                {panel === 'grant' && (
                  <Card style={{ marginBottom: 10 }}>
                    {grantMsg && <div style={grantMsg.startsWith('✓') ? S.success : S.error}>{grantMsg}</div>}
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                      <TokenField label="Tokens to send" value={grantAmt} onChange={setGrantAmt} tokenRateInr={TOKEN_RATE} />
                      <Field label="Reason">
                        <input style={{ ...S.input, width: 180 }} value={grantNote} onChange={(e) => setGrantNote(e.target.value)} placeholder="e.g. Call refund" />
                      </Field>
                      <button onClick={handleGrant} disabled={granting || !grantAmt} style={{ ...S.btn, opacity: (granting || !grantAmt) ? 0.5 : 1, alignSelf: 'flex-end' }}>
                        {granting ? '…' : 'Send'}
                      </button>
                    </div>
                  </Card>
                )}

                {/* Settings panel — kept small and scrollable so it never takes over the whole screen on mobile */}
                {panel === 'settings' && (
                  <Card style={{ marginBottom: 10, maxHeight: '65vh', overflowY: 'auto' }}>
                    <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: `1px solid ${colors.border}` }}>
                      <div style={{ fontFamily: sans, fontSize: 13, color: colors.text, fontWeight: 600, marginBottom: 10 }}>Moderation</div>
                      {moderationMsg && <div style={moderationMsg.startsWith('Error') ? S.error : S.success}>{moderationMsg}</div>}

                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                        <button onClick={toggleFanMute} disabled={moderationSaving} style={{ ...S.ghostBtn, fontSize: 12, padding: '7px 14px', opacity: moderationSaving ? 0.5 : 1 }}>
                          {fanMuted ? 'Unmute' : 'Mute'}
                        </button>

                        {fanCurrentlyBlocked ? (
                          <button onClick={liftFanBlock} disabled={moderationSaving} style={{ ...S.ghostBtn, fontSize: 12, padding: '7px 14px', color: '#8FC88F' }}>
                            Lift restriction
                          </button>
                        ) : (
                          <>
                            <input
                              value={blockReasonInput}
                              onChange={(e) => setBlockReasonInput(e.target.value)}
                              placeholder="Reason (optional)"
                              style={{ ...S.input, width: 140, fontSize: 12 }}
                            />
                            <button onClick={applyFanBlock} disabled={moderationSaving} style={{ ...S.btn, fontSize: 12, padding: '7px 14px', background: '#9C5A5A', border: 'none' }}>
                              {moderationSaving ? '…' : `Restrict${fanBlockCount > 0 ? ` (#${fanBlockCount + 1})` : ''}`}
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    <div style={{ marginBottom: 16 }}>
                      <Field label="Chat background (leave empty to use default)">
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <input ref={bgFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleBgFilePick} />
                          <button onClick={() => bgFileRef.current?.click()} disabled={bgUploading} style={{ ...S.ghostBtn, fontSize: 12, padding: '7px 12px', opacity: bgUploading ? 0.5 : 1 }}>
                            {bgUploading ? 'Uploading…' : 'Browse photo'}
                          </button>
                          {bgPreview && <img src={bgPreview} alt="bg" style={{ width: 40, height: 30, objectFit: 'cover', borderRadius: 4, border: `1px solid ${colors.border}` }} />}
                          {bgPreview && (
                            <button onClick={() => setBgPreview(null)} style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 8px', color: '#D99A9A' }}>Remove (use default)</button>
                          )}
                        </div>
                      </Field>
                    </div>

                    <div style={{ marginBottom: 12, paddingTop: 12, borderTop: `1px solid ${colors.border}` }}>
                      <div style={{ fontFamily: sans, fontSize: 13, color: colors.text, fontWeight: 600, marginBottom: 10 }}>Message pricing</div>
                      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 10 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: sans, fontSize: 12, color: colors.muted, cursor: 'pointer' }}>
                          <input type="radio" checked={pricingMode === 'default'} onChange={() => setPricingMode('default')} />
                          Tier default
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: sans, fontSize: 12, color: colors.muted, cursor: 'pointer' }}>
                          <input type="radio" checked={pricingMode === 'flat'} onChange={() => setPricingMode('flat')} />
                          Flat price
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: sans, fontSize: 12, color: colors.muted, cursor: 'pointer' }}>
                          <input type="radio" checked={pricingMode === 'per_token'} onChange={() => setPricingMode('per_token')} />
                          Per token
                        </label>
                      </div>

                      {pricingMode === 'flat' && (
                        <input style={{ ...S.input, width: 140 }} type="number" min={0} value={flatPrice} onChange={(e) => setFlatPrice(e.target.value)} placeholder="Tokens/msg" />
                      )}
                      {pricingMode === 'per_token' && (
                        <input style={{ ...S.input, width: 140 }} type="number" min={1} value={perTokenBlock} onChange={(e) => setPerTokenBlock(e.target.value)} placeholder="Msgs per token" />
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', paddingTop: 12, borderTop: `1px solid ${colors.border}` }}>
                      <label style={{ fontFamily: sans, fontSize: 13, color: colors.muted, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                        <input type="checkbox" checked={mediaEnabled} onChange={(e) => setMediaEnabled(e.target.checked)} />
                        Allow media
                      </label>
                      <button onClick={saveSettings} disabled={settingsSaving} style={{ ...S.btn, opacity: settingsSaving ? 0.5 : 1 }}>
                        {settingsSaving ? 'Saving…' : 'Save settings'}
                      </button>
                    </div>
                  </Card>
                )}

                {panel === 'locked-media' && (
                  <Card style={{ marginBottom: 10 }}>
                    <div style={{ fontFamily: sans, fontSize: 13, color: colors.text, fontWeight: 600, marginBottom: 10 }}>Send unlockable media</div>
                    <p style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginBottom: 14, lineHeight: 1.6 }}>
                      Select photos/videos and set a token price for the whole bundle — 0 sends them free. Removed automatically after 30 days.
                    </p>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
                      <input ref={lockedFileRef} type="file" accept="image/*,video/*" multiple style={{ display: 'none' }} onChange={handleLockedFilesChange} />
                      <button onClick={() => lockedFileRef.current?.click()} style={{ ...S.ghostBtn, fontSize: 12, padding: '8px 14px' }}>
                        {lockedFiles.length > 0 ? `${lockedFiles.length} file${lockedFiles.length === 1 ? '' : 's'} selected` : 'Choose photos/videos'}
                      </button>
                      <TokenField label="Bundle price" value={lockedPrice} onChange={setLockedPrice} tokenRateInr={TOKEN_RATE} />
                      <Field label="Caption (optional)">
                        <input style={{ ...S.input, width: 200 }} value={lockedCaption} onChange={(e) => setLockedCaption(e.target.value)} placeholder="e.g. From today's shoot 📸" />
                      </Field>
                      <button
                        onClick={handleSendLockedMedia}
                        disabled={sendingLocked || lockedFiles.length === 0 || lockedPrice === ''}
                        style={{ ...S.btn, opacity: (sendingLocked || lockedFiles.length === 0 || lockedPrice === '') ? 0.5 : 1 }}
                      >
                        {sendingLocked ? 'Sending…' : 'Send locked bundle'}
                      </button>
                    </div>
                  </Card>
                )}

                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10, padding: '4px 0', minHeight: 0 }}>
                  {thread.length === 0 && (
                    <T.muted>No messages yet — send the first one below.</T.muted>
                  )}
                  {thread.map((msg) => {
                    const isLockedBundle = msg.unlock_price_coins !== null && msg.unlock_price_coins !== undefined;
                    const isRead = msg.is_mine && fanLastRead && new Date(msg.created_at) <= fanLastRead;
                    return (
                      <div key={msg.id || msg.stream_id}
                           onMouseEnter={() => setHoveredMsg(msg.id)}
                           onMouseLeave={() => setHoveredMsg(null)}
                           style={{ alignSelf: msg.is_mine ? 'flex-end' : 'flex-start', maxWidth: '75%',
                                    opacity: msg.deleted ? 0.4 : 1 }}>
                        {!msg.is_mine && (
                          <div style={{ fontFamily: sans, fontSize: 11, color: colors.muted, marginBottom: 3 }}>
                            {fan?.display_name || fan?.email}
                          </div>
                        )}
                        <div onClick={() => selecting && toggleSelect(msg.id)}
                             style={{ fontFamily: sans, fontSize: 14, color: colors.text, lineHeight: 1.6, textAlign: 'left', padding: (msg.media_url || isLockedBundle) ? 6 : '10px 14px', borderRadius: 10, wordBreak: 'break-word', overflow: 'hidden', cursor: selecting ? 'pointer' : 'default', background: pickedMsgs.includes(msg.id) ? 'rgba(156,90,90,0.18)' : msg.is_mine ? 'rgba(193,125,74,0.15)' : 'rgba(22,20,16,0.9)', border: pickedMsgs.includes(msg.id) ? '1px solid rgba(156,90,90,0.5)' : msg.is_mine ? '1px solid rgba(193,125,74,0.25)' : `1px solid ${colors.border}` }}>
                          {msg.parent_id && msgById[msg.parent_id] && (
                            <div style={quotedInStudio}>
                              <div style={{ fontFamily: sans, fontSize: 10, color: colors.accent, marginBottom: 2 }}>
                                {msgById[msg.parent_id].is_mine ? 'You' : (fan?.display_name || 'Them')}
                              </div>
                              <div style={{ fontFamily: sans, fontSize: 11, color: colors.muted, lineHeight: 1.4,
                                            overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box',
                                            WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                                {msgById[msg.parent_id].deleted ? 'This message was deleted' : msgById[msg.parent_id].content}
                              </div>
                            </div>
                          )}
                          {isLockedBundle ? (
                            <>
                              <div style={{ display: 'grid', gridTemplateColumns: msg.locked_media_urls?.length > 1 ? '1fr 1fr' : '1fr', gap: 4 }}>
                                {(msg.locked_media_urls || []).map((item, i) => (
                                  item.type === 'video'
                                    ? <video key={i} src={item.url} controls style={{ width: '100%', borderRadius: 6, display: 'block' }} />
                                    : <img key={i} src={item.url} alt="" style={{ width: '100%', borderRadius: 6, display: 'block' }} />
                                ))}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 4px 2px', fontFamily: sans, fontSize: 11, color: colors.accent }}>
                                🔒 Priced at {msg.unlock_price_coins} tokens · {msg.unlocked_at ? <span style={{ color: '#8FC88F' }}>Unlocked by fan</span> : 'Awaiting unlock'}
                              </div>
                            </>
                          ) : (
                            <>
                              {msg.media_url && msg.media_type === 'image' && <img src={msg.media_url} alt="" style={{ width: '100%', maxWidth: 260, borderRadius: 6, display: 'block', marginBottom: msg.content ? 6 : 0 }} />}
                              {msg.media_url && msg.media_type === 'video' && <video src={msg.media_url} controls style={{ width: '100%', maxWidth: 260, borderRadius: 6, display: 'block', marginBottom: msg.content ? 6 : 0 }} />}
                              {msg.media_url && msg.media_type === 'audio' && <audio src={msg.media_url} controls style={{ width: '100%', minWidth: 220 }} />}
                            </>
                          )}
                          {msg.content && (
                            <div style={{ padding: (msg.media_url || isLockedBundle) ? '0 8px 8px' : 0, whiteSpace: 'pre-wrap' }}>
                              {msg.content}
                            </div>
                          )}
                        </div>
                        {/* Shown on hover, so the thread reads as a conversation
                            rather than a list of things to act on. */}
                        {!msg.deleted && (
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 3,
                                        alignSelf: msg.is_mine ? 'flex-end' : 'flex-start',
                                        opacity: (hoveredMsg === msg.id || selecting) ? 1 : 0,
                                        transition: 'opacity 120ms ease' }}>
                            <button onClick={() => setReplyTo(msg)} style={msgActionBtn}>Reply</button>
                            <button onClick={() => toggleSelect(msg.id)} style={msgActionBtn}>
                              {pickedMsgs.includes(msg.id) ? 'Deselect' : 'Select'}
                            </button>
                          </div>
                        )}

                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3, alignSelf: msg.is_mine ? 'flex-end' : 'flex-start' }}>
                          <span style={{ fontFamily: sans, fontSize: 10, color: colors.muted }}>
                            {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {msg.is_mine && (
                            <span style={{ fontSize: 11, color: isRead ? colors.accent : colors.muted }}>{isRead ? '✓✓' : '✓'}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {typing && (
                    <div style={{ alignSelf: 'flex-start' }}>
                      <div style={{ fontFamily: sans, fontSize: 11, color: colors.muted, marginBottom: 3 }}>
                        {fan?.display_name || 'Fan'} is typing…
                      </div>
                    </div>
                  )}
                  <div ref={bottomRef} />
                </div>

                <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 10, flexShrink: 0 }}>
                  {recording ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(156,90,90,0.1)', border: '1px solid rgba(156,90,90,0.3)', borderRadius: 8, padding: '10px 14px' }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#D99A9A', flexShrink: 0 }} />
                      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 14, color: colors.text }}>
                        {String(Math.floor(recordSeconds / 60)).padStart(2, '0')}:{String(recordSeconds % 60).padStart(2, '0')} / 01:00
                      </span>
                      <div style={{ flex: 1 }} />
                      <button onClick={cancelRecording} style={{ ...S.ghostBtn, fontSize: 12, padding: '7px 14px' }}>Cancel</button>
                      <button onClick={stopRecording} style={{ ...S.btn, fontSize: 12, padding: '7px 14px' }}>Send</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                      <button onClick={() => setPanel(panel === 'locked-media' ? null : 'locked-media')} style={{ ...S.ghostBtn, fontSize: 16, padding: '8px 10px', color: panel === 'locked-media' ? colors.accent : colors.muted }} title="Send unlockable media bundle">
                        🔒
                      </button>
                      <button onClick={startRecording} disabled={sending} style={{ ...S.ghostBtn, fontSize: 16, padding: '8px 10px', opacity: sending ? 0.5 : 1 }} title="Record a voice note">
                        🎙️
                      </button>
                      {pickedMsgs.length > 0 && (
                        <div style={deleteBar}>
                          <span style={{ fontFamily: sans, fontSize: 13, color: colors.text }}>
                            {pickedMsgs.length} selected
                          </span>
                          <button onClick={deleteSelected} disabled={deleting}
                                  style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 14px', color: '#D99A9A', borderColor: 'rgba(156,90,90,0.4)' }}>
                            {deleting ? 'Deleting…' : 'Delete for everyone'}
                          </button>
                          <button onClick={() => setPickedMsgs([])} style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 14px' }}>
                            Cancel
                          </button>
                        </div>
                      )}

                      {replyTo && (
                        <div style={studioReplyBar}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontFamily: sans, fontSize: 10, color: colors.accent }}>
                              Replying to {replyTo.is_mine ? 'yourself' : (fan?.display_name || 'them')}
                            </div>
                            <div style={{ fontFamily: sans, fontSize: 11, color: colors.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {replyTo.content}
                            </div>
                          </div>
                          <button onClick={() => setReplyTo(null)} style={{ ...msgActionBtn, color: colors.accent }}>✕</button>
                        </div>
                      )}

                      <textarea
                        ref={replyRef}
                        value={reply}
                        onChange={(e) => { setReply(e.target.value); handleTyping(); autoGrow(e.target); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                        placeholder={replyTo ? 'Write your reply…' : 'Reply… (Enter to send)'}
                        rows={3}
                        style={{ flex: 1, background: 'rgba(22,20,16,0.9)', border: `1px solid ${colors.border}`, color: colors.text, fontFamily: sans, fontSize: 16, padding: '10px 14px', borderRadius: 8, resize: 'none', outline: 'none', textAlign: 'left', maxHeight: 160 }}
                      />
                      <button onClick={() => sendReply()} disabled={sending || !reply.trim()} style={{ ...S.btn, opacity: (sending || !reply.trim()) ? 0.5 : 1 }}>
                        {sending ? '…' : 'Send'}
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <T.muted>Select a conversation to read and reply.</T.muted>
            )}
          </div>
        </div>
      )}

      {bgCropFile && (
        <CropTool
          file={bgCropFile}
          aspectRatio={CHAT_BG_ASPECT}
          outputWidth={720}
          onCancel={() => setBgCropFile(null)}
          onCropComplete={handleBgCropComplete}
        />
      )}
    </div>
  );
}