import React, { useState, useEffect, useCallback } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useTimelineStore, Clip } from "../store/timelineStore";
import { Plus, Trash2, Film, Music, Image, Loader2, Upload, FolderOpen, Eye, X } from "lucide-react";

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

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"]);

export const MediaPool: React.FC = () => {
  const { mediaPool, addMediaFile, removeMediaFile, updateMediaFile, addClip, tracks } = useTimelineStore();
  const [isImporting, setIsImporting] = useState(false);
  const [importCount, setImportCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [previewMedia, setPreviewMedia] = useState<any | null>(null);

  // Background task event listeners — async setup with mounted-flag cleanup
  useEffect(() => {
    let mounted = true;
    const cleanup: Array<() => void> = [];

    Promise.all([
      listen<ProxyProgressPayload>("proxy-progress", (event) => {
        const { clip_id, status, proxy_path } = event.payload;
        if (status === "completed" && proxy_path) updateMediaFile(clip_id, { proxyPath: proxy_path });
      }),
      listen<WaveformProgressPayload>("waveform-progress", (event) => {
        const { clip_id, status, waveform_path } = event.payload;
        if (status === "completed" && waveform_path) updateMediaFile(clip_id, { waveformPath: waveform_path });
      }),
      listen<ThumbnailProgressPayload>("thumbnail-progress", (event) => {
        const { clip_id, status, thumbnails_dir } = event.payload;
        if (status === "completed" && thumbnails_dir) updateMediaFile(clip_id, { thumbnailPath: `${thumbnails_dir}/thumb_0001.jpg` });
      }),
      listen<{ paths: string[] }>("tauri://drag-drop", async (event) => {
        setIsDragging(false);
        await importFiles(event.payload.paths);
      }),
      listen("tauri://drag-enter", () => setIsDragging(true)),
      listen("tauri://drag-leave", () => setIsDragging(false)),
    ]).then((fns) => {
      if (mounted) {
        cleanup.push(...fns);
      } else {
        fns.forEach((fn) => fn());
      }
    });

    return () => {
      mounted = false;
      cleanup.forEach((fn) => fn());
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
    const ext = (media.filePath as string).split(".").pop()?.toLowerCase() ?? "";
    const isImage = IMAGE_EXTENSIONS.has(ext);
    const isAudio = !media.width && !media.height && !isImage;

    const trackType = isAudio ? "audio" : "video";
    const clipType: Clip["type"] = isImage ? "image" : isAudio ? "audio" : "video";

    const targetTrack = tracks.find((t) => t.type === trackType);
    if (!targetTrack) {
      alert(`No active ${trackType} track found on timeline!`);
      return;
    }

    // Images get duration:9999 (unlimited source) + 5s default display window
    const sourceDuration = isImage ? 9999 : media.duration;
    const displayEnd = isImage ? 5.0 : media.duration;

    const colorMap: Record<string, string> = {
      video: "var(--bg-panel-light)",
      audio: "var(--bg-panel)",
      image: "var(--bg-darker)",
    };

    addClip(targetTrack.id, {
      name: media.name,
      filePath: media.filePath,
      proxyPath: media.proxyPath,
      type: clipType,
      duration: sourceDuration,
      startOffset: 0,
      endOffset: displayEnd,
      timeStart: 0,
      volume: 1.0,
      speed: 1.0,
      color: colorMap[clipType],
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
          border: `1.5px dashed ${isDragging ? "var(--border-focus)" : "var(--border-normal)"}`,
          borderRadius: "10px",
          padding: "16px 12px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "8px",
          background: isDragging ? "var(--bg-panel-light)" : "rgba(255,255,255,0.01)",
          transition: "border-color 0.2s, background 0.2s",
          cursor: "default",
        }}
      >
        <Upload size={22} style={{ color: isDragging ? "var(--text-bright)" : "var(--text-muted)", opacity: isDragging ? 1 : 0.5, transition: "color 0.2s" }} />
        <span style={{ fontSize: "11px", color: isDragging ? "var(--text-bright)" : "var(--text-muted)", fontWeight: 600, letterSpacing: "0.3px" }}>
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
        <div style={{ color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "4px", fontSize: "10px" }}>
          {errorMsg}
        </div>
      )}

      {/* Media Pool Grid */}
      <div style={{ flex: 1, overflowY: "auto", marginTop: "4px" }}>
        {mediaPool.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100px", color: "var(--text-muted)", gap: "8px" }}>
            <span style={{ fontSize: "10px", opacity: 0.4 }}>No media imported yet</span>
          </div>
        ) : (
          <div className="media-grid">
            {mediaPool.map((media) => {
              const ext = (media.filePath as string).split(".").pop()?.toLowerCase() ?? "";
              const isImageFile = IMAGE_EXTENSIONS.has(ext);
              const isVideoFile = !isImageFile && !!(media.width || media.height);
              const isAudioFile = !isImageFile && !isVideoFile && media.hasAudio;
              // Images and audio-only files don't need proxy/thumbnails from Rust
              const isProcessing = (isVideoFile && (!media.proxyPath || !media.thumbnailPath)) ||
                                   (isAudioFile && !media.waveformPath);
              const thumbSrc = media.thumbnailPath
                ? convertFileSrc(media.thumbnailPath!)
                : isImageFile
                  ? convertFileSrc(media.filePath)
                  : null;

              const PlaceholderIcon = isImageFile ? Image : isAudioFile ? Music : Film;

              return (
                <div 
                  key={media.id} 
                  className="media-thumbnail-card" 
                  title={media.name}
                  draggable={true}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/json", JSON.stringify(media));
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  style={{ cursor: "grab" }}
                >
                  {thumbSrc ? (
                    <img src={thumbSrc} alt={media.name} className="media-img" />
                  ) : (
                    <div className="media-placeholder">
                      <PlaceholderIcon size={20} />
                    </div>
                  )}

                  <span className="media-card-duration">{formatDuration(media.duration)}</span>
                  <div className="media-card-title">{media.name}</div>

                  <div
                    className="media-thumbnail-actions"
                    style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(10, 10, 10, 0.85)", opacity: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "6px", transition: "opacity 0.2s ease", zIndex: 3 }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = "0"; }}
                  >
                    <button className="btn-primary" style={{ padding: "4px 8px", fontSize: "10px", borderRadius: "4px", width: "80%" }} onClick={() => handleAddToTimeline(media)}>
                      <Plus size={10} /> Add to Track
                    </button>
                    <button className="btn-secondary" style={{ padding: "4px 8px", fontSize: "10px", borderRadius: "4px", width: "80%", color: "var(--text-bright)", borderColor: "var(--border-normal)" }} onClick={() => setPreviewMedia(media)}>
                      <Eye size={10} /> Preview
                    </button>
                    <button className="btn-secondary" style={{ padding: "4px 8px", fontSize: "10px", borderRadius: "4px", width: "80%", color: "var(--text-normal)", borderColor: "var(--border-normal)" }} onClick={() => removeMediaFile(media.id)}>
                      <Trash2 size={10} /> Remove
                    </button>
                    {isProcessing && (
                      <div style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "8px", color: "var(--text-muted)", marginTop: "4px" }}>
                        <Loader2 size={10} className="animate-spin" /> Processing proxy...
                      </div>
                    )}
                  </div>

                  {isProcessing && (
                    <div
                      style={{
                        position: "absolute",
                        top: 6,
                        left: 6,
                        padding: "4px",
                        borderRadius: "50%",
                        backgroundColor: "rgba(10, 10, 10, 0.75)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        zIndex: 2
                      }}
                      title="Building proxy/waveform in background"
                    >
                      <Loader2 size={10} className="animate-spin" style={{ color: "var(--text-bright)" }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Glassmorphic Media Previewer Modal */}
      {previewMedia && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(6, 8, 12, 0.8)",
          backdropFilter: "blur(6px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 10005,
        }}>
          <div style={{
            background: "rgba(18, 22, 33, 0.95)",
            border: "1px solid var(--border-normal)",
            boxShadow: "0 10px 40px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.05)",
            borderRadius: "14px",
            width: "480px",
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            gap: "14px",
            color: "#fff"
          }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Eye size={16} style={{ color: "var(--text-bright)" }} />
                <span style={{ fontSize: "13px", fontWeight: "700" }}>Media Previewer</span>
              </div>
              <button 
                onClick={() => setPreviewMedia(null)}
                style={{ background: "transparent", border: 0, color: "var(--text-muted)", cursor: "pointer" }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Display Body */}
            <div style={{
              height: "240px",
              background: "var(--bg-darker)",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              border: "1px solid var(--border-dim)",
              position: "relative"
            }}>
              {(() => {
                const ext = (previewMedia.filePath as string).split(".").pop()?.toLowerCase() ?? "";
                const isImg = IMAGE_EXTENSIONS.has(ext);
                const isAud = !isImg && !previewMedia.width && !previewMedia.height && previewMedia.hasAudio;
                
                if (isImg) {
                  return (
                    <img 
                      src={convertFileSrc(previewMedia.filePath)} 
                      alt="" 
                      style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} 
                    />
                  );
                } else if (isAud) {
                  return (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
                      <div style={{
                        width: "60px",
                        height: "60px",
                        borderRadius: "50%",
                        background: "rgba(255,255,255,0.03)",
                        border: "2px dashed var(--border-normal)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        animation: "spin 12s linear infinite"
                      }}>
                        <Music size={24} style={{ color: "var(--text-muted)" }} />
                      </div>
                      <audio 
                        src={convertFileSrc(previewMedia.filePath)} 
                        controls 
                        autoPlay 
                        style={{ width: "280px" }} 
                      />
                    </div>
                  );
                } else {
                  // Video File
                  return (
                    <video 
                      src={convertFileSrc(previewMedia.filePath)} 
                      controls 
                      autoPlay 
                      style={{ width: "100%", height: "100%", objectFit: "contain" }} 
                    />
                  );
                }
              })()}
            </div>

            {/* Info details */}
            <div style={{ fontSize: "11px", color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: "4px" }}>
              <div><strong style={{ color: "var(--text-normal)" }}>Name:</strong> {previewMedia.name}</div>
              <div style={{ wordBreak: "break-all" }}><strong style={{ color: "var(--text-normal)" }}>Path:</strong> {previewMedia.filePath}</div>
              <div style={{ display: "flex", gap: "16px", marginTop: "2px" }}>
                <div><strong>Duration:</strong> {previewMedia.duration.toFixed(2)}s</div>
                {previewMedia.width && <div><strong>Resolution:</strong> {previewMedia.width}x{previewMedia.height}</div>}
                <div><strong>Size:</strong> {(previewMedia.sizeBytes / (1024 * 1024)).toFixed(2)} MB</div>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
              <button 
                className="btn-secondary" 
                style={{ flex: 1, fontSize: "11px", padding: "8px 0" }} 
                onClick={() => setPreviewMedia(null)}
              >
                Close Preview
              </button>
              <button 
                className="btn-primary" 
                style={{ flex: 1, fontSize: "11px", padding: "8px 0" }} 
                onClick={() => {
                  handleAddToTimeline(previewMedia);
                  setPreviewMedia(null);
                }}
              >
                Add to Track
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
