type Listener = (time: number) => void;
const listeners = new Set<Listener>();
export const playheadBus = {
  emit(time: number): void { listeners.forEach(fn => fn(time)); },
  on(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
