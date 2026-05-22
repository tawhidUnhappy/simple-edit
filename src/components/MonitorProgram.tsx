import React, { useRef, useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useTimelineStore } from "../store/timelineStore";
import { Play, Pause, SkipBack, SkipForward, Volume2, Maximize2 } from "lucide-react";

export const MonitorProgram: React.FC = () => {
  const { playhead, setPlayhead, isPlaying, setIsPlaying, tracks, timelineDuration } = useTimelineStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number | null>(null);
  const [activeClip, setActiveClip] = useState<any>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  // 1. Find the active video clip at the current playhead position
  useEffect(() => {
    const videoTrack = tracks.find((t) => t.type === "video");
    if (!videoTrack) {
      setActiveClip(null);
      setVideoSrc(null);
      return;
    }

    const clip = videoTrack.clips.find((c) => {
      const clipEnd = c.timeStart + (c.endOffset - c.startOffset) / c.speed;
      return playhead >= c.timeStart && playhead < clipEnd;
    });

    if (clip) {
      if (activeClip?.id !== clip.id) {
        setActiveClip(clip);
        // Prioritize lightweight transcode proxy, fallback to full quality source
        const finalPath = clip.proxyPath || clip.filePath;
        setVideoSrc(convertFileSrc(finalPath));
      }
    } else {
      setActiveClip(null);
      setVideoSrc(null);
    }
  }, [playhead, tracks, activeClip]);

  // 2a. Force unmute whenever the source changes — React's muted={false} prop
  // does not remove the HTML muted attribute from the DOM, so the video stays
  // silent. Setting the property directly on the element is the only reliable fix.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    video.volume = 1.0;
  }, [videoSrc]);

  // 2b. Play / Pause effect
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.muted = false;
      video.play().catch((e) => {
        console.warn("Autoplay / play blocked or failed: ", e);
      });
    } else {
      video.pause();
    }
  }, [isPlaying, videoSrc]);

  // 3. Keep video currentTime in sync when playhead is changed by external scrubbing
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeClip || isPlaying) return;

    const targetLocalTime = (playhead - activeClip.timeStart) * activeClip.speed + activeClip.startOffset;
    if (Math.abs(video.currentTime - targetLocalTime) > 0.15) {
      video.currentTime = targetLocalTime;
    }
  }, [playhead, activeClip, isPlaying]);

  // 4. Zero-Lag Frame Loop: sync video playback back to Zustand playhead
  useEffect(() => {
    const syncPlayhead = () => {
      const video = videoRef.current;
      if (video && isPlaying && activeClip) {
        // Calculate the global timeline time based on video currentTime
        const globalTime = activeClip.timeStart + (video.currentTime - activeClip.startOffset) / activeClip.speed;
        setPlayhead(globalTime);

        // If video ended or reached clip end boundaries, stop playback
        const clipEnd = activeClip.timeStart + (activeClip.endOffset - activeClip.startOffset) / activeClip.speed;
        if (globalTime >= clipEnd || video.ended) {
          setIsPlaying(false);
          setPlayhead(clipEnd);
        }
      } else if (isPlaying && !activeClip) {
        // Pure ticking playhead when playing audio/nothing
        const step = 1 / 60; // assume 60fps tick
        const nextTime = playhead + step;
        if (nextTime >= timelineDuration) {
          setPlayhead(timelineDuration);
          setIsPlaying(false);
        } else {
          setPlayhead(nextTime);
        }
      }
      rafRef.current = requestAnimationFrame(syncPlayhead);
    };

    if (isPlaying) {
      rafRef.current = requestAnimationFrame(syncPlayhead);
    } else if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [isPlaying, activeClip, playhead, timelineDuration, setPlayhead, setIsPlaying]);

  const handleTogglePlay = () => {
    setIsPlaying(!isPlaying);
  };

  const handleSkipStart = () => {
    setPlayhead(0);
  };

  const handleSkipEnd = () => {
    setPlayhead(timelineDuration);
  };

  const formatTime = (time: number) => {
    const hours = Math.floor(time / 3600);
    const mins = Math.floor((time % 3600) / 60);
    const secs = Math.floor(time % 60);
    const ms = Math.floor((time % 1) * 100);
    return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
  };

  const handleScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const targetTime = Math.max(0, percent * (timelineDuration || 10));
    setPlayhead(targetTime);
  };

  const progressPercent = timelineDuration > 0 ? (playhead / timelineDuration) * 100 : 0;

  return (
    <div className="monitor-container" style={{ padding: "16px" }}>
      {/* Video Screen Panel */}
      <div className="video-screen">
        {videoSrc ? (
          <video
            ref={videoRef}
            src={videoSrc}
            className="video-element"
            preload="auto"
            onError={(e) => {
              console.error("Video error:", e);
              setErrorText("Failed to load video asset. Ensure proxy is ready.");
            }}
          />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", gap: "10px", background: "#06080e" }}>
            <span style={{ fontSize: "14px", fontWeight: "600", letterSpacing: "1px", background: "linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-teal) 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              PROGRAM MONITOR
            </span>
            <span style={{ fontSize: "10px", opacity: 0.6 }}>No Video Clip Active at Playhead</span>
          </div>
        )}

        {/* Subtitle Rendering Overlay */}
        {activeClip && activeClip.type === "video" && (
          <div className="subtitle-overlay">
            {/* Renders caption if subtitle layers exist */}
          </div>
        )}
      </div>

      {/* Controller Controls row */}
      <div className="monitor-controls">
        {/* Scrubber track */}
        <div className="time-scrubber" onClick={handleScrub}>
          <div className="time-scrubber-progress" style={{ width: `${progressPercent}%` }}></div>
          <div className="time-scrubber-handle" style={{ left: `${progressPercent}%` }}></div>
        </div>

        <div className="controls-row">
          {/* Timecode display */}
          <div className="time-display">
            {formatTime(playhead)} <span style={{ color: "var(--text-muted)", fontSize: "10px" }}>/ {formatTime(timelineDuration)}</span>
          </div>

          {/* Buttons player */}
          <div className="control-buttons">
            <button className="icon-btn" onClick={handleSkipStart} title="Jump to Start">
              <SkipBack size={18} />
            </button>
            <button className="icon-btn play" onClick={handleTogglePlay} title={isPlaying ? "Pause" : "Play"}>
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
