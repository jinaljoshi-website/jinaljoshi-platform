import { EXTRA_OPTIONS } from '../data';
import { C, F } from '../tokens';
import { WonderCoinAmount } from '../components/WonderCoin';

export default function Extras() {
  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={eyebrow}>Custom requests</div>
        <h1 style={title}>Extras</h1>
        <p style={text}>
          The guide’s schema includes `custom_requests` for things like shoutouts and greetings, so this page gives those requests a front-end home.
        </p>
      </div>

      <div style={{ display: 'grid', gap: 16 }}>
        {EXTRA_OPTIONS.map((item) => (
          <div key={item.id} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center' }}>
              <div>
                <div style={{ fontFamily: F.display, fontSize: 28, marginBottom: 6 }}>{item.title}</div>
                <div style={{ color: C.muted }}>{item.description}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ marginBottom: 10 }}>
                  <WonderCoinAmount amount={item.price} size={18} />
                </div>
                <button style={button}>Request</button>
              </div>
            </div>
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