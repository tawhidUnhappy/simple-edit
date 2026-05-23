import React, { useRef, useEffect, useState } from "react";
import { useTimelineStore, Clip } from "../store/timelineStore";
import { Scissors, Trash2, ZoomIn, ZoomOut, Volume2, VolumeX, Eye, EyeOff, Lock, Unlock, Magnet, ArrowLeftToLine, ArrowRightToLine } from "lucide-react";

export const Timeline: React.FC = () => {
  const {
    tracks,
    playhead,
    setPlayhead,
    zoom,
    setZoom,
    timelineDuration,
    selectedClipId,
    setSelectedClipId,
    splitClip,
    deleteClip,
    moveClip,
    updateClipProperties,
    rippleDeleteClip,
    rippleTrimLeft,
    rippleTrimRight,
    isPlaying,
    setIsPlaying,
    toggleTrackLock,
    toggleTrackMute,
    toggleTrackHide,
    addClip,
  } = useTimelineStore();

  const rulerCanvasRef = useRef<HTMLCanvasElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Drag state: moving a clip
  const [draggedClip, setDraggedClip] = useState<{ clip: Clip; startX: number; originalTimeStart: number } | null>(null);

  // Resize state: dragging a clip edge
  const [resizeState, setResizeState] = useState<{
    clip: Clip;
    edge: "left" | "right";
    startX: number;
    original: { startOffset: number; endOffset: number; timeStart: number };
  } | null>(null);

  const [isScrubbing, setIsScrubbing] = useState(false);
  const [snappingEnabled, setSnappingEnabled] = useState(true);
  const [snapLineTime, setSnapLineTime] = useState<number | null>(null);

  // Stable refs to avoid stale closures in keyboard/wheel handlers
  const zoomRef = useRef(zoom);
  const isPlayingRef = useRef(isPlaying);
  const selectedClipIdRef = useRef(selectedClipId);
  const playheadRef = useRef(playhead);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { selectedClipIdRef.current = selectedClipId; }, [selectedClipId]);
  useEffect(() => { playheadRef.current = playhead; }, [playhead]);

  // 1. Draw Canvas Ruler
  useEffect(() => {
    const canvas = rulerCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const timelineWidth = Math.max(scrollAreaRef.current?.clientWidth || 800, timelineDuration * zoom + 300);
    canvas.width = timelineWidth;
    canvas.height = 28;

    ctx.fillStyle = "var(--bg-panel)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "var(--border-normal)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, canvas.height - 1);
    ctx.lineTo(canvas.width, canvas.height - 1);
    ctx.stroke();

    ctx.fillStyle = "var(--text-muted)";
    ctx.font = "9px var(--font-mono)";
    ctx.textAlign = "center";

    let tickSpacing = 1;
    if (zoom < 0.5) tickSpacing = 600; // 10 minutes
    else if (zoom < 2) tickSpacing = 120; // 2 minutes
    else if (zoom < 5) tickSpacing = 60;  // 1 minute
    else if (zoom < 15) tickSpacing = 10;
    else if (zoom < 35) tickSpacing = 5;
    else if (zoom < 80) tickSpacing = 2;

    const totalSeconds = Math.ceil(canvas.width / zoom);
    for (let s = 0; s <= totalSeconds; s++) {
      if (s % tickSpacing !== 0) continue;
      const x = s * zoom;
      const isMajor = s % (tickSpacing * 5) === 0;
      ctx.strokeStyle = isMajor ? "rgba(255, 255, 255, 0.25)" : "rgba(255, 255, 255, 0.1)";
      ctx.beginPath();
      ctx.moveTo(x, isMajor ? 12 : 18);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
      if (isMajor || zoom > 50) {
        const label = `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
        ctx.fillText(label, x, 10);
      }
    }
  }, [zoom, timelineDuration]);

  // 2. Playhead auto-scroll during playback
  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el || !isPlaying) return;
    const px = playhead * zoom;
    const viewLeft = el.scrollLeft + 120;
    const viewRight = el.scrollLeft + el.clientWidth;
    if (px > viewRight - 50 || px < viewLeft) {
      el.scrollLeft = px - 200;
    }
  }, [playhead, zoom, isPlaying]);

  // 3. Ctrl+scroll zoom
  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setZoom(zoomRef.current * factor);
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [setZoom]);

  const trimClipLeftAtPlayhead = (clipId: string, time: number) => {
    let clip: Clip | null = null;
    for (const track of tracks) {
      const found = track.clips.find((c) => c.id === clipId);
      if (found) { clip = found; break; }
    }
    if (!clip) return;
    const clipEnd = clip.timeStart + (clip.endOffset - clip.startOffset) / clip.speed;
    if (time <= clip.timeStart || time >= clipEnd) return;
    const offsetDelta = (time - clip.timeStart) * clip.speed;
    const newStartOffset = clip.startOffset + offsetDelta;
    updateClipProperties(clipId, {
      startOffset: newStartOffset,
      timeStart: time
    });
  };

  const trimClipRightAtPlayhead = (clipId: string, time: number) => {
    let clip: Clip | null = null;
    for (const track of tracks) {
      const found = track.clips.find((c) => c.id === clipId);
      if (found) { clip = found; break; }
    }
    if (!clip) return;
    const clipEnd = clip.timeStart + (clip.endOffset - clip.startOffset) / clip.speed;
    if (time <= clip.timeStart || time >= clipEnd) return;
    const offsetDelta = (time - clip.timeStart) * clip.speed;
    const newEndOffset = clip.startOffset + offsetDelta;
    updateClipProperties(clipId, {
      endOffset: newEndOffset
    });
  };

  // 4. Keyboard shortcuts (Space, S, Delete/Backspace, Q, W, B)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON" || tag === "SELECT") return;

      if (e.code === "Space") {
        e.preventDefault();
        const nextPlaying = !isPlayingRef.current;
        setIsPlaying(nextPlaying);
        window.dispatchEvent(new CustomEvent("playback-toggle", { detail: nextPlaying }));
      } else if (e.key === "=" || e.key === "+" || e.code === "NumpadAdd") {
        e.preventDefault();
        setZoom(zoomRef.current * 1.25);
      } else if (e.key === "-" || e.key === "_" || e.code === "NumpadSubtract") {
        e.preventDefault();
        setZoom(zoomRef.current / 1.25);
      } else if ((e.key === "0" || e.code === "Digit0") && e.ctrlKey) {
        e.preventDefault();
        setZoom(50);
      } else if ((e.key === "s" || e.key === "S" || e.key === "b" || e.key === "B") && !e.ctrlKey) {
        e.preventDefault();
        const id = selectedClipIdRef.current;
        if (id) {
          const currentTracks = useTimelineStore.getState().tracks;
          const clipTrack = currentTracks.find((t) => t.clips.some((c) => c.id === id));
          if (clipTrack?.locked) return;
          splitClip(id, playheadRef.current);
        }
      } else if ((e.key === "b" || e.key === "B") && e.ctrlKey) {
        e.preventDefault();
        const id = selectedClipIdRef.current;
        if (id) {
          const currentTracks = useTimelineStore.getState().tracks;
          const clipTrack = currentTracks.find((t) => t.clips.some((c) => c.id === id));
          if (clipTrack?.locked) return;
          splitClip(id, playheadRef.current);
        }
      } else if (e.key === "q" || e.key === "Q") {
        e.preventDefault();
        const id = selectedClipIdRef.current;
        if (id) {
          const currentTracks = useTimelineStore.getState().tracks;
          const clipTrack = currentTracks.find((t) => t.clips.some((c) => c.id === id));
          if (clipTrack?.locked) return;
          if (e.shiftKey) {
            trimClipLeftAtPlayhead(id, playheadRef.current);
          } else {
            rippleTrimLeft(id, playheadRef.current);
          }
        }
      } else if (e.key === "w" || e.key === "W") {
        e.preventDefault();
        const id = selectedClipIdRef.current;
        if (id) {
          const currentTracks = useTimelineStore.getState().tracks;
          const clipTrack = currentTracks.find((t) => t.clips.some((c) => c.id === id));
          if (clipTrack?.locked) return;
          if (e.shiftKey) {
            trimClipRightAtPlayhead(id, playheadRef.current);
          } else {
            rippleTrimRight(id, playheadRef.current);
          }
        }
      } else if (e.key === "Delete" || e.key === "Backspace") {
        const id = selectedClipIdRef.current;
        if (id) {
          const currentTracks = useTimelineStore.getState().tracks;
          const clipTrack = currentTracks.find((t) => t.clips.some((c) => c.id === id));
          if (clipTrack?.locked) return;
          e.preventDefault();
          if (e.shiftKey || (e.altKey && e.key === "Backspace")) {
            rippleDeleteClip(id);
          } else {
            deleteClip(id);
          }
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setIsPlaying, setZoom, splitClip, deleteClip, tracks]);

  // 5. Playhead scrubbing
  const handleRulerMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPlayingRef.current) {
      setIsPlaying(false);
      window.dispatchEvent(new CustomEvent("playback-toggle", { detail: false }));
    }
    setIsScrubbing(true);
    updatePlayheadFromEvent(e);
  };
  const handleRulerMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isScrubbing) return;
    updatePlayheadFromEvent(e);
  };
  const updatePlayheadFromEvent = (e: React.MouseEvent) => {
    const rect = scrollAreaRef.current?.getBoundingClientRect();
    if (!rect) return;
    const relX = e.clientX - rect.left - 120 + (scrollAreaRef.current?.scrollLeft || 0);
    setPlayhead(Math.max(0, relX / zoom));
  };

  // 6. Global mouse-up: clears drag / resize / scrub
  const handleGlobalMouseUp = () => {
    setIsScrubbing(false);
    setDraggedClip(null);
    setResizeState(null);
    setSnapLineTime(null);
  };
  useEffect(() => {
    window.addEventListener("mouseup", handleGlobalMouseUp);
    return () => window.removeEventListener("mouseup", handleGlobalMouseUp);
  }, []);

  // 7. Zoom buttons
  const zoomIn = () => setZoom(zoom * 1.2);
  const zoomOut = () => setZoom(zoom / 1.2);

  // 9. Toolbar actions
  const handleSplitActiveClip = () => {
    if (selectedClipId) {
      const clipTrack = tracks.find((t) => t.clips.some((c) => c.id === selectedClipId));
      if (clipTrack?.locked) return;
      splitClip(selectedClipId, playhead);
    }
  };
  const handleDeleteActiveClip = () => {
    if (selectedClipId) {
      const clipTrack = tracks.find((t) => t.clips.some((c) => c.id === selectedClipId));
      if (clipTrack?.locked) return;
      deleteClip(selectedClipId);
    }
  };

  // 10. Clip drag (move)
  const handleClipMouseDown = (e: React.MouseEvent, clip: Clip) => {
    e.stopPropagation();
    const track = tracks.find((t) => t.id === clip.trackId);
    if (track?.locked) {
      setSelectedClipId(clip.id);
      return;
    }
    setSelectedClipId(clip.id);
    setDraggedClip({ clip, startX: e.clientX, originalTimeStart: clip.timeStart });
  };

  // 11. Clip resize (edge drag)
  const handleResizeMouseDown = (e: React.MouseEvent, clip: Clip, edge: "left" | "right") => {
    e.stopPropagation();
    e.preventDefault();
    const track = tracks.find((t) => t.id === clip.trackId);
    if (track?.locked) return;

    setSelectedClipId(clip.id);
    setResizeState({
      clip,
      edge,
      startX: e.clientX,
      original: { startOffset: clip.startOffset, endOffset: clip.endOffset, timeStart: clip.timeStart },
    });
  };

  // 12. Mouse move handler for drag + resize
  const handleTimelineAreaMouseMove = (e: React.MouseEvent) => {
    const getSnapTime = (targetTime: number, excludeClipId: string, snapThreshold = 0.25): number | null => {
      if (Math.abs(targetTime - playhead) < snapThreshold) {
        return playhead;
      }
      for (const track of tracks) {
        for (const other of track.clips) {
          if (other.id === excludeClipId) continue;
          const otherEnd = other.timeStart + (other.endOffset - other.startOffset) / other.speed;
          if (Math.abs(targetTime - other.timeStart) < snapThreshold) {
            return other.timeStart;
          }
          if (Math.abs(targetTime - otherEnd) < snapThreshold) {
            return otherEnd;
          }
        }
      }
      return null;
    };

    if (resizeState) {
      const { clip, edge, startX, original } = resizeState;
      const deltaTime = (e.clientX - startX) / zoom;

      let snappedTime: number | null = null;

      if (edge === "right") {
        let targetEnd = original.timeStart + (original.endOffset + deltaTime * clip.speed - clip.startOffset) / clip.speed;
        if (snappingEnabled) {
          const snapped = getSnapTime(targetEnd, clip.id);
          if (snapped !== null) {
            targetEnd = snapped;
            snappedTime = snapped;
          }
        }
        setSnapLineTime(snappedTime);
        let newEnd = clip.startOffset + (targetEnd - original.timeStart) * clip.speed;
        newEnd = Math.max(original.startOffset + 0.1, Math.min(clip.duration, newEnd));
        updateClipProperties(clip.id, { endOffset: newEnd });
      } else {
        let newTimeStart = original.timeStart + deltaTime;
        if (snappingEnabled) {
          const snapped = getSnapTime(newTimeStart, clip.id);
          if (snapped !== null) {
            newTimeStart = snapped;
            snappedTime = snapped;
          }
        }
        setSnapLineTime(snappedTime);
        const actualDeltaTime = newTimeStart - original.timeStart;
        let newStart = original.startOffset + actualDeltaTime * clip.speed;
        newStart = Math.max(0, Math.min(original.endOffset - 0.1, newStart));
        const finalTimeStart = original.timeStart + (newStart - original.startOffset) / clip.speed;
        updateClipProperties(clip.id, { startOffset: newStart, timeStart: finalTimeStart });
      }
      return;
    }

    if (draggedClip) {
      const deltaTime = (e.clientX - draggedClip.startX) / zoom;
      let newTimeStart = Math.max(0, draggedClip.originalTimeStart + deltaTime);

      let snappedTime: number | null = null;

      if (snappingEnabled) {
        const snapThreshold = 0.25; // 250ms snap window
        const clipDur = (draggedClip.clip.endOffset - draggedClip.clip.startOffset) / draggedClip.clip.speed;

        // Proximity check on left edge
        const leftSnap = getSnapTime(newTimeStart, draggedClip.clip.id, snapThreshold);
        if (leftSnap !== null) {
          newTimeStart = leftSnap;
          snappedTime = leftSnap;
        } else {
          // Proximity check on right edge
          const rightSnap = getSnapTime(newTimeStart + clipDur, draggedClip.clip.id, snapThreshold);
          if (rightSnap !== null) {
            newTimeStart = rightSnap - clipDur;
            snappedTime = rightSnap;
          }
        }
      }

      setSnapLineTime(snappedTime);
      moveClip(draggedClip.clip.id, draggedClip.clip.trackId, newTimeStart);
    }
  };

  return (
    <div className="timeline-container">
      {/* Toolbar */}
      <div className="timeline-toolbar">
        <div className="toolbar-group">
          <button
            className="btn-secondary"
            style={{ padding: "4px 8px", fontSize: "11px" }}
            onClick={handleSplitActiveClip}
            disabled={!selectedClipId}
            title="Split at Playhead (S / B / Ctrl+B)"
          >
            <Scissors size={12} /> Split
          </button>
          <button
            className="btn-secondary"
            style={{ padding: "4px 8px", fontSize: "11px" }}
            onClick={() => selectedClipId && trimClipLeftAtPlayhead(selectedClipId, playhead)}
            disabled={!selectedClipId}
            title="Trim Start to Playhead (Shift+Q)"
          >
            <ArrowLeftToLine size={12} /> Trim Left
          </button>
          <button
            className="btn-secondary"
            style={{ padding: "4px 8px", fontSize: "11px", color: "var(--text-bright)", borderColor: "rgba(56, 189, 248, 0.3)" }}
            onClick={() => selectedClipId && rippleTrimLeft(selectedClipId, playhead)}
            disabled={!selectedClipId}
            title="Ripple Trim Start (Q)"
          >
            <ArrowLeftToLine size={12} style={{ color: "#38bdf8" }} /> Ripple Trim Left
          </button>
          <button
            className="btn-secondary"
            style={{ padding: "4px 8px", fontSize: "11px" }}
            onClick={() => selectedClipId && trimClipRightAtPlayhead(selectedClipId, playhead)}
            disabled={!selectedClipId}
            title="Trim End to Playhead (Shift+W)"
          >
            <ArrowRightToLine size={12} /> Trim Right
          </button>
          <button
            className="btn-secondary"
            style={{ padding: "4px 8px", fontSize: "11px", color: "var(--text-bright)", borderColor: "rgba(56, 189, 248, 0.3)" }}
            onClick={() => selectedClipId && rippleTrimRight(selectedClipId, playhead)}
            disabled={!selectedClipId}
            title="Ripple Trim End (W)"
          >
            <ArrowRightToLine size={12} style={{ color: "#38bdf8" }} /> Ripple Trim Right
          </button>
          <button
            className="btn-secondary"
            style={{ padding: "4px 8px", fontSize: "11px", color: "var(--text-normal)", borderColor: "var(--border-normal)" }}
            onClick={handleDeleteActiveClip}
            disabled={!selectedClipId}
            title="Delete Selected (Del)"
          >
            <Trash2 size={12} /> Delete
          </button>
          <button
            className="btn-secondary"
            style={{ padding: "4px 8px", fontSize: "11px", color: "#f87171", borderColor: "rgba(239, 68, 68, 0.3)" }}
            onClick={() => selectedClipId && rippleDeleteClip(selectedClipId)}
            disabled={!selectedClipId}
            title="Ripple Delete (Shift+Del)"
          >
            <Trash2 size={12} style={{ color: "#ef4444" }} /> Ripple Delete
          </button>
        </div>

        <div className="toolbar-group" style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button
            className={`btn-secondary ${snappingEnabled ? "active" : ""}`}
            style={{ 
              padding: "4px 8px", 
              fontSize: "11px",
              borderColor: snappingEnabled ? "var(--border-focus)" : "var(--border-normal)",
              color: snappingEnabled ? "#fff" : "var(--text-muted)",
              background: snappingEnabled ? "rgba(255,255,255,0.06)" : "none",
              display: "flex",
              alignItems: "center",
              gap: "4px"
            }}
            onClick={() => setSnappingEnabled(!snappingEnabled)}
            title="Toggle Snapping (Magnet Tool)"
          >
            <Magnet size={12} style={{ color: snappingEnabled ? "var(--text-bright)" : "inherit" }} />
            <span>Snapping</span>
          </button>

          <div style={{ display: "flex", gap: "6px", alignItems: "center", borderLeft: "1px solid var(--border-dim)", paddingLeft: "10px" }}>
            <span style={{ fontSize: "9px", color: "var(--text-muted)", opacity: 0.5 }}>Ctrl+Scroll or</span>
            <button className="btn-secondary" style={{ padding: "4px" }} onClick={zoomOut} title="Zoom Out">
              <ZoomOut size={14} />
            </button>
            <span style={{ fontSize: "10px", color: "var(--text-muted)", width: "40px", textAlign: "center" }}>
              {Math.round(zoom)}px/s
            </span>
            <button className="btn-secondary" style={{ padding: "4px" }} onClick={zoomIn} title="Zoom In">
              <ZoomIn size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable timeline viewport */}
      <div
        className="timeline-scrollview"
        ref={scrollAreaRef}
        onMouseMove={handleTimelineAreaMouseMove}
        style={{ userSelect: "none", cursor: resizeState ? "ew-resize" : draggedClip ? "grabbing" : "default" }}
      >
        <div style={{ position: "relative", minWidth: "100%", width: "fit-content" }}>

          {/* Ruler */}
          <div style={{ display: "flex", paddingLeft: "120px", position: "sticky", top: 0, zIndex: 4 }}>
            <canvas
              ref={rulerCanvasRef}
              className="ruler-canvas"
              onMouseDown={handleRulerMouseDown}
              onMouseMove={handleRulerMouseMove}
              style={{ cursor: "col-resize" }}
            />
          </div>

          {/* Track rows */}
          <div className="tracks-area">
            {tracks.map((track) => {
              const isMuted = !!track.muted;
              const isHidden = !!track.hidden;
              const isLocked = !!track.locked;

              return (
                <div
                  key={track.id}
                  className={`track-row ${track.type}`}
                  style={{
                    opacity: isHidden ? 0.35 : 1,
                    position: "relative",
                  }}
                >
                  <div className="track-header">
                    <span className="track-name">{track.name}</span>
                    <div style={{ display: "flex", gap: "8px", marginTop: "2px" }}>
                      <button
                        onClick={() => toggleTrackLock(track.id)}
                        style={{ background: "none", border: "none", color: isLocked ? "var(--text-bright)" : "var(--text-muted)", cursor: "pointer" }}
                        title={isLocked ? "Unlock Track" : "Lock Track"}
                      >
                        {isLocked ? <Lock size={10} /> : <Unlock size={10} />}
                      </button>
                      <button
                        onClick={() => toggleTrackMute(track.id)}
                        style={{ background: "none", border: "none", color: isMuted ? "var(--text-bright)" : "var(--text-muted)", cursor: "pointer" }}
                        title={isMuted ? "Unmute" : "Mute"}
                      >
                        {isMuted ? <VolumeX size={10} /> : <Volume2 size={10} />}
                      </button>
                      <button
                        onClick={() => toggleTrackHide(track.id)}
                        style={{ background: "none", border: "none", color: isHidden ? "var(--text-bright)" : "var(--text-muted)", cursor: "pointer" }}
                        title={isHidden ? "Unhide" : "Hide"}
                      >
                        {isHidden ? <EyeOff size={10} /> : <Eye size={10} />}
                      </button>
                    </div>
                  </div>

                  <div
                    className="track-timeline-content"
                    onDoubleClick={(e) => {
                      if (e.target === e.currentTarget) setSelectedClipId(null);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "copy";
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      try {
                        const mediaStr = e.dataTransfer.getData("application/json");
                        if (!mediaStr) return;
                        const media = JSON.parse(mediaStr);
                        if (!media) return;

                        // Calculate drop position in seconds
                        const rect = e.currentTarget.getBoundingClientRect();
                        const dropX = e.clientX - rect.left + (scrollAreaRef.current?.scrollLeft || 0);
                        const dropTime = Math.max(0, dropX / zoom);

                        const ext = (media.filePath as string).split(".").pop()?.toLowerCase() ?? "";
                        const isImage = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(ext);
                        const isAudio = !media.width && !media.height && !isImage;

                        // Validate that media type matches the track type
                        if (track.type === "audio" && !isAudio) {
                          alert("Only audio clips can be dropped onto the Audio Track!");
                          return;
                        }
                        if (track.type === "video" && isAudio) {
                          alert("Only video or image clips can be dropped onto the Video Track!");
                          return;
                        }

                        const clipType: Clip["type"] = isImage ? "image" : isAudio ? "audio" : "video";
                        const sourceDuration = isImage ? 9999 : media.duration;
                        const displayEnd = isImage ? 5.0 : media.duration;

                        const colorMap: Record<string, string> = {
                          video: "var(--bg-panel-light)",
                          audio: "var(--bg-panel)",
                          image: "var(--bg-darker)",
                        };

                        addClip(track.id, {
                          name: media.name,
                          filePath: media.filePath,
                          proxyPath: media.proxyPath,
                          type: clipType,
                          duration: sourceDuration,
                          startOffset: 0,
                          endOffset: displayEnd,
                          timeStart: dropTime,
                          volume: 1.0,
                          speed: 1.0,
                          color: colorMap[clipType],
                        });
                      } catch (err) {
                        console.error("Drop failed:", err);
                      }
                    }}
                    style={{ position: "relative" }}
                  >
                    {isLocked && (
                      <div
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          right: 0,
                          bottom: 0,
                          background: "repeating-linear-gradient(45deg, rgba(0, 0, 0, 0.25) 0, rgba(0, 0, 0, 0.25) 10px, transparent 10px, transparent 20px)",
                          pointerEvents: "none",
                          zIndex: 3,
                          opacity: 0.4,
                        }}
                      />
                    )}
                    {track.clips.map((clip) => {
                      const clipDuration = (clip.endOffset - clip.startOffset) / clip.speed;
                      const leftPx = clip.timeStart * zoom;
                      const widthPx = Math.max(4, clipDuration * zoom);
                      const isSelected = selectedClipId === clip.id;

                      return (
                        <div
                          key={clip.id}
                          className={`timeline-clip ${clip.type} ${isSelected ? "selected" : ""}`}
                          style={{
                            left: `${leftPx}px`,
                            width: `${widthPx}px`,
                            backgroundColor: clip.type === "video" ? "var(--bg-panel-light)" : clip.type === "audio" ? "var(--bg-panel)" : clip.type === "subtitle" ? "var(--bg-darker)" : "var(--border-normal)",
                            position: "absolute",
                            cursor: draggedClip?.clip.id === clip.id ? "grabbing" : "grab",
                          }}
                          onMouseDown={(e) => handleClipMouseDown(e, clip)}
                        >
                          {/* Left resize handle */}
                          {!isLocked && (
                            <div
                              onMouseDown={(e) => handleResizeMouseDown(e, clip, "left")}
                              style={{
                                position: "absolute",
                                left: 0,
                                top: 0,
                                bottom: 0,
                                width: "7px",
                                cursor: "ew-resize",
                                background: "rgba(255,255,255,0.18)",
                                borderRadius: "3px 0 0 3px",
                                zIndex: 2,
                              }}
                            />
                          )}

                          <span className="clip-name" style={{ paddingLeft: "10px", paddingRight: "10px", display: "inline-flex", alignItems: "center" }}>
                            {isLocked && <Lock size={10} style={{ marginRight: "4px" }} />}
                            {clip.name}
                          </span>
                          <span className="clip-time-bounds">
                            {clip.startOffset.toFixed(1)}s – {clip.endOffset.toFixed(1)}s
                          </span>

                          {/* Right resize handle */}
                          {!isLocked && (
                            <div
                              onMouseDown={(e) => handleResizeMouseDown(e, clip, "right")}
                              style={{
                                position: "absolute",
                                right: 0,
                                top: 0,
                                bottom: 0,
                                width: "7px",
                                cursor: "ew-resize",
                                background: "rgba(255,255,255,0.18)",
                                borderRadius: "0 3px 3px 0",
                                zIndex: 2,
                              }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {snapLineTime !== null && (
              <div
                className="timeline-snap-line"
                style={{
                  position: "absolute",
                  left: `${snapLineTime * zoom + 120}px`,
                  top: 0,
                  bottom: 0,
                  width: "1.5px",
                  backgroundColor: "#38bdf8",
                  boxShadow: "0 0 8px #38bdf8",
                  zIndex: 5,
                  pointerEvents: "none",
                }}
              />
            )}

            {/* Playhead line */}
            <div
              className="timeline-playhead-line"
              style={{ left: `${playhead * zoom + 120}px` }}
            >
              <div className="timeline-playhead-handle"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Timeline;
