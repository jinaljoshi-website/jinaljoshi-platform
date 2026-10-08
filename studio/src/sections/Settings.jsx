// studio/src/sections/Settings.jsx
import { Fragment, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { T, S, Card, Eyebrow, Field, TokenField, colors } from '../ui';
import CropTool from '../components/CropTool';

const confirmBox = { background: 'rgba(217,164,92,0.08)', border: '1px solid rgba(217,164,92,0.3)', borderRadius: 10, padding: 16 };

const sans = "'DM Sans', system-ui, sans-serif";
const ladderBox = { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(242,235,224,0.08)', borderRadius: 8, padding: 14, marginTop: 16 };
const ladderRow = { display: 'flex', justifyContent: 'space-between', gap: 12, fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 12, color: '#9B8F83', padding: '5px 0' };
const offerRow = { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 0', borderBottom: '1px solid rgba(242,235,224,0.08)' };
const codeChip = { fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#C17D4A', background: 'rgba(193,125,74,0.12)', border: '1px solid rgba(193,125,74,0.3)', borderRadius: 4, padding: '2px 6px', marginLeft: 8 };
const toggleRow = { display: 'flex', alignItems: 'flex-start', gap: 10, fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13, color: '#9B8F83', cursor: 'pointer', lineHeight: 1.5 };
const mono = "'DM Mono', 'Courier New', monospace";
const TIERS = ['community', 'insider', 'premium', 'supreme'];
const CHAT_BG_ASPECT      = 9 / 16;
const COMMUNITY_BG_ASPECT = 3 / 4;

const SUBSECTIONS = [
  { id: 'pricing',     label: 'Pricing & Discounts' },
  { id: 'community',   label: 'Community'           },
  { id: 'gallery',     label: 'Gallery'              },
  { id: 'calls',       label: 'Call Rates'           },
  { id: 'messages',    label: 'Direct Messages'     },
  { id: 'backgrounds', label: 'Backgrounds'          },
  { id: 'offers',      label: 'Bonus Offers'         },
  { id: 'currency',    label: 'International'        },
  { id: 'legal',       label: 'Legal Details'        },
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
      {active === 'currency'    && <CurrencySection      draft={draft} set={set} config={config} setConfig={setConfig} />}
      {active === 'offers'      && <OffersSection />}
      {active === 'calls'       && <CallsSection         draft={draft} set={set} config={config} setConfig={setConfig} tokenRate={tokenRate} />}
      {active === 'messages'    && <MessagesSection      draft={draft} set={set} config={config} setConfig={setConfig} tokenRate={tokenRate} />}
      {active === 'backgrounds' && <BackgroundsSection config={config} setConfig={setConfig} />}
      {active === 'legal'       && <LegalDetailsSection draft={draft} set={set} config={config} setConfig={setConfig} />}
    </div>
  );
}

// ── Shared save button + status, used inside each section ───────────────────
function SectionSave({ keys, draft, config, setConfig }) {
  const [saving,     setSaving]     = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');

  const hasChanges = keys.some((k) => String(draft[k] ?? '') !== String(config[k] ?? ''));

  // What is actually about to change, in words. Every value here is live for
  // fans the moment it saves, and a stray touch on a phone can move a price —
  // so the change is shown back before it happens rather than after.
  const changed = keys.filter((k) => String(draft[k] ?? '') !== String(config[k] ?? ''));

  const handleSave = async () => {
    setError(''); setSuccess(''); setSaving(true);
    try {
      const changes = {};
      keys.forEach((k) => { changes[k] = draft[k]; });
      await api.post('/api/studio/config', { changes });
      setConfig((c) => ({ ...c, ...changes }));
      setSuccess('Saved — this is live for fans immediately.');
      setConfirming(false);
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

      {confirming ? (
        <div style={confirmBox}>
          <div style={{ fontFamily: sans, fontSize: 13, color: colors.text, marginBottom: 8 }}>
            This changes what fans are charged, straight away.
          </div>
          <div style={{ display: 'grid', gap: 4, marginBottom: 12 }}>
            {changed.map((k) => (
              <div key={k} style={{ fontFamily: mono, fontSize: 11, color: colors.muted }}>
                {k.replace(/_/g, ' ')}: <span style={{ color: colors.muted }}>{String(config[k] ?? '—')}</span>
                {' \u2192 '}
                <span style={{ color: colors.accent }}>{String(draft[k] ?? '—')}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={handleSave} disabled={saving} style={{ ...S.btn, opacity: saving ? 0.5 : 1 }}>
              {saving ? 'Saving…' : 'Yes, make it live'}
            </button>
            <button onClick={() => setConfirming(false)} disabled={saving} style={S.ghostBtn}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setConfirming(true)} disabled={!hasChanges}
                style={{ ...S.btn, opacity: hasChanges ? 1 : 0.5 }}>
          Save changes
        </button>
      )}
    </div>
  );
}

// ── Pricing & Discounts ───────────────────────────────────────────────────────
function PricingSection({ draft, set, config, setConfig, tokenRate }) {
  const keys = [
    'token_rate_inr', 'guest_price_multiplier',
    'community_monthly_cost', 'insider_monthly_cost', 'premium_monthly_cost', 'supreme_monthly_cost',
    'community_discount_pct', 'insider_discount_pct', 'premium_discount_pct', 'supreme_discount_pct',
    'recharge_discount_tier1_threshold', 'recharge_discount_tier1_pct',
    'recharge_discount_tier2_threshold', 'recharge_discount_tier2_pct',
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
        <T.sectionTitle>Non-member (guest) pricing</T.sectionTitle>
        <p style={{ fontFamily: sans, fontSize: 13, color: colors.muted, marginBottom: 14 }}>
          Applied everywhere a non-member pays: Calls, Gallery unlocks, Merchandise, and Extras. Direct message guest pricing is derived from this multiplied by the Community tier's message rate.
        </p>
        <Field label="Guest price multiplier">
          <input style={S.input} type="number" min={1} step={0.1} value={draft.guest_price_multiplier ?? 2} onChange={(e) => set('guest_price_multiplier', e.target.value)} />
        </Field>
        <p style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginTop: 8, fontStyle: 'italic' }}>
          e.g. 2 means guests pay double what a member would pay before any membership discount.
        </p>
      </Card>

      <Card style={{ marginBottom: 20 }}>
        <T.sectionTitle>Token recharge bulk discounts</T.sectionTitle>
        <p style={{ fontFamily: sans, fontSize: 13, color: colors.muted, marginBottom: 14 }}>
          Two discount tiers apply automatically when a fan buys tokens in bulk — spend at or above the threshold and the percentage discount applies to the whole purchase.
        </p>
        <div style={S.formGrid}>
          <Field label="Tier 1 — token threshold">
            <input style={S.input} type="number" min={1} value={draft.recharge_discount_tier1_threshold ?? 500} onChange={(e) => set('recharge_discount_tier1_threshold', e.target.value)} />
          </Field>
          <Field label="Tier 1 — discount %">
            <input style={S.input} type="number" min={0} max={100} value={draft.recharge_discount_tier1_pct ?? 5} onChange={(e) => set('recharge_discount_tier1_pct', e.target.value)} />
          </Field>
          <Field label="Tier 2 — token threshold">
            <input style={S.input} type="number" min={1} value={draft.recharge_discount_tier2_threshold ?? 1000} onChange={(e) => set('recharge_discount_tier2_threshold', e.target.value)} />
          </Field>
          <Field label="Tier 2 — discount %">
            <input style={S.input} type="number" min={0} max={100} value={draft.recharge_discount_tier2_pct ?? 10} onChange={(e) => set('recharge_discount_tier2_pct', e.target.value)} />
          </Field>
        </div>
        <p style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginTop: 10, fontStyle: 'italic' }}>
          e.g. with the values above: buying {draft.recharge_discount_tier1_threshold ?? 500}+ tokens gets {draft.recharge_discount_tier1_pct ?? 5}% off, {draft.recharge_discount_tier2_threshold ?? 1000}+ gets {draft.recharge_discount_tier2_pct ?? 10}% off.
        </p>
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
// The credit system this section used to edit no longer exists. The Public
// Corner is free and unlimited for members; guests get a daily allowance. Only
// that allowance is still configurable, so only that is shown — the old fields
// described a mechanism that had already been removed.
function CommunitySection({ draft, set, config, setConfig }) {
  const keys = ['community_guest_daily_messages', 'community_pin_hours', 'gift_expiry_days'];

  return (
    <div>
      <Card style={{ marginBottom: 20 }}>
        <T.sectionTitle>The Public Corner</T.sectionTitle>
        <p style={{ fontFamily: sans, fontSize: 13, color: colors.muted, marginBottom: 4, lineHeight: 1.7 }}>
          Members post as much as they like, at no cost. It is part of what they pay for.
        </p>
        <p style={{ fontFamily: sans, fontSize: 13, color: colors.muted, marginBottom: 16, lineHeight: 1.7 }}>
          Guests get a small daily allowance so the feed stays alive without becoming
          a place people post in without joining.
        </p>
        <div style={S.formGrid}>
          <Field label="Guest messages per day">
            <input style={S.input} type="number" min={0} max={20}
                   value={draft.community_guest_daily_messages ?? 1}
                   onChange={(e) => set('community_guest_daily_messages', e.target.value)} />
          </Field>
          <Field label="A poll stays at the top for (hours)">
            <input style={S.input} type="number" min={1}
                   value={draft.community_pin_hours ?? 48}
                   onChange={(e) => set('community_pin_hours', e.target.value)} />
          </Field>
          <Field label="Gifted tokens last (days)">
            <input style={S.input} type="number" min={1}
                   value={draft.gift_expiry_days ?? 30}
                   onChange={(e) => set('gift_expiry_days', e.target.value)} />
          </Field>
        </div>
        <p style={{ fontFamily: sans, fontSize: 11, color: colors.muted, marginTop: 10, lineHeight: 1.6 }}>
          Changing how long a gift lasts applies to gifts sent from now on. Tokens already
          given keep the expiry they were given with.
        </p>
        <p style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginTop: 12, fontStyle: 'italic' }}>
          Set to 0 to close the Public Corner to guests entirely. Members are unaffected either way.
        </p>
      </Card>

      <SectionSave keys={keys} draft={draft} config={config} setConfig={setConfig} />
    </div>
  );
}

// ── Bonus offers ──────────────────────────────────────────────────────────────
//
// A discount given as quantity rather than price: full price collected, full
// price taxed, more tokens handed over. The fan is no worse off than with a
// percentage off, the invoice stays simple, and the tokens given are never
// counted as revenue anywhere.
function OffersSection() {
  const [offers,  setOffers]  = useState(null);
  const [pct,     setPct]     = useState('20');
  const [hours,   setHours]   = useState(4);
  const [code,    setCode]    = useState('');
  // Announced by default: most offers exist to be seen.
  const [announced, setAnnounced] = useState(true);
  const [label,   setLabel]   = useState('');
  const [minTok,  setMinTok]  = useState('');
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');

  const load = () => api.get('/api/studio/bonus-offers')
    .then((d) => setOffers(d.offers || []))
    .catch((e) => setError(e.message));

  useEffect(() => { load(); }, []);

  const start = async () => {
    setSaving(true); setError(''); setSuccess('');
    try {
      await api.post('/api/studio/bonus-offers', {
        bonusPct: pct, hours, code: code.trim() || undefined,
        label: label.trim() || undefined, minTokens: minTok || 0,
        announced,
      });
      setSuccess(
        !announced
          ? `Code ${code.trim().toUpperCase()} works, and nobody has been told. Give it out yourself.`
          : code.trim()
            ? `Code ${code.trim().toUpperCase()} is live and shown to everybody.`
            : 'Offer is live and announced.'
      );
      setCode(''); setLabel(''); setMinTok(''); setAnnounced(true);
      load();
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };

  const end = async (o) => {
    if (!window.confirm(`End "${o.label || `${o.bonusPct}% bonus`}" now?`)) return;
    setError('');
    try { await api.post(`/api/studio/bonus-offers/${o.id}/end`); load(); }
    catch (err) { setError(err.message); }
  };

  const running = (offers || []).filter((o) => o.running);
  const past    = (offers || []).filter((o) => !o.running);

  return (
    <div>
      {error   && <div style={S.error}>{error}</div>}
      {success && <div style={S.success}>{success}</div>}

      <Card style={{ marginBottom: 20 }}>
        <T.sectionTitle>Start an offer</T.sectionTitle>
        <p style={{ fontFamily: sans, fontSize: 13, color: colors.muted, marginBottom: 14, lineHeight: 1.7 }}>
          Extra tokens rather than money off. Somebody buying 500 at 20% pays the same and receives
          600 — you collect the full price and the tax is on the full price, which is simpler for
          everyone. Bonus tokens spend anywhere, never expire, and never count as earnings.
        </p>

        <div style={S.formGrid}>
          <Field label="Bonus (%)">
            <input style={S.input} type="number" min={5} max={100} value={pct}
                   onChange={(e) => setPct(e.target.value)} />
          </Field>
          <Field label="Only on purchases of (tokens)">
            <input style={S.input} type="number" min={0} value={minTok} placeholder="any amount"
                   onChange={(e) => setMinTok(e.target.value)} />
          </Field>
          <Field label="Code — leave empty for everyone" full>
            <input style={S.input} value={code} placeholder="e.g. WEEKEND"
                   onChange={(e) => setCode(e.target.value.toUpperCase())} />
          </Field>
          {/* Whether to tell anybody.
              //
              // Every active code was shown to everybody with the code itself
              // attached, so an offer meant for one person — an apology, an
              // email, a single member — went platform-wide the moment it was
              // made. A quiet one still works when typed.
              //
              // Always on screen, dimmed until there is a code: hidden until
              // one was typed, nobody would learn it existed, and wanting an
              // offer to be quiet is often the reason to use a code at all. */}
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8,
                          gridColumn: '1 / -1', margin: '2px 0 14px',
                          cursor: code.trim() ? 'pointer' : 'default',
                          opacity: code.trim() ? 1 : 0.45 }}>
            <input type="checkbox" checked={!announced} disabled={!code.trim()}
                   onChange={(e) => setAnnounced(!e.target.checked)}
                   style={{ marginTop: 3 }} />
            <span style={{ fontFamily: sans, fontSize: 13, color: colors.text }}>
              Keep this one quiet
              <span style={{ display: 'block', fontSize: 11, color: colors.muted, marginTop: 2 }}>
                {code.trim()
                  ? 'Nobody is shown the code. It still works for anyone you give it to.'
                  : 'Give it a code above to make it a private one.'}
              </span>
            </span>
          </label>

          <Field label="What to call it" full>
            <input style={S.input} value={label} placeholder={`e.g. ${pct}% bonus tokens tonight`}
                   onChange={(e) => setLabel(e.target.value)} />
          </Field>
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginBottom: 8 }}>Runs for</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[[4, '4 hours'], [24, '24 hours'], [72, '3 days'], [168, 'a week'], [720, 'a month']].map(([h, l]) => (
              <button key={h} onClick={() => setHours(h)}
                      style={{ ...S.ghostBtn, fontSize: 12, padding: '6px 12px',
                               ...(hours === h ? { color: colors.accent, borderColor: colors.accent } : {}) }}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <div style={{ ...ladderBox, marginTop: 14 }}>
          <div style={{ fontFamily: sans, fontSize: 12, color: colors.text }}>
            Somebody buying 500 tokens would receive{' '}
            <strong style={{ color: colors.accent }}>{500 + Math.floor((500 * (parseFloat(pct) || 0)) / 100)}</strong>
            {' '}and pay the same as always.
          </div>
          {!code.trim() && (
            <div style={{ fontFamily: sans, fontSize: 11, color: colors.muted, marginTop: 6 }}>
              A sitewide offer is announced in the Public Corner and shown at the top of every page.
            </div>
          )}
        </div>

        <button onClick={start} disabled={saving} style={{ ...S.btn, marginTop: 14, opacity: saving ? 0.5 : 1 }}>
          {saving ? 'Starting…' : code.trim() ? 'Create the code' : 'Start it now'}
        </button>
      </Card>

      {running.length > 0 && (
        <Card style={{ marginBottom: 20 }}>
          <T.sectionTitle>Running now</T.sectionTitle>
          {running.map((o) => (
            <div key={o.id} style={offerRow}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontFamily: sans, fontSize: 14, color: colors.text }}>
                  {o.label || `${o.bonusPct}% bonus`}
                  {o.code && <span style={codeChip}>{o.code}</span>}
                </div>
                <div style={{ fontFamily: sans, fontSize: 11, color: colors.muted, marginTop: 3 }}>
                  Ends {new Date(o.endsAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  {o.minTokens > 0 && ` · on ${o.minTokens}+ tokens`}
                  {' · '}used {o.uses} time{o.uses === 1 ? '' : 's'}
                </div>
              </div>
              <button onClick={() => end(o)} style={{ ...S.ghostBtn, fontSize: 11, padding: '5px 12px', color: '#D99A9A' }}>
                End now
              </button>
            </div>
          ))}
        </Card>
      )}

      {past.length > 0 && (
        <Card>
          <T.sectionTitle>Finished</T.sectionTitle>
          <p style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginBottom: 10, lineHeight: 1.6 }}>
            What each one gave away, against what came in while it ran. Worth reading before
            repeating one.
          </p>
          {past.slice(0, 12).map((o) => (
            <div key={o.id} style={offerRow}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontFamily: sans, fontSize: 13, color: colors.text }}>
                  {o.label || `${o.bonusPct}% bonus`}
                  {o.code && <span style={codeChip}>{o.code}</span>}
                </div>
                <div style={{ fontFamily: mono, fontSize: 10, color: colors.muted, marginTop: 3 }}>
                  {new Date(o.startsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  {' · '}used {o.uses} time{o.uses === 1 ? '' : 's'}
                </div>
              </div>
              <div style={{ textAlign: 'right', fontFamily: sans, fontSize: 11, color: colors.muted }}>
                <div style={{ color: colors.success }}>₹{o.inrDuring.toLocaleString('en-IN')} in</div>
                <div>{o.bonusGiven} bonus tokens given</div>
              </div>
            </div>
          ))}
        </Card>
      )}

      {offers && offers.length === 0 && <T.muted>No offers yet.</T.muted>}
    </div>
  );
}

