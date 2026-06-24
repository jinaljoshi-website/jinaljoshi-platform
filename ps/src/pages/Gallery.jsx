import { GALLERY_SETS } from '../data';
import { C, F } from '../tokens';
import { WonderCoinAmount } from '../components/WonderCoin';

export default function Gallery() {
  return (
    <div>
      <Header
        eyebrow="Exclusive content"
        title="Gallery"
        text="Members can unlock photo sets, videos, and albums here. The guide’s database includes sets, set_items, and access_grants for this content model."
      />

      <div style={grid}>
        {GALLERY_SETS.map((item) => (
          <div key={item.id} style={card}>
            <div style={tag}>{item.type}</div>
            <div style={{ fontFamily: F.display, fontSize: 28, marginBottom: 8 }}>{item.title}</div>
            <div style={{ fontSize: 14, color: C.muted, marginBottom: 18 }}>
              Access mode: {item.mode}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <WonderCoinAmount amount={item.price_coins} size={18} />
              <button style={button}>Unlock</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Header({ eyebrow, title, text }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={eyebrowStyle}>{eyebrow}</div>
      <h1 style={titleStyle}>{title}</h1>
      <p style={textStyle}>{text}</p>
    </div>
  );
}

const eyebrowStyle = { fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 12 };
const titleStyle = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(28px, 5vw, 52px)', margin: '0 0 10px' };
const textStyle = { fontFamily: F.sans, color: C.muted, fontSize: 15, lineHeight: 1.75, maxWidth: 720 };
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 18 };
const card = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 };
const tag = { display: 'inline-block', border: `1px solid ${C.border}`, color: C.accent, fontSize: 12, padding: '4px 8px', borderRadius: 999, marginBottom: 16 };
const button = { background: C.accent, color: '#1A1714', border: 'none', borderRadius: 8, padding: '10px 14px', cursor: 'pointer', fontWeight: 600 };