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

interface TimelineState {
  // System state
  systemStatus: SystemInfo | null;
  setSystemStatus: (status: SystemInfo | null) => void;

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

  recalculateDuration: () => void;
}

export const useTimelineStore = create<TimelineState>((set, get) => ({
  systemStatus: null,
  setSystemStatus: (status) => set({ systemStatus: status }),

  mediaPool: [],
  addMediaFile: (file) => set((state) => ({ mediaPool: [...state.mediaPool, file] })),
  removeMediaFile: (id) => set((state) => ({ mediaPool: state.mediaPool.filter((m) => m.id !== id) })),
  updateMediaFile: (id, properties) => set((state) => ({
    mediaPool: state.mediaPool.map((m) => (m.id === id ? { ...m, ...properties } : m)),
  })),

  tracks: [
    { id: "v-1", name: "Video Track 1", type: "video", clips: [] },
    { id: "a-1", name: "Audio Track 1", type: "audio", clips: [] },
    { id: "s-1", name: "Subtitle Track 1", type: "subtitle", clips: [] },
  ],
  playhead: 0,
  zoom: 50, // 50px = 1s
  isPlaying: false,
  timelineDuration: 0,
  selectedClipId: null,

  setPlayhead: (time) => set({ playhead: Math.max(0, time) }),
  setZoom: (zoom) => set({ zoom: Math.max(10, Math.min(zoom, 500)) }),
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
    return { tracks: [...state.tracks, newTrack] };
  }),

  removeTrack: (trackId) => set((state) => {
    return { tracks: state.tracks.filter((t) => t.id !== trackId) };
  }),

  addClip: (trackId, clipData) => set((state) => {
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

    setTimeout(() => get().recalculateDuration(), 0);

    return { tracks: newTracks, selectedClipId: id };
  }),

  deleteClip: (clipId) => set((state) => {
    const newTracks = state.tracks.map((track) => ({
      ...track,
      clips: track.clips.filter((c) => c.id !== clipId),
    }));

    setTimeout(() => get().recalculateDuration(), 0);

    return {
      tracks: newTracks,
      selectedClipId: state.selectedClipId === clipId ? null : state.selectedClipId,
    };
  }),

  splitClip: (clipId, time) => set((state) => {
    let clipToSplit: Clip | null = null;
    let targetTrackId = "";

    // Find the clip
    for (const track of state.tracks) {
      const found = track.clips.find((c) => c.id === clipId);
      if (found) {
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

    const firstHalf: Clip = {
      ...clipToSplit,
      id: `${clipToSplit.id}-1`,
      endOffset: splitSourcePoint,
    };

    const secondHalf: Clip = {
      ...clipToSplit,
      id: `${clipToSplit.id}-2`,
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

    return { tracks: newTracks, selectedClipId: secondHalf.id };
  }),

  updateClipOffsets: (clipId, startOffset, endOffset) => set((state) => {
    const newTracks = state.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((c) => {
        if (c.id === clipId) {
          return { ...c, startOffset, endOffset };
        }
        return c;
      }),
    }));

    setTimeout(() => get().recalculateDuration(), 0);

    return { tracks: newTracks };
  }),

  moveClip: (clipId, newTrackId, newTimeStart) => set((state) => {
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

    // Add clip to new track
    const newTracks = tracksWithoutClip.map((track) => {
      if (track.id === newTrackId) {
        return { ...track, clips: [...track.clips, movingClip!] };
      }
      return track;
    });

    setTimeout(() => get().recalculateDuration(), 0);

    return { tracks: newTracks };
  }),

  updateClipProperties: (clipId, properties) => set((state) => {
    const newTracks = state.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((c) => {
        if (c.id === clipId) {
          return { ...c, ...properties };
        }
        return c;
      }),
    }));

    setTimeout(() => get().recalculateDuration(), 0);

    return { tracks: newTracks };
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