// ── International ─────────────────────────────────────────────────────────────
function CurrencySection({ draft, set, config, setConfig }) {
  const keys = ['international_payments_live', 'fx_buffer_pct', 'fx_max_age_hours'];
  const live = String(draft.international_payments_live) === 'true';

  return (
    <div>
      <Card style={{ marginBottom: 20 }}>
        <T.sectionTitle>Accepting foreign currency</T.sectionTitle>
        <p style={{ fontFamily: sans, fontSize: 13, color: colors.muted, marginBottom: 14, lineHeight: 1.7 }}>
          A fan outside India can pay in their own money or in US dollars. Both make the sale a
          zero-rated export, which is why it is worth offering. Switch this off and everybody pays
          in rupees, which always works — worth doing if the payment provider has a bad day rather
          than letting purchases fail.
        </p>
        <label style={toggleRow}>
          <input type="checkbox" checked={live}
                 onChange={(e) => set('international_payments_live', e.target.checked ? 'true' : 'false')} />
          <span>
            <strong style={{ color: colors.text }}>
              {live ? 'Foreign currency is being offered' : 'Everybody pays in rupees'}
            </strong>
            <span style={{ display: 'block', fontSize: 11, marginTop: 2 }}>
              Applies to anyone we can see is outside India.
            </span>
          </span>
        </label>
      </Card>

      <Card style={{ marginBottom: 20 }}>
        <T.sectionTitle>Exchange rates</T.sectionTitle>
        <p style={{ fontFamily: sans, fontSize: 13, color: colors.muted, marginBottom: 14, lineHeight: 1.7 }}>
          Rates refresh twice a day. The buffer absorbs movement between quoting a price and the
          money actually settling, which can take days — without it, a rupee that weakens overnight
          means banking less than the price advertised. A rate older than the limit below is not
          used at all, and that currency is simply not offered until it refreshes.
        </p>
        <div style={S.formGrid}>
          <Field label="Buffer on every conversion (%)">
            <input style={S.input} type="number" min={0} max={20} step="0.5"
                   value={draft.fx_buffer_pct ?? ''}
                   onChange={(e) => set('fx_buffer_pct', e.target.value)} />
          </Field>
          <Field label="Stop using a rate after (hours)">
            <input style={S.input} type="number" min={1}
                   value={draft.fx_max_age_hours ?? ''}
                   onChange={(e) => set('fx_max_age_hours', e.target.value)} />
          </Field>
        </div>
      </Card>

      <SectionSave keys={keys} draft={draft} config={config} setConfig={setConfig} />
    </div>
  );
}

