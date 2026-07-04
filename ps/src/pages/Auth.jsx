// ps/src/pages/Auth.jsx
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { C, F } from '../tokens';
import { api, saveAuth, saveStreamToken } from '../api';

export default function Auth() {
  const navigate  = useNavigate();
  const [params]  = useSearchParams();

  const [mode,        setMode]       = useState(params.get('mode') || 'login');
  const [email,       setEmail]      = useState('');
  const [password,    setPass]       = useState('');
  const [displayName, setName]       = useState('');
  const [dob,         setDob]        = useState('');
  const [consent1,    setConsent1]   = useState(false);
  const [consent2,    setConsent2]   = useState(false);
  const [error,       setError]      = useState('');
  const [notice,      setNotice]     = useState('');
  const [loading,     setLoading]    = useState(false);

  useEffect(() => {
    setMode(params.get('mode') || 'login');
    const n = params.get('notice');
    if (n) setNotice(decodeURIComponent(n));
  }, [params]);

  const handleSubmit = async () => {
    setError('');
    setNotice('');

    if (!email || !password || (mode === 'signup' && !dob)) {
      setError('Please fill in all required fields.');
      return;
    }

    if (mode === 'signup' && (!consent1 || !consent2)) {
      setError('Please accept both agreements to create your account.');
      return;
    }

    setLoading(true);
    try {
      let data;
      if (mode === 'signup') {
        data = await api.post('/api/auth/signup', {
          email, password, dob,
          displayName:     displayName.trim() || null,
          consentTerms:    consent1,
          consentNoRefund: consent2,
        });
      } else {
        data = await api.post('/api/auth/login', { email, password });
      }

      saveAuth(data.jwt, data.user);
      if (data.streamToken) saveStreamToken(data.streamToken);
      navigate('/platform/landing');
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={wrap}>
      <div style={card}>
        <button onClick={() => navigate('/')} style={backBtn}>← Back</button>

        <div style={{ fontFamily: F.display, fontSize: 34, color: C.text, marginBottom: 8 }}>
          {mode === 'signup' ? 'Join Personal Space' : 'Welcome back'}
        </div>
        <div style={{ fontFamily: F.sans, fontSize: 14, color: C.muted, marginBottom: 26 }}>
          {mode === 'signup'
            ? "Create your account to join Jinal's space."
            : 'Sign in to continue to your member space.'}
        </div>

        {notice && (
          <div style={noticeBox}>
            <span style={{ marginRight: 8 }}>ℹ️</span>{notice}
          </div>
        )}

        <Field label="Email address">
          <input style={inputStyle} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </Field>

        <Field label="Password">
          <input style={inputStyle} type="password" value={password} onChange={(e) => setPass(e.target.value)} placeholder="8 characters minimum" />
        </Field>

        {mode === 'signup' && (
          <>
            <Field label="Your name (optional — shown in community)">
              <input style={inputStyle} type="text" value={displayName} onChange={(e) => setName(e.target.value)} placeholder="What should we call you?" />
            </Field>

            <Field label="Date of birth">
              <input style={inputStyle} type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
              <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
                You must be 18 or older to join. Used for your daily horoscope — you can update this later.
              </div>
            </Field>

            <div style={consentBox}>
              <label style={consentLabel}>
                <input type="checkbox" checked={consent1} onChange={(e) => setConsent1(e.target.checked)} style={{ marginRight: 10, marginTop: 2, flexShrink: 0 }} />
                <span>
                  I have read and agree to the{' '}
                  <a href="/terms" target="_blank" rel="noopener noreferrer" style={termsLink}>Terms of Use</a>.
                  This is a voluntary registration on an independent platform run and managed personally by Jinal Joshi.
                </span>
              </label>

              <label style={{ ...consentLabel, marginTop: 14 }}>
                <input type="checkbox" checked={consent2} onChange={(e) => setConsent2(e.target.checked)} style={{ marginRight: 10, marginTop: 2, flexShrink: 0 }} />
                <span>
                  I understand that all J Token purchases are <strong style={{ color: C.text }}>final and non-refundable</strong>. Tokens cannot be redeemed for cash. In case of a technical issue, token credits may be issued by support.
                </span>
              </label>
            </div>
          </>
        )}

        {error && <div style={errorBox}>{error}</div>}

        <button
          onClick={handleSubmit}
          disabled={loading || (mode === 'signup' && (!consent1 || !consent2))}
          style={{ ...submitBtn, opacity: (loading || (mode === 'signup' && (!consent1 || !consent2))) ? 0.6 : 1, cursor: (loading || (mode === 'signup' && (!consent1 || !consent2))) ? 'default' : 'pointer' }}
        >
          {loading ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
        </button>

        {mode === 'signup' && (
          <p style={legalText}>By creating an account you confirm that you are 18 or older.</p>
        )}

        <div style={{ marginTop: 22, textAlign: 'center' }}>
          {mode === 'login' ? (
            <>
              <button onClick={() => setMode('signup')} style={linkBtn}>Create account</button>
              <span style={{ color: C.muted, fontSize: 12 }}> • </span>
              <button onClick={() => setError('Password reset is available after verifying your phone number.')} style={linkBtn}>
                Forgot password?
              </button>
            </>
          ) : (
            <button onClick={() => setMode('login')} style={linkBtn}>
              Already have an account? Sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={labelStyle}>{label}</div>
      {children}
    </div>
  );
}

const wrap         = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: C.bg };
const card         = { width: '100%', maxWidth: 460, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 34, boxSizing: 'border-box' };
const backBtn      = { background: 'transparent', border: 'none', color: C.muted, marginBottom: 22, cursor: 'pointer', padding: 0, fontFamily: F.sans };
const labelStyle   = { fontFamily: F.sans, fontSize: 13, color: C.muted, marginBottom: 8 };
const inputStyle   = { width: '100%', boxSizing: 'border-box', background: '#100F0C', border: `1px solid ${C.border}`, color: C.text, padding: '12px 14px', borderRadius: 8, outline: 'none', fontFamily: F.sans, fontSize: 15 };
const submitBtn    = { background: C.accent, border: 'none', color: '#1A1714', fontWeight: 700, padding: '13px 18px', borderRadius: 8, width: '100%', fontSize: 15, fontFamily: F.sans };
const errorBox     = { background: 'rgba(156,90,90,0.15)', border: '1px solid rgba(156,90,90,0.45)', color: '#D99A9A', padding: 12, borderRadius: 8, marginBottom: 18, fontSize: 14, fontFamily: F.sans };
const noticeBox    = { background: 'rgba(193,125,74,0.08)', border: `1px solid rgba(193,125,74,0.25)`, color: '#C17D4A', padding: 12, borderRadius: 8, marginBottom: 18, fontSize: 14, fontFamily: F.sans, lineHeight: 1.6 };
const legalText    = { fontFamily: F.sans, fontSize: 11, color: C.muted, marginTop: 12, textAlign: 'center', lineHeight: 1.6 };
const linkBtn      = { background: 'transparent', border: 'none', color: C.accent, cursor: 'pointer', fontFamily: F.sans, fontSize: 13, padding: 0 };
const consentBox   = { background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, marginBottom: 20 };
const consentLabel = { display: 'flex', alignItems: 'flex-start', fontFamily: F.sans, fontSize: 13, color: C.muted, lineHeight: 1.65, cursor: 'pointer' };
const termsLink    = { color: C.accent, textDecoration: 'none' };