// Tiny WebAudio blips — no audio files. Browsers only allow audio after a user gesture,
// so the context is created lazily and resumed on the first pointer/key interaction.

export type BlipKind = "new" | "info" | "warn" | "danger" | "success";

type AudioCtor = typeof AudioContext;

let ctx: AudioContext | null = null;
let unlockWired = false;
let lastAt = 0;

function getCtor(): AudioCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext;
}

function ensureCtx(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = getCtor();
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Call once at app start; resumes the audio context on the first user gesture. */
export function wireAudioUnlock(): void {
  if (unlockWired || typeof window === "undefined") return;
  unlockWired = true;
  const unlock = () => {
    const c = ensureCtx();
    if (c && c.state === "suspended") void c.resume().catch(() => undefined);
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

const TONES: Record<BlipKind, { freqs: number[]; type: OscillatorType; dur: number; gain: number }> = {
  new: { freqs: [880, 1320], type: "sine", dur: 0.07, gain: 0.05 },
  info: { freqs: [660, 990], type: "sine", dur: 0.08, gain: 0.05 },
  success: { freqs: [784, 1046, 1568], type: "triangle", dur: 0.07, gain: 0.05 },
  warn: { freqs: [520, 440], type: "triangle", dur: 0.1, gain: 0.06 },
  danger: { freqs: [330, 220, 330], type: "square", dur: 0.09, gain: 0.035 },
};

/** Plays a short blip. Throttled to avoid a wall of noise when a feed bursts. */
export function playBlip(kind: BlipKind = "info", minGapMs = 250): void {
  const now = Date.now();
  if (now - lastAt < minGapMs) return;
  lastAt = now;
  const c = ensureCtx();
  if (!c) return;
  if (c.state === "suspended") {
    void c.resume().catch(() => undefined);
  }
  const tone = TONES[kind];
  try {
    let t = c.currentTime + 0.005;
    for (const f of tone.freqs) {
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = tone.type;
      osc.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(tone.gain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + tone.dur);
      osc.connect(g);
      g.connect(c.destination);
      osc.start(t);
      osc.stop(t + tone.dur + 0.02);
      t += tone.dur * 0.85;
    }
  } catch {
    /* audio is best-effort */
  }
}
