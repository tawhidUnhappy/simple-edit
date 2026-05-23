import { useEffect, useRef, useCallback } from "react";
import { Clip } from "../store/timelineStore";

export function useAudioPool(
  clips: Clip[],
  mediaServerPort: number,
  getTrackMuted: (trackId: string) => boolean,
) {
  const elementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());

  const makeUrl = (clip: Clip) =>
    `http://127.0.0.1:${mediaServerPort}/file?path=${encodeURIComponent(clip.filePath)}`;

  // Get or create an <audio> element for a clip, recreating it if the src URL has changed.
  const getOrCreate = useCallback((clip: Clip): HTMLAudioElement | null => {
    if (mediaServerPort <= 0) return null;
    const expectedSrc = makeUrl(clip);
    let el = elementsRef.current.get(clip.id);
    if (!el || el.src !== expectedSrc) {
      if (el) el.pause();
      el = new Audio();
      el.preload = "metadata"; // load enough for seeking, not the full file
      el.src = expectedSrc;
      elementsRef.current.set(clip.id, el);
    }
    return el;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaServerPort]);

  // Sync element pool with current clip list
  useEffect(() => {
    if (mediaServerPort <= 0) return;
    const ids = new Set(clips.map((c) => c.id));
    elementsRef.current.forEach((el, id) => {
      if (!ids.has(id)) { el.pause(); el.src = ""; elementsRef.current.delete(id); }
    });
    clips.forEach((clip) => getOrCreate(clip));
  }, [clips, mediaServerPort, getOrCreate]);

  const stopAll = useCallback(() => {
    elementsRef.current.forEach((el) => { try { el.pause(); } catch {} });
  }, []);

  const stopClip = useCallback((clipId: string) => {
    const el = elementsRef.current.get(clipId);
    if (el) { try { el.pause(); } catch {} }
  }, []);

  const playClip = useCallback((clip: Clip, playhead: number): boolean => {
    if (mediaServerPort <= 0) return false;
    const clipEnd = clip.timeStart + (clip.endOffset - clip.startOffset) / clip.speed;
    if (playhead < clip.timeStart || playhead >= clipEnd) return false;

    const targetTime = (playhead - clip.timeStart) * clip.speed + clip.startOffset;
    const el = getOrCreate(clip);
    if (!el) return false;

    const isMuted = getTrackMuted(clip.trackId);
    el.muted = isMuted;
    el.volume = isMuted ? 0 : (clip.volume ?? 1.0);
    el.playbackRate = clip.speed;

    if (Math.abs(el.currentTime - targetTime) > 0.1) el.currentTime = targetTime;
    el.play().catch(() => {});
    return true;
  }, [mediaServerPort, getOrCreate, getTrackMuted]);

  const isPlaying = useCallback(
    (clipId: string) => { const el = elementsRef.current.get(clipId); return el ? !el.paused : false; },
    [],
  );

  // Drift correction: seek audio element if it's too far off expected position
  const correctDrift = useCallback((clip: Clip, playhead: number, threshold = 0.15) => {
    const el = elementsRef.current.get(clip.id);
    if (!el || el.paused) return;
    const expected = (playhead - clip.timeStart) * clip.speed + clip.startOffset;
    if (Math.abs(el.currentTime - expected) > threshold) el.currentTime = expected;
  }, []);

  const setMuted = useCallback((clipId: string, muted: boolean) => {
    const el = elementsRef.current.get(clipId);
    if (el) { el.muted = muted; el.volume = muted ? 0 : 1; }
  }, []);

  const isBufferReady = useCallback((clipId: string): boolean => {
    const el = elementsRef.current.get(clipId);
    return el ? el.readyState >= 2 : false;
  }, []);

  useEffect(() => {
    return () => {
      elementsRef.current.forEach((el) => { el.pause(); el.src = ""; });
      elementsRef.current.clear();
    };
  }, []);

  return { playClip, stopClip, stopAll, isPlaying, correctDrift, setMuted, isBufferReady };
}
