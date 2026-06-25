// studio/src/pages/Login.jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, saveAuth } from '../api';

const bg      = '#0D0C0A';
const surface = '#161410';
const text    = '#F2EBE0';
const muted   = '#9B8F83';
const accent  = '#C17D4A';
const border  = 'rgba(242,235,224,0.08)';
const sans    = "'DM Sans', system-ui, sans-serif";
const display = "'Cormorant Garamond', Georgia, serif";

export default function Login() {
  const navigate  = useNavigate();
  const [email,   setEmail]   = useState('');
  const [pass,    setPass]    = useState('');
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setError(''); setLoading(true);
    try {
      const data = await api.post('/api/auth/login', { email, password: pass });
      if (!data.user?.isArtist) {
        setError('This console is for Jinal only.');
        return;
      }
      saveAuth(data.jwt, data.user);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 400, background: surface, border: `1px solid ${border}`, borderRadius: 12, padding: 36 }}>
        <div style={{ fontFamily: display, fontSize: 28, color: text, marginBottom: 6 }}>Studio</div>
        <div style={{ fontFamily: sans, fontSize: 13, color: muted, marginBottom: 28 }}>Jinal Joshi · Personal Space console</div>

        <label style={labelStyle}>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={inputStyle}
          placeholder="your@email.com"
        />

        <label style={labelStyle}>Password</label>
        <input
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
          style={inputStyle}
          placeholder="••••••••"
        />

        {error && <div style={errorStyle}>{error}</div>}

        <button
          onClick={handleLogin}
          disabled={loading}
          style={{ ...btnStyle, opacity: loading ? 0.6 : 1 }}
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
    </div>
  );
}

const labelStyle = { fontFamily: sans, fontSize: 12, color: muted, display: 'block', marginBottom: 6 };
const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  background: '#100F0C', border: `1px solid ${border}`,
  color: text, padding: '11px 14px', borderRadius: 8,
  fontFamily: sans, fontSize: 14, outline: 'none', marginBottom: 16,
};
const errorStyle = {
  background: 'rgba(156,90,90,0.12)', border: '1px solid rgba(156,90,90,0.35)',
  color: '#D99A9A', padding: 10, borderRadius: 8, marginBottom: 14,
  fontFamily: sans, fontSize: 13,
};
const btnStyle = {
  background: accent, border: 'none', color: '#1A1714',
  fontFamily: sans, fontSize: 14, fontWeight: 700,
  padding: '12px 0', borderRadius: 8, width: '100%', cursor: 'pointer',
};