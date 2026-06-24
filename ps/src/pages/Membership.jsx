import { TERMS, TIERS, termPrice } from '../data';
import { C, F } from '../tokens';

export default function Membership() {
  const tiers = Object.values(TIERS).filter((t) => t.id !== 'none');
  const terms = TERMS;

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <div style={eyebrow}>Membership</div>
        <h1 style={title}>Choose your tier</h1>
        <p style={text}>
          The homepage and this screen both depend on shared tier and term data so prices stay consistent throughout the PS app.
        </p>
      </div>

      <div style={{ display: 'grid', gap: 18 }}>
        {tiers.map((tier) => (
          <div key={tier.id} style={card}>
            <div style={{ fontFamily: F.display, fontSize: 30, marginBottom: 8 }}>{tier.name}</div>
            <div style={{ color: C.muted, marginBottom: 16 }}>{tier.description}</div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: 12,
                marginBottom: 18,
              }}
            >
              {terms.map((term) => (
                <div key={term.id} style={termCard}>
                  <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>{term.label}</div>
                  <div style={{ fontSize: 18, color: C.text }}>₹{termPrice(tier, term)}</div>
                </div>
              ))}
            </div>

            <ul style={{ margin: 0, paddingLeft: 18, color: C.muted, lineHeight: 1.8 }}>
              {tier.perks.map((perk) => (
                <li key={perk}>{perk}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

const eyebrow = {
  fontFamily: F.mono,
  fontSize: 11,
  color: C.accent,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  marginBottom: 12,
};

const title = {
  fontFamily: F.display,
  fontWeight: 300,
  fontSize: 'clamp(28px, 5vw, 52px)',
  margin: '0 0 10px',
};

const text = {
  fontFamily: F.sans,
  color: C.muted,
  fontSize: 15,
  lineHeight: 1.75,
  maxWidth: 720,
};

const card = {
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  padding: 22,
};

const termCard = {
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  padding: 14,
  background: 'rgba(255,255,255,0.02)',
};