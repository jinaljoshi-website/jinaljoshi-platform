// ps/src/pages/Contact.jsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { C, F } from '../tokens';
import { WonderCoin } from '../components/WonderCoin';

const API = import.meta.env.VITE_API_URL;
const DEFAULT_ADDRESS = 'Jinal Joshi, A-14/103, Broadway Avenue Society, Jay Gopal Lal Road, Nr Jangid Circle, Mira Road East, Mira Bhayandar, Thane, Maharashtra - 401107';

export default function Contact() {
  const navigate = useNavigate();
  const [address, setAddress] = useState(DEFAULT_ADDRESS);

  useEffect(() => {
    fetch(`${API}/api/public/config`)
      .then((r) => r.json())
      .then((data) => {
        const c = data.config || {};
        if (c.legal_registered_address) setAddress(c.legal_registered_address);
      })
      .catch(() => {});
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text }}>
      <div style={topBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <WonderCoin size={20} />
          <span style={{ fontFamily: F.display, fontSize: 18, color: C.text, cursor: 'pointer' }} onClick={() => navigate('/')}>Personal Space</span>
        </div>
        <button onClick={() => navigate(-1)} style={backBtn}>← Back</button>
      </div>
      <div style={page}>
        <div style={header}>
          <div style={eyebrow}>Get in touch</div>
          <h1 style={title}>Contact & Support</h1>
          <p style={subtitle}>We're here to help. Every message is read and responded to personally.</p>
        </div>

        <div style={cardsGrid}>
          <div style={contactCard}>
            <div style={cardIcon}>✉️</div>
            <div style={cardTitle}>General support</div>
            <div style={cardDesc}>For questions about your account, token balance, membership, or anything else on the platform.</div>
            <a href="mailto:support@jinaljoshi.in" style={emailLink}>support@jinaljoshi.in</a>
            <a href="tel:+918689888658" style={emailLink}>+91 86898 88658</a>
            <div style={responseTime}>Response within 2 business days</div>
          </div>

          <div style={contactCard}>
            <div style={cardIcon}>🔒</div>
            <div style={cardTitle}>Payment & billing</div>
            <div style={cardDesc}>For issues with token purchases, payment failures, or transaction queries.</div>
            <a href="mailto:billing@jinaljoshi.in" style={emailLink}>billing@jinaljoshi.in</a>
            <a href="tel:+918689888658" style={emailLink}>+91 86898 88658</a>
            <div style={responseTime}>Response within 2 business days</div>
          </div>

          <div style={contactCard}>
            <div style={cardIcon}>⚖️</div>
            <div style={cardTitle}>Grievance officer</div>
            <div style={cardDesc}>Jinal Joshi, Grievance Officer under the IT (Intermediary Guidelines) Rules, 2021. For formal grievances or consumer protection matters.</div>
            <a href="mailto:grievance@jinaljoshi.in" style={emailLink}>grievance@jinaljoshi.in</a>
            <a href="tel:+918689888658" style={emailLink}>+91 86898 88658</a>
            <div style={responseTime}>Acknowledged within 24 hours · resolved within 15 days</div>
          </div>
        </div>

        <div style={infoBox}>
          <div style={infoTitle}>Platform information</div>
          <div style={infoGrid}>
            <div style={infoRow}>
              <span style={infoLabel}>Platform name</span>
              <span style={infoVal}>Personal Space</span>
            </div>
            <div style={infoRow}>
              <span style={infoLabel}>Website</span>
              <span style={infoVal}>ps.jinaljoshi.in</span>
            </div>
            <div style={infoRow}>
              <span style={infoLabel}>Operated by</span>
              <span style={infoVal}>Jinal Joshi</span>
            </div>
            <div style={infoRow}>
              <span style={infoLabel}>Support email</span>
              <span style={infoVal}><a href="mailto:support@jinaljoshi.in" style={link}>support@jinaljoshi.in</a></span>
            </div>
            <div style={infoRow}>
              <span style={infoLabel}>Telephone</span>
              <span style={infoVal}><a href="tel:+918689888658" style={link}>+91 86898 88658</a></span>
            </div>
            <div style={infoRow}>
              <span style={infoLabel}>Grievance Officer</span>
              <span style={infoVal}>Jinal Joshi</span>
            </div>
            <div style={infoRow}>
              <span style={infoLabel}>Regd. Office:</span>
              <span style={{ ...infoVal, textAlign: 'right' }}>{address}</span>
            </div>
            <div style={infoRow}>
              <span style={infoLabel}>Payment processor</span>
              <span style={{ ...infoVal, textAlign: 'right' }}>Razorpay · card and UPI details are never stored on our servers</span>
            </div>
          </div>
        </div>

        <div style={noteBox}>
          <div style={{ fontFamily: F.sans, fontSize: 14, color: '#9B8F83', lineHeight: 1.8 }}>
            <strong style={{ color: C.text }}>A note from Jinal</strong><br />
            Personal Space is run and managed by me personally — not by a team, not by an agency. When you write to support, your message reaches me or someone I trust directly. I take every concern seriously and will always try to make things right where I can. Thank you for being here.
          </div>
        </div>

        <div style={footerNote}>Personal Space · ps.jinaljoshi.in · Personally operated by Jinal Joshi</div>
      </div>
    </div>
  );
}

