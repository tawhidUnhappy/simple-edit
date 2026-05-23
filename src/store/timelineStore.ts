import { create } from "zustand";

export interface Clip {
  id: string;
  name: string;
  filePath: string;
  proxyPath?: string;
  type: "video" | "audio" | "image" | "text" | "subtitle";
  duration: number; // total original source duration, in seconds
  startOffset: number; // cut start relative to source start, in seconds
  endOffset: number; // cut end relative to source start, in seconds
  trackId: string;
  timeStart: number; // position on timeline track, in seconds
  volume: number; // 0.0 to 1.0
  speed: number; // 0.1 to 5.0
  text?: string; // for text / subtitle custom properties
  color?: string; // visual color of clip in timeline
}

export interface Track {
  id: string;
  name: string;
  type: "video" | "audio" | "subtitle";
  clips: Clip[];
  locked?: boolean;
  muted?: boolean;
  hidden?: boolean;
}

export interface SystemInfo {
  hardware: {
    gpu_brand: string;
    gpu_name: string;
    vram_total_mb: number;
    nvidia_driver_version: string | null;
    cpu_cores: number;
    system_ram_gb: number;
  };
  micromamba_exists: boolean;
  conda_env_exists: boolean;
  python_working: boolean;
  python_version: string;
  pytorch_cuda_available: boolean;
  pytorch_cuda_device: string;
  ffmpeg_exists: boolean;
  ffmpeg_version: string;
}

export interface MediaFile {
  id: string;
  name: string;
  filePath: string;
  duration: number;
  width?: number;
  height?: number;
  hasAudio: boolean;
  thumbnailPath?: string;
  waveformPath?: string;
  proxyPath?: string;
  sizeBytes: number;
}

interface ProjectData {
  projectName: string;
  tracks: Track[];
  mediaPool: MediaFile[];
  lyricsText?: string;
}

interface TimelineState {
  // System state
  systemStatus: SystemInfo | null;
  setSystemStatus: (status: SystemInfo | null) => void;

  // Project management
  workspacePath: string | null;
  projectPath: string | null;
  projectName: string;
  hasOpenProject: boolean;
  isDirty: boolean;
  setWorkspacePath: (path: string) => void;
  setProjectPath: (path: string | null) => void;
  setProjectName: (name: string, silent?: boolean) => void;
  setHasOpenProject: (open: boolean) => void;
  markDirty: () => void;
  markClean: () => void;
  loadProjectData: (json: string) => void;
  getProjectJson: () => string;
  resetProject: () => void;

  // Lyrics
  lyricsText: string;
  setLyricsText: (text: string) => void;

  // Local HTTP media server port (0 = not yet started)
  mediaServerPort: number;
  setMediaServerPort: (port: number) => void;

  // Media pool
  mediaPool: MediaFile[];
  addMediaFile: (file: MediaFile) => void;
  removeMediaFile: (id: string) => void;
  updateMediaFile: (id: string, properties: Partial<MediaFile>) => void;

  // Timeline layout
  tracks: Track[];
  playhead: number; // in seconds
  zoom: number; // pixels per second
  isPlaying: boolean;
  timelineDuration: number;
  selectedClipId: string | null;

