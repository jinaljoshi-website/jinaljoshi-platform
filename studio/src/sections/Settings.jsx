// studio/src/sections/Settings.jsx
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { T, S, Card, Eyebrow, Field, TokenField, colors } from '../ui';

const sans = "'DM Sans', system-ui, sans-serif";
const TIERS = ['community', 'insider', 'premium', 'supreme'];

const SUBSECTIONS = [
  { id: 'pricing',     label: 'Pricing & Discounts' },
  { id: 'community',   label: 'Community'           },
  { id: 'gallery',     label: 'Gallery'              },
  { id: 'calls',       label: 'Call Rates'           },
  { id: 'backgrounds', label: 'Backgrounds'          },
];

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
  const [active,  setActive]  = useState('pricing');
  const [config,  setConfig]  = useState({});
  const [draft,   setDraft]   = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/studio/config').then((d) => {
      setConfig(d.config);
      setDraft(d.config);
    }).finally(() => setLoading(false));
  }, []);

  const set = (key, val) => setDraft((prev) => ({ ...prev, [key]: val }));

  if (loading) return <T.muted>Loading settings…</T.muted>;

  const tokenRate = parseInt(draft.token_rate_inr) || 66;

  return (
    <div>
      <Eyebrow>Platform settings</Eyebrow>
      <T.title>Settings</T.title>

      {/* Sub-navigation */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24, borderBottom: `1px solid ${colors.border}`, paddingBottom: 16 }}>
        {SUBSECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setActive(s.id)}
            style={{
              background: active === s.id ? 'rgba(193,125,74,0.12)' : 'transparent',
              border:     active === s.id ? '1px solid rgba(193,125,74,0.3)' : `1px solid ${colors.border}`,
              color:      active === s.id ? colors.accent : colors.muted,
              fontFamily: sans, fontSize: 13, fontWeight: active === s.id ? 600 : 400,
              padding: '8px 16px', borderRadius: 999, cursor: 'pointer',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {active === 'pricing'     && <PricingSection     draft={draft} set={set} config={config} setConfig={setConfig} tokenRate={tokenRate} />}
      {active === 'community'   && <CommunitySection    draft={draft} set={set} config={config} setConfig={setConfig} />}
      {active === 'gallery'     && <GallerySection       draft={draft} set={set} config={config} setConfig={setConfig} />}
      {active === 'calls'       && <CallsSection         draft={draft} set={set} config={config} setConfig={setConfig} tokenRate={tokenRate} />}
      {active === 'backgrounds' && <BackgroundsSection />}
    </div>
  );
}

