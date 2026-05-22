import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Play, Pause, X, Download, Server, RefreshCw } from "lucide-react";

interface DownloadProgressPayload {
  task_id: String;
  url: String;
  filename: String;
  bytes_downloaded: number;
  bytes_total: number;
  speed_mb_s: number;
  percent: number;
  status: String; // "downloading", "paused", "completed", "failed", "cancelled"
  error: String | null;
}

interface LocalModel {
  name: string;
  size: string;
  path: string;
}

export const ModelManager: React.FC = () => {
  const [downloadUrl, setDownloadUrl] = useState("");
  const [modelType, setModelType] = useState("stable-diffusion");
  const [customName, setCustomName] = useState("");
  const [isResolving, setIsResolving] = useState(false);
  const [downloads, setDownloads] = useState<Record<string, DownloadProgressPayload>>({});
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);

  useEffect(() => {
    // 1. Listen for download progress updates from the Rust backend
    const unlisten = listen<DownloadProgressPayload>("download-progress", (event) => {
      const payload = event.payload;
      setDownloads((prev) => {
        const next = { ...prev };
        if (payload.status === "completed" || payload.status === "failed" || payload.status === "cancelled") {
          // Keep it on UI for 3 seconds then remove
          next[payload.task_id as string] = payload;
          setTimeout(() => {
            setDownloads((curr) => {
              const updated = { ...curr };
              delete updated[payload.task_id as string];
              return updated;
            });
            scanLocalModels(); // Rescan models on complete/cancel
          }, 3500);
        } else {
          next[payload.task_id as string] = payload;
        }
        return next;
      });
    });

    scanLocalModels();

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const scanLocalModels = async () => {
    try {
      const models = await invoke<LocalModel[]>("list_local_models");
      setLocalModels(models);
    } catch (e) {
      console.error("Failed to scan local models:", e);
    }
  };

  const handleDownload = async () => {
    if (!downloadUrl) return;
    setIsResolving(true);

    try {
      // 1. Resolve url (Civitai link -> direct url, or keep original)
      let directUrl = downloadUrl;
      if (downloadUrl.includes("civitai.com")) {
        directUrl = await invoke<string>("resolve_civitai_url", { url: downloadUrl });
      }

      // 2. Determine target relative directory
      let filename = customName.trim();
      if (!filename) {
        // Extract filename from directUrl or default
        try {
          const urlObj = new URL(directUrl);
          filename = urlObj.pathname.split("/").pop() || "model.bin";
          if (!filename.includes(".")) filename = "model.safetensors";
        } catch {
          filename = "model.safetensors";
        }
      }

      const destRelativePath = `models/${modelType}/${filename}`;

      // 3. Start download
      await invoke<string>("start_download", {
        url: directUrl,
        destRelativePath,
      });

      setDownloadUrl("");
      setCustomName("");
    } catch (e: any) {
      alert(`Failed to start download: ${e}`);
    } finally {
      setIsResolving(false);
    }
  };

  const pauseDownload = async (taskId: string) => {
    try {
      await invoke("pause_download", { taskId });
    } catch (e) {
      console.error(e);
    }
  };

  const resumeDownload = async (taskId: string) => {
    try {
      await invoke("resume_download", { taskId });
    } catch (e) {
      console.error(e);
    }
  };

  const cancelDownload = async (taskId: string) => {
    try {
      await invoke("cancel_download", { taskId });
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="panel-content">
      <div className="input-group">
        <label className="input-label">Model Type</label>
        <select value={modelType} onChange={(e) => setModelType(e.target.value)}>
          <option value="stable-diffusion">Stable Diffusion (.safetensors)</option>
          <option value="whisper">Whisper speech-to-text (.bin)</option>
          <option value="tts">IndexTTS2 Voice Weights (.pth)</option>
          <option value="rvc">RVC Voice Cloner (.pth)</option>
        </select>
      </div>

      <div className="input-group">
        <label className="input-label">Civitai / Direct Model URL</label>
        <div className="input-wrapper">
          <input
            type="text"
            placeholder="Paste Civitai or direct model link here..."
            value={downloadUrl}
            onChange={(e) => setDownloadUrl(e.target.value)}
          />
        </div>
      </div>

      <div className="input-group">
        <label className="input-label">Custom Save Filename (Optional)</label>
        <div className="input-wrapper">
          <input
            type="text"
            placeholder="e.g. anything-xl.safetensors (auto-detect if blank)"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
          />
        </div>
      </div>

      <button
        className="btn-primary"
        onClick={handleDownload}
        disabled={isResolving || !downloadUrl}
      >
        {isResolving ? (
          <>
            <RefreshCw className="animate-spin" size={16} /> Resolving URL...
          </>
        ) : (
          <>
            <Download size={16} /> Add to Download Queue
          </>
        )}
      </button>

      {/* Active Downloads List */}
      {Object.keys(downloads).length > 0 && (
        <div className="card-list" style={{ marginTop: "12px" }}>
          <label className="input-label">Active Downloads</label>
          {Object.values(downloads).map((dl) => (
            <div className="item-card" key={dl.task_id as string}>
              <div className="item-card-row">
                <span className="item-title" style={{ maxWidth: "70%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {dl.filename}
                </span>
                <span className="item-meta" style={{ color: dl.status === "failed" ? "var(--accent-rose)" : dl.status === "completed" ? "var(--accent-teal)" : "var(--accent-primary)" }}>
                  {dl.status.toUpperCase()}
                </span>
              </div>

              {/* Progress Bar */}
              <div className="progress-container">
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${dl.percent}%` }}></div>
                </div>
                <div className="progress-stats">
                  <span>{dl.percent.toFixed(1)}%</span>
                  {dl.status === "downloading" && (
                    <span>{dl.speed_mb_s.toFixed(2)} MB/s</span>
                  )}
                </div>
              </div>

              {/* Action buttons for pauses/cancels */}
              {dl.status !== "completed" && dl.status !== "failed" && dl.status !== "cancelled" && (
                <div className="item-card-row" style={{ marginTop: "4px" }}>
                  {dl.status === "downloading" ? (
                    <button className="btn-secondary" style={{ padding: "4px 8px", fontSize: "11px" }} onClick={() => pauseDownload(dl.task_id as string)}>
                      <Pause size={12} /> Pause
                    </button>
                  ) : (
                    <button className="btn-secondary" style={{ padding: "4px 8px", fontSize: "11px" }} onClick={() => resumeDownload(dl.task_id as string)}>
                      <Play size={12} /> Resume
                    </button>
                  )}
                  <button className="btn-secondary" style={{ padding: "4px 8px", fontSize: "11px", color: "var(--accent-rose)" }} onClick={() => cancelDownload(dl.task_id as string)}>
                    <X size={12} /> Cancel
                  </button>
                </div>
              )}

              {dl.error && (
                <div className="item-meta" style={{ color: "var(--accent-rose)", marginTop: "4px", fontSize: "10px" }}>
                  Error: {dl.error}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Local Installed Weights list */}
      <div className="card-list" style={{ marginTop: "12px" }}>
        <label className="input-label">Local Model Vault</label>
        {localModels.map((model, idx) => (
          <div className="item-card" key={idx}>
            <div className="item-card-row">
              <span className="item-title">{model.name}</span>
              <span className="item-meta">{model.size}</span>
            </div>
            <div className="item-meta" style={{ fontSize: "10px", color: "var(--text-muted)" }}>
              <Server size={10} style={{ marginRight: "4px", display: "inline" }} />
              {model.path}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
