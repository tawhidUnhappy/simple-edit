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

// Call from a user-gesture handler to create & unlock the AudioContext.
export function resumeContext(): void {
  try {
    const ctx = ensureContext();
    if (ctx.state !== "running") ctx.resume().catch(() => {});
  } catch {}
}

// Defers cb until AudioContext is running.
// If no context yet, or already running, calls cb immediately.
// Falls back to calling cb even if resume fails (so audio still plays directly).
export function whenContextRunning(cb: () => void): void {
  if (!_ctx || _ctx.state === "running") { cb(); return; }
  _ctx.resume().then(cb).catch(cb);
}

// Returns true if the element is now routed through the shared AudioContext+AnalyserNode.
// Returns false if createMediaElementSource threw (CORS or unsupported) — element plays directly.
// Safe to call multiple times; only connects once per element.
export function connectAudioElement(el: HTMLAudioElement): boolean {
  if (_connected.has(el)) return true;
  try {
    const ctx = ensureContext();
    const source = ctx.createMediaElementSource(el);
    source.connect(_analyser!);
    _connected.add(el);
    return true;
  } catch {
    return false; // element not captured — plays directly to system audio
  }
}
