// studio/src/components/CallStage.jsx
// Full-screen 1:1 call stage. Replaces Stream's SpeakerLayout, which is built for
// group calls and pillarboxes portrait phone video badly on a two-person call.
import { useEffect, useRef, useState } from 'react';
import { ParticipantView, useCallStateHooks } from '@stream-io/video-react-sdk';
const SANS = "'DM Sans', system-ui, sans-serif";

const STYLE_ID = 'studio-call-stage-css';
const CSS = `
.studio-stage .str-video__participant-view { width: 100%; height: 100%; border-radius: 0; }
.studio-stage .str-video__participant-view video { width: 100% !important; height: 100% !important; object-fit: cover !important; }
.studio-pip .str-video__participant-view { border-radius: 12px; overflow: hidden; }
.studio-pip .str-video__participant-view video { object-fit: cover !important; }
.studio-stage .str-video__call-controls,
.studio-stage .str-video__participant-details { display: none !important; }
`;

const Icon = ({ d, off }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
    {off && <line x1="3" y1="3" x2="21" y2="21" />}
  </svg>
);
const MIC  = 'M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v1a7 7 0 0 1-14 0v-1M12 19v3';
const CAM  = 'M23 7l-7 5 7 5V7zM14 5H3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z';
const FLIP = 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15';
const END  = 'M18 6L6 18M6 6l12 12';

export default function CallStage({ timerNode, onLeave }) {
  const { useLocalParticipant, useRemoteParticipants, useMicrophoneState, useCameraState } = useCallStateHooks();
  const localParticipant   = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();
  const remote = remoteParticipants[0] || null;

  const { microphone, isMute: micMuted } = useMicrophoneState();
  const { camera,     isMute: camMuted } = useCameraState();

  const [selfLarge,    setSelfLarge]    = useState(false);
  const [showControls, setShowControls] = useState(true);
  const hideTimer = useRef(null);

  useEffect(() => {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
  }, []);

  // Controls fade out when nothing is happening, and come straight back on any
  // touch or movement. Longer first delay so a first-time caller sees them.
  useEffect(() => {
    const arm = (delay) => {
      clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setShowControls(false), delay);
    };
    arm(6000);
    const wake = () => { setShowControls(true); arm(3500); };
    window.addEventListener('pointerdown', wake);
    window.addEventListener('pointermove', wake);
    return () => {
      clearTimeout(hideTimer.current);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('pointermove', wake);
    };
  }, []);

  const big   = selfLarge ? localParticipant : (remote || localParticipant);
  const small = selfLarge ? remote : (remote ? localParticipant : null);
  const canSwap = !!remote && !!localParticipant;

  return (
    <div className="studio-stage" style={stage}>
      <div style={mainVideo}>
        {big
          ? <ParticipantView participant={big} ParticipantViewUI={null} />
          : <div style={placeholder}>Connecting…</div>}
      </div>

      {small && (
        <div
          className="studio-pip"
          onClick={() => canSwap && setSelfLarge((v) => !v)}
          title={canSwap ? 'Tap to swap' : undefined}
          style={{ ...pip, cursor: canSwap ? 'pointer' : 'default' }}
        >
          <ParticipantView participant={small} ParticipantViewUI={null} />
        </div>
      )}

      {timerNode && <div style={{ ...topPill, opacity: showControls ? 1 : 0.35 }}>{timerNode}</div>}

      {!remote && (
        <div style={waitingNote}>Waiting for the other person to join…</div>
      )}

      <div style={{ ...controlBar, opacity: showControls ? 1 : 0, pointerEvents: showControls ? 'auto' : 'none' }}>
        <button onClick={() => microphone.toggle()} style={{ ...ctrlBtn, ...(micMuted ? ctrlOff : {}) }} aria-label={micMuted ? 'Unmute' : 'Mute'}>
          <Icon d={MIC} off={micMuted} />
        </button>
        <button onClick={() => camera.toggle()} style={{ ...ctrlBtn, ...(camMuted ? ctrlOff : {}) }} aria-label={camMuted ? 'Turn camera on' : 'Turn camera off'}>
          <Icon d={CAM} off={camMuted} />
        </button>
        <button onClick={() => camera.flip()} style={ctrlBtn} aria-label="Flip camera">
          <Icon d={FLIP} />
        </button>
        <button onClick={onLeave} style={endBtn} aria-label="End call">
          <Icon d={END} />
        </button>
      </div>
    </div>
  );
}

const stage = {
  position: 'fixed', inset: 0, zIndex: 3000, background: '#000',
  overflow: 'hidden', touchAction: 'none',
};
const mainVideo   = { position: 'absolute', inset: 0 };
const placeholder = {
  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: 'rgba(255,255,255,0.6)', fontFamily: SANS, fontSize: 15,
};
const pip = {
  position: 'absolute', right: 16, bottom: 108, width: 108, height: 152,
  borderRadius: 12, overflow: 'hidden', background: '#111',
  border: '1.5px solid rgba(255,255,255,0.22)', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  transition: 'transform 0.15s', zIndex: 3002,
};
const topPill = {
  position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 14px)', left: '50%',
  transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)',
  borderRadius: 999, padding: '6px 14px', zIndex: 3002, transition: 'opacity 0.25s',
};
const waitingNote = {
  position: 'absolute', top: '50%', left: 0, right: 0, transform: 'translateY(40px)',
  textAlign: 'center', color: 'rgba(255,255,255,0.75)', fontFamily: SANS, fontSize: 14, zIndex: 3001,
};
const controlBar = {
  position: 'absolute', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 22px)', left: 0, right: 0,
  display: 'flex', justifyContent: 'center', gap: 14, zIndex: 3003, transition: 'opacity 0.25s',
};
const ctrlBtn = {
  width: 52, height: 52, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.18)',
  background: 'rgba(255,255,255,0.14)', backdropFilter: 'blur(10px)', color: '#fff',
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0,
};
const ctrlOff = { background: 'rgba(255,255,255,0.9)', color: '#111' };
const endBtn = {
  width: 52, height: 52, borderRadius: '50%', border: 'none',
  background: '#D64545', color: '#fff',
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0,
};