  // Actions
  setPlayhead: (time: number) => void;
  setZoom: (zoom: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setSelectedClipId: (id: string | null) => void;

  addTrack: (type: "video" | "audio" | "subtitle", name?: string) => void;
  removeTrack: (trackId: string) => void;
  addClip: (trackId: string, clipData: Omit<Clip, "id" | "trackId">) => void;
  deleteClip: (clipId: string) => void;
  splitClip: (clipId: string, time: number) => void;
  updateClipOffsets: (clipId: string, startOffset: number, endOffset: number) => void;
  moveClip: (clipId: string, newTrackId: string, newTimeStart: number) => void;
  updateClipProperties: (clipId: string, properties: Partial<Clip>) => void;
  rippleDeleteClip: (clipId: string) => void;
  rippleTrimLeft: (clipId: string, time: number) => void;
  rippleTrimRight: (clipId: string, time: number) => void;

  toggleTrackLock: (trackId: string) => void;
  toggleTrackMute: (trackId: string) => void;
  toggleTrackHide: (trackId: string) => void;

  recalculateDuration: () => void;
}

let recalcTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRecalc(fn: () => void) {
  if (recalcTimer !== null) clearTimeout(recalcTimer);
  recalcTimer = setTimeout(() => { recalcTimer = null; fn(); }, 50);
}

const DEFAULT_TRACKS: Track[] = [
  { id: "v-1", name: "Video Track 1", type: "video", clips: [] },
  { id: "a-1", name: "Audio Track 1", type: "audio", clips: [] },
  { id: "s-1", name: "Subtitle Track 1", type: "subtitle", clips: [] },
];

export const useTimelineStore = create<TimelineState>((set, get) => ({
  systemStatus: null,
  setSystemStatus: (status) => set({ systemStatus: status }),

  workspacePath: null,
  projectPath: null,
  projectName: "Untitled Project",
  hasOpenProject: false,
  isDirty: false,
  setWorkspacePath: (path) => set({ workspacePath: path }),
  setProjectPath: (path) => set({ projectPath: path }),
  setProjectName: (name, silent = false) => set({ projectName: name, ...(silent ? {} : { isDirty: true }) }),
  setHasOpenProject: (open) => set({ hasOpenProject: open }),
  markDirty: () => set({ isDirty: true }),
  markClean: () => set({ isDirty: false }),

  lyricsText: "",
  setLyricsText: (text) => set({ lyricsText: text, isDirty: true }),

  loadProjectData: (json: string) => {
    try {
      const data: ProjectData = JSON.parse(json);
      set({
        projectName: data.projectName ?? "Untitled Project",
        tracks: data.tracks ?? DEFAULT_TRACKS,
        mediaPool: data.mediaPool ?? [],
        lyricsText: data.lyricsText ?? "",
        playhead: 0,
        isPlaying: false,
        selectedClipId: null,
        isDirty: false,
      });
      scheduleRecalc(() => get().recalculateDuration());
    } catch (e) {
      throw new Error(`Invalid project file: ${e}`);
    }
  },

  getProjectJson: () => {
    const { projectName, tracks, mediaPool, lyricsText } = get();
    return JSON.stringify({ projectName, tracks, mediaPool, lyricsText }, null, 2);
  },

  resetProject: () => set({
    tracks: DEFAULT_TRACKS,
    mediaPool: [],
    lyricsText: "",
    playhead: 0,
    isPlaying: false,
    timelineDuration: 0,
    selectedClipId: null,
    projectName: "Untitled Project",
    projectPath: null,
    isDirty: false,
  }),

  mediaServerPort: 0,
  setMediaServerPort: (port) => set({ mediaServerPort: port }),

  mediaPool: [],
  addMediaFile: (file) => set((state) => ({ mediaPool: [...state.mediaPool, file], isDirty: true })),
  removeMediaFile: (id) => set((state) => ({ mediaPool: state.mediaPool.filter((m) => m.id !== id), isDirty: true })),
  updateMediaFile: (id, properties) => set((state) => ({
    mediaPool: state.mediaPool.map((m) => (m.id === id ? { ...m, ...properties } : m)),
  })),

  tracks: DEFAULT_TRACKS,
  playhead: 0,
  zoom: 50, // 50px = 1s
  isPlaying: false,
  timelineDuration: 0,
  selectedClipId: null,

  setPlayhead: (time) => set({ playhead: Math.max(0, time) }),
  setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(zoom, 5000)) }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setSelectedClipId: (selectedClipId) => set({ selectedClipId }),

  addTrack: (type, name) => set((state) => {
    const id = `${type === "video" ? "v" : type === "audio" ? "a" : "s"}-${Date.now()}`;
    const newTrack: Track = {
      id,
      name: name || `${type.charAt(0).toUpperCase() + type.slice(1)} Track ${state.tracks.filter((t) => t.type === type).length + 1}`,
      type,
      clips: [],
    };
    return { tracks: [...state.tracks, newTrack], isDirty: true };
  }),

  removeTrack: (trackId) => set((state) => {
    const targetTrack = state.tracks.find((t) => t.id === trackId);
    if (targetTrack?.locked) return {};
    return { tracks: state.tracks.filter((t) => t.id !== trackId), isDirty: true };
  }),

  addClip: (trackId, clipData) => set((state) => {
    const targetTrack = state.tracks.find((t) => t.id === trackId);
    if (targetTrack?.locked) return {};

    const id = `clip-${Date.now()}`;
    const newClip: Clip = {
      ...clipData,
      id,
      trackId,
    };

    const newTracks = state.tracks.map((track) => {
      if (track.id === trackId) {
        return { ...track, clips: [...track.clips, newClip] };
      }
      return track;
    });

    scheduleRecalc(() => get().recalculateDuration());

    return { tracks: newTracks, selectedClipId: id, isDirty: true };
  }),

  deleteClip: (clipId) => set((state) => {
    const containingTrack = state.tracks.find((t) => t.clips.some((c) => c.id === clipId));
    if (containingTrack?.locked) return {};

    const newTracks = state.tracks.map((track) => ({
      ...track,
      clips: track.clips.filter((c) => c.id !== clipId),
    }));

    scheduleRecalc(() => get().recalculateDuration());

    return {
      tracks: newTracks,
      selectedClipId: state.selectedClipId === clipId ? null : state.selectedClipId,
      isDirty: true,
    };
  }),

  splitClip: (clipId, time) => set((state) => {
    let clipToSplit: Clip | null = null;
    let targetTrackId = "";

    // Find the clip
    for (const track of state.tracks) {
      const found = track.clips.find((c) => c.id === clipId);
      if (found) {
        if (track.locked) return {};
        clipToSplit = found;
        targetTrackId = track.id;
        break;
      }
    }

    if (!clipToSplit) return {};

    const clipEnd = clipToSplit.timeStart + (clipToSplit.endOffset - clipToSplit.startOffset) / clipToSplit.speed;

    // Check if the split time actually cuts the clip
    if (time <= clipToSplit.timeStart || time >= clipEnd) return {};

    // Calculate split points
    const splitRatio = (time - clipToSplit.timeStart) * clipToSplit.speed;
    const splitSourcePoint = clipToSplit.startOffset + splitRatio;

    const ts = Date.now();
    const firstHalf: Clip = {
      ...clipToSplit,
      id: `clip-${ts}-a`,
      endOffset: splitSourcePoint,
    };

    const secondHalf: Clip = {
      ...clipToSplit,
      id: `clip-${ts}-b`,
      timeStart: time,
      startOffset: splitSourcePoint,
    };

    const newTracks = state.tracks.map((track) => {
      if (track.id === targetTrackId) {
        const filtered = track.clips.filter((c) => c.id !== clipId);
        return { ...track, clips: [...filtered, firstHalf, secondHalf] };
      }
      return track;
    });

    return { tracks: newTracks, selectedClipId: secondHalf.id, isDirty: true };
  }),

  updateClipOffsets: (clipId, startOffset, endOffset) => set((state) => {
    if (startOffset >= endOffset) return {};
    const containingTrack = state.tracks.find((t) => t.clips.some((c) => c.id === clipId));
    if (containingTrack?.locked) return {};

    const newTracks = state.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((c) => {
        if (c.id === clipId) {
          return { ...c, startOffset, endOffset };
        }
        return c;
      }),
    }));

