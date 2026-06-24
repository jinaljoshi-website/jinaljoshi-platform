import { SHOP_ITEMS } from '../data';
import { C, F } from '../tokens';
import { WonderCoinAmount } from '../components/WonderCoin';

export default function Shop() {
  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={eyebrow}>Merchandise</div>
        <h1 style={title}>Shop</h1>
        <p style={text}>
          The backend schema includes `merchandise` and `orders`, and this page is the matching storefront for those coin-based purchases.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
        {SHOP_ITEMS.map((item) => (
          <div key={item.id} style={card}>
            <div style={{ fontFamily: F.display, fontSize: 28, marginBottom: 10 }}>{item.title}</div>
            <div style={{ color: C.muted, marginBottom: 12 }}>Remaining stock: {item.remaining}</div>
            <div style={{ marginBottom: 18 }}>
              <WonderCoinAmount amount={item.price_coins} size={18} />
            </div>
            <button style={button}>Buy now</button>
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