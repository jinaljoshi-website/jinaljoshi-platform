import { useNavigate } from 'react-router-dom';
import { C, F } from '../tokens';

export default function GuestNudge({ message, compact = false }) {
  const navigate = useNavigate();

  if (compact) {
    return (
      <button onClick={() => navigate('/platform/membership')} style={compactStyle}>
        <span>{message || 'Members pay less on this'}</span>
        <span style={{ color: C.accent, fontWeight: 700 }}>See membership options →</span>
      </button>
    );
  }

  return (
    <button onClick={() => navigate('/platform/membership')} style={bannerStyle}>
      <div style={{ fontFamily: F.sans, fontSize: 13, color: C.text, lineHeight: 1.5 }}>
        {message || "You're browsing as a guest — members get better rates on everything."}
      </div>
      <div style={{ fontFamily: F.sans, fontSize: 12, color: C.accent, fontWeight: 700, whiteSpace: 'nowrap', marginLeft: 12 }}>
        See membership options →
      </div>
    </button>
  );
}

const bannerStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
  width: '100%', boxSizing: 'border-box', textAlign: 'left', cursor: 'pointer',
  background: 'rgba(193,125,74,0.06)', border: `1px solid rgba(193,125,74,0.2)`,
  borderRadius: 8, padding: '10px 14px', marginBottom: 12,
};

const compactStyle = {
  display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'left', cursor: 'pointer',
  background: 'transparent', border: 'none', padding: 0, fontFamily: F.sans, fontSize: 11, color: C.muted,
};