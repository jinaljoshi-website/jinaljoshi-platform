// ps/src/components/HelpChat.jsx
// A help panel that knows this fan, not just the platform.
//
// Answers are built from live config and their own record — remaining unlocks,
// actual balances, what their tier costs them per message. That is both more
// useful than a generic FAQ and safer than a language model, which would answer
// most of these correctly and occasionally invent a number about somebody's
// money.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { C, F } from '../tokens';
import { api } from '../api';

const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Each answer is a function of the fan's real position. Keywords are what a
// person would actually type, not the words we happen to use on the page.
function buildTopics(c, go) {
  if (!c) return [];
  const t = [];

  t.push({
    q: 'What are J Tokens?',
    keys: ['token', 'coin', 'currency', 'jtoken', 'j token'],
    a: () => (
      <>
        J Tokens are what you spend here — on messages, photo sets, calls and merchandise.
        One token is {rupees(c.tokenRate)} including tax, and they never expire.
        {c.tokens.total > 0
          ? <> You have <b>{plural(c.tokens.total, 'token', 'tokens')}</b> right now.</>
          : <> You have none at the moment.</>}
      </>
    ),
    action: { label: 'Get tokens', to: '/platform/coins' },
  });

  if (c.tokens.gifted > 0) {
    t.push({
      q: 'What is the difference between my gifted and purchased tokens?',
      keys: ['gift', 'gifted', 'free token', 'expire', 'welcome'],
      a: () => (
        <>
          You have <b>{plural(c.tokens.gifted, 'gifted token', 'gifted tokens')}</b> from Jinal and{' '}
          <b>{plural(c.tokens.purchased, 'purchased token', 'purchased tokens')}</b>.
          Gifted ones are spent first, and they work on messages, photo sets and selfies —
          not on merchandise, calls or membership.
          {c.tokens.giftedExpiresInDays !== null && c.tokens.giftedExpiresInDays !== undefined && (
            <> Your gifted tokens expire in <b>{plural(c.tokens.giftedExpiresInDays, 'day', 'days')}</b>.</>
          )}
        </>
      ),
    });
  }

  t.push({
    q: 'How do I unlock a photo set?',
    keys: ['unlock', 'set', 'gallery', 'photo', 'album', 'open'],
    a: () => (
      <>
        Every set is split into parts. Some photos are free for everyone. Others are meant for
        members, and the higher your tier the more you reach. Anything above your tier can be
        bought on its own — you never have to.
        {c.isMember
          ? <> Everything at your level is <b>already included</b> — nothing to spend.
              {c.unlocks.allowance > 0 && <> You have opened {c.unlocks.used} of {c.unlocks.allowance} sets
                this month; past that a further one at your level is a token.</>}</>
          : <> As a guest you can buy any set outright. Members open everything at their own level
              without paying, and pay less for the rest.</>}
      </>
    ),
    action: { label: 'Open the gallery', to: '/platform/gallery' },
  });

  t.push({
    q: 'How much does it cost to message Jinal?',
    keys: ['message', 'dm', 'chat', 'text', 'write', 'talk'],
    a: () => (c.isMember ? (
      <>
        Your membership includes <b>{plural(c.messages.freePerMonth, 'message', 'messages')}</b> a
        month, up to {c.messages.dailyCap} a day. You have{' '}
        <b>{c.messages.freeRemaining} left this month</b> and {c.messages.dailyRemaining} left today.
        After that it is {plural(c.messages.costAfterFree, 'token', 'tokens')} per message.
      </>
    ) : (
      <>
        As a guest each message costs {plural(c.messages.costAfterFree, 'token', 'tokens')}.
        Members get a monthly allowance of free messages instead.
      </>
    )),
    action: { label: 'Write to Jinal', to: '/platform/chat' },
  });

  t.push({
    q: 'What does my membership include?',
    keys: ['membership', 'member', 'tier', 'plan', 'subscri', 'benefit', 'perk'],
    a: () => (c.isMember ? (
      <>
        You are on <b>{c.tier}</b>, which runs to{' '}
        {new Date(c.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}.
        That includes {plural(c.messages.freePerMonth, 'free message', 'free messages')} a month,
        every {c.tier} photo set at no extra cost
        {c.discountPct > 0 && <>, and {c.discountPct}% off everything you buy</>}
        {c.selfies.free && <>. Selfie of the Day is included too</>}.
      </>
    ) : (
      <>
        You are browsing as a guest. Members get free messages and set unlocks every month,
        pay less for everything, and see things guests do not.
      </>
    )),
    action: { label: c.isMember ? 'See your membership' : 'See what members get', to: '/platform/membership' },
  });

  t.push({
    q: 'What is Selfie of the Day?',
    keys: ['selfie', 'daily', 'photo of the day'],
    a: () => (
      <>
        One selfie, most days, nothing staged. {c.selfies.free
          ? <>They are <b>included with your membership</b> at no cost.</>
          : <>Each one is {plural(c.selfies.unlockCost, 'token', 'tokens')}, or {c.selfies.passCost} tokens
             for a pass covering the next several as they are posted.</>}
      </>
    ),
    action: { label: 'See them', to: '/platform/gallery?tab=selfies' },
  });

  t.push({
    q: 'What happens if my membership ends?',
    keys: ['end', 'expire', 'lapse', 'cancel', 'stop', 'renew'],
    a: () => (
      <>
        Anything you paid tokens for stays yours permanently. Sets that were open because of your
        membership close again until you renew. Your tokens are unaffected either way.
      </>
    ),
  });

  t.push({
    q: 'How do calls work?',
    keys: ['call', 'video', 'audio', 'talk', 'session', 'book'],
    a: () => (
      <>
        You book a slot and pay in tokens by the minute. Priority Video rings Jinal straight
        away if she is free; the others are scheduled.
        {c.discountPct > 0 && <> Your tier takes {c.discountPct}% off the rate.</>}
      </>
    ),
    action: { label: 'Book a call', to: '/platform/calls' },
  });

  t.push({
    q: 'Can I get a refund?',
    keys: ['refund', 'money back', 'cancel', 'return', 'wrong'],
    a: () => (
      <>
        Tokens are non-refundable once bought, and unlocked content cannot be returned.
        If a call does not happen, or something goes wrong at our end, tokens come back to you —
        the refund policy sets out exactly when.
      </>
    ),
    action: { label: 'Read the policy', to: '/refund' },
  });

  return t;
}

export default function HelpChat() {
  const [open, setOpen]   = useState(false);
  const [ctx, setCtx]     = useState(null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(null);
  const navigate = useNavigate();
  const panelRef = useRef(null);

  // Loaded when first opened, not on every page — most visits never need it.
  useEffect(() => {
    if (open && !ctx) api.get('/api/help/context').then(setCtx).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const topics = buildTopics(ctx, navigate);
  const q = query.trim().toLowerCase();
  const shown = q
    ? topics.filter((t) => t.q.toLowerCase().includes(q) || t.keys.some((k) => q.includes(k) || k.includes(q)))
    : topics;

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={fab}>
        Need help?
      </button>
    );
  }

  return (
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div style={panel} ref={panelRef}>
        <div style={header}>
          <div>
            <div style={{ fontFamily: F.display, fontSize: 20, color: C.text }}>How can I help?</div>
            {ctx && (
              <div style={{ fontFamily: F.sans, fontSize: 11, color: C.muted, marginTop: 2 }}>
                Answers are for your account · {ctx.isMember ? ctx.tier : 'guest'}
              </div>
            )}
          </div>
          <button onClick={() => setOpen(false)} style={closeBtn}>✕</button>
        </div>

        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPicked(null); }}
          placeholder="Ask about tokens, messages, unlocking…"
          style={search}
        />

        <div style={{ overflowY: 'auto', flex: 1, marginTop: 12 }}>
          {!ctx ? (
            <div style={{ fontFamily: F.sans, fontSize: 13, color: C.muted }}>One moment…</div>
          ) : shown.length === 0 ? (
            <div style={{ fontFamily: F.sans, fontSize: 13, color: C.muted, lineHeight: 1.7 }}>
              Nothing here matches that. Jinal reads every message — ask her directly and she
              will answer.
              <button onClick={() => { setOpen(false); navigate('/platform/chat'); }} style={inlineLink}>
                Write to Jinal
              </button>
            </div>
          ) : shown.map((t, i) => {
            const isOpen = picked === i;
            return (
              <div key={t.q} style={item}>
                <button onClick={() => setPicked(isOpen ? null : i)} style={qBtn}>
                  <span>{t.q}</span>
                  <span style={{ color: C.accent, flexShrink: 0, marginLeft: 10 }}>{isOpen ? '−' : '+'}</span>
                </button>
                {isOpen && (
                  <div style={answer}>
                    {t.a()}
                    {t.action && (
                      <button onClick={() => { setOpen(false); navigate(t.action.to); }} style={actionBtn}>
                        {t.action.label} →
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={footer}>
          Still stuck? <button onClick={() => { setOpen(false); navigate('/platform/chat'); }} style={inlineLink}>
            Message Jinal
          </button>
        </div>
      </div>
    </div>
  );
}

const fab      = { position: 'fixed', right: 16, bottom: 88, padding: '10px 16px', borderRadius: 999, background: C.surface, border: `1px solid ${C.border}`, color: C.muted, fontFamily: F.sans, fontSize: 13, cursor: 'pointer', zIndex: 120, whiteSpace: 'nowrap', boxShadow: '0 4px 16px rgba(0,0,0,0.35)' };
const overlay  = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', padding: 16 };
const panel    = { width: '100%', maxWidth: 420, maxHeight: '80vh', display: 'flex', flexDirection: 'column', background: '#161410', border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 };
const header   = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 };
const closeBtn = { background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, fontSize: 13, padding: '5px 10px', borderRadius: 8, cursor: 'pointer' };
const search   = { width: '100%', boxSizing: 'border-box', background: '#100F0C', border: `1px solid ${C.border}`, color: C.text, fontFamily: F.sans, fontSize: 13, padding: '10px 12px', borderRadius: 8, outline: 'none' };
const item     = { borderBottom: `1px solid ${C.border}` };
const qBtn     = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', background: 'none', border: 'none', padding: '13px 0', cursor: 'pointer', fontFamily: F.sans, fontSize: 13, color: C.text, textAlign: 'left', lineHeight: 1.4 };
const answer   = { fontFamily: F.sans, fontSize: 13, color: C.muted, lineHeight: 1.75, padding: '0 0 14px' };
const actionBtn = { display: 'block', marginTop: 10, background: 'rgba(193,125,74,0.12)', border: `1px solid rgba(193,125,74,0.3)`, color: C.accent, fontFamily: F.sans, fontSize: 12, padding: '7px 14px', borderRadius: 8, cursor: 'pointer' };
const footer   = { fontFamily: F.sans, fontSize: 12, color: C.muted, borderTop: `1px solid ${C.border}`, paddingTop: 12, marginTop: 12 };
const inlineLink = { background: 'none', border: 'none', color: C.accent, fontFamily: F.sans, fontSize: 12, cursor: 'pointer', padding: 0, textDecoration: 'underline' };