// ── Gallery ───────────────────────────────────────────────────────────────────
function GallerySection({ draft, set, config, setConfig }) {
  const keys = [
    ...TIERS.map((t) => `tier_open_cap_${t}`),
    'tier_open_band2_until', 'tier_open_band2_cost',
    'tier_open_band3_until', 'tier_open_band3_cost',
  ];

  // null, not a default. A blank field is a real problem that needs saying out
  // loud, and substituting 15 for it is how it stays invisible.
  const n = (k) => {
    const v = parseInt(draft[k], 10);
    return Number.isNaN(v) ? null : v;
  };
  const caps  = Object.fromEntries(TIERS.map((t) => [t, n(`tier_open_cap_${t}`)]));
  const b2To  = n('tier_open_band2_until');
  const b2    = n('tier_open_band2_cost');
  const b3To  = n('tier_open_band3_until');
  const b3    = n('tier_open_band3_cost');

  const bandsReady  = [b2To, b2, b3To, b3].every((v) => v !== null);
  const missingCaps = TIERS.filter((t) => caps[t] === null);

  // The bands are absolute set numbers shared by every tier — they are not
  // measured from each tier's cap. A tier only decides where "included" stops.
  // This panel used to show a single row built from the Premium cap with no
  // tier named on it, which is how you end up reading Premium's ladder and
  // thinking it is Community's.
  const rowFor = (cap) => {
    if (cap === null || !bandsReady) return null;
    if (cap === 0) return { included: 'everything', band2: '—', band3: '—', beyond: '—' };
    const thirdFrom  = Math.max(cap, b2To) + 1;
    const beyondFrom = Math.max(cap, b2To, b3To) + 1;
    return {
      included: `1–${cap}`,
      band2:  cap < b2To        ? `${cap + 1}–${b2To}` : '—',
      band3:  thirdFrom <= b3To ? `${thirdFrom}–${b3To}` : '—',
      beyond: `${beyondFrom}+`,
    };
  };

  const grid4   = { display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr 1fr 1fr', gap: '6px 10px', alignItems: 'baseline' };
  const headCell = { fontFamily: mono, fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6F675E' };
  const tierCell = { fontFamily: sans, fontSize: 12, color: colors.text };
  const valCell  = { fontFamily: mono, fontSize: 12, color: '#9B8F83' };
  const warnText = { fontFamily: sans, fontSize: 12, color: '#D99A9A', lineHeight: 1.6, marginTop: 10 };

  return (
    <div>
      <Card style={{ marginBottom: 20 }}>
        <T.sectionTitle>Sets included with a membership</T.sectionTitle>
        <p style={{ fontFamily: sans, fontSize: 13, color: colors.muted, marginBottom: 14, lineHeight: 1.7 }}>
          Everything at a member's own level opens without spending anything, up to the number
          below. A cap of <strong style={{ color: colors.text }}>0 means no limit at all</strong> —
          which is how Supreme is exempted.
        </p>
        <div style={S.formGrid}>
          {TIERS.map((tier) => (
            <Field key={tier} label={`${tier.charAt(0).toUpperCase() + tier.slice(1)} — sets a month`}>
              <input style={S.input} type="number" min={0}
                     value={draft[`tier_open_cap_${tier}`] ?? ''}
                     onChange={(e) => set(`tier_open_cap_${tier}`, e.target.value)} />
            </Field>
          ))}
        </div>
        {missingCaps.length > 0 && (
          <p style={warnText}>
            No cap set for {missingCaps.join(', ')}. Leave it blank and the backend cannot tell
            "unlimited" from "not configured" — it now charges full price rather than guessing,
            so members at {missingCaps.length === 1 ? 'that tier' : 'those tiers'} would be
            billed for sets their membership is meant to include. Enter a number, or 0 for
            no limit.
          </p>
        )}
      </Card>

      <Card style={{ marginBottom: 20 }}>
        <T.sectionTitle>After that</T.sectionTitle>
        <p style={{ fontFamily: sans, fontSize: 13, color: colors.muted, marginBottom: 14, lineHeight: 1.7 }}>
          The price climbs in steps rather than jumping to one figure — the sixteenth set and the
          sixtieth are not the same thing. Past the last step a set costs its own price for that
          tier, which is the point at which a membership has stopped being a membership.
        </p>
        <div style={S.formGrid}>
          <Field label="Second band runs to">
            <input style={S.input} type="number" min={0} value={draft.tier_open_band2_until ?? ''}
                   onChange={(e) => set('tier_open_band2_until', e.target.value)} />
          </Field>
          <Field label="Tokens per set in that band">
            <input style={S.input} type="number" min={0} value={draft.tier_open_band2_cost ?? ''}
                   onChange={(e) => set('tier_open_band2_cost', e.target.value)} />
          </Field>
          <Field label="Third band runs to">
            <input style={S.input} type="number" min={0} value={draft.tier_open_band3_until ?? ''}
                   onChange={(e) => set('tier_open_band3_until', e.target.value)} />
          </Field>
          <Field label="Tokens per set in that band">
            <input style={S.input} type="number" min={0} value={draft.tier_open_band3_cost ?? ''}
                   onChange={(e) => set('tier_open_band3_cost', e.target.value)} />
          </Field>
        </div>

        {/* Worked out rather than described, and worked out for every tier.
            Four numbers do not read as a ladder until you see what somebody
            actually pays at each step \u2014 and which somebody. */}
        <div style={ladderBox}>
          <div style={{ fontFamily: mono, fontSize: 10, color: colors.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
            Which sets cost what, by tier
          </div>

          {bandsReady ? (
            <div style={grid4}>
              <span style={headCell} />
              <span style={headCell}>Included</span>
              <span style={headCell}>{b2} token{b2 === 1 ? '' : 's'}</span>
              <span style={headCell}>{b3} token{b3 === 1 ? '' : 's'}</span>
              <span style={headCell}>Own price</span>

              {TIERS.map((tier) => {
                const r = rowFor(caps[tier]);
                const name = tier.charAt(0).toUpperCase() + tier.slice(1);
                return (
                  <Fragment key={tier}>
                    <span style={tierCell}>{name}</span>
                    {r ? (
                      <>
                        <span style={valCell}>{r.included}</span>
                        <span style={valCell}>{r.band2}</span>
                        <span style={valCell}>{r.band3}</span>
                        <span style={valCell}>{r.beyond}</span>
                      </>
                    ) : (
                      <span style={{ ...valCell, color: '#D99A9A', gridColumn: 'span 4' }}>cap not set</span>
                    )}
                  </Fragment>
                );
              })}
            </div>
          ) : (
            <div style={{ fontFamily: sans, fontSize: 12, color: '#D99A9A', lineHeight: 1.6 }}>
              Fill in all four band numbers above to see what each tier pays.
            </div>
          )}

          {bandsReady && b3To <= b2To && (
            <p style={warnText}>
              The third band ends at {b3To}, on or before the second ends at {b2To}, so the
              {' '}{b3}-token step never applies \u2014 a member goes straight from {b2} token to the
              set's own price.
            </p>
          )}

          <div style={{ fontFamily: sans, fontSize: 11, color: colors.muted, marginTop: 12, lineHeight: 1.6 }}>
            The bands are the same set numbers for everyone. A tier only decides where
            "included" stops \u2014 so a higher tier always pays less, never more, for the same set.
            Resets on each member's own renewal date, not the 1st.
          </div>
        </div>
      </Card>

      <SectionSave keys={keys} draft={draft} config={config} setConfig={setConfig} />
    </div>
  );
}

// ── Call Rates ────────────────────────────────────────────────────────────────
function CallsSection({ draft, set, config, setConfig, tokenRate }) {
  const keys = ['call_video_per_min', 'call_priority_per_min'];

  return (
    <div>
      <Card style={{ marginBottom: 20 }}>
        <T.sectionTitle>Call rates (tokens / minute)</T.sectionTitle>
        <p style={{ fontFamily: sans, fontSize: 13, color: colors.muted, marginBottom: 14 }}>
          Base per-minute rate before any membership discount or guest multiplier.
          Calls are video; a fan chooses whether to connect now or schedule one.
        </p>
        <div style={S.formGrid}>
          <TokenField label="Connect now" value={draft.call_priority_per_min ?? 22} onChange={(v) => set('call_priority_per_min', v)} tokenRateInr={tokenRate} />
          <TokenField label="Scheduled"   value={draft.call_video_per_min ?? 15}    onChange={(v) => set('call_video_per_min', v)}    tokenRateInr={tokenRate} />
        </div>
        <p style={{ fontFamily: sans, fontSize: 11, color: colors.muted, marginTop: 12 }}>
          The audio rates are no longer offered and are not shown here. They remain
          in the configuration so historical calls still price correctly.
        </p>
      </Card>

      <SectionSave keys={keys} draft={draft} config={config} setConfig={setConfig} />
    </div>
  );
}
// ── Direct Messages ───────────────────────────────────────────────────────────
function MessagesSection({ draft, set, config, setConfig, tokenRate }) {
  const TIERS_LOCAL = ['community', 'insider', 'premium', 'supreme'];
  const keys = TIERS_LOCAL.flatMap((t) => [`dm_free_per_month_${t}`, `dm_daily_cap_${t}`, `dm_overage_cost_${t}`]);

  return (
    <div>
      <Card style={{ marginBottom: 20 }}>
        <T.sectionTitle>Direct message quotas & pricing per tier</T.sectionTitle>
        <p style={{ fontFamily: sans, fontSize: 13, color: colors.muted, marginBottom: 14 }}>
          Free messages reset monthly, with a daily cap. Once both are used up, each additional message costs the overage rate shown. Guests have no free allowance, they pay the Community overage rate multiplied by the guest multiplier (set in Pricing & Discounts).
        </p>
        {TIERS_LOCAL.map((tier) => (
          <div key={tier} style={{ marginBottom: 20, paddingBottom: 18, borderBottom: `1px solid ${colors.border}` }}>
            <div style={{ fontFamily: sans, fontSize: 13, color: colors.accent, textTransform: 'capitalize', fontWeight: 600, marginBottom: 10 }}>{tier}</div>
            <div style={S.formGrid}>
              <Field label="Free messages / month">
                <input style={S.input} type="number" min={0} value={draft[`dm_free_per_month_${tier}`] ?? 0} onChange={(e) => set(`dm_free_per_month_${tier}`, e.target.value)} />
              </Field>
              <Field label="Daily cap">
                <input style={S.input} type="number" min={0} value={draft[`dm_daily_cap_${tier}`] ?? 0} onChange={(e) => set(`dm_daily_cap_${tier}`, e.target.value)} />
              </Field>
              <TokenField label="Overage cost" value={draft[`dm_overage_cost_${tier}`] ?? 1} onChange={(v) => set(`dm_overage_cost_${tier}`, v)} tokenRateInr={tokenRate} />
            </div>
          </div>
        ))}
      </Card>

      <SectionSave keys={keys} draft={draft} config={config} setConfig={setConfig} />
    </div>
  );
}
// ── Backgrounds ───────────────────────────────────────────────────────────────
function BackgroundsSection({ config, setConfig }) {
  const [bgType,      setBgType]      = useState('community');
  const [bgUploading,  setBgUploading] = useState(false);
  const [bgRemoving,   setBgRemoving]  = useState(false);
  const [bgCropFile,   setBgCropFile]  = useState(null);
  const [error,        setError]       = useState('');
  const [success,      setSuccess]     = useState('');
  const bgFileRef = useRef(null);

  const aspectForType = bgType === 'community' ? COMMUNITY_BG_ASPECT : CHAT_BG_ASPECT;
  const configKey = bgType === 'community' ? 'community_chat_bg' : 'personal_chat_bg';
  // Read directly from the already-loaded platform config — this is what's genuinely live
  // right now, rather than a separate, easy-to-drift local copy.
  const currentBg = config?.[configKey] || '';

  const handleBgFilePick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(''); setSuccess('');
    setBgCropFile(file);
  };

  const handleBgCropComplete = async (croppedFile) => {
    setBgCropFile(null);
    setBgUploading(true);
    setError(''); setSuccess('');
    try {
      const publicUrl = await uploadToR2(croppedFile, 'background', api);
      await api.post('/api/upload/confirm-background', { publicUrl, type: bgType });
      setConfig((c) => ({ ...c, [configKey]: publicUrl }));
      setSuccess(`${bgType === 'community' ? 'Community' : 'Default personal chat'} background updated — live immediately.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBgUploading(false);
    }
  };

  const handleRemoveBg = async () => {
    setError(''); setSuccess(''); setBgRemoving(true);
    try {
      // A genuine SQL NULL, not an empty string — an empty string would satisfy
      // COALESCE() as "present" on the read side and break the intended fallback.
      await api.post('/api/studio/chat-bg', { type: bgType, value: null });
      setConfig((c) => ({ ...c, [configKey]: null }));
      setSuccess(`${bgType === 'community' ? 'Community' : 'Default personal chat'} background removed — chat now shows the plain background.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBgRemoving(false);
    }
  };

  return (
    <Card>
      <T.sectionTitle>Chat backgrounds</T.sectionTitle>
      <p style={{ fontFamily: sans, fontSize: 13, color: colors.muted, marginBottom: 16, lineHeight: 1.6 }}>
        Upload a photo to use as the background — you'll be able to crop it before it's saved. Community applies to everyone in the community feed. The personal default applies to any fan's DM chat who doesn't have an individual override set (those are managed per-fan from Messages).
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
        <input ref={bgFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleBgFilePick} />
        <button
          onClick={() => bgFileRef.current?.click()}
          disabled={bgUploading || bgRemoving}
          style={{ ...S.btn, opacity: (bgUploading || bgRemoving) ? 0.5 : 1 }}
        >
          {bgUploading ? 'Uploading…' : 'Browse & upload photo'}
        </button>
        {currentBg && (
          <button
            onClick={handleRemoveBg}
            disabled={bgUploading || bgRemoving}
            style={{ ...S.ghostBtn, color: '#D99A9A', opacity: (bgUploading || bgRemoving) ? 0.5 : 1 }}
          >
            {bgRemoving ? 'Removing…' : 'Remove background'}
          </button>
        )}
      </div>
      {currentBg ? (
        <div>
          <div style={{ fontFamily: sans, fontSize: 12, color: colors.muted, marginBottom: 8 }}>Currently live</div>
          <img src={currentBg} alt="background preview" style={{ width: '100%', maxWidth: 320, height: 180, objectFit: 'cover', borderRadius: 8, border: `1px solid ${colors.border}` }} />
        </div>
      ) : (
        <p style={{ fontFamily: sans, fontSize: 12, color: colors.muted, fontStyle: 'italic' }}>No background currently set — showing the plain default.</p>
      )}

      {bgCropFile && (
        <CropTool
          file={bgCropFile}
          aspectRatio={aspectForType}
          outputWidth={bgType === 'community' ? 900 : 720}
          onCancel={() => setBgCropFile(null)}
          onCropComplete={handleBgCropComplete}
        />
      )}
    </Card>
  );
}

// ── Legal Details ─────────────────────────────────────────────────────────────
function LegalDetailsSection({ draft, set, config, setConfig }) {
  const keys = ['legal_registered_address', 'legal_gstin', 'domestic_gst_rate_pct'];

  return (
    <Card>
      <T.sectionTitle>Business & legal details</T.sectionTitle>
      <p style={{ fontFamily: sans, fontSize: 13, color: colors.muted, marginBottom: 16 }}>
        This address and GSTIN appear on every legal page (Terms, Privacy, Refund, Shipping) and the site footer. Update it here once, rather than editing each page by hand.
      </p>
      <Field label="Registered address (as per GST certificate)">
        <textarea
          style={{ ...S.input, minHeight: 70, resize: 'vertical', lineHeight: 1.6 }}
          value={draft.legal_registered_address ?? ''}
          onChange={(e) => set('legal_registered_address', e.target.value)}
        />
      </Field>
      <Field label="GSTIN">
        <input style={S.input} value={draft.legal_gstin ?? ''} onChange={(e) => set('legal_gstin', e.target.value)} />
        </Field>

        <Field label="GST rate (%)">
          <input style={S.input} type="number" min={0} max={100} step="0.01"
                 value={draft.domestic_gst_rate_pct ?? ''}
                 onChange={(e) => set('domestic_gst_rate_pct', e.target.value)} />
          <div style={{ fontFamily: sans, fontSize: 11, color: colors.muted, marginTop: 6, lineHeight: 1.6 }}>
            Changes with the law, not with a decision. Token prices already include this — the
            rate here is what gets stripped out to work out the taxable value on an invoice, the
            share a charity receives, and what a photographer's work generated. Changing it
            changes all three.
          </div>
      </Field>

      <SectionSave keys={keys} draft={draft} config={config} setConfig={setConfig} />
    </Card>
  );
}