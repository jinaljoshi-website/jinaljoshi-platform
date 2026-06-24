import { CALL_OPTIONS } from '../data';
import { C, F } from '../tokens';
import { WonderCoinAmount } from '../components/WonderCoin';

export default function Calls() {
  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={eyebrow}>Bookings</div>
        <h1 style={title}>Calls</h1>
        <p style={text}>
          This screen maps to the backend `call_requests` table, which the guide defines for audio and video call bookings with per-minute coin pricing.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
        {CALL_OPTIONS.map((option) => (
          <div key={option.id} style={card}>
            <div style={{ fontFamily: F.display, fontSize: 28, marginBottom: 10 }}>{option.title}</div>
            <div style={{ color: C.muted, marginBottom: 14 }}>{option.description}</div>
            <div style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
              <WonderCoinAmount amount={option.coinsPerMin} size={18} />
              <span style={{ color: C.muted }}>/ min</span>
            </div>
            <button style={button}>Request booking</button>
          </div>
        ))}
      </div>
    </div>
  );
}

const eyebrow = { fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 12 };
const title = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(28px, 5vw, 52px)', margin: '0 0 10px' };
const text = { fontFamily: F.sans, color: C.muted, fontSize: 15, lineHeight: 1.75, maxWidth: 720 };
const card = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 };
const button = { background: C.accent, color: '#1A1714', border: 'none', borderRadius: 8, padding: '10px 14px', cursor: 'pointer', fontWeight: 600 };