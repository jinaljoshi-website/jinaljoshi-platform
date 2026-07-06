// studio/src/sections/Messages.jsx
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { T, S, Card, Eyebrow, Badge, Field, TokenField, colors } from '../ui';
import { StreamChat } from 'stream-chat';

const TOKEN_RATE = 66;

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

export function Messages() {
  const [convos,   setConvos]   = useState([]);
  const [selected, setSelected] = useState(null);
  const [thread,   setThread]   = useState([]);
  const [fan,      setFan]      = useState(null);
  const [reply,    setReply]    = useState('');
  const [sending,  setSending]  = useState(false);
  const [loading,  setLoading]  = useState(true);
  const [typing,   setTyping]   = useState(false);
  const [panel,    setPanel]    = useState(null);
  const isMobile = useIsMobile();

  const [grantAmt,  setGrantAmt]  = useState('');
  const [grantNote, setGrantNote] = useState('');
  const [granting,  setGranting]  = useState(false);
  const [grantMsg,  setGrantMsg]  = useState('');

  // Fan settings — bgPreview is the raw override (for editing), effectiveBg is what the fan actually sees right now
  const [bgUploading,   setBgUploading]   = useState(false);
  const [bgPreview,     setBgPreview]     = useState('');
  const [effectiveBg,   setEffectiveBg]   = useState('');
  const [customCost,    setCustomCost]    = useState('');
  const [mediaEnabled,  setMediaEnabled]  = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);

  const [mediaSending, setMediaSending] = useState(false);
  const mediaFileRef = useRef(null);
  const bgFileRef    = useRef(null);
  const bottomRef    = useRef(null);

  const scClientRef  = useRef(null);
  const channelRef   = useRef(null);
  const artistIdRef  = useRef(null);

  useEffect(() => {
    api.get('/api/studio/dms')
      .then((d) => setConvos(d.conversations || []))
      .finally(() => setLoading(false));

    initArtistStream();

    return () => {
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

  const openConvo = async (fanId) => {
    if (channelRef.current) {
      channelRef.current.off('message.new');
      channelRef.current.off('typing.start');
      channelRef.current.off('typing.stop');
      await channelRef.current.stopWatching().catch(() => {});
      channelRef.current = null;
    }

    setSelected(fanId);
    setPanel(null);
    setGrantMsg('');
    setTyping(false);

    const data = await api.get(`/api/studio/dms/${fanId}`);
    setThread(data.messages || []);
    setFan(data.fan || null);
    setBgPreview(data.fan?.personal_chat_bg || '');
    setEffectiveBg(data.fan?.effective_chat_bg || '');
    setCustomCost(data.fan?.custom_chat_price || '');
    setMediaEnabled(data.fan?.can_send_media || false);

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
            media_type: msg.attachments?.[0]?.type === 'video' ? 'video' : msg.attachments?.[0]?.image_url ? 'image' : null,
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

      channelRef.current = channel;
      await channel.watch();
      channel.markRead().catch(() => {});
    } catch (err) {
      console.error('Studio channel watch error:', err);
    }
  };

  const closeConvo = () => {
    setSelected(null);
    setThread([]);
    setFan(null);
    setPanel(null);
  };

  const sendReply = async (mediaUrl = null, mediaType = null) => {
    if (!reply.trim() && !mediaUrl) return;
    setSending(true);
    try {
      const data = await api.post(`/api/studio/dms/${selected}/reply`, {
        content:   reply.trim() || undefined,
        mediaUrl:  mediaUrl  || undefined,
        mediaType: mediaType || undefined,
      });

      setThread((prev) => [...prev, data.message]);
      setReply('');

      if (channelRef.current) {
        const streamMsg = {};
        if (reply.trim()) streamMsg.text = reply.trim();
        if (mediaUrl) {
          streamMsg.attachments = [{
            type: mediaType === 'video' ? 'video' : 'image',
            [mediaType === 'video' ? 'asset_url' : 'image_url']: mediaUrl,
          }];
        }
        streamMsg.id = data.message.id;
        await channelRef.current.sendMessage(streamMsg).catch(() => {});
      }
    } catch (err) { alert(err.message); }
    finally { setSending(false); }
  };

  const handleMediaFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setMediaSending(true);
    try {
      const publicUrl = await uploadToR2(file, 'chat_media');
      const mediaType = file.type.startsWith('video/') ? 'video' : 'image';
      await sendReply(publicUrl, mediaType);
    } catch (err) { alert(err.message); }
    finally { setMediaSending(false); }
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

  const handleBgUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !fan) return;
    e.target.value = '';
    setBgUploading(true);
    try {
      const publicUrl = await uploadToR2(file, 'background');
      await api.post('/api/upload/confirm-background', { publicUrl, type: 'fan', fanId: fan.id });
      setBgPreview(publicUrl);
      setEffectiveBg(publicUrl); // reflect immediately, this is now the effective background too
    } catch (err) { alert(err.message); }
    finally { setBgUploading(false); }
  };

  const saveSettings = async () => {
    if (!fan) return;
    setSettingsSaving(true);
    try {
      await api.post('/api/studio/chat-bg', { type: 'fan', value: bgPreview, fanId: fan.id });
      await api.patch(`/api/studio/fan-settings/${fan.id}`, {
        custom_chat_price: customCost ? parseInt(customCost) : null,
        can_send_media:    mediaEnabled,
      });
      setEffectiveBg(bgPreview);
    } catch (err) { alert(err.message); }
    finally { setSettingsSaving(false); }
  };

  const handleTyping = () => {
    if (channelRef.current) channelRef.current.keystroke().catch(() => {});
  };

  if (loading) return <T.muted>Loading messages…</T.muted>;

  const sans = "'DM Sans', system-ui, sans-serif";
  const showList   = !isMobile || !selected;
  const showThread = !isMobile || !!selected;

  return (
    <div style={isMobile
      ? { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }
      : { display: 'grid', gridTemplateColumns: '240px 1fr', gap: 20, height: '85vh' }
    }>
      {showList && (
        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, flex: isMobile ? 1 : undefined, minHeight: 0 }}>
          <Eyebrow>Conversations</Eyebrow>
          {convos.length === 0 && <T.muted>No messages yet.</T.muted>}
          {convos.map((c) => (
            <button key={c.fan_id} onClick={() => openConvo(c.fan_id)} style={{ background: selected === c.fan_id ? 'rgba(193,125,74,0.1)' : '#161410', border: selected === c.fan_id ? '1px solid rgba(193,125,74,0.3)' : `1px solid ${colors.border}`, borderRadius: 8, padding: '12px 14px', textAlign: 'left', cursor: 'pointer', color: colors.text }}>
              <div style={{ fontFamily: sans, fontSize: 14, marginBottom: 3 }}>{c.display_name || c.email}</div>
              <div style={{ fontFamily: sans, fontSize: 12, color: colors.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.content?.slice(0, 40)}…</div>
              {!c.is_mine && !c.read && <div style={{ width: 6, height: 6, borderRadius: '50%', background: colors.accent, marginTop: 5 }} />}
            </button>
          ))}
        </div>
      )}

      {showThread && (
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', minHeight: 0, flex: isMobile ? 1 : undefined, borderRadius: effectiveBg ? 10 : 0, overflow: 'hidden' }}>
          {/* Live background preview — exactly what this fan sees right now */}
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
                    {fan && !isMobile && <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: colors.muted }}>{fan.coin_balance} tokens</span>}
                    {effectiveBg && (
                      <span style={{ fontFamily: sans, fontSize: 10, color: colors.accent, background: 'rgba(193,125,74,0.1)', border: '1px solid rgba(193,125,74,0.25)', borderRadius: 999, padding: '3px 8px' }}>
                        {bgPreview ? 'Custom background' : 'Default background'}
                      </span>
                    )}
                  </div>
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

                {panel === 'settings' && (
                  <Card style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                      <Field label="Chat background photo (leave empty to use the default)">
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <input ref={bgFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleBgUpload} />
                          <button onClick={() => bgFileRef.current?.click()} disabled={bgUploading} style={{ ...S.ghostBtn, fontSize: 12, padding: '7px 12px', opacity: bgUploading ? 0.5 : 1 }}>
                            {bgUploading ? 'Uploading…' : 'Browse photo'}
                          </button>
                          {bgPreview && <img src={bgPreview} alt="bg" style={{ width: 48, height: 36, objectFit: 'cover', borderRadius: 4, border: `1px solid ${colors.border}` }} />}
                          {bgPreview && (
                            <button onClick={() => setBgPreview('')} style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 8px', color: '#D99A9A' }}>Clear override</button>
                          )}
                        </div>
                      </Field>
                      <TokenField label="Custom DM cost (overrides tier default)" value={customCost} onChange={setCustomCost} tokenRateInr={TOKEN_RATE} />
                      <Field label="Allow fan to send media">
                        <label style={{ fontFamily: sans, fontSize: 13, color: colors.muted, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 6 }}>
                          <input type="checkbox" checked={mediaEnabled} onChange={(e) => setMediaEnabled(e.target.checked)} />
                          {mediaEnabled ? 'Enabled' : 'Disabled'}
                        </label>
                      </Field>
                      <button onClick={saveSettings} disabled={settingsSaving} style={{ ...S.btn, opacity: settingsSaving ? 0.5 : 1, alignSelf: 'flex-end' }}>
                        {settingsSaving ? 'Saving…' : 'Save settings'}
                      </button>
                    </div>
                  </Card>
                )}

                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10, padding: '4px 0', minHeight: 0 }}>
                  {thread.map((msg) => (
                    <div key={msg.id || msg.stream_id} style={{ alignSelf: msg.is_mine ? 'flex-end' : 'flex-start', maxWidth: '75%' }}>
                      {!msg.is_mine && (
                        <div style={{ fontFamily: sans, fontSize: 11, color: colors.muted, marginBottom: 3 }}>
                          {fan?.display_name || fan?.email}
                        </div>
                      )}
                      <div style={{ fontFamily: sans, fontSize: 14, color: colors.text, lineHeight: 1.6, padding: msg.media_url ? 6 : '10px 14px', borderRadius: 10, wordBreak: 'break-word', overflow: 'hidden', background: msg.is_mine ? 'rgba(193,125,74,0.15)' : 'rgba(22,20,16,0.9)', border: msg.is_mine ? '1px solid rgba(193,125,74,0.25)' : `1px solid ${colors.border}` }}>
                        {msg.media_url && msg.media_type === 'image' && <img src={msg.media_url} alt="" style={{ width: '100%', maxWidth: 260, borderRadius: 6, display: 'block', marginBottom: msg.content ? 6 : 0 }} />}
                        {msg.media_url && msg.media_type === 'video' && <video src={msg.media_url} controls style={{ width: '100%', maxWidth: 260, borderRadius: 6, display: 'block', marginBottom: msg.content ? 6 : 0 }} />}
                        {msg.content && <div style={{ padding: msg.media_url ? '0 8px 8px' : 0 }}>{msg.content}</div>}
                      </div>
                      <div style={{ fontFamily: sans, fontSize: 10, color: colors.muted, marginTop: 3, textAlign: msg.is_mine ? 'right' : 'left' }}>
                        {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  ))}

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
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <input ref={mediaFileRef} type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={handleMediaFile} />
                    <button onClick={() => mediaFileRef.current?.click()} disabled={mediaSending || sending} style={{ ...S.ghostBtn, fontSize: 16, padding: '8px 10px', opacity: (mediaSending || sending) ? 0.5 : 1 }} title="Attach image or video">
                      {mediaSending ? '…' : '📎'}
                    </button>
                    <textarea
                      value={reply}
                      onChange={(e) => { setReply(e.target.value); handleTyping(); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                      placeholder="Reply… (Enter to send)"
                      rows={2}
                      style={{ flex: 1, background: 'rgba(22,20,16,0.9)', border: `1px solid ${colors.border}`, color: colors.text, fontFamily: sans, fontSize: 14, padding: '10px 14px', borderRadius: 8, resize: 'none', outline: 'none' }}
                    />
                    <button onClick={() => sendReply()} disabled={sending || !reply.trim()} style={{ ...S.btn, opacity: (sending || !reply.trim()) ? 0.5 : 1 }}>
                      {sending ? '…' : 'Send'}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <T.muted>Select a conversation to read and reply.</T.muted>
            )}
          </div>
        </div>
      )}
    </div>
  );
}