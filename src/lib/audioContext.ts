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

// Call this from a user-gesture handler (button click) to create and unlock the AudioContext.
// ensureContext() is called here so _ctx is guaranteed to exist when connectAudioElement runs later.
export function resumeContext(): void {
  const ctx = ensureContext();
  if (ctx.state !== "running") ctx.resume().catch(() => {});
}

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
