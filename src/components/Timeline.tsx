import React, { useRef, useEffect, useState, useCallback } from "react";
import { useTimelineStore, Clip, Track } from "../store/timelineStore";
import { useShallow } from "zustand/react/shallow";
import { playheadBus } from "../lib/playheadBus";
import { Scissors, Trash2, ZoomIn, ZoomOut, Volume2, VolumeX, Eye, EyeOff, Lock, Unlock, Magnet, ArrowLeftToLine, ArrowRightToLine } from "lucide-react";

// ─── Canvas drawing ──────────────────────────────────────────────────────────

const CLIP_COLORS: Record<string, { bg: string; bgSel: string; border: string; text: string }> = {
  video: { bg: "#252836", bgSel: "#2d3147", border: "rgba(255,255,255,0.08)", text: "#9aa0bb" },
  audio: { bg: "#1c1f2e", bgSel: "#252840", border: "rgba(255,255,255,0.07)", text: "#8a90a8" },
  image: { bg: "#1a1c28", bgSel: "#222438", border: "rgba(255,255,255,0.06)", text: "#858ba2" },
  subtitle: { bg: "#1e2030", bgSel: "#262840", border: "rgba(255,255,255,0.06)", text: "#7a8098" },
};

interface DrawState {
  dragClipId: string | null;
  dragTimeStart: number;
  resizeClipId: string | null;
  resizeClip: Clip | null;
}

function drawTrack(
  canvas: HTMLCanvasElement,
  clips: Clip[],
  zoom: number,
  selectedId: string | null,
  isLocked: boolean,
  ds: DrawState,
  logicalW: number,
  logicalH: number,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, logicalW, logicalH);
  const H = logicalH;

  for (let ci = 0; ci < clips.length; ci++) {
    const clip = clips[ci];
    let timeStart = clip.timeStart;
    let startOffset = clip.startOffset;
    let endOffset = clip.endOffset;

    if (ds.dragClipId === clip.id) timeStart = ds.dragTimeStart;
    if (ds.resizeClipId === clip.id && ds.resizeClip) {
      startOffset = ds.resizeClip.startOffset;
      endOffset = ds.resizeClip.endOffset;
      timeStart = ds.resizeClip.timeStart;
    }

    const dur = (endOffset - startOffset) / clip.speed;
    const x = Math.round(timeStart * zoom);
    const w = Math.max(4, Math.round(dur * zoom));
    const isSelected = selectedId === clip.id;
    const colors = CLIP_COLORS[clip.type] ?? CLIP_COLORS.video;

    // Body
    ctx.fillStyle = isSelected ? colors.bgSel : colors.bg;
    ctx.fillRect(x, 1, w, H - 2);

    // Border / selection ring
    ctx.strokeStyle = isSelected ? "#60a5fa" : colors.border;
    ctx.lineWidth = isSelected ? 1.5 : 1;
    ctx.strokeRect(x + 0.5, 1.5, w - 1, H - 3);

    // Clip labelling (clipped to clip width)
    if (w > 18) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 8, 0, Math.max(0, w - 16), H);
      ctx.clip();
      ctx.fillStyle = isSelected ? "#e0e4ff" : colors.text;
      ctx.font = "11px system-ui, sans-serif";
      ctx.fillText(clip.name, x + 8, 16);
      if (w > 60) {
        ctx.fillStyle = "rgba(255,255,255,0.28)";
        ctx.font = "9px monospace";
        ctx.fillText(`${startOffset.toFixed(1)}s–${endOffset.toFixed(1)}s`, x + 8, 29);
      }
      ctx.restore();
    }

    // Resize handles — 8px wide, clearly visible strips
    if (!isLocked && w >= 20) {
      const hColor = isSelected ? "rgba(96,165,250,0.60)" : "rgba(255,255,255,0.38)";
      const pipColor = isSelected ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.72)";
      const mid = Math.round(H / 2);
      // Left handle
      ctx.fillStyle = hColor;
      ctx.fillRect(x, 1, 8, H - 2);
      ctx.fillStyle = pipColor;
      ctx.fillRect(x + 3, mid - 6, 2, 12);
      // Right handle
      ctx.fillStyle = hColor;
      ctx.fillRect(x + w - 8, 1, 8, H - 2);
      ctx.fillStyle = pipColor;
      ctx.fillRect(x + w - 5, mid - 6, 2, 12);
    }
  }

  // Locked overlay (diagonal stripe)
  if (isLocked) {
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, logicalW, logicalH);
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 8;
    for (let i = -logicalH; i < logicalW + logicalH; i += 18) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + logicalH, logicalH); ctx.stroke();
    }
    ctx.restore();
  }
}

