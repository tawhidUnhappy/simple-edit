import React, { useRef, useEffect, useState } from "react";
import { useTimelineStore, Clip, Track } from "../store/timelineStore";
import { Scissors, Trash2, ZoomIn, ZoomOut, Volume2, VolumeX, Eye, EyeOff } from "lucide-react";

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
    isPlaying
  } = useTimelineStore();

  const rulerCanvasRef = useRef<HTMLCanvasElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  
  // Track mute / hide states locally
  const [mutedTracks, setMutedTracks] = useState<Record<string, boolean>>({});
  const [hiddenTracks, setHiddenTracks] = useState<Record<string, boolean>>({});

  // Dragging state for clips
  const [draggedClip, setDraggedClip] = useState<{ clip: Clip; startX: number; originalTimeStart: number } | null>(null);

  // Dragging state for playhead
  const [isScrubbing, setIsScrubbing] = useState(false);

  // 1. Draw Canvas Ruler Ticks
  useEffect(() => {
    const canvas = rulerCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Resize canvas based on client width or timeline pixel duration
    const timelineWidth = Math.max(scrollAreaRef.current?.clientWidth || 800, timelineDuration * zoom + 300);
    canvas.width = timelineWidth;
    canvas.height = 28;

    // Drawing settings
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

    // Draw grid lines and labels every 1s, 5s, or 10s based on zoom scale
    let tickSpacing = 1; // standard spacing in seconds
    if (zoom < 15) tickSpacing = 10;
    else if (zoom < 35) tickSpacing = 5;
    else if (zoom < 80) tickSpacing = 2;
    else tickSpacing = 1;

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
        const minutes = Math.floor(s / 60);
        const seconds = s % 60;
        const label = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
        ctx.fillText(label, x, 10);
      }
    }
  }, [zoom, timelineDuration]);

  // 2. Playhead auto-scrolling during active playback
  useEffect(() => {
    const scrollContainer = scrollAreaRef.current;
    if (!scrollContainer || !isPlaying) return;

    const playheadPx = playhead * zoom;
    const viewLeft = scrollContainer.scrollLeft + 120; // accounting for track header
    const viewRight = scrollContainer.scrollLeft + scrollContainer.clientWidth;

    if (playheadPx > viewRight - 50 || playheadPx < viewLeft) {
      scrollContainer.scrollLeft = playheadPx - 200;
    }
  }, [playhead, zoom, isPlaying]);

  // 3. Playhead Scrubbing Handlers
  const handleRulerMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsScrubbing(true);
    updatePlayheadPosition(e);
  };

  const handleRulerMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isScrubbing) return;
    updatePlayheadPosition(e);
  };

  const handleGlobalMouseUp = () => {
    setIsScrubbing(false);
    setDraggedClip(null);
  };

  useEffect(() => {
    window.addEventListener("mouseup", handleGlobalMouseUp);
    return () => {
      window.removeEventListener("mouseup", handleGlobalMouseUp);
    };
  }, []);

  const updatePlayheadPosition = (e: React.MouseEvent<HTMLCanvasElement | HTMLDivElement>) => {
    const rect = scrollAreaRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    // Relative mouse X position inside the scroll container content
    const relativeX = e.clientX - rect.left - 120 + (scrollAreaRef.current?.scrollLeft || 0);
    const targetSeconds = Math.max(0, relativeX / zoom);
    setPlayhead(targetSeconds);
  };

  // 4. Zoom Controls
  const zoomIn = () => setZoom(zoom * 1.2);
  const zoomOut = () => setZoom(zoom / 1.2);

  // 5. Track Actions
  const toggleMute = (trackId: string) => {
    setMutedTracks(prev => ({ ...prev, [trackId]: !prev[trackId] }));
  };

  const toggleHide = (trackId: string) => {
    setHiddenTracks(prev => ({ ...prev, [trackId]: !prev[trackId] }));
  };

  // 6. Clip Splicing & Deleting
  const handleSplitActiveClip = () => {
    if (selectedClipId) {
      splitClip(selectedClipId, playhead);
    }
  };

  const handleDeleteActiveClip = () => {
    if (selectedClipId) {
      deleteClip(selectedClipId);
    }
  };

  // 7. Drag-and-Drop / Move clip triggers
  const handleClipMouseDown = (e: React.MouseEvent, clip: Clip) => {
    e.stopPropagation();
    setSelectedClipId(clip.id);
    setDraggedClip({
      clip,
      startX: e.clientX,
      originalTimeStart: clip.timeStart,
    });
  };

  const handleTimelineAreaMouseMove = (e: React.MouseEvent) => {
    if (!draggedClip) return;
    
    const deltaX = e.clientX - draggedClip.startX;
    const deltaTime = deltaX / zoom;
    const newTimeStart = Math.max(0, draggedClip.originalTimeStart + deltaTime);

    // Apply snap-to-playhead logic if mouse is within 0.25 seconds of playhead
    const snapDistance = 0.25;
    let finalTimeStart = newTimeStart;
    if (Math.abs(newTimeStart - playhead) < snapDistance) {
      finalTimeStart = playhead;
    }
    
    // Snap to other clip endpoints
    for (const track of tracks) {
      for (const other of track.clips) {
        if (other.id === draggedClip.clip.id) continue;
        const otherEnd = other.timeStart + (other.endOffset - other.startOffset) / other.speed;
        
        if (Math.abs(newTimeStart - otherEnd) < snapDistance) {
          finalTimeStart = otherEnd; // snap start of dragged to end of other
        }
        
        const clipDuration = (draggedClip.clip.endOffset - draggedClip.clip.startOffset) / draggedClip.clip.speed;
        if (Math.abs((newTimeStart + clipDuration) - other.timeStart) < snapDistance) {
          finalTimeStart = other.timeStart - clipDuration; // snap end of dragged to start of other
        }
      }
    }

    moveClip(draggedClip.clip.id, draggedClip.clip.trackId, finalTimeStart);
  };

  return (
    <div className="timeline-container">
      {/* Timeline Toolbar controls */}
      <div className="timeline-toolbar">
        <div className="toolbar-group">
          <button
            className="btn-secondary"
            style={{ padding: "4px 8px", fontSize: "11px" }}
            onClick={handleSplitActiveClip}
            disabled={!selectedClipId}
            title="Split Clip at Playhead (S)"
          >
            <Scissors size={12} /> Split Clip
          </button>
          <button
            className="btn-secondary"
            style={{ padding: "4px 8px", fontSize: "11px", color: "var(--accent-rose)", borderColor: "rgba(244, 63, 94, 0.2)" }}
            onClick={handleDeleteActiveClip}
            disabled={!selectedClipId}
            title="Delete Selected Clip (Backspace)"
          >
            <Trash2 size={12} /> Delete
          </button>
        </div>

        <div className="toolbar-group" style={{ display: "flex", gap: "6px" }}>
          <button className="btn-secondary" style={{ padding: "4px" }} onClick={zoomOut} title="Zoom Out">
            <ZoomOut size={14} />
          </button>
          <span style={{ fontSize: "10px", color: "var(--text-muted)", width: "32px", textAlign: "center" }}>
            {Math.round(zoom)}%
          </span>
          <button className="btn-secondary" style={{ padding: "4px" }} onClick={zoomIn} title="Zoom In">
            <ZoomIn size={14} />
          </button>
        </div>
      </div>

      {/* Main scrolling viewport tracks */}
      <div
        className="timeline-scrollview"
        ref={scrollAreaRef}
        onMouseMove={handleTimelineAreaMouseMove}
        style={{ userSelect: "none" }}
      >
        <div style={{ position: "relative", minWidth: "100%", width: "fit-content" }}>
          
          {/* Virtual Canvas Time Ruler */}
          <div style={{ display: "flex", paddingLeft: "120px", position: "sticky", top: 0, zIndex: 4 }}>
            <canvas
              ref={rulerCanvasRef}
              className="ruler-canvas"
              onMouseDown={handleRulerMouseDown}
              onMouseMove={handleRulerMouseMove}
              style={{ cursor: "col-resize" }}
            />
          </div>

          {/* Timeline Tracks Rows */}
          <div className="tracks-area">
            {tracks.map((track) => {
              const isMuted = mutedTracks[track.id];
              const isHidden = hiddenTracks[track.id];

              return (
                <div key={track.id} className={`track-row ${track.type}`} style={{ opacity: isHidden ? 0.3 : 1 }}>
                  {/* Left sidebar header */}
                  <div className="track-header">
                    <span className="track-name">{track.name}</span>
                    <div style={{ display: "flex", gap: "8px", marginTop: "2px" }}>
                      <button
                        onClick={() => toggleMute(track.id)}
                        style={{ background: "none", border: "none", color: isMuted ? "var(--accent-rose)" : "var(--text-muted)", cursor: "pointer" }}
                        title={isMuted ? "Unmute" : "Mute"}
                      >
                        {isMuted ? <VolumeX size={10} /> : <Volume2 size={10} />}
                      </button>
                      <button
                        onClick={() => toggleHide(track.id)}
                        style={{ background: "none", border: "none", color: isHidden ? "var(--accent-rose)" : "var(--text-muted)", cursor: "pointer" }}
                        title={isHidden ? "Unhide" : "Hide"}
                      >
                        {isHidden ? <EyeOff size={10} /> : <Eye size={10} />}
                      </button>
                    </div>
                  </div>

                  {/* Right tracks lane */}
                  <div
                    className="track-timeline-content"
                    onDoubleClick={(e) => {
                      // Click on blank track space clears selected clip
                      if (e.target === e.currentTarget) {
                        setSelectedClipId(null);
                      }
                    }}
                  >
                    {track.clips.map((clip) => {
                      const clipDuration = (clip.endOffset - clip.startOffset) / clip.speed;
                      const leftPx = clip.timeStart * zoom;
                      const widthPx = clipDuration * zoom;
                      const isSelected = selectedClipId === clip.id;

                      return (
                        <div
                          key={clip.id}
                          className={`timeline-clip ${clip.type} ${isSelected ? "selected" : ""}`}
                          style={{
                            left: `${leftPx}px`,
                            width: `${widthPx}px`,
                            backgroundColor: clip.color || "var(--accent-primary)",
                          }}
                          onMouseDown={(e) => handleClipMouseDown(e, clip)}
                        >
                          <span className="clip-name">{clip.name}</span>
                          <span className="clip-time-bounds">
                            {clip.startOffset.toFixed(1)}s - {clip.endOffset.toFixed(1)}s
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Playhead vertical line slider */}
            <div
              className="timeline-playhead-line"
              style={{
                left: `${playhead * zoom + 120}px`,
              }}
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
