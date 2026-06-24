import { C, F } from '../tokens';

export default function Chat() {
  return (
    <Page
      eyebrow="Direct messages"
      title="Chat with Jinal"
      text="This is the private messaging area. Stream chat wiring can be added later; for now this page gives you the correct signed-in screen structure."
    >
      <div style={panel}>
        <div style={{ fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 10 }}>
          Chat status
        </div>
        <div style={{ fontSize: 15, color: C.text, marginBottom: 8 }}>
          Your private conversation area will appear here.
        </div>
        <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.7 }}>
          Member-specific chat pricing, media permissions, and background settings can be connected once the backend artist controls are ready.
        </div>
      </div>
    </Page>
  );
}

function Page({ eyebrow, title, text, children }) {
  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 12 }}>
          {eyebrow}
        </div>
        <h1 style={{ fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(28px, 5vw, 52px)', margin: '0 0 10px' }}>
          {title}
        </h1>
        <p style={{ fontFamily: F.sans, color: C.muted, fontSize: 15, lineHeight: 1.75, maxWidth: 720 }}>
          {text}
        </p>
      </div>
      {children}
    </div>
  );
}

const panel = {
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  padding: 22,
};