const topBar     = { position: 'sticky', top: 0, zIndex: 50, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 28px', background: 'rgba(13,12,10,0.94)', borderBottom: `1px solid rgba(242,235,224,0.08)`, backdropFilter: 'blur(12px)' };
const backBtn    = { background: 'transparent', border: `1px solid rgba(242,235,224,0.08)`, color: '#9B8F83', fontFamily: F.sans, fontSize: 13, padding: '8px 14px', borderRadius: 8, cursor: 'pointer' };
const page       = { maxWidth: 900, margin: '0 auto', padding: '48px 24px 80px' };
const header     = { marginBottom: 48, paddingBottom: 32, borderBottom: `1px solid rgba(242,235,224,0.08)` };
const eyebrow    = { fontFamily: F.mono, fontSize: 11, color: C.accent, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 12 };
const title      = { fontFamily: F.display, fontWeight: 300, fontSize: 'clamp(36px,5vw,56px)', color: C.text, margin: '0 0 16px' };
const subtitle   = { fontFamily: F.sans, fontSize: 16, color: '#9B8F83', lineHeight: 1.7, margin: 0 };
const cardsGrid  = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 32 };
const contactCard = { background: '#161410', border: `1px solid rgba(242,235,224,0.08)`, borderRadius: 10, padding: 24, display: 'flex', flexDirection: 'column', gap: 8 };
const cardIcon   = { fontSize: 28, marginBottom: 4 };
const cardTitle  = { fontFamily: F.display, fontSize: 20, color: C.text };
const cardDesc   = { fontFamily: F.sans, fontSize: 13, color: '#9B8F83', lineHeight: 1.7, flexGrow: 1 };
const emailLink  = { color: C.accent, fontFamily: F.sans, fontSize: 14, textDecoration: 'none', fontWeight: 600 };
const responseTime = { fontFamily: F.mono, fontSize: 10, color: '#6B6560', letterSpacing: '0.06em' };
const infoBox    = { background: '#161410', border: `1px solid rgba(242,235,224,0.08)`, borderRadius: 10, padding: 28, marginBottom: 20 };
const infoTitle  = { fontFamily: F.display, fontSize: 22, color: C.text, marginBottom: 20 };
const infoGrid   = { display: 'flex', flexDirection: 'column', gap: 0 };
const infoRow    = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: `1px solid rgba(242,235,224,0.06)`, flexWrap: 'wrap', gap: 8 };
const infoLabel  = { fontFamily: F.sans, fontSize: 13, color: '#9B8F83' };
const infoVal    = { fontFamily: F.sans, fontSize: 13, color: C.text };
const link       = { color: C.accent, textDecoration: 'none' };
const noteBox    = { background: 'rgba(193,125,74,0.06)', border: `1px solid rgba(193,125,74,0.2)`, borderRadius: 10, padding: 24, marginBottom: 32 };
const footerNote = { fontFamily: F.mono, fontSize: 11, color: '#6B6560', letterSpacing: '0.08em', textAlign: 'center', marginTop: 48 };