import React, { useRef, useEffect, useState, useMemo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useTimelineStore, Clip } from "../store/timelineStore";
import { playheadBus } from "../lib/playheadBus";
import { Play, Pause, SkipBack, SkipForward, Volume2, Maximize2 } from "lucide-react";

interface LyricLine {
  time: number;
  text: string;
}

function parseLRC(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split("\n")) {
    const m = raw.match(/^\[(\d{2}):(\d{2})[.:](\d{2,3})\](.*)/);
    if (m) {
      const t = parseInt(m[1]) * 60 + parseInt(m[2]) + parseInt(m[3]) / (m[3].length === 3 ? 1000 : 100);
      lines.push({ time: t, text: m[4].trim() });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

const safeSetCurrentTime = (media: HTMLMediaElement, time: number) => {
  if (!isFinite(time) || time < 0) return;
  try {
    if (media.readyState >= 1) {
      media.currentTime = time;
    } else {
      const onLoadedMetadata = () => {
        try { media.currentTime = time; } catch (err) { console.warn("Error setting currentTime in loadedmetadata:", err); }
        media.removeEventListener("loadedmetadata", onLoadedMetadata);
      };
      media.addEventListener("loadedmetadata", onLoadedMetadata);
    }
  } catch (err) {
    console.warn("Error setting currentTime:", err);
  }
};

const toMediaUrl = (path: string, port: number) =>
  `http://127.0.0.1:${port}/file?path=${encodeURIComponent(path)}`;

// Only open GStreamer decoders for clips within this window of the playhead
const AUDIO_WINDOW_S = 120;

export const MonitorProgram: React.FC = () => {
  const { playhead, setPlayhead, isPlaying, setIsPlaying, tracks, timelineDuration, lyricsText, mediaPool, mediaServerPort } = useTimelineStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number | null>(null);

  const [activeClip, setActiveClip] = useState<Clip | null>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);

  // Audio windowing: only mount <audio> elements for clips near the playhead
  const audioClips = useMemo(() => {
    return tracks
      .filter((t) => t.type === "audio")
      .flatMap((t) => t.clips)
      .filter((c) => {
        const clipEnd = c.timeStart + (c.endOffset - c.startOffset) / c.speed;
        return clipEnd >= playhead - AUDIO_WINDOW_S && c.timeStart <= playhead + AUDIO_WINDOW_S;
      });
  }, [tracks, playhead]);

  const audioRefsMap = useRef<Map<string, HTMLAudioElement>>(new Map());

  const activeClipRef = useRef<Clip | null>(null);
  const videoSrcRef = useRef<string | null>(null);
  const timelineDurationRef = useRef(timelineDuration);
  const playheadRef = useRef(playhead);
  const playStartRef = useRef<{ wallTime: number; playhead: number } | null>(null);
  const videoPlayingRef = useRef<string | null>(null);
  const playingAudiosRef = useRef<Set<string>>(new Set());
  // Rolling frame-time buffer for auto-pause guard
  const frameBudgetRef = useRef<number[]>([]);

  useEffect(() => { playheadRef.current = playhead; }, [playhead]);
  useEffect(() => { timelineDurationRef.current = timelineDuration; }, [timelineDuration]);
  useEffect(() => { activeClipRef.current = activeClip; }, [activeClip]);
  useEffect(() => { videoSrcRef.current = videoSrc; }, [videoSrc]);

  // Active clip detection (runs at ~10fps via Zustand playhead updates)
  useEffect(() => {
    const videoTrack = tracks.find((t) => t.type === "video");
    if (!videoTrack) {
      setActiveClip(null);
      setVideoSrc(null);
      setImageSrc(null);
      return;
    }

    const clip = videoTrack.clips.find((c) => {
      const clipEnd = c.timeStart + (c.endOffset - c.startOffset) / c.speed;
      return playhead >= c.timeStart && playhead < clipEnd;
    }) ?? null;

    const poolItem = clip ? mediaPool.find((m) => m.filePath === clip.filePath) : null;
    const resolvedPath = poolItem?.proxyPath || clip?.proxyPath || clip?.filePath || null;
    const resolvedUrl = resolvedPath && mediaServerPort > 0 ? toMediaUrl(resolvedPath, mediaServerPort) : null;

    if (clip?.id !== activeClipRef.current?.id || (clip?.type === "video" && videoSrc !== resolvedUrl)) {
      setActiveClip(clip);
      if (clip?.type === "video" && resolvedUrl) {
        setVideoSrc(resolvedUrl);
        setImageSrc(null);
      } else if (clip?.type === "image") {
        setImageSrc(convertFileSrc(clip.filePath));
        setVideoSrc(null);
      } else {
        setVideoSrc(null);
        setImageSrc(null);
      }
    } else if (!clip) {
      setActiveClip(null);
      setVideoSrc(null);
      setImageSrc(null);
    }
  }, [playhead, tracks, mediaPool, videoSrc]);

  // Pause receiver
  useEffect(() => {
    const handleToggle = (e: Event) => {
      const play = (e as CustomEvent).detail;
      if (!play) {
        const video = videoRef.current;
        if (video) video.pause();
        audioRefsMap.current.forEach((a) => a.pause());
        videoPlayingRef.current = null;
        playingAudiosRef.current.clear();
      }
    };
    window.addEventListener("playback-toggle", handleToggle);
    return () => window.removeEventListener("playback-toggle", handleToggle);
  }, []);

  // Unified play/pause effect
  useEffect(() => {
    const video = videoRef.current;

    if (isPlaying) {
      if (video && videoSrc && activeClipRef.current?.type === "video") {
        const localTime = (playheadRef.current - activeClipRef.current.timeStart) * activeClipRef.current.speed + activeClipRef.current.startOffset;
        safeSetCurrentTime(video, localTime);
        const videoTrack = tracks.find((t) => t.type === "video");
        video.muted = videoTrack?.muted || false;
        video.volume = video.muted ? 0 : 1.0;
        videoPlayingRef.current = activeClipRef.current.id;
        video.play().catch((e) => { console.warn("video play blocked:", e); videoPlayingRef.current = null; });
      }

      audioRefsMap.current.forEach((audio, clipId) => {
        const clip = audioClips.find((c) => c.id === clipId);
        if (!clip) return;
        const clipEnd = clip.timeStart + (clip.endOffset - clip.startOffset) / clip.speed;
        const track = tracks.find((t) => t.id === clip.trackId);
        const isMuted = track?.muted || false;

        if (playheadRef.current >= clip.timeStart && playheadRef.current < clipEnd) {
          const localTime = (playheadRef.current - clip.timeStart) * clip.speed + clip.startOffset;
          safeSetCurrentTime(audio, localTime);
          audio.muted = isMuted;
          audio.volume = isMuted ? 0 : (clip.volume ?? 1.0);
          playingAudiosRef.current.add(clip.id);
          audio.play().catch((e) => { console.warn("audio play blocked:", e); playingAudiosRef.current.delete(clip.id); });
        } else {
          audio.pause();
          playingAudiosRef.current.delete(clip.id);
        }
      });
    } else {
      if (video) video.pause();
      audioRefsMap.current.forEach((a) => a.pause());
      videoPlayingRef.current = null;
      playingAudiosRef.current.clear();
    }
  }, [isPlaying, videoSrc, tracks, audioClips]);

  // Scrub sync (when not playing, sync media currentTime to playhead at ~10fps)
  useEffect(() => {
    if (isPlaying) return;

    const video = videoRef.current;
    if (video && activeClip && activeClip.type === "video") {
      const targetLocalTime = (playhead - activeClip.timeStart) * activeClip.speed + activeClip.startOffset;
      if (Math.abs(video.currentTime - targetLocalTime) > 0.15) {
        safeSetCurrentTime(video, targetLocalTime);
      }
    }

    audioRefsMap.current.forEach((audio, clipId) => {
      const clip = audioClips.find((c) => c.id === clipId);
      if (!clip) return;
      const clipEnd = clip.timeStart + (clip.endOffset - clip.startOffset) / clip.speed;
      if (playhead >= clip.timeStart && playhead < clipEnd) {
        const targetLocalTime = (playhead - clip.timeStart) * clip.speed + clip.startOffset;
        if (Math.abs(audio.currentTime - targetLocalTime) > 0.15) {
          safeSetCurrentTime(audio, targetLocalTime);
        }
      }
    });
  }, [playhead, activeClip, isPlaying, audioClips]);

  // RAF loop — decoupled from Zustand: emits bus at 60fps, syncs Zustand at ~10fps
  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    playStartRef.current = { wallTime: Date.now(), playhead: playheadRef.current };
    frameBudgetRef.current = [];

    let frameCounter = 0;
    let lastFrameTime = performance.now();

    const syncPlayhead = () => {
      // Auto-pause guard: if avg frame time exceeds ~80ms (< 13fps), system is overloaded
      const now = performance.now();
      const dt = now - lastFrameTime;
      lastFrameTime = now;

      if (dt > 0 && dt < 5000) { // ignore first/stalled frames
        frameBudgetRef.current.push(dt);
        if (frameBudgetRef.current.length > 10) frameBudgetRef.current.shift();
        if (frameBudgetRef.current.length >= 10) {
          const avg = frameBudgetRef.current.reduce((a, b) => a + b, 0) / frameBudgetRef.current.length;
          if (avg > 80) {
            console.warn(`[auto-pause] avg frame time ${avg.toFixed(0)}ms — pausing to prevent freeze`);
            setIsPlaying(false);
            window.dispatchEvent(new CustomEvent("playback-toggle", { detail: false }));
            return; // don't reschedule
          }
        }
      }

      const state = useTimelineStore.getState();
      const currentTracks = state.tracks;
      const currentDuration = state.timelineDuration;

      const video = videoRef.current;
      const activeCl = activeClipRef.current;
      const vidSrc = videoSrcRef.current;

      const start = playStartRef.current;
      if (!start) return;

      const elapsed = (Date.now() - start.wallTime) / 1000;
      const next = start.playhead + elapsed;

      if (currentDuration > 0 && next >= currentDuration) {
        setPlayhead(currentDuration);
        playheadBus.emit(currentDuration);
        playheadRef.current = currentDuration;
        setIsPlaying(false);
        window.dispatchEvent(new CustomEvent("playback-toggle", { detail: false }));
        return;
      }

      // Always emit to bus at 60fps — Timeline DOM updates without React re-renders
      playheadBus.emit(next);
      playheadRef.current = next;

      // Sync Zustand at ~10fps (every 6 frames) — triggers re-renders for lyric/time display
      frameCounter++;
      if (frameCounter % 6 === 0) {
        setPlayhead(next);
      }

      // Sync active video
      if (video && vidSrc && activeCl && activeCl.type === "video") {
        const videoTrack = currentTracks.find((t) => t.type === "video");
        const isVideoMuted = videoTrack?.muted || false;
        video.muted = isVideoMuted;
        video.volume = isVideoMuted ? 0 : 1.0;

        const targetLocalTime = (next - activeCl.timeStart) * activeCl.speed + activeCl.startOffset;

        if (videoPlayingRef.current !== activeCl.id) {
          video.playbackRate = activeCl.speed;
          safeSetCurrentTime(video, targetLocalTime);
          videoPlayingRef.current = activeCl.id;
          video.play().catch((e) => { console.warn("video sync play blocked:", e); videoPlayingRef.current = null; });
        } else {
          const drift = Math.abs(video.currentTime - targetLocalTime);
          if (drift > 0.04) safeSetCurrentTime(video, targetLocalTime);
        }
      } else {
        if (videoPlayingRef.current !== null) {
          if (video) video.pause();
          videoPlayingRef.current = null;
        }
      }

      // Sync audio clips
      const currentAudioClips = currentTracks.filter((t) => t.type === "audio").flatMap((t) => t.clips);

      audioRefsMap.current.forEach((audio, clipId) => {
        const clip = currentAudioClips.find((c) => c.id === clipId);
        if (!clip) { if (!audio.paused) audio.pause(); playingAudiosRef.current.delete(clipId); return; }
        const clipEnd = clip.timeStart + (clip.endOffset - clip.startOffset) / clip.speed;
        const inRange = next >= clip.timeStart && next < clipEnd;
        if (!inRange) { if (!audio.paused) audio.pause(); playingAudiosRef.current.delete(clipId); }
      });

      currentAudioClips.forEach((clip) => {
        const audio = audioRefsMap.current.get(clip.id);
        if (!audio) return;
        const clipEnd = clip.timeStart + (clip.endOffset - clip.startOffset) / clip.speed;
        const inRange = next >= clip.timeStart && next < clipEnd;

        if (inRange) {
          const localTime = (next - clip.timeStart) * clip.speed + clip.startOffset;
          const track = currentTracks.find((t) => t.id === clip.trackId);
          const isMuted = track?.muted || false;
          audio.muted = isMuted;
          audio.volume = isMuted ? 0 : (clip.volume ?? 1.0);

          if (!playingAudiosRef.current.has(clip.id)) {
            safeSetCurrentTime(audio, localTime);
            playingAudiosRef.current.add(clip.id);
            audio.play().catch((e) => { console.warn("audio sync play blocked:", e); playingAudiosRef.current.delete(clip.id); });
          } else {
            const drift = Math.abs(audio.currentTime - localTime);
            if (drift > 0.25) safeSetCurrentTime(audio, localTime);
          }
        }
      });

      rafRef.current = requestAnimationFrame(syncPlayhead);
    };

    rafRef.current = requestAnimationFrame(syncPlayhead);
    return () => {
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      const video = videoRef.current;
      if (video) video.pause();
      audioRefsMap.current.forEach((a) => a.pause());
      videoPlayingRef.current = null;
      playingAudiosRef.current.clear();
    };
  }, [isPlaying, setPlayhead, setIsPlaying]);

  // Lyric overlay
  const parsedLyrics = useMemo(() => parseLRC(lyricsText), [lyricsText]);
  const currentLyricLine = useMemo(() => {
    let line = "";
    for (const l of parsedLyrics) {
      if (l.time <= playhead) line = l.text;
    }
    return line;
  }, [parsedLyrics, playhead]);

  // Controls
  const handleTogglePlay = () => {
    const nextPlaying = !isPlaying;
    setIsPlaying(nextPlaying);

    if (nextPlaying) {
      const video = videoRef.current;
      if (video && videoSrc && activeClip?.type === "video") {
        const localTime = (playhead - activeClip.timeStart) * activeClip.speed + activeClip.startOffset;
        video.playbackRate = activeClip.speed;
        safeSetCurrentTime(video, localTime);
        video.muted = false;
        video.volume = 1.0;
        video.play().catch(() => {});
      }
      audioRefsMap.current.forEach((audio, clipId) => {
        const clip = audioClips.find((c) => c.id === clipId);
        if (!clip) return;
        const clipEnd = clip.timeStart + (clip.endOffset - clip.startOffset) / clip.speed;
        const inRange = playhead >= clip.timeStart && playhead < clipEnd;
        const track = tracks.find((t) => t.id === clip.trackId);
        const isMuted = track?.muted || false;
        if (inRange) {
          const localTime = (playhead - clip.timeStart) * clip.speed + clip.startOffset;
          audio.muted = isMuted;
          audio.volume = isMuted ? 0 : (clip.volume ?? 1.0);
          safeSetCurrentTime(audio, localTime);
          audio.play().catch(() => {});
        } else {
          audio.play().then(() => audio.pause()).catch(() => {});
        }
      });
    }

    window.dispatchEvent(new CustomEvent("playback-toggle", { detail: nextPlaying }));
  };

  const handleSkipStart = () => {
    const time = 0;
    setPlayhead(time);
    playheadBus.emit(time);
    if (videoRef.current) safeSetCurrentTime(videoRef.current, activeClip ? activeClip.startOffset : 0);
    audioRefsMap.current.forEach((a) => { a.pause(); safeSetCurrentTime(a, 0); });
  };

  const handleSkipEnd = () => {
    const time = timelineDuration;
    setPlayhead(time);
    playheadBus.emit(time);
    if (isPlaying) {
      setIsPlaying(false);
      window.dispatchEvent(new CustomEvent("playback-toggle", { detail: false }));
    }
  };

  const handleScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const time = Math.max(0, percent * (timelineDuration || 10));
    setPlayhead(time);
    playheadBus.emit(time);
  };

  const formatTime = (time: number) => {
    const h = Math.floor(time / 3600);
    const m = Math.floor((time % 3600) / 60);
    const s = Math.floor(time % 60);
    const ms = Math.floor((time % 1) * 100);
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
  };

  const progressPercent = timelineDuration > 0 ? (playhead / timelineDuration) * 100 : 0;

  return (
    <div className="monitor-container" style={{ padding: "16px" }}>
      {/* Hidden audio elements — only clips within ±120s of playhead to limit GStreamer decoder count */}
      <div style={{ display: "none" }}>
        {audioClips.map((clip) => (
          <audio
            key={clip.id}
            ref={(el) => {
              if (el) audioRefsMap.current.set(clip.id, el);
              else audioRefsMap.current.delete(clip.id);
            }}
            src={mediaServerPort > 0 ? toMediaUrl(clip.filePath, mediaServerPort) : ""}
            preload="auto"
          />
        ))}
      </div>

      {/* Video Screen */}
      <div className="video-screen" style={{ position: "relative" }}>
        {videoSrc ? (
          <video
            ref={videoRef}
            src={videoSrc}
            className="video-element"
            preload="auto"
            onError={(e) => console.error("Video load error:", e)}
          />
        ) : imageSrc ? (
          <img
            src={imageSrc}
            alt=""
            className="video-element"
            style={{ objectFit: "contain", width: "100%", height: "100%" }}
          />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", gap: "10px", background: "var(--bg-darker)" }}>
            <span style={{ fontSize: "14px", fontWeight: "600", letterSpacing: "1px", color: "var(--text-bright)" }}>
              PROGRAM MONITOR
            </span>
            <span style={{ fontSize: "10px", opacity: 0.6 }}>No Clip Active at Playhead</span>
          </div>
        )}

        {currentLyricLine && (
          <div style={{ position: "absolute", bottom: "12%", left: 0, right: 0, textAlign: "center", pointerEvents: "none", padding: "0 16px" }}>
            <span style={{
              display: "inline-block", color: "#fff", fontSize: "18px", fontWeight: 700, lineHeight: 1.3,
              textShadow: "0 1px 8px rgba(0,0,0,0.9), 0 0 24px rgba(0,0,0,0.6)",
              background: "rgba(0,0,0,0.35)", padding: "4px 12px", borderRadius: "6px", backdropFilter: "blur(4px)",
            }}>
              {currentLyricLine}
            </span>
          </div>
        )}
      </div>

      {/* Transport Controls */}
      <div className="monitor-controls">
        <div className="time-scrubber" onClick={handleScrub}>
          <div className="time-scrubber-progress" style={{ width: `${progressPercent}%` }}></div>
          <div className="time-scrubber-handle" style={{ left: `${progressPercent}%` }}></div>
        </div>

        <div className="controls-row">
          <div className="time-display">
            {formatTime(playhead)} <span style={{ color: "var(--text-muted)", fontSize: "10px" }}>/ {formatTime(timelineDuration)}</span>
          </div>

          <div className="control-buttons">
            <button className="icon-btn" onClick={handleSkipStart} title="Jump to Start">
              <SkipBack size={18} />
            </button>
            <button className="icon-btn play" onClick={handleTogglePlay} title={isPlaying ? "Pause (Space)" : "Play (Space)"}>
              {isPlaying ? <Pause size={20} fill="#fff" /> : <Play size={20} fill="#fff" style={{ marginLeft: "2px" }} />}
            </button>
            <button className="icon-btn" onClick={handleSkipEnd} title="Jump to End">
              <SkipForward size={18} />
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button className="icon-btn" title="Volume">
              <Volume2 size={16} />
            </button>
            <button className="icon-btn" title="Fullscreen">
              <Maximize2 size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
