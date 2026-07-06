// studio/src/lib/ringtone.js
// Synthesizes a simple two-tone ringtone pattern using the Web Audio API — no audio file needed

let audioCtx = null;
let ringInterval = null;
let isRinging = false;

function playTone(ctx, freq, startTime, duration) {
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, startTime);
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(0.25, startTime + 0.02);
  gain.gain.linearRampToValueAtTime(0, startTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

function playRingCycle(ctx) {
  const now = ctx.currentTime;
  playTone(ctx, 480, now,        0.4);
  playTone(ctx, 440, now,        0.4);
  playTone(ctx, 480, now + 0.5,  0.4);
  playTone(ctx, 440, now + 0.5,  0.4);
}

export function startRingtone() {
  if (isRinging) return;
  isRinging = true;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    playRingCycle(audioCtx);
    ringInterval = setInterval(() => {
      if (audioCtx) playRingCycle(audioCtx);
    }, 2000);
  } catch (err) {
    console.error('Ringtone failed to start:', err);
  }
}

export function stopRingtone() {
  isRinging = false;
  if (ringInterval) clearInterval(ringInterval);
  ringInterval = null;
  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }
}