// ── Shared save button + status, used inside each section ───────────────────
function SectionSave({ keys, draft, config, setConfig }) {
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');

  const hasChanges = keys.some((k) => String(draft[k] ?? '') !== String(config[k] ?? ''));

  const handleSave = async () => {
    setError(''); setSuccess(''); setSaving(true);
    try {
      const changes = {};
      keys.forEach((k) => { changes[k] = draft[k]; });
      await api.post('/api/studio/config', { changes });
      setConfig((c) => ({ ...c, ...changes }));
      setSuccess('Saved — this is live for fans immediately.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ marginTop: 16 }}>
      {error   && <div style={S.error}>{error}</div>}
      {success && <div style={S.success}>{success}</div>}
      <button onClick={handleSave} disabled={saving || !hasChanges} style={{ ...S.btn, opacity: (saving || !hasChanges) ? 0.5 : 1 }}>
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  );
}

// ── Pricing & Discounts ───────────────────────────────────────────────────────
function PricingSection({ draft, set, config, setConfig, tokenRate }) {
  const keys = [
    'token_rate_inr',
    'community_monthly_cost', 'insider_monthly_cost', 'premium_monthly_cost', 'supreme_monthly_cost',
    'community_discount_pct', 'insider_discount_pct', 'premium_discount_pct', 'supreme_discount_pct',
  ];

  return (
    <div>
      <Card style={{ marginBottom: 20 }}>
        <T.sectionTitle>Token rate</T.sectionTitle>
        <p style={{ fontFamily: sans, fontSize: 13, color: colors.muted, marginBottom: 14 }}>
          This is the base INR value of 1 J Token, used everywhere on the platform to convert tokens to rupees.
        </p>
        <TokenField label="1 J Token = (INR)" value={draft.token_rate_inr || 66} onChange={(v) => set('token_rate_inr', v)} tokenRateInr={1} />
      </Card>

      <Card style={{ marginBottom: 20 }}>
        <T.sectionTitle>Membership monthly cost & discount</T.sectionTitle>
        <p style={{ fontFamily: sans, fontSize: 13, color: colors.muted, marginBottom: 14 }}>
          The monthly price fans pay when purchasing this tier, and the site-wide purchase discount that comes with it (applied to Calls, Merch, and Extras — Gallery unlocks use flat pricing instead).
        </p>
        {TIERS.map((tier) => (
          <div key={tier} style={{ marginBottom: 20, paddingBottom: 18, borderBottom: `1px solid ${colors.border}` }}>
            <div style={{ fontFamily: sans, fontSize: 13, color: colors.accent, textTransform: 'capitalize', fontWeight: 600, marginBottom: 10 }}>{tier}</div>
            <div style={S.formGrid}>
              <TokenField label="Monthly cost" value={draft[`${tier}_monthly_cost`] ?? 0} onChange={(v) => set(`${tier}_monthly_cost`, v)} tokenRateInr={tokenRate} />
              <Field label="Discount %">
                <input style={S.input} type="number" min={0} max={100} value={draft[`${tier}_discount_pct`] ?? 0} onChange={(e) => set(`${tier}_discount_pct`, e.target.value)} />
              </Field>
            </div>
          </div>
        ))}
      </Card>

      <SectionSave keys={keys} draft={draft} config={config} setConfig={setConfig} />
    </div>
  );
}

// ── Community ─────────────────────────────────────────────────────────────────
function CommunitySection({ draft, set, config, setConfig }) {
  const keys = ['community_daily_free_messages', 'community_tokens_per_credit_block', 'community_messages_per_credit_block'];

  return (
    <div>
      <Card style={{ marginBottom: 20 }}>
        <T.sectionTitle>Community message limits</T.sectionTitle>
        <p style={{ fontFamily: sans, fontSize: 13, color: colors.muted, marginBottom: 14 }}>
          Every fan gets this many free community messages per day. Once used up, they can buy more with tokens.
        </p>
        <div style={S.formGrid}>
          <Field label="Free messages per day">
            <input style={S.input} type="number" min={0} value={draft.community_daily_free_messages ?? 1} onChange={(e) => set('community_daily_free_messages', e.target.value)} />
          </Field>
          <Field label="Tokens per credit block">
            <input style={S.input} type="number" min={1} value={draft.community_tokens_per_credit_block ?? 1} onChange={(e) => set('community_tokens_per_credit_block', e.target.value)} />
          </Field>
          <Field label="Messages earned per block">
            <input style={S.input} type="number" min={1} value={draft.community_messages_per_credit_block ?? 3} onChange={(e) => set('community_messages_per_credit_block', e.target.value)} />
          </Field>
        </div>
        <p style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginTop: 10, fontStyle: 'italic' }}>
          Example with the values above: spending {draft.community_tokens_per_credit_block ?? 1} token(s) grants {draft.community_messages_per_credit_block ?? 3} extra community messages.
        </p>
      </Card>

      <SectionSave keys={keys} draft={draft} config={config} setConfig={setConfig} />
    </div>
  );
}

