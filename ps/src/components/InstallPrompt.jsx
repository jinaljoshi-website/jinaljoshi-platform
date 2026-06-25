// ps/src/components/InstallPrompt.jsx
// Shows a floating "Add to home screen" banner after login
// Remembers dismissal in sessionStorage

import { useEffect, useState } from 'react';
import { C, F } from '../tokens';
import { WonderCoin } from './WonderCoin';

export default function InstallPrompt() {
  const [show,      setShow]      = useState(false);
  const [deferredPrompt, setDeferred] = useState(null);
  const [isIOS,     setIsIOS]     = useState(false);
  const [expanded,  setExpanded]  = useState(false);

  useEffect(() => {
    // Don't show if already dismissed this session
    if (sessionStorage.getItem('install_dismissed')) return;

    // Detect iOS
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
    setIsIOS(ios);

    // Already installed
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    if (ios) {
      // iOS doesn't fire beforeinstallprompt — show manual instructions
      setTimeout(() => setShow(true), 3000);
    } else {
      // Android / Chrome
      const handler = (e) => {
        e.preventDefault();
        setDeferred(e);
        setTimeout(() => setShow(true), 3000);
      };
      window.addEventListener('beforeinstallprompt', handler);
      return () => window.removeEventListener('beforeinstallprompt', handler);
    }
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') dismiss();
    } else {
      setExpanded(true);
    }
  };

  const dismiss = () => {
    sessionStorage.setItem('install_dismissed', '1');
    setShow(false);
  };

  if (!show) return null;

  return (
    <div style={banner}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
        <WonderCoin size={32} />
        <div>
          <div style={{ fontFamily: F.display, fontSize: 16, color: C.text, marginBottom: 2 }}>
            Add Personal Space to your home screen
          </div>
          {expanded && isIOS ? (
            <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
              Tap the <strong style={{ color: C.text }}>Share</strong> button at the bottom of Safari,
              then tap <strong style={{ color: C.text }}>"Add to Home Screen"</strong>
            </div>
          ) : (
            <div style={{ fontFamily: F.sans, fontSize: 12, color: C.muted }}>
              {deferredPrompt ? 'Install the app for the best experience' : 'Open in your browser and save to home screen'}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        {!expanded && (
          <button onClick={handleInstall} style={installBtn}>
            {deferredPrompt ? 'Install' : 'How?'}
          </button>
        )}
        <button onClick={dismiss} style={dismissBtn}>✕</button>
      </div>
    </div>
  );
}

const banner = {
  position:     'fixed',
  bottom:       24,
  left:         '50%',
  transform:    'translateX(-50%)',
  width:        'calc(100% - 32px)',
  maxWidth:     520,
  background:   '#1E1B17',
  border:       '1px solid rgba(193,125,74,0.3)',
  borderRadius: 12,
  padding:      '14px 16px',
  display:      'flex',
  alignItems:   'center',
  gap:          12,
  zIndex:       1000,
  boxShadow:    '0 8px 32px rgba(0,0,0,0.4)',
  backdropFilter: 'blur(12px)',
};

const installBtn = {
  background:   '#C17D4A',
  border:       'none',
  color:        '#1A1714',
  fontFamily:   "'DM Sans', system-ui, sans-serif",
  fontSize:     13,
  fontWeight:   700,
  padding:      '8px 14px',
  borderRadius: 8,
  cursor:       'pointer',
  whiteSpace:   'nowrap',
};

const dismissBtn = {
  background:   'transparent',
  border:       '1px solid rgba(242,235,224,0.1)',
  color:        '#9B8F83',
  fontFamily:   "'DM Sans', system-ui, sans-serif",
  fontSize:     14,
  padding:      '6px 10px',
  borderRadius: 8,
  cursor:       'pointer',
};