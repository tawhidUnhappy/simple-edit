import React, { useState, useEffect, useCallback } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useTimelineStore } from "../store/timelineStore";
import { Plus, Trash2, Film, Music, AlertCircle, Loader2, Upload, FolderOpen } from "lucide-react";

interface ProxyProgressPayload {
  clip_id: string;
  status: string;
  proxy_path: string | null;
  error: string | null;
}

interface WaveformProgressPayload {
  clip_id: string;
  status: string;
  waveform_path: string | null;
  error: string | null;
}

interface ThumbnailProgressPayload {
  clip_id: string;
  status: string;
  thumbnails_dir: string | null;
  error: string | null;
}

const MEDIA_EXTENSIONS = ["mp4", "mov", "avi", "mkv", "webm", "m4v", "mpg", "mpeg",
  "mp3", "wav", "aac", "m4a", "flac", "ogg", "opus",
  "jpg", "jpeg", "png", "gif", "webp", "bmp"];

export const MediaPool: React.FC = () => {
  const { mediaPool, addMediaFile, removeMediaFile, updateMediaFile, addClip, tracks } = useTimelineStore();
  const [isImporting, setIsImporting] = useState(false);
  const [importCount, setImportCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Background task event listeners
  useEffect(() => {
    const unlistenProxy = listen<ProxyProgressPayload>("proxy-progress", (event) => {
      const { clip_id, status, proxy_path } = event.payload;
      if (status === "completed" && proxy_path) {
        updateMediaFile(clip_id, { proxyPath: proxy_path });
      }
    });

    const unlistenWaveform = listen<WaveformProgressPayload>("waveform-progress", (event) => {
      const { clip_id, status, waveform_path } = event.payload;
      if (status === "completed" && waveform_path) {
        updateMediaFile(clip_id, { waveformPath: waveform_path });
      }
    });

    const unlistenThumbnail = listen<ThumbnailProgressPayload>("thumbnail-progress", (event) => {
      const { clip_id, status, thumbnails_dir } = event.payload;
      if (status === "completed" && thumbnails_dir) {
        const thumbUrl = `${thumbnails_dir}/thumb_0001.jpg`;
        updateMediaFile(clip_id, { thumbnailPath: thumbUrl });
      }
    });

    // OS-level file drag-drop (Tauri emits these window-wide)
    const unlistenDrop = listen<{ paths: string[] }>("tauri://drag-drop", async (event) => {
      setIsDragging(false);
      await importFiles(event.payload.paths);
    });

    const unlistenEnter = listen("tauri://drag-enter", () => setIsDragging(true));
    const unlistenLeave = listen("tauri://drag-leave", () => setIsDragging(false));

    return () => {
      unlistenProxy.then((fn) => fn());
      unlistenWaveform.then((fn) => fn());
      unlistenThumbnail.then((fn) => fn());
      unlistenDrop.then((fn) => fn());
      unlistenEnter.then((fn) => fn());
      unlistenLeave.then((fn) => fn());
    };
  }, [updateMediaFile]);

  const importFiles = useCallback(async (paths: string[]) => {
    setIsImporting(true);
    setImportCount(paths.length);
    setErrorMsg(null);
    let lastError: string | null = null;

    for (const path of paths) {
      try {
        const media = await invoke<any>("import_media_file", { filePath: path });
        addMediaFile({
          id: media.id,
          name: media.name,
          filePath: media.filePath,
          duration: media.duration,
          width: media.width,
          height: media.height,
          hasAudio: media.hasAudio,
          sizeBytes: media.sizeBytes,
        });
      } catch (e: any) {
        lastError = e.toString();
      }
    }

    if (lastError) setErrorMsg(lastError);
    setIsImporting(false);
    setImportCount(0);
  }, [addMediaFile]);

  const handleBrowse = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "Media Files", extensions: MEDIA_EXTENSIONS }],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      await importFiles(paths);
    } catch (e: any) {
      setErrorMsg(e.toString());
    }
  };

  const handleAddToTimeline = (media: any) => {
    const targetTrackType = media.width || media.height ? "video" : "audio";
    const targetTrack = tracks.find((t) => t.type === targetTrackType);
    if (!targetTrack) {
      alert(`No active ${targetTrackType} track found on timeline!`);
      return;
    }
    addClip(targetTrack.id, {
      name: media.name,
      filePath: media.filePath,
      proxyPath: media.proxyPath,
      type: targetTrackType,
      duration: media.duration,
      startOffset: 0,
      endOffset: media.duration,
      timeStart: 0,
      volume: 1.0,
      speed: 1.0,
      color: targetTrackType === "video" ? "var(--accent-primary)" : "var(--accent-teal)",
    });
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="panel-content" style={{ padding: "12px", gap: "12px" }}>
      {/* Drop Zone / Import Section */}
      <div
        style={{
          border: `1.5px dashed ${isDragging ? "var(--accent-primary)" : "var(--border-normal)"}`,
          borderRadius: "10px",
          padding: "16px 12px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "8px",
          background: isDragging ? "rgba(139, 92, 246, 0.06)" : "rgba(255,255,255,0.01)",
          transition: "border-color 0.2s, background 0.2s",
          cursor: "default",
        }}
      >
        <Upload size={22} style={{ color: isDragging ? "var(--accent-primary)" : "var(--text-muted)", opacity: isDragging ? 1 : 0.5, transition: "color 0.2s" }} />
        <span style={{ fontSize: "11px", color: isDragging ? "var(--accent-primary)" : "var(--text-muted)", fontWeight: 600, letterSpacing: "0.3px" }}>
          {isDragging ? "Drop to import" : "Drag files here"}
        </span>
        <span style={{ fontSize: "9px", color: "var(--text-muted)", opacity: 0.6 }}>
          MP4 · MOV · MKV · MP3 · WAV · JPG · PNG…
        </span>
        <button
          className="btn-primary"
          style={{ marginTop: "4px", padding: "5px 14px", fontSize: "11px", display: "flex", alignItems: "center", gap: "6px" }}
          onClick={handleBrowse}
          disabled={isImporting}
        >
          {isImporting ? (
            <>
              <Loader2 size={11} className="animate-spin" />
              {importCount > 1 ? `Importing ${importCount} files…` : "Importing…"}
            </>
          ) : (
            <>
              <FolderOpen size={11} />
              Browse Files
            </>
          )}
        </button>
      </div>

      {/* Error message */}
      {errorMsg && (
        <div style={{ color: "var(--accent-rose)", display: "flex", alignItems: "center", gap: "4px", fontSize: "10px" }}>
          <AlertCircle size={10} />
          {errorMsg}
        </div>
      )}

      {/* Media Pool Grid */}
      <div style={{ flex: 1, overflowY: "auto", marginTop: "4px" }}>
        {mediaPool.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "120px", color: "var(--text-muted)", gap: "8px" }}>
            <Film size={24} style={{ opacity: 0.3 }} />
            <span style={{ fontSize: "10px", opacity: 0.5 }}>No media imported yet</span>
          </div>
        ) : (
          <div className="media-grid">
            {mediaPool.map((media) => {
              const isVideo = media.width || media.height;
              const isProcessing = (!media.proxyPath && isVideo) || (!media.thumbnailPath && isVideo) || (!media.waveformPath && media.hasAudio);
              const thumbSrc = media.thumbnailPath ? convertFileSrc(media.thumbnailPath!) : null;

              return (
                <div key={media.id} className="media-thumbnail-card" title={media.name}>
                  {thumbSrc ? (
                    <img src={thumbSrc} alt={media.name} className="media-img" />
                  ) : (
                    <div className="media-placeholder">
                      {isVideo ? <Film size={20} /> : <Music size={20} />}
                    </div>
                  )}

                  <span className="media-card-duration">{formatDuration(media.duration)}</span>
                  <div className="media-card-title">{media.name}</div>

                  <div
                    className="media-thumbnail-actions"
                    style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(12, 16, 26, 0.75)", opacity: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "6px", transition: "opacity 0.2s ease", zIndex: 3 }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = "0"; }}
                  >
                    {!isProcessing ? (
                      <>
                        <button className="btn-primary" style={{ padding: "4px 8px", fontSize: "10px", borderRadius: "4px", width: "80%" }} onClick={() => handleAddToTimeline(media)}>
                          <Plus size={10} /> Add to Track
                        </button>
                        <button className="btn-secondary" style={{ padding: "4px 8px", fontSize: "10px", borderRadius: "4px", width: "80%", color: "var(--accent-rose)", borderColor: "rgba(244, 63, 94, 0.2)" }} onClick={() => removeMediaFile(media.id)}>
                          <Trash2 size={10} /> Remove
                        </button>
                      </>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                        <Loader2 size={16} className="animate-spin" style={{ color: "var(--accent-teal)" }} />
                        <span style={{ fontSize: "8px", color: "var(--text-muted)", textAlign: "center" }}>Processing…</span>
                      </div>
                    )}
                  </div>

                  {isProcessing && (
                    <div style={{ position: "absolute", bottom: 2, right: 2, width: 6, height: 6, borderRadius: "50%", backgroundColor: "var(--accent-orange)", boxShadow: "0 0 6px var(--accent-orange)" }} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