    scheduleRecalc(() => get().recalculateDuration());

    return { tracks: newTracks, isDirty: true };
  }),

  moveClip: (clipId, newTrackId, newTimeStart) => set((state) => {
    const sourceTrack = state.tracks.find((t) => t.clips.some((c) => c.id === clipId));
    if (sourceTrack?.locked) return {};

    const targetTrack = state.tracks.find((t) => t.id === newTrackId);
    if (targetTrack?.locked) return {};

    let movingClip: Clip | null = null;

    // Remove clip from old track
    const tracksWithoutClip = state.tracks.map((track) => {
      const found = track.clips.find((c) => c.id === clipId);
      if (found) {
        movingClip = { ...found, trackId: newTrackId, timeStart: Math.max(0, newTimeStart) };
        return { ...track, clips: track.clips.filter((c) => c.id !== clipId) };
      }
      return track;
    });

    if (!movingClip) return {};

    // Validate clip type matches target track type
    const mc = movingClip as Clip;
    if (targetTrack) {
      const videoTypes = new Set(["video", "image"]);
      if (targetTrack.type === "audio" && !["audio"].includes(mc.type)) return {};
      if (targetTrack.type === "video" && !videoTypes.has(mc.type)) return {};
      if (targetTrack.type === "subtitle" && !["subtitle", "text"].includes(mc.type)) return {};
    }

    // Add clip to new track
    const newTracks = tracksWithoutClip.map((track) => {
      if (track.id === newTrackId) {
        return { ...track, clips: [...track.clips, movingClip!] };
      }
      return track;
    });

    scheduleRecalc(() => get().recalculateDuration());

    return { tracks: newTracks, isDirty: true };
  }),

  updateClipProperties: (clipId, properties) => set((state) => {
    const containingTrack = state.tracks.find((t) => t.clips.some((c) => c.id === clipId));
    if (containingTrack?.locked) return {};

    const newTracks = state.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((c) => {
        if (c.id === clipId) {
          return { ...c, ...properties };
        }
        return c;
      }),
    }));

    scheduleRecalc(() => get().recalculateDuration());

    return { tracks: newTracks, isDirty: true };
  }),

  rippleDeleteClip: (clipId) => set((state) => {
    let containingTrack = null;
    let targetClip = null;
    for (const track of state.tracks) {
      const found = track.clips.find((c) => c.id === clipId);
      if (found) {
        containingTrack = track;
        targetClip = found;
        break;
      }
    }

    if (!containingTrack || containingTrack.locked || !targetClip) return {};

    const clipDuration = (targetClip.endOffset - targetClip.startOffset) / targetClip.speed;
    const clipStart = targetClip.timeStart;

    const newTracks = state.tracks.map((track) => {
      if (track.id === containingTrack!.id) {
        const filtered = track.clips.filter((c) => c.id !== clipId);
        const mapped = filtered.map((c) => {
          if (c.timeStart > clipStart) {
            return { ...c, timeStart: Math.max(0, c.timeStart - clipDuration) };
          }
          return c;
        });
        return { ...track, clips: mapped };
      }
      return track;
    });

    scheduleRecalc(() => get().recalculateDuration());

    return {
      tracks: newTracks,
      selectedClipId: state.selectedClipId === clipId ? null : state.selectedClipId,
      isDirty: true,
    };
  }),

  rippleTrimLeft: (clipId, time) => set((state) => {
    let containingTrack = null;
    let targetClip = null;
    for (const track of state.tracks) {
      const found = track.clips.find((c) => c.id === clipId);
      if (found) {
        containingTrack = track;
        targetClip = found;
        break;
      }
    }

    if (!containingTrack || containingTrack.locked || !targetClip) return {};

    const clipEnd = targetClip.timeStart + (targetClip.endOffset - targetClip.startOffset) / targetClip.speed;
    if (time <= targetClip.timeStart || time >= clipEnd) return {};

    const deltaTime = time - targetClip.timeStart;
    const offsetDelta = deltaTime * targetClip.speed;
    const newStartOffset = targetClip.startOffset + offsetDelta;
    const originalTimeStart = targetClip.timeStart;

    const newTracks = state.tracks.map((track) => {
      if (track.id === containingTrack!.id) {
        return {
          ...track,
          clips: track.clips.map((c) => {
            if (c.id === clipId) {
              return { ...c, startOffset: newStartOffset }; // timeStart remains originalTimeStart due to shift left cancelling shift right
            }
            if (c.timeStart > originalTimeStart) {
              return { ...c, timeStart: Math.max(0, c.timeStart - deltaTime) };
            }
            return c;
          }),
        };
      }
      return track;
    });

    scheduleRecalc(() => get().recalculateDuration());

    return { tracks: newTracks, isDirty: true };
  }),

  rippleTrimRight: (clipId, time) => set((state) => {
    let containingTrack = null;
    let targetClip = null;
    for (const track of state.tracks) {
      const found = track.clips.find((c) => c.id === clipId);
      if (found) {
        containingTrack = track;
        targetClip = found;
        break;
      }
    }

    if (!containingTrack || containingTrack.locked || !targetClip) return {};

    const clipEnd = targetClip.timeStart + (targetClip.endOffset - targetClip.startOffset) / targetClip.speed;
    if (time <= targetClip.timeStart || time >= clipEnd) return {};

    const deltaTime = clipEnd - time;
    const offsetDelta = deltaTime * targetClip.speed;
    const newEndOffset = targetClip.endOffset - offsetDelta;
    const originalTimeStart = targetClip.timeStart;

    const newTracks = state.tracks.map((track) => {
      if (track.id === containingTrack!.id) {
        return {
          ...track,
          clips: track.clips.map((c) => {
            if (c.id === clipId) {
              return { ...c, endOffset: newEndOffset };
            }
            if (c.timeStart > originalTimeStart) {
              return { ...c, timeStart: Math.max(0, c.timeStart - deltaTime) };
            }
            return c;
          }),
        };
      }
      return track;
    });

    scheduleRecalc(() => get().recalculateDuration());

    return { tracks: newTracks, isDirty: true };
  }),

  toggleTrackLock: (trackId) => set((state) => {
    const newTracks = state.tracks.map((t) =>
      t.id === trackId ? { ...t, locked: !t.locked } : t
    );
    return { tracks: newTracks, isDirty: true };
  }),

  toggleTrackMute: (trackId) => set((state) => {
    const newTracks = state.tracks.map((t) =>
      t.id === trackId ? { ...t, muted: !t.muted } : t
    );
    return { tracks: newTracks, isDirty: true };
  }),

  toggleTrackHide: (trackId) => set((state) => {
    const newTracks = state.tracks.map((t) =>
      t.id === trackId ? { ...t, hidden: !t.hidden } : t
    );
    return { tracks: newTracks, isDirty: true };
  }),

  recalculateDuration: () => {
    let maxDuration = 0;
    const tracks = get().tracks;
    for (const track of tracks) {
      for (const clip of track.clips) {
        const clipEnd = clip.timeStart + (clip.endOffset - clip.startOffset) / clip.speed;
        if (clipEnd > maxDuration) {
          maxDuration = clipEnd;
        }
      }
    }
    set({ timelineDuration: maxDuration });
  },
}));
