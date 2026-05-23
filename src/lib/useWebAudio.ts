import { useEffect, useRef, useCallback } from "react";
import { Clip } from "../store/timelineStore";

// Each playing clip gets a source node + gain node pair.
// AudioBufferSourceNode can only play once, so we recreate on each play.
interface ActiveNode { source: AudioBufferSourceNode; gain: GainNode; startedAt: number; offset: number; }

export function useWebAudio(
  clips: Clip[],
  mediaServerPort: number,
  getTrackMuted: (trackId: string) => boolean,
) {
  const ctxRef = useRef<AudioContext | null>(null);
  const buffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const activeNodesRef = useRef<Map<string, ActiveNode>>(new Map());
  const loadingRef = useRef<Set<string>>(new Set());

  // Lazily create AudioContext (must be after a user gesture on some browsers)
  const getCtx = useCallback((): AudioContext => {
    if (!ctxRef.current || ctxRef.current.state === "closed") {
      ctxRef.current = new AudioContext();
    }
    return ctxRef.current;
  }, []);

  // Preload / decode audio for all provided clips
  useEffect(() => {
    if (mediaServerPort <= 0) return;
    clips.forEach((clip) => {
      if (buffersRef.current.has(clip.id) || loadingRef.current.has(clip.id)) return;
      loadingRef.current.add(clip.id);
      const url = `http://127.0.0.1:${mediaServerPort}/file?path=${encodeURIComponent(clip.filePath)}`;
      fetch(url)
        .then((r) => r.arrayBuffer())
        .then((ab) => getCtx().decodeAudioData(ab))
        .then((buf) => { buffersRef.current.set(clip.id, buf); loadingRef.current.delete(clip.id); })
        .catch((err) => { console.warn(`[WebAudio] failed to decode ${clip.filePath}:`, err); loadingRef.current.delete(clip.id); });
    });
    // Clean up buffers for clips no longer in the list
    const ids = new Set(clips.map(c => c.id));
    buffersRef.current.forEach((_, id) => { if (!ids.has(id)) buffersRef.current.delete(id); });
  }, [clips, mediaServerPort, getCtx]);

  const stopAll = useCallback(() => {
    activeNodesRef.current.forEach(({ source }) => { try { source.stop(); } catch {} });
    activeNodesRef.current.clear();
  }, []);

  const stopClip = useCallback((clipId: string) => {
    const node = activeNodesRef.current.get(clipId);
    if (node) { try { node.source.stop(); } catch {} activeNodesRef.current.delete(clipId); }
  }, []);

  // Start playback of a clip from `playhead` (timeline seconds).
  // Returns true if started, false if buffer not ready yet.
  const playClip = useCallback((clip: Clip, playhead: number): boolean => {
    const ctx = getCtx();
    if (ctx.state === "suspended") ctx.resume();
    const buffer = buffersRef.current.get(clip.id);
    if (!buffer) return false;

    const clipEnd = clip.timeStart + (clip.endOffset - clip.startOffset) / clip.speed;
    if (playhead < clip.timeStart || playhead >= clipEnd) return false;

    // How far into the clip's source audio the playhead is
    const sourceOffset = (playhead - clip.timeStart) * clip.speed + clip.startOffset;
    if (sourceOffset >= buffer.duration) return false;

    stopClip(clip.id);

    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = clip.speed;
    source.connect(gain);
    gain.connect(ctx.destination);

    const isMuted = getTrackMuted(clip.trackId);
    gain.gain.value = isMuted ? 0 : (clip.volume ?? 1.0);

    source.start(0, sourceOffset);
    source.onended = () => activeNodesRef.current.delete(clip.id);
    activeNodesRef.current.set(clip.id, { source, gain, startedAt: ctx.currentTime, offset: sourceOffset });
    return true;
  }, [getCtx, stopClip, getTrackMuted]);

  const isPlaying = useCallback((clipId: string): boolean => activeNodesRef.current.has(clipId), []);

  // Correct drift: compare AudioContext currentTime to expected position
  const correctDrift = useCallback((clip: Clip, playhead: number, threshold = 0.25) => {
    const ctx = ctxRef.current;
    const node = activeNodesRef.current.get(clip.id);
    if (!ctx || !node) return;
    const expected = (playhead - clip.timeStart) * clip.speed + clip.startOffset;
    const actual = node.offset + (ctx.currentTime - node.startedAt) * clip.speed;
    if (Math.abs(actual - expected) > threshold) {
      // Drift too large — restart from correct position
      stopClip(clip.id);
      playClip(clip, playhead);
    }
  }, [stopClip, playClip]);

  const setMuted = useCallback((clipId: string, muted: boolean) => {
    const node = activeNodesRef.current.get(clipId);
    if (node) node.gain.gain.value = muted ? 0 : 1;
  }, []);

  const isBufferReady = useCallback((clipId: string): boolean => buffersRef.current.has(clipId), []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAll();
      ctxRef.current?.close();
    };
  }, [stopAll]);

  return { playClip, stopClip, stopAll, isPlaying, correctDrift, setMuted, isBufferReady };
}
