let _ctx: AudioContext | null = null;
let _analyser: AnalyserNode | null = null;
const _connected = new WeakSet<HTMLAudioElement>();

function ensureContext(): AudioContext {
  if (!_ctx) {
    _ctx = new AudioContext();
    _analyser = _ctx.createAnalyser();
    _analyser.fftSize = 256;
    _analyser.smoothingTimeConstant = 0.8;
    _analyser.connect(_ctx.destination);
  }
  return _ctx;
}

export function getAnalyser(): AnalyserNode | null {
  return _analyser;
}

export function resumeContext(): void {
  if (_ctx?.state === "suspended") _ctx.resume().catch(() => {});
}

// Must be called from user-gesture context or after resumeContext() has been called.
// Safe to call multiple times per element — only connects once.
export function connectAudioElement(el: HTMLAudioElement): void {
  if (_connected.has(el)) return;
  try {
    const ctx = ensureContext();
    const source = ctx.createMediaElementSource(el);
    source.connect(_analyser!);
    _connected.add(el);
  } catch {}
}
