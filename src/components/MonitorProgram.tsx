import React, { useRef, useEffect, useMemo, useCallback } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useTimelineStore, Clip } from "../store/timelineStore";
import { playheadBus } from "../lib/playheadBus";
import { useAudioPool } from "../lib/useAudioPool";
import { Play, Pause, SkipBack, SkipForward, Volume2, Maximize2 } from "lucide-react";

interface LyricLine { time: number; text: string; }

function parseLRC(lrc: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const raw of lrc.split("\n")) {
    const m = raw.match(/^\[(\d{2}):(\d{2})[.:](\d{2,3})\](.*)/);
    if (m) {
      const t = parseInt(m[1]) * 60 + parseInt(m[2]) + parseInt(m[3]) / (m[3].length === 3 ? 1000 : 100);
      out.push({ time: t, text: m[4].trim() });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

const safeSetTime = (media: HTMLMediaElement, time: number) => {
  if (!isFinite(time) || time < 0) return;
  try {
    if (media.readyState >= 1) { media.currentTime = time; }
    else {
      const fn = () => { try { media.currentTime = time; } catch {} media.removeEventListener("loadedmetadata", fn); };
      media.addEventListener("loadedmetadata", fn);
    }
  } catch {}
};

const toMediaUrl = (path: string, port: number) =>
  `http://127.0.0.1:${port}/file?path=${encodeURIComponent(path)}`;

function formatTime(t: number): string {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60), ms = Math.floor((t % 1) * 100);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
}

const MonitorProgramComponent: React.FC = () => {
  // playhead intentionally NOT subscribed — driven entirely by bus
  const {
    setPlayhead, isPlaying, setIsPlaying,
    tracks, timelineDuration, lyricsText, mediaPool, mediaServerPort,
  } = useTimelineStore();

  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number | null>(null);

  // DOM refs — updated by bus at 60fps, zero React re-renders
  const timeDisplayRef = useRef<HTMLSpanElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const progressHandleRef = useRef<HTMLDivElement>(null);
  const lyricWrapRef = useRef<HTMLDivElement>(null);
  const lyricTextRef = useRef<HTMLSpanElement>(null);

  const [activeClip, setActiveClip] = React.useState<Clip | null>(null);
  const [videoSrc, setVideoSrc] = React.useState<string | null>(null);
  const [imageSrc, setImageSrc] = React.useState<string | null>(null);

  // Audio clips — only changes when tracks change (not on playhead tick)
  const audioClips = useMemo(
    () => tracks.filter((t) => t.type === "audio").flatMap((t) => t.clips),
    [tracks],
  );

  // ── Web Audio API ──────────────────────────────────────────────────────────
  const getTrackMuted = useCallback((trackId: string) =>
    !!tracks.find((t) => t.id === trackId)?.muted,
    [tracks],
  );
  const webAudio = useAudioPool(audioClips, mediaServerPort, getTrackMuted);

  // ── Internal refs ──────────────────────────────────────────────────────────
  const activeClipRef = useRef<Clip | null>(null);
  const videoSrcRef = useRef<string | null>(null);
  const timelineDurationRef = useRef(timelineDuration);
  const playheadRef = useRef(0);
  const isPlayingRef = useRef(isPlaying);
  const playStartRef = useRef<{ wallTime: number; playhead: number } | null>(null);
  const videoPlayingRef = useRef<string | null>(null);
  const frameBudgetRef = useRef<number[]>([]);
  const parsedLyricsRef = useRef<LyricLine[]>([]);
  const tracksRef = useRef(tracks);
  const mediaPoolRef = useRef(mediaPool);
  const mediaServerPortRef = useRef(mediaServerPort);

  useEffect(() => { timelineDurationRef.current = timelineDuration; }, [timelineDuration]);
  useEffect(() => { activeClipRef.current = activeClip; }, [activeClip]);
  useEffect(() => { videoSrcRef.current = videoSrc; }, [videoSrc]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { tracksRef.current = tracks; }, [tracks]);
  useEffect(() => { mediaPoolRef.current = mediaPool; }, [mediaPool]);
  useEffect(() => { mediaServerPortRef.current = mediaServerPort; }, [mediaServerPort]);

  const parsedLyrics = useMemo(() => parseLRC(lyricsText), [lyricsText]);
  useEffect(() => { parsedLyricsRef.current = parsedLyrics; }, [parsedLyrics]);

  // ── Bus subscriptions: 60fps DOM updates, zero React re-renders ────────────
  useEffect(() => {
    return playheadBus.on((t) => {
      playheadRef.current = t;

      // Time display
      if (timeDisplayRef.current) timeDisplayRef.current.textContent = formatTime(t);

      // Progress bar
      const dur = timelineDurationRef.current;
      const pct = dur > 0 ? (t / dur) * 100 : 0;
      if (progressBarRef.current) progressBarRef.current.style.width = `${pct}%`;
      if (progressHandleRef.current) progressHandleRef.current.style.left = `${pct}%`;

      // Lyric overlay
      let line = "";
      for (const l of parsedLyricsRef.current) { if (l.time <= t) line = l.text; else break; }
      if (lyricTextRef.current) lyricTextRef.current.textContent = line;
      if (lyricWrapRef.current) lyricWrapRef.current.style.display = line ? "block" : "none";

      // Active-clip detection — only setState when clip boundary is crossed (rare)
      const currentTracks = tracksRef.current;
      const videoTrack = currentTracks.find((tr) => tr.type === "video");
      if (!videoTrack) {
        if (activeClipRef.current !== null) { setActiveClip(null); setVideoSrc(null); setImageSrc(null); }
        return;
      }
      const clip = videoTrack.clips.find((c) => {
        const end = c.timeStart + (c.endOffset - c.startOffset) / c.speed;
        return t >= c.timeStart && t < end;
      }) ?? null;

      if (clip?.id !== activeClipRef.current?.id) {
        const port = mediaServerPortRef.current;
        const poolItem = clip ? mediaPoolRef.current.find((m) => m.filePath === clip.filePath) : null;
        const resolved = poolItem?.proxyPath || clip?.proxyPath || clip?.filePath || null;
        const url = resolved && port > 0 ? toMediaUrl(resolved, port) : null;
        setActiveClip(clip);
        if (clip?.type === "video" && url) { setVideoSrc(url); setImageSrc(null); }
        else if (clip?.type === "image") { setImageSrc(convertFileSrc(clip.filePath)); setVideoSrc(null); }
        else { setVideoSrc(null); setImageSrc(null); }
      }

      // Scrub sync (only when paused)
      if (isPlayingRef.current) return;
      const video = videoRef.current;
      const ac = activeClipRef.current;
      if (video && ac?.type === "video") {
        const target = (t - ac.timeStart) * ac.speed + ac.startOffset;
        if (Math.abs(video.currentTime - target) > 0.15) safeSetTime(video, target);
      }
      // Scrub audio via Web Audio — Web Audio doesn't support scrubbing directly,
      // but we can stop and re-seek by doing nothing (no scrub preview for audio is fine)
    });
  }, []); // no deps — uses only refs

  // ── Playback toggle receiver ───────────────────────────────────────────────
  useEffect(() => {
    const fn = (e: Event) => {
      if (!(e as CustomEvent).detail) {
        if (videoRef.current) videoRef.current.pause();
        webAudio.stopAll();
        videoPlayingRef.current = null;
      }
    };
    window.addEventListener("playback-toggle", fn);
    return () => window.removeEventListener("playback-toggle", fn);
  }, [webAudio]);

  // ── Start/stop on isPlaying change ────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (isPlaying) {
      // Video — seek first, play after seek settles to avoid frame-zero flash
      if (video && videoSrc && activeClipRef.current?.type === "video") {
        const ac = activeClipRef.current;
        const lt = (playheadRef.current - ac.timeStart) * ac.speed + ac.startOffset;
        const vTrack = tracks.find((t) => t.type === "video");
        video.playbackRate = ac.speed;
        video.muted = vTrack?.muted || false;
        video.volume = video.muted ? 0 : 1.0;
        videoPlayingRef.current = ac.id;
        safeSetTime(video, lt);
        let played = false;
        const doPlay = () => {
          if (played) return;
          played = true;
          video.removeEventListener("seeked", doPlay);
          if (isPlayingRef.current) video.play().catch(() => { videoPlayingRef.current = null; });
        };
        video.addEventListener("seeked", doPlay);
        // Fallback: play after 200ms even if seeked never fires
        setTimeout(doPlay, 200);
      }
      // Audio
      audioClips.forEach((clip) => webAudio.playClip(clip, playheadRef.current));
    } else {
      if (video) video.pause();
      webAudio.stopAll();
      videoPlayingRef.current = null;
    }
  }, [isPlaying, videoSrc, tracks, audioClips, webAudio]);

  // ── RAF loop ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      return;
    }

    playStartRef.current = { wallTime: performance.now(), playhead: playheadRef.current };
    frameBudgetRef.current = [];
    let frameCounter = 0;
    let lastFrameTime = performance.now();

    const tick = () => {
      // Auto-pause guard
      const now = performance.now();
      const dt = now - lastFrameTime;
      lastFrameTime = now;
      if (dt > 0 && dt < 5000) {
        frameBudgetRef.current.push(dt);
        if (frameBudgetRef.current.length > 15) frameBudgetRef.current.shift();
        if (frameBudgetRef.current.length >= 15) {
          const avg = frameBudgetRef.current.reduce((a, b) => a + b, 0) / 15;
          if (avg > 120) {
            console.warn(`[auto-pause] avg ${avg.toFixed(0)}ms`);
            setIsPlaying(false);
            window.dispatchEvent(new CustomEvent("playback-toggle", { detail: false }));
            return;
          }
        }
      }

      const state = useTimelineStore.getState();
      const start = playStartRef.current;
      if (!start) return;
      const next = start.playhead + (performance.now() - start.wallTime) / 1000;

      if (state.timelineDuration > 0 && next >= state.timelineDuration) {
        playheadBus.emit(state.timelineDuration);
        setPlayhead(state.timelineDuration);
        setIsPlaying(false);
        window.dispatchEvent(new CustomEvent("playback-toggle", { detail: false }));
        return;
      }

      // 60fps bus emit → DOM updates (time display, progress, playhead line, lyric)
      playheadBus.emit(next);
      playheadRef.current = next;

      // ~10fps Zustand update (lyric/active-clip state via React)
      frameCounter++;
      if (frameCounter % 6 === 0) setPlayhead(next);

      // Sync video
      const video = videoRef.current;
      const activeCl = activeClipRef.current;
      const vidSrc = videoSrcRef.current;
      if (video && vidSrc && activeCl?.type === "video") {
        const currentTracks = state.tracks;
        const vTrack = currentTracks.find((t) => t.type === "video");
        video.muted = vTrack?.muted || false;
        video.volume = video.muted ? 0 : 1.0;
        const target = (next - activeCl.timeStart) * activeCl.speed + activeCl.startOffset;
        if (videoPlayingRef.current !== activeCl.id) {
          video.playbackRate = activeCl.speed;
          safeSetTime(video, target);
          videoPlayingRef.current = activeCl.id;
          video.play().catch(() => { videoPlayingRef.current = null; });
        } else if (
          frameCounter % 30 === 0 &&
          now - start.wallTime > 500 &&
          Math.abs(video.currentTime - target) > 0.3
        ) {
          safeSetTime(video, target);
        }
      } else if (videoPlayingRef.current !== null) {
        if (video) video.pause();
        videoPlayingRef.current = null;
      }

      // Audio sync: drift correction every 12 frames (~5fps) — Web Audio self-syncs
      if (frameCounter % 12 === 0) {
        const currentAudio = state.tracks.filter((t) => t.type === "audio").flatMap((t) => t.clips);
        currentAudio.forEach((clip) => {
          const end = clip.timeStart + (clip.endOffset - clip.startOffset) / clip.speed;
          if (next >= clip.timeStart && next < end) {
            if (!webAudio.isPlaying(clip.id)) {
              webAudio.playClip(clip, next);
            } else {
              webAudio.correctDrift(clip, next);
            }
          } else {
            if (webAudio.isPlaying(clip.id)) webAudio.stopClip(clip.id);
          }
        });
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      if (videoRef.current) videoRef.current.pause();
      webAudio.stopAll();
      videoPlayingRef.current = null;
    };
  }, [isPlaying, setPlayhead, setIsPlaying, webAudio]);

  // ── Controls ───────────────────────────────────────────────────────────────
  const handleTogglePlay = () => {
    const next = !isPlaying;
    setIsPlaying(next);
    window.dispatchEvent(new CustomEvent("playback-toggle", { detail: next }));
    // Actual media start/stop is handled by the isPlaying effect
  };

  const handleSkipStart = () => {
    setPlayhead(0); playheadBus.emit(0);
    webAudio.stopAll();
    if (videoRef.current) safeSetTime(videoRef.current, activeClip ? activeClip.startOffset : 0);
  };
  const handleSkipEnd = () => {
    setPlayhead(timelineDuration); playheadBus.emit(timelineDuration);
    if (isPlaying) { setIsPlaying(false); window.dispatchEvent(new CustomEvent("playback-toggle", { detail: false })); }
  };
  const handleScrub = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = Math.max(0, ((e.clientX - rect.left) / rect.width) * (timelineDuration || 10));
    setPlayhead(t); playheadBus.emit(t);
    webAudio.stopAll();
  };

  return (
    <div className="monitor-container" style={{ padding: "16px" }}>
      {/* Video Screen */}
      <div className="video-screen" style={{ position: "relative" }}>
        {videoSrc ? (
          <video ref={videoRef} src={videoSrc} className="video-element" preload="auto"
            onError={(e) => console.error("Video load error:", e)} />
        ) : imageSrc ? (
          <img src={imageSrc} alt="" className="video-element"
            style={{ objectFit: "contain", width: "100%", height: "100%" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", gap: "10px", background: "var(--bg-darker)" }}>
            <span style={{ fontSize: "14px", fontWeight: "600", letterSpacing: "1px", color: "var(--text-bright)" }}>PROGRAM MONITOR</span>
            <span style={{ fontSize: "10px", opacity: 0.6 }}>No Clip Active at Playhead</span>
          </div>
        )}

        {/* Lyric overlay — DOM ref, zero re-renders */}
        <div ref={lyricWrapRef} style={{ display: "none", position: "absolute", bottom: "12%", left: 0, right: 0, textAlign: "center", pointerEvents: "none", padding: "0 16px" }}>
          <span ref={lyricTextRef} style={{ display: "inline-block", color: "#fff", fontSize: "18px", fontWeight: 700, lineHeight: 1.3, textShadow: "0 1px 8px rgba(0,0,0,0.9)", background: "rgba(0,0,0,0.35)", padding: "4px 12px", borderRadius: "6px", backdropFilter: "blur(4px)" }} />
        </div>
      </div>

      {/* Transport Controls */}
      <div className="monitor-controls">
        <div className="time-scrubber" onPointerDown={handleScrub} style={{ touchAction: "none" }}>
          <div ref={progressBarRef} className="time-scrubber-progress" style={{ width: "0%" }} />
          <div ref={progressHandleRef} className="time-scrubber-handle" style={{ left: "0%" }} />
        </div>

        <div className="controls-row">
          <div className="time-display">
            <span ref={timeDisplayRef}>00:00:00.00</span>
            <span style={{ color: "var(--text-muted)", fontSize: "10px" }}> / {formatTime(timelineDuration)}</span>
          </div>
          <div className="control-buttons">
            <button className="icon-btn" onClick={handleSkipStart} title="Jump to Start"><SkipBack size={18} /></button>
            <button className="icon-btn play" onClick={handleTogglePlay} title={isPlaying ? "Pause (Space)" : "Play (Space)"}>
              {isPlaying ? <Pause size={20} fill="#fff" /> : <Play size={20} fill="#fff" style={{ marginLeft: "2px" }} />}
            </button>
            <button className="icon-btn" onClick={handleSkipEnd} title="Jump to End"><SkipForward size={18} /></button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button className="icon-btn" title="Volume"><Volume2 size={16} /></button>
            <button className="icon-btn" title="Fullscreen"><Maximize2 size={16} /></button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const MonitorProgram = React.memo(MonitorProgramComponent);
