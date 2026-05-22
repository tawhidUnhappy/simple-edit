import React, { useState, useEffect } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTimelineStore } from "../store/timelineStore";
import { Plus, Trash2, Film, Music, HardDrive, AlertCircle, Loader2 } from "lucide-react";

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

export const MediaPool: React.FC = () => {
  const { mediaPool, addMediaFile, removeMediaFile, updateMediaFile, addClip, tracks } = useTimelineStore();
  const [filePath, setFilePath] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    // 1. Listen for background proxy progress
    const unlistenProxy = listen<ProxyProgressPayload>("proxy-progress", (event) => {
      const { clip_id, status, proxy_path } = event.payload;
      if (status === "completed" && proxy_path) {
        updateMediaFile(clip_id, { proxyPath: proxy_path });
      }
    });

    // 2. Listen for background waveform progress
    const unlistenWaveform = listen<WaveformProgressPayload>("waveform-progress", (event) => {
      const { clip_id, status, waveform_path } = event.payload;
      if (status === "completed" && waveform_path) {
        updateMediaFile(clip_id, { waveformPath: waveform_path });
      }
    });

    // 3. Listen for background thumbnail progress
    const unlistenThumbnail = listen<ThumbnailProgressPayload>("thumbnail-progress", (event) => {
      const { clip_id, status, thumbnails_dir } = event.payload;
      if (status === "completed" && thumbnails_dir) {
        // First frame cached is thumb_0001.jpg
        const thumbUrl = `${thumbnails_dir}/thumb_0001.jpg`;
        updateMediaFile(clip_id, { thumbnailPath: thumbUrl });
      }
    });

    return () => {
      unlistenProxy.then((fn) => fn());
      unlistenWaveform.then((fn) => fn());
      unlistenThumbnail.then((fn) => fn());
    };
  }, [updateMediaFile]);

  const handleImport = async () => {
    if (!filePath.trim()) return;
    setIsImporting(true);
    setErrorMsg(null);

    try {
      // Invoke isolated Tauri backend import media command
      const media = await invoke<any>("import_media_file", { filePath: filePath.trim() });
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
      setFilePath("");
    } catch (e: any) {
      setErrorMsg(e.toString());
    } finally {
      setIsImporting(false);
    }
  };

  const handleAddToTimeline = (media: any) => {
    // Determine target track: Video goes to first video track, pure Audio goes to first audio track
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
      timeStart: 0, // Drop at timeline start
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

  const formatSize = (bytes: number) => {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="panel-content" style={{ padding: "12px", gap: "12px" }}>
      {/* Absolute Path Import Section */}
      <div className="input-group">
        <label className="input-label" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <HardDrive size={12} />
          Import File Path
        </label>
        <div className="input-wrapper">
          <input
            type="text"
            placeholder="Paste absolute path here... (e.g. /path/to/video.mp4)"
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            disabled={isImporting}
            style={{ fontSize: "11px" }}
          />
          <button
            className="btn-primary"
            style={{ padding: "6px 12px", fontSize: "11px" }}
            onClick={handleImport}
            disabled={isImporting || !filePath.trim()}
          >
            {isImporting ? <Loader2 size={12} className="animate-spin" /> : "Import"}
          </button>
        </div>
        {errorMsg && (
          <div className="item-meta" style={{ color: "var(--accent-rose)", display: "flex", alignItems: "center", gap: "4px", marginTop: "4px", fontSize: "10px" }}>
            <AlertCircle size={10} />
            {errorMsg}
          </div>
        )}
      </div>

      {/* Media Pool Grid */}
      <div style={{ flex: 1, overflowY: "auto", marginTop: "4px" }}>
        {mediaPool.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "160px", color: "var(--text-muted)", gap: "8px", border: "1px dashed var(--border-normal)", borderRadius: "8px" }}>
            <Film size={28} style={{ opacity: 0.4 }} />
            <span style={{ fontSize: "11px" }}>No media imported yet</span>
          </div>
        ) : (
          <div className="media-grid">
            {mediaPool.map((media) => {
              const isVideo = media.width || media.height;
              const isProcessingProxy = !media.proxyPath && isVideo;
              const isProcessingThumbnails = !media.thumbnailPath && isVideo;
              const isProcessingWaveform = !media.waveformPath && media.hasAudio;
              const isProcessing = isProcessingProxy || isProcessingThumbnails || isProcessingWaveform;

              // Convert local absolute thumbnail path to a Tauri assets URL
              const hasThumb = media.thumbnailPath;
              const thumbSrc = hasThumb ? convertFileSrc(media.thumbnailPath!) : null;

              return (
                <div key={media.id} className="media-thumbnail-card" title={media.name}>
                  {/* Thumbnail / Icon preview */}
                  {thumbSrc ? (
                    <img src={thumbSrc} alt={media.name} className="media-img" />
                  ) : (
                    <div className="media-placeholder">
                      {isVideo ? <Film size={20} /> : <Music size={20} />}
                    </div>
                  )}

                  {/* Duration Badge */}
                  <span className="media-card-duration">
                    {formatDuration(media.duration)}
                  </span>

                  {/* Name Overlay */}
                  <div className="media-card-title">
                    {media.name}
                  </div>

                  {/* Quick Action Badges & Loader Overlay */}
                  <div
                    className="media-thumbnail-actions"
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      background: "rgba(12, 16, 26, 0.75)",
                      opacity: 0,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "6px",
                      transition: "opacity 0.2s ease",
                      zIndex: 3
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = "1";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = "0";
                    }}
                  >
                    {!isProcessing ? (
                      <>
                        <button
                          className="btn-primary"
                          style={{ padding: "4px 8px", fontSize: "10px", borderRadius: "4px", width: "80%" }}
                          onClick={() => handleAddToTimeline(media)}
                        >
                          <Plus size={10} /> Add to Track
                        </button>
                        <button
                          className="btn-secondary"
                          style={{ padding: "4px 8px", fontSize: "10px", borderRadius: "4px", width: "80%", color: "var(--accent-rose)", borderColor: "rgba(244, 63, 94, 0.2)" }}
                          onClick={() => removeMediaFile(media.id)}
                        >
                          <Trash2 size={10} /> Remove
                        </button>
                      </>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", padding: "6px" }}>
                        <Loader2 size={16} className="animate-spin" style={{ color: "var(--accent-teal)" }} />
                        <span style={{ fontSize: "8px", color: "var(--text-muted)", textAlign: "center" }}>
                          {isProcessingProxy && "Proxy..."}
                          {isProcessingThumbnails && "Frames..."}
                          {isProcessingWaveform && "Waves..."}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Processing Glow border or indicator */}
                  {isProcessing && (
                    <div style={{ position: "absolute", bottom: 2, right: 2, width: 6, height: 6, borderRadius: "50%", backgroundColor: "var(--accent-orange)", boxShadow: "0 0 6px var(--accent-orange)" }}></div>
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
