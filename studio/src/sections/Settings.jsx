// studio/src/sections/Settings.jsx
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { T, S, Card, Eyebrow, Field, TokenField, colors } from '../ui';

const TIERS = ['community', 'insider', 'premium', 'supreme'];
const TOKEN_RATE = 66;

// Simple upload helper for studio (no shared hook needed)
async function uploadToR2(file, context, apiInstance) {
  const { uploadUrl, publicUrl } = await apiInstance.post('/api/upload/presign', {
    filename:    file.name,
    contentType: file.type,
    context,
  });
  await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
  return publicUrl;
}

export function Settings() {
  const [config,     setConfig]     = useState({});
  const [draft,      setDraft]      = useState({});
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error,      setError]      = useState('');
  const [success,    setSuccess]    = useState('');

  // Background upload
  const [bgType,    setBgType]    = useState('community');
  const [bgPreview, setBgPreview] = useState('');
  const [bgUploading, setBgUploading] = useState(false);
  const bgFileRef = useRef(null);

  useEffect(() => {
    api.get('/api/studio/config').then((d) => {
      setConfig(d.config);
      setDraft(d.config);
    }).finally(() => setLoading(false));
  }, []);

  const set = (key, val) => setDraft((prev) => ({ ...prev, [key]: val }));

  const handleSave = async () => {
    setError(''); setSuccess(''); setSaving(true);
    try {
      await api.post('/api/studio/config', { changes: draft });
      setConfig(draft);
      setSuccess('Changes saved. Click "Publish changes" to make them live.');
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const handlePublish = async () => {
    setError(''); setPublishing(true);
    try {
      const data = await api.post('/api/studio/config/publish', {});
      setSuccess(data.message);
      setConfig((c) => ({ ...c, config_published: 'true' }));
    } catch (err) { setError(err.message); }
    finally { setPublishing(false); }
  };

  const handleBgFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setBgUploading(true); setError('');
    try {
      const publicUrl = await uploadToR2(file, 'background', api);
      await api.post('/api/upload/confirm-background', { publicUrl, type: bgType });
      setBgPreview(publicUrl);
      setSuccess(`${bgType === 'community' ? 'Community' : 'Personal'} chat background updated.`);
    } catch (err) { setError(err.message); }
    finally { setBgUploading(false); }
  };

  if (loading) return <T.muted>Loading settings…</T.muted>;

  const isPublished = config.config_published === 'true';

  return (
    <div>
      <Eyebrow>Platform settings</Eyebrow>
      <T.title>Settings</T.title>

      {error   && <div style={S.error}>{error}</div>}
      {success && <div style={S.success}>{success}</div>}

      {/* Publish banner */}
      <div style={{ background: isPublished ? 'rgba(100,160,100,0.08)' : 'rgba(193,125,74,0.08)', border: `1px solid ${isPublished ? 'rgba(100,160,100,0.25)' : 'rgba(193,125,74,0.25)'}`, borderRadius: 10, padding: '14px 18px', marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13, color: isPublished ? colors.success : colors.accent }}>
          {isPublished ? '✓ All pricing is live.' : '⚠ Unpublished changes — fans see old pricing until you publish.'}
        </div>
        <button onClick={handlePublish} disabled={publishing || isPublished} style={{ ...S.btn, opacity: (publishing || isPublished) ? 0.5 : 1 }}>
          {publishing ? 'Publishing…' : 'Publish changes'}
        </button>
      </div>

      {/* Token rate */}
      <Card style={{ marginBottom: 20 }}>
        <T.sectionTitle>Token rate</T.sectionTitle>
        <TokenField label="1 J Token = (INR)" value={draft.token_rate_inr || 66} onChange={(v) => set('token_rate_inr', v)} tokenRateInr={1} />
      </Card>

      {/* Guest pricing */}
      <Card style={{ marginBottom: 20 }}>
        <T.sectionTitle>Guest pricing</T.sectionTitle>
        <div style={S.formGrid}>
          <TokenField label="DM cost per message" value={draft.guest_dm_cost || 4} onChange={(v) => set('guest_dm_cost', v)} tokenRateInr={parseInt(draft.token_rate_inr) || TOKEN_RATE} />
          <TokenField label="Community chat (per day)" value={draft.guest_community_cost || 2} onChange={(v) => set('guest_community_cost', v)} tokenRateInr={parseInt(draft.token_rate_inr) || TOKEN_RATE} />
        </div>
      </Card>

      {/* Membership tiers */}
      <Card style={{ marginBottom: 20 }}>
        <T.sectionTitle>Membership tiers</T.sectionTitle>
        {TIERS.map((tier) => (
          <div key={tier} style={{ marginBottom: 24, paddingBottom: 20, borderBottom: `1px solid ${colors.border}` }}>
            <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13, color: colors.accent, textTransform: 'capitalize', fontWeight: 600, marginBottom: 12 }}>{tier}</div>
            <div style={S.formGrid}>
              <TokenField label="Monthly cost" value={draft[`${tier}_monthly_tokens`] || 0} onChange={(v) => set(`${tier}_monthly_tokens`, v)} tokenRateInr={parseInt(draft.token_rate_inr) || TOKEN_RATE} />
              <Field label="Free DMs / month"><input style={S.input} type="number" min={0} value={draft[`${tier}_free_dms`] || 0} onChange={(e) => set(`${tier}_free_dms`, e.target.value)} /></Field>
              <Field label="Daily DM cap"><input style={S.input} type="number" min={0} value={draft[`${tier}_daily_dm_cap`] || 0} onChange={(e) => set(`${tier}_daily_dm_cap`, e.target.value)} /></Field>
              <TokenField label="Overage DM cost" value={draft[`${tier}_overage_dm_cost`] || 1} onChange={(v) => set(`${tier}_overage_dm_cost`, v)} tokenRateInr={parseInt(draft.token_rate_inr) || TOKEN_RATE} />
              <Field label="Set unlocks / month"><input style={S.input} type="number" min={0} value={draft[`${tier}_unlocks`] || 0} onChange={(e) => set(`${tier}_unlocks`, e.target.value)} /></Field>
              <Field label="Discount %"><input style={S.input} type="number" min={0} max={100} value={draft[`${tier}_discount_pct`] || 0} onChange={(e) => set(`${tier}_discount_pct`, e.target.value)} /></Field>
            </div>
          </div>
        ))}
      </Card>

      {/* Call rates */}
      <Card style={{ marginBottom: 20 }}>
        <T.sectionTitle>Call rates (tokens / minute)</T.sectionTitle>
        <div style={S.formGrid}>
          <TokenField label="Audio call" value={draft.call_audio_per_min || 8} onChange={(v) => set('call_audio_per_min', v)} tokenRateInr={parseInt(draft.token_rate_inr) || TOKEN_RATE} />
          <TokenField label="Video call" value={draft.call_video_per_min || 15} onChange={(v) => set('call_video_per_min', v)} tokenRateInr={parseInt(draft.token_rate_inr) || TOKEN_RATE} />
          <TokenField label="Priority video" value={draft.call_priority_per_min || 22} onChange={(v) => set('call_priority_per_min', v)} tokenRateInr={parseInt(draft.token_rate_inr) || TOKEN_RATE} />
        </div>
      </Card>

      <button onClick={handleSave} disabled={saving} style={{ ...S.btn, opacity: saving ? 0.6 : 1, marginBottom: 32 }}>
        {saving ? 'Saving…' : 'Save changes'}
      </button>

      {/* Chat backgrounds */}
      <Card>
        <T.sectionTitle>Chat backgrounds</T.sectionTitle>
        <p style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13, color: colors.muted, marginBottom: 16, lineHeight: 1.6 }}>
          Upload a photo to use as the chat background for all fans. This replaces the dark default background.
        </p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
          <Field label="Apply to">
            <select style={S.input} value={bgType} onChange={(e) => setBgType(e.target.value)}>
              <option value="community">Community chat (all members)</option>
              <option value="personal">Personal chat (all fans by default)</option>
            </select>
          </Field>
          <input ref={bgFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleBgFileChange} />
          <button
            onClick={() => bgFileRef.current?.click()}
            disabled={bgUploading}
            style={{ ...S.btn, opacity: bgUploading ? 0.5 : 1 }}
          >
            {bgUploading ? 'Uploading…' : 'Browse & upload photo'}
          </button>
        </div>
        {bgPreview && (
          <div>
            <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 12, color: colors.muted, marginBottom: 8 }}>Preview</div>
            <img src={bgPreview} alt="background preview" style={{ width: '100%', maxWidth: 320, height: 180, objectFit: 'cover', borderRadius: 8, border: `1px solid ${colors.border}` }} />
          </div>
        )}
      </Card>
    </div>
  );
}