function hitTest(
  canvasX: number,
  clips: Clip[],
  zoom: number,
): { clip: Clip; edge: "left" | "right" | "body" } | null {
  for (let i = clips.length - 1; i >= 0; i--) {
    const clip = clips[i];
    const cx = clip.timeStart * zoom;
    const cw = Math.max(4, (clip.endOffset - clip.startOffset) / clip.speed * zoom);
    if (canvasX < cx || canvasX > cx + cw) continue;
    if (canvasX - cx <= 14) return { clip, edge: "left" };
    if (cx + cw - canvasX <= 14) return { clip, edge: "right" };
    return { clip, edge: "body" };
  }
  return null;
}

// ─── Component ───────────────────────────────────────────────────────────────

const TimelineComponent: React.FC = () => {
  const {
    tracks,
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
  } = useTimelineStore(useShallow((s) => ({
    tracks: s.tracks,
    setPlayhead: s.setPlayhead,
    zoom: s.zoom,
    setZoom: s.setZoom,
    timelineDuration: s.timelineDuration,
    selectedClipId: s.selectedClipId,
    setSelectedClipId: s.setSelectedClipId,
    splitClip: s.splitClip,
    deleteClip: s.deleteClip,
    moveClip: s.moveClip,
    updateClipProperties: s.updateClipProperties,
    rippleDeleteClip: s.rippleDeleteClip,
    rippleTrimLeft: s.rippleTrimLeft,
    rippleTrimRight: s.rippleTrimRight,
    isPlaying: s.isPlaying,
    setIsPlaying: s.setIsPlaying,
    toggleTrackLock: s.toggleTrackLock,
    toggleTrackMute: s.toggleTrackMute,
    toggleTrackHide: s.toggleTrackHide,
    addClip: s.addClip,
  })));

  const rulerCanvasRef = useRef<HTMLCanvasElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const playheadLineRef = useRef<HTMLDivElement>(null);
  // Map of trackId → canvas element for clip rendering
  const trackCanvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());

  const [draggedClip, setDraggedClip] = useState<{ clip: Clip; startX: number; originalTimeStart: number; currentTimeStart: number } | null>(null);
  const [resizeState, setResizeState] = useState<{
    clip: Clip; edge: "left" | "right"; startX: number;
    original: { startOffset: number; endOffset: number; timeStart: number };
    current: Clip;
  } | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [snappingEnabled, setSnappingEnabled] = useState(true);
  const [snapLineTime, setSnapLineTime] = useState<number | null>(null);

  // Stable refs
  const zoomRef = useRef(zoom);
  const isPlayingRef = useRef(isPlaying);
  const selectedClipIdRef = useRef(selectedClipId);
  const playheadRef = useRef(0);
  // Pinch-to-zoom: tracks two pointer positions
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchInitRef = useRef<{ dist: number; zoom: number } | null>(null);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { selectedClipIdRef.current = selectedClipId; }, [selectedClipId]);

  // Bus → DOM (no React re-renders)
  useEffect(() => {
    return playheadBus.on((t) => {
      playheadRef.current = t;
      const el = playheadLineRef.current;
      if (el) el.style.left = `${t * zoomRef.current + 120}px`;
    });
  }, []);

  useEffect(() => {
    const el = playheadLineRef.current;
    if (el) el.style.left = `${playheadRef.current * zoom + 120}px`;
  }, [zoom]);

  // Auto-scroll during playback (bus, zero re-renders)
  useEffect(() => {
    return playheadBus.on((t) => {
      const el = scrollAreaRef.current;
      if (!el || !isPlayingRef.current) return;
      const px = t * zoomRef.current;
      if (px > el.scrollLeft + el.clientWidth - 50 || px < el.scrollLeft + 120) {
        el.scrollLeft = px - 200;
      }
    });
  }, []);

  // ── Canvas redraw whenever tracks / zoom / selection / drag / resize change ──
  const drawState: DrawState = {
    dragClipId: draggedClip?.clip.id ?? null,
    dragTimeStart: draggedClip?.currentTimeStart ?? 0,
    resizeClipId: resizeState?.clip.id ?? null,
    resizeClip: resizeState?.current ?? null,
  };

  useEffect(() => {
    const dpr = window.devicePixelRatio || 1;
    const logicalW = Math.max(
      scrollAreaRef.current?.clientWidth || 800,
      timelineDuration * zoom + 600,
    );
    tracks.forEach((track) => {
      const canvas = trackCanvasRefs.current.get(track.id);
      if (!canvas) return;
      const logicalH = track.type === "audio" ? 64 : 72;
      canvas.width = Math.round(logicalW * dpr);
      canvas.height = Math.round(logicalH * dpr);
      canvas.style.width = logicalW + "px";
      canvas.style.height = logicalH + "px";
      drawTrack(canvas, track.clips, zoom, selectedClipId, !!track.locked, drawState, logicalW, logicalH);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, zoom, selectedClipId, draggedClip, resizeState, timelineDuration]);

  // ── Ruler canvas ──
  useEffect(() => {
    const canvas = rulerCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(scrollAreaRef.current?.clientWidth || 800, timelineDuration * zoom + 300);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(28 * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = "28px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "var(--bg-panel)";
    ctx.fillRect(0, 0, w, 28);
    ctx.strokeStyle = "var(--border-normal)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, 27); ctx.lineTo(w, 27); ctx.stroke();
    ctx.fillStyle = "var(--text-muted)";
    ctx.font = "9px var(--font-mono)"; ctx.textAlign = "center";
    let tick = 1;
    if (zoom < 0.5) tick = 600; else if (zoom < 2) tick = 120; else if (zoom < 5) tick = 60;
    else if (zoom < 15) tick = 10; else if (zoom < 35) tick = 5; else if (zoom < 80) tick = 2;
    const total = Math.ceil(w / zoom);
    for (let s = 0; s <= total; s++) {
      if (s % tick !== 0) continue;
      const x = s * zoom;
      const maj = s % (tick * 5) === 0;
      ctx.strokeStyle = maj ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.1)";
      ctx.beginPath(); ctx.moveTo(x, maj ? 12 : 18); ctx.lineTo(x, 28); ctx.stroke();
      if (maj || zoom > 50) {
        const lbl = `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
        ctx.fillText(lbl, x, 10);
      }
    }
  }, [zoom, timelineDuration]);

  // ── Ctrl+scroll zoom ──
  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(zoomRef.current * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setZoom]);

  // ── Trim helpers ──
  const trimClipLeft = useCallback((clipId: string, time: number) => {
    const { tracks: t } = useTimelineStore.getState();
    let clip: Clip | null = null;
    for (const tr of t) { const f = tr.clips.find(c => c.id === clipId); if (f) { clip = f; break; } }
    if (!clip) return;
    const end = clip.timeStart + (clip.endOffset - clip.startOffset) / clip.speed;
    if (time <= clip.timeStart || time >= end) return;
    const newStart = clip.startOffset + (time - clip.timeStart) * clip.speed;
    updateClipProperties(clipId, { startOffset: newStart, timeStart: time });
  }, [updateClipProperties]);

  const trimClipRight = useCallback((clipId: string, time: number) => {
    const { tracks: t } = useTimelineStore.getState();
    let clip: Clip | null = null;
    for (const tr of t) { const f = tr.clips.find(c => c.id === clipId); if (f) { clip = f; break; } }
    if (!clip) return;
    const end = clip.timeStart + (clip.endOffset - clip.startOffset) / clip.speed;
    if (time <= clip.timeStart || time >= end) return;
    updateClipProperties(clipId, { endOffset: clip.startOffset + (time - clip.timeStart) * clip.speed });
  }, [updateClipProperties]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON" || tag === "SELECT") return;
      if (e.code === "Space") {
        e.preventDefault();
        const next = !isPlayingRef.current;
        setIsPlaying(next);
        window.dispatchEvent(new CustomEvent("playback-toggle", { detail: next }));
      } else if (e.key === "=" || e.key === "+" || e.code === "NumpadAdd") {
        e.preventDefault(); setZoom(zoomRef.current * 1.25);
      } else if (e.key === "-" || e.key === "_" || e.code === "NumpadSubtract") {
        e.preventDefault(); setZoom(zoomRef.current / 1.25);
      } else if (e.ctrlKey && (e.key === "0" || e.code === "Digit0")) {
        e.preventDefault(); setZoom(50);
      } else if ((e.key === "s" || e.key === "S" || e.key === "b" || e.key === "B") && !e.ctrlKey) {
        e.preventDefault();
        const id = selectedClipIdRef.current;
        if (id) {
          const tr = useTimelineStore.getState().tracks.find(t => t.clips.some(c => c.id === id));
          if (!tr?.locked) splitClip(id, playheadRef.current);
        }
      } else if ((e.key === "b" || e.key === "B") && e.ctrlKey) {
        e.preventDefault();
        const id = selectedClipIdRef.current;
        if (id) {
          const tr = useTimelineStore.getState().tracks.find(t => t.clips.some(c => c.id === id));
          if (!tr?.locked) splitClip(id, playheadRef.current);
        }
      } else if (e.key === "q" || e.key === "Q") {
        e.preventDefault();
        const id = selectedClipIdRef.current;
        if (id) {
          const tr = useTimelineStore.getState().tracks.find(t => t.clips.some(c => c.id === id));
          if (!tr?.locked) {
            if (e.shiftKey) trimClipLeft(id, playheadRef.current);
            else rippleTrimLeft(id, playheadRef.current);
          }
        }
      } else if (e.key === "w" || e.key === "W") {
        e.preventDefault();
        const id = selectedClipIdRef.current;
        if (id) {
          const tr = useTimelineStore.getState().tracks.find(t => t.clips.some(c => c.id === id));
          if (!tr?.locked) {
            if (e.shiftKey) trimClipRight(id, playheadRef.current);
            else rippleTrimRight(id, playheadRef.current);
          }
        }
      } else if (e.key === "Delete" || e.key === "Backspace") {
        const id = selectedClipIdRef.current;
        if (id) {
          const tr = useTimelineStore.getState().tracks.find(t => t.clips.some(c => c.id === id));
          if (!tr?.locked) {
            e.preventDefault();
            if (e.shiftKey || (e.altKey && e.key === "Backspace")) rippleDeleteClip(id);
            else deleteClip(id);
          }
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setIsPlaying, setZoom, splitClip, deleteClip, rippleDeleteClip, rippleTrimLeft, rippleTrimRight, trimClipLeft, trimClipRight]);

  // ── Playhead scrubbing (ruler) ──
  const updatePlayhead = useCallback((e: { clientX: number }) => {
    const rect = scrollAreaRef.current?.getBoundingClientRect();
    if (!rect) return;
    const t = Math.max(0, (e.clientX - rect.left - 120 + (scrollAreaRef.current?.scrollLeft || 0)) / zoomRef.current);
    setPlayhead(t);
    playheadBus.emit(t);
  }, [setPlayhead]);

  const handleRulerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    if (isPlayingRef.current) { setIsPlaying(false); window.dispatchEvent(new CustomEvent("playback-toggle", { detail: false })); }
    setIsScrubbing(true);
    updatePlayhead(e);
  }, [setIsPlaying, updatePlayhead]);

  const handleRulerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isScrubbing) updatePlayhead(e);
  }, [isScrubbing, updatePlayhead]);

  // ── Global pointer-up (handles both mouse and touch release) ──
  useEffect(() => {
    const up = (e: PointerEvent) => {
      activePointersRef.current.delete(e.pointerId);
      if (activePointersRef.current.size < 2) pinchInitRef.current = null;
      setIsScrubbing(false); setDraggedClip(null); setResizeState(null); setSnapLineTime(null);
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => { window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
  }, []);

  // ── Snapping helper (used in mousemove) ──
  const getSnapTime = (target: number, excludeId: string, threshold = 0.25): number | null => {
    if (Math.abs(target - playheadRef.current) < threshold) return playheadRef.current;
    for (const track of tracks) {
      for (const c of track.clips) {
        if (c.id === excludeId) continue;
        const end = c.timeStart + (c.endOffset - c.startOffset) / c.speed;
        if (Math.abs(target - c.timeStart) < threshold) return c.timeStart;
        if (Math.abs(target - end) < threshold) return end;
      }
    }
    return null;
  };

  // ── Track canvas pointer events ──
  const handleCanvasPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>, track: Track) => {
    // Track all pointers for pinch-to-zoom
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointersRef.current.size === 2) {
      const pts = Array.from(activePointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      pinchInitRef.current = { dist, zoom: zoomRef.current };
      return; // second touch starts pinch, not drag
    }

    if (track.locked) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    // getBoundingClientRect already accounts for scroll — do NOT add scrollLeft again
    const canvasX = e.clientX - rect.left;
    const hit = hitTest(canvasX, track.clips, zoomRef.current);
    if (!hit) { setSelectedClipId(null); return; }
    setSelectedClipId(hit.clip.id);
    if (hit.edge === "body") {
      setDraggedClip({ clip: hit.clip, startX: e.clientX, originalTimeStart: hit.clip.timeStart, currentTimeStart: hit.clip.timeStart });
    } else {
      setResizeState({
        clip: hit.clip, edge: hit.edge, startX: e.clientX,
        original: { startOffset: hit.clip.startOffset, endOffset: hit.clip.endOffset, timeStart: hit.clip.timeStart },
        current: { ...hit.clip },
      });
    }
  }, [setSelectedClipId]);

  // Show ew-resize cursor on edge hover, grab on body (pointer move on canvas)
  const handleCanvasHover = useCallback((e: React.PointerEvent<HTMLCanvasElement>, track: Track) => {
    if (draggedClip || resizeState) return; // parent container cursor takes over
    const rect = e.currentTarget.getBoundingClientRect();
    const canvasX = e.clientX - rect.left; // rect already accounts for scroll
    const hit = hitTest(canvasX, track.clips, zoomRef.current);
    e.currentTarget.style.cursor = hit ? (hit.edge !== "body" ? "ew-resize" : "grab") : "default";
  }, [draggedClip, resizeState]);

  // ── Pointer move on scroll area: drag, resize, or pinch-to-zoom ──
  const handleTimelinePointerMove = (e: React.PointerEvent) => {
    // Update pointer position for pinch tracking
    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    // Pinch-to-zoom (2 fingers)
    if (activePointersRef.current.size >= 2 && pinchInitRef.current) {
      const pts = Array.from(activePointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      setZoom(pinchInitRef.current.zoom * (dist / pinchInitRef.current.dist));
      return;
    }

    if (resizeState) {
      const { clip, edge, startX, original } = resizeState;
      const dt = (e.clientX - startX) / zoom;
      let snap: number | null = null;

      if (edge === "right") {
        let targetEnd = original.timeStart + (original.endOffset + dt * clip.speed - clip.startOffset) / clip.speed;
        if (snappingEnabled) { const s = getSnapTime(targetEnd, clip.id); if (s !== null) { targetEnd = s; snap = s; } }
        setSnapLineTime(snap);
        const newEnd = Math.max(original.startOffset + 0.1, Math.min(clip.duration, clip.startOffset + (targetEnd - original.timeStart) * clip.speed));
        setResizeState(prev => prev ? { ...prev, current: { ...prev.current, endOffset: newEnd } } : null);
        updateClipProperties(clip.id, { endOffset: newEnd });
      } else {
        let newStart = original.timeStart + dt;
        if (snappingEnabled) { const s = getSnapTime(newStart, clip.id); if (s !== null) { newStart = s; snap = s; } }
        setSnapLineTime(snap);
        const actualDt = newStart - original.timeStart;
        const newStartOffset = Math.max(0, Math.min(original.endOffset - 0.1, original.startOffset + actualDt * clip.speed));
        const finalTimeStart = original.timeStart + (newStartOffset - original.startOffset) / clip.speed;
        setResizeState(prev => prev ? { ...prev, current: { ...prev.current, startOffset: newStartOffset, timeStart: finalTimeStart } } : null);
        updateClipProperties(clip.id, { startOffset: newStartOffset, timeStart: finalTimeStart });
      }
      return;
    }

    if (draggedClip) {
      const dt = (e.clientX - draggedClip.startX) / zoom;
      let newStart = Math.max(0, draggedClip.originalTimeStart + dt);
      let snap: number | null = null;
      if (snappingEnabled) {
        const dur = (draggedClip.clip.endOffset - draggedClip.clip.startOffset) / draggedClip.clip.speed;
        const ls = getSnapTime(newStart, draggedClip.clip.id);
        if (ls !== null) { newStart = ls; snap = ls; }
        else { const rs = getSnapTime(newStart + dur, draggedClip.clip.id); if (rs !== null) { newStart = rs - dur; snap = rs; } }
      }
      setSnapLineTime(snap);
      setDraggedClip(prev => prev ? { ...prev, currentTimeStart: newStart } : null);
      moveClip(draggedClip.clip.id, draggedClip.clip.trackId, newStart);
    }
  };

  return (
    <div className="timeline-container">
      {/* Toolbar */}
      <div className="timeline-toolbar">
        <div className="toolbar-group">
          <button className="btn-secondary" style={{ padding: "4px 8px", fontSize: "11px" }}
            onClick={() => { const id = selectedClipIdRef.current; if (id) { const tr = useTimelineStore.getState().tracks.find(t => t.clips.some(c => c.id === id)); if (!tr?.locked) splitClip(id, playheadRef.current); } }}
            disabled={!selectedClipId} title="Split at Playhead (S)">
            <Scissors size={12} /> Split
          </button>
          <button className="btn-secondary" style={{ padding: "4px 8px", fontSize: "11px" }}
            onClick={() => { const id = selectedClipIdRef.current; if (id) trimClipLeft(id, playheadRef.current); }}
            disabled={!selectedClipId} title="Trim Start to Playhead (Shift+Q)">
            <ArrowLeftToLine size={12} /> Trim Left
          </button>
          <button className="btn-secondary" style={{ padding: "4px 8px", fontSize: "11px", color: "var(--text-bright)", borderColor: "rgba(56,189,248,0.3)" }}
            onClick={() => { const id = selectedClipIdRef.current; if (id) rippleTrimLeft(id, playheadRef.current); }}
            disabled={!selectedClipId} title="Ripple Trim Start (Q)">
            <ArrowLeftToLine size={12} style={{ color: "#38bdf8" }} /> Ripple Left
          </button>
          <button className="btn-secondary" style={{ padding: "4px 8px", fontSize: "11px" }}
            onClick={() => { const id = selectedClipIdRef.current; if (id) trimClipRight(id, playheadRef.current); }}
            disabled={!selectedClipId} title="Trim End to Playhead (Shift+W)">
            <ArrowRightToLine size={12} /> Trim Right
          </button>
          <button className="btn-secondary" style={{ padding: "4px 8px", fontSize: "11px", color: "var(--text-bright)", borderColor: "rgba(56,189,248,0.3)" }}
            onClick={() => { const id = selectedClipIdRef.current; if (id) rippleTrimRight(id, playheadRef.current); }}
            disabled={!selectedClipId} title="Ripple Trim End (W)">
            <ArrowRightToLine size={12} style={{ color: "#38bdf8" }} /> Ripple Right
          </button>
          <button className="btn-secondary" style={{ padding: "4px 8px", fontSize: "11px" }}
            onClick={() => { const id = selectedClipIdRef.current; if (id) { const tr = useTimelineStore.getState().tracks.find(t => t.clips.some(c => c.id === id)); if (!tr?.locked) deleteClip(id); } }}
            disabled={!selectedClipId} title="Delete (Del)">
            <Trash2 size={12} /> Delete
          </button>
          <button className="btn-secondary" style={{ padding: "4px 8px", fontSize: "11px", color: "#f87171", borderColor: "rgba(239,68,68,0.3)" }}
            onClick={() => { const id = selectedClipIdRef.current; if (id) rippleDeleteClip(id); }}
            disabled={!selectedClipId} title="Ripple Delete (Shift+Del)">
            <Trash2 size={12} style={{ color: "#ef4444" }} /> Ripple Del
          </button>
        </div>

        <div className="toolbar-group" style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button
            className={`btn-secondary ${snappingEnabled ? "active" : ""}`}
            style={{ padding: "4px 8px", fontSize: "11px", borderColor: snappingEnabled ? "var(--border-focus)" : "var(--border-normal)", color: snappingEnabled ? "#fff" : "var(--text-muted)", background: snappingEnabled ? "rgba(255,255,255,0.06)" : "none", display: "flex", alignItems: "center", gap: "4px" }}
            onClick={() => setSnappingEnabled(v => !v)} title="Toggle Snapping">
            <Magnet size={12} style={{ color: snappingEnabled ? "var(--text-bright)" : "inherit" }} />
            <span>Snapping</span>
          </button>
          <div style={{ display: "flex", gap: "6px", alignItems: "center", borderLeft: "1px solid var(--border-dim)", paddingLeft: "10px" }}>
            <span style={{ fontSize: "9px", color: "var(--text-muted)", opacity: 0.5 }}>Ctrl+Scroll or</span>
            <button className="btn-secondary" style={{ padding: "4px" }} onClick={() => setZoom(zoomRef.current / 1.2)} title="Zoom Out"><ZoomOut size={14} /></button>
            <span style={{ fontSize: "10px", color: "var(--text-muted)", width: "40px", textAlign: "center" }}>{Math.round(zoom)}px/s</span>
            <button className="btn-secondary" style={{ padding: "4px" }} onClick={() => setZoom(zoomRef.current * 1.2)} title="Zoom In"><ZoomIn size={14} /></button>
          </div>
        </div>
      </div>

      {/* Scrollable timeline viewport */}
      <div
        className="timeline-scrollview"
        ref={scrollAreaRef}
        onPointerMove={handleTimelinePointerMove}
        style={{ userSelect: "none", touchAction: "none", cursor: resizeState ? "ew-resize" : draggedClip ? "grabbing" : "default" }}
      >
        <div style={{ position: "relative", minWidth: "100%", width: "fit-content" }}>

          {/* Ruler */}
          <div style={{ display: "flex", paddingLeft: "120px", position: "sticky", top: 0, zIndex: 4 }}>
            <canvas ref={rulerCanvasRef} className="ruler-canvas"
              onPointerDown={handleRulerDown} onPointerMove={handleRulerMove}
              style={{ cursor: "col-resize", touchAction: "none" }} />
          </div>

          {/* Track rows */}
          <div className="tracks-area">
            {tracks.map((track) => {
              const isMuted = !!track.muted;
              const isHidden = !!track.hidden;
              const isLocked = !!track.locked;
              // Canvas dimensions are set imperatively in the draw effect (with DPR scaling)

              return (
                <div key={track.id} className={`track-row ${track.type}`}
                  style={{ opacity: isHidden ? 0.35 : 1, position: "relative" }}>
                  <div className="track-header">
                    <span className="track-name">{track.name}</span>
                    <div style={{ display: "flex", gap: "8px", marginTop: "2px" }}>
                      <button onClick={() => toggleTrackLock(track.id)}
                        style={{ background: "none", border: "none", color: isLocked ? "var(--text-bright)" : "var(--text-muted)", cursor: "pointer" }}
                        title={isLocked ? "Unlock" : "Lock"}>
                        {isLocked ? <Lock size={10} /> : <Unlock size={10} />}
                      </button>
                      <button onClick={() => toggleTrackMute(track.id)}
                        style={{ background: "none", border: "none", color: isMuted ? "var(--text-bright)" : "var(--text-muted)", cursor: "pointer" }}
                        title={isMuted ? "Unmute" : "Mute"}>
                        {isMuted ? <VolumeX size={10} /> : <Volume2 size={10} />}
                      </button>
                      <button onClick={() => toggleTrackHide(track.id)}
                        style={{ background: "none", border: "none", color: isHidden ? "var(--text-bright)" : "var(--text-muted)", cursor: "pointer" }}
                        title={isHidden ? "Unhide" : "Hide"}>
                        {isHidden ? <EyeOff size={10} /> : <Eye size={10} />}
                      </button>
                    </div>
                  </div>

                  {/* Canvas replaces DOM clip divs — no React reconciliation per clip */}
                  <canvas
                    ref={(el) => {
                      if (el) { trackCanvasRefs.current.set(track.id, el); }
                      else { trackCanvasRefs.current.delete(track.id); }
                    }}
                    style={{ display: "block", touchAction: "none" }}
                    onPointerDown={(e) => handleCanvasPointerDown(e, track)}
                    onPointerMove={(e) => handleCanvasHover(e, track)}
                    onDoubleClick={() => setSelectedClipId(null)}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
                    onDrop={(e) => {
                      e.preventDefault();
                      try {
                        const media = JSON.parse(e.dataTransfer.getData("application/json"));
                        if (!media) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const dropTime = Math.max(0, (e.clientX - rect.left) / zoom);
                        const ext = (media.filePath as string).split(".").pop()?.toLowerCase() ?? "";
                        const isImage = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(ext);
                        const isAudio = !media.width && !media.height && !isImage;
                        if (track.type === "audio" && !isAudio) { alert("Only audio clips can be dropped onto the Audio Track!"); return; }
                        if (track.type === "video" && isAudio) { alert("Only video or image clips can be dropped onto the Video Track!"); return; }
                        const clipType: Clip["type"] = isImage ? "image" : isAudio ? "audio" : "video";
                        addClip(track.id, {
                          name: media.name, filePath: media.filePath, proxyPath: media.proxyPath,
                          type: clipType, duration: isImage ? 9999 : media.duration,
                          startOffset: 0, endOffset: isImage ? 5.0 : media.duration,
                          timeStart: dropTime, volume: 1.0, speed: 1.0,
                          color: clipType === "video" ? "var(--bg-panel-light)" : clipType === "audio" ? "var(--bg-panel)" : "var(--bg-darker)",
                        });
                      } catch (err) { console.error("Drop failed:", err); }
                    }}
                  />
                </div>
              );
            })}

            {/* Snap line */}
            {snapLineTime !== null && (
              <div className="timeline-snap-line" style={{ position: "absolute", left: `${snapLineTime * zoom + 120}px`, top: 0, bottom: 0, width: "1.5px", backgroundColor: "#38bdf8", boxShadow: "0 0 8px #38bdf8", zIndex: 5, pointerEvents: "none" }} />
            )}

            {/* Playhead line — DOM ref, updated by bus at 60fps */}
            <div ref={playheadLineRef} className="timeline-playhead-line"
              style={{ left: `${playheadRef.current * zoom + 120}px`, willChange: "left" }}>
              <div className="timeline-playhead-handle" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const Timeline = React.memo(TimelineComponent);
export default Timeline;