// ── Gallery ───────────────────────────────────────────────────────────────────
function GallerySection({ draft, set, config, setConfig }) {
  const keys = TIERS.map((t) => `gallery_unlocks_${t}`);

  return (
    <div>
      <Card style={{ marginBottom: 20 }}>
        <T.sectionTitle>Free monthly unlock credits per tier</T.sectionTitle>
        <p style={{ fontFamily: sans, fontSize: 13, color: colors.muted, marginBottom: 14 }}>
          How many sets each membership tier can unlock for free per month, using their monthly credit. Beyond this, fans pay the flat listed price for any set.
        </p>
        <div style={S.formGrid}>
          {TIERS.map((tier) => (
            <Field key={tier} label={`${tier.charAt(0).toUpperCase() + tier.slice(1)} — unlocks / month`}>
              <input style={S.input} type="number" min={0} value={draft[`gallery_unlocks_${tier}`] ?? 0} onChange={(e) => set(`gallery_unlocks_${tier}`, e.target.value)} />
            </Field>
          ))}
        </div>
      </Card>

      <SectionSave keys={keys} draft={draft} config={config} setConfig={setConfig} />
    </div>
  );
}

// ── Call Rates ────────────────────────────────────────────────────────────────
function CallsSection({ draft, set, config, setConfig, tokenRate }) {
  const keys = ['call_audio_per_min', 'call_video_per_min', 'call_priority_per_min'];

  return (
    <div>
      <Card style={{ marginBottom: 20 }}>
        <T.sectionTitle>Call rates (tokens / minute)</T.sectionTitle>
        <p style={{ fontFamily: sans, fontSize: 13, color: colors.muted, marginBottom: 14 }}>
          Base per-minute rate before any membership discount or guest doubling is applied.
        </p>
        <div style={S.formGrid}>
          <TokenField label="Audio call" value={draft.call_audio_per_min ?? 8} onChange={(v) => set('call_audio_per_min', v)} tokenRateInr={tokenRate} />
          <TokenField label="Video call" value={draft.call_video_per_min ?? 15} onChange={(v) => set('call_video_per_min', v)} tokenRateInr={tokenRate} />
          <TokenField label="Priority video" value={draft.call_priority_per_min ?? 22} onChange={(v) => set('call_priority_per_min', v)} tokenRateInr={tokenRate} />
        </div>
      </Card>

      <SectionSave keys={keys} draft={draft} config={config} setConfig={setConfig} />
    </div>
  );
}

// ── Backgrounds ───────────────────────────────────────────────────────────────
function BackgroundsSection() {
  const [bgType,      setBgType]      = useState('community');
  const [bgPreview,    setBgPreview]   = useState('');
  const [bgUploading,  setBgUploading] = useState(false);
  const [error,        setError]       = useState('');
  const [success,      setSuccess]     = useState('');
  const bgFileRef = useRef(null);

  const handleBgFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setBgUploading(true); setError(''); setSuccess('');
    try {
      const publicUrl = await uploadToR2(file, 'background', api);
      await api.post('/api/upload/confirm-background', { publicUrl, type: bgType });
      setBgPreview(publicUrl);
      setSuccess(`${bgType === 'community' ? 'Community' : 'Default personal chat'} background updated — live immediately.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBgUploading(false);
    }
  };

  return (
    <Card>
      <T.sectionTitle>Chat backgrounds</T.sectionTitle>
      <p style={{ fontFamily: sans, fontSize: 13, color: colors.muted, marginBottom: 16, lineHeight: 1.6 }}>
        Upload a photo to use as the background. Community applies to everyone in the community feed. The personal default applies to any fan's DM chat who doesn't have an individual override set (those are managed per-fan from Messages).
      </p>
      {error   && <div style={S.error}>{error}</div>}
      {success && <div style={S.success}>{success}</div>}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
        <Field label="Apply to">
          <select style={S.input} value={bgType} onChange={(e) => setBgType(e.target.value)}>
            <option value="community">Community chat (all members)</option>
            <option value="personal">Personal chat default (all fans, unless overridden)</option>
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
          <div style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginBottom: 8 }}>Preview</div>
          <img src={bgPreview} alt="background preview" style={{ width: '100%', maxWidth: 320, height: 180, objectFit: 'cover', borderRadius: 8, border: `1px solid ${colors.border}` }} />
        </div>
      )}
    </Card>
  );
}