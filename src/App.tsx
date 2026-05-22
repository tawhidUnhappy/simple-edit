import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTimelineStore, SystemInfo } from "./store/timelineStore";
import { MediaPool } from "./components/MediaPool";
import { MonitorProgram } from "./components/MonitorProgram";
import { Timeline } from "./components/Timeline";
import { ModelManager } from "./components/ModelManager";
import { ToolUpdater } from "./components/ToolUpdater";
import { AiGenerator } from "./components/AiGenerator";
import { ClipInspector } from "./components/ClipInspector";
import { VisualizerPanel } from "./components/VisualizerPanel";
import { 
  Cpu, 
  ShieldAlert, 
  Cpu as GpuIcon, 
  Layers, 
  Wrench, 
  RefreshCw, 
  Film, 
  X, 
  Loader2, 
  CheckCircle2, 
  AlertTriangle 
} from "lucide-react";
import "./App.css";

function App() {
  const { systemStatus, setSystemStatus, tracks: timelineTracks } = useTimelineStore();
  const [leftTab, setLeftTab] = useState<"media" | "models">("media");
  const [rightTab, setRightTab] = useState<"tools" | "generation" | "visualizer" | "inspector">("tools");
  const [isRefreshing, setIsRefreshing] = useState(false);

  // --- Export Modal & Compilation State ---
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportPath, setExportPath] = useState("/run/media/yuzuki/Evil/simple-edit/temp/export.mp4");
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState("");
  const [exportSuccess, setExportSuccess] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const fetchSystemStatus = async () => {
    setIsRefreshing(true);
    try {
      const status = await invoke<SystemInfo>("check_system_status");
      setSystemStatus(status);
    } catch (error) {
      console.error("Failed to check system status:", error);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchSystemStatus();
  }, []);

  // Listen for backend export events
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    
    const setupListener = async () => {
      unlisten = await listen<any>("export-progress", (event) => {
        const { progress, status } = event.payload;
        setExportProgress(progress);
        setExportStatus(status);
        if (progress >= 1.0) {
          setIsExporting(false);
          setExportSuccess(true);
        }
      });
    };
    
    setupListener();
    
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleExportProject = async () => {
    if (!exportPath.trim()) {
      alert("Please enter a valid target export path.");
      return;
    }

    setIsExporting(true);
    setExportProgress(0);
    setExportStatus("Analyzing project structure...");
    setExportSuccess(false);
    setExportError(null);

    try {
      // Map state tracks to matching Serde JSON structures
      const compiledTracks = timelineTracks.map((t) => ({
        id: t.id,
        name: t.name,
        type: t.type,
        clips: t.clips.map((c) => ({
          id: c.id,
          name: c.name,
          filePath: c.filePath,
          type: c.type,
          duration: c.duration,
          startOffset: c.startOffset,
          endOffset: c.endOffset,
          trackId: c.trackId,
          timeStart: c.timeStart,
          volume: c.volume,
          speed: c.speed,
          text: c.text || null,
        })),
      }));

      await invoke("export_project", {
        tracks: compiledTracks,
        outputPath: exportPath.trim(),
      });
    } catch (error: any) {
      console.error("Export compiler failed:", error);
      setExportError(error.toString() || "Unknown FFmpeg compiler error");
      setIsExporting(false);
    }
  };

  return (
    <div className="app-container">
      {/* Top Navigation Bar */}
      <header className="top-bar">
        <div className="brand-section">
          <Layers className="text-indigo-500" size={20} style={{ color: "var(--accent-primary)" }} />
          <h1 className="brand-logo">simple-edit</h1>
          <span style={{ fontSize: "10px", color: "var(--text-muted)", marginLeft: "4px" }}>v0.1.0-alpha</span>
        </div>

        {/* System Hardware Badges + Export Trigger */}
        <div className="system-badges" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button 
            onClick={fetchSystemStatus} 
            disabled={isRefreshing}
            className="badge"
            style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "4px" }}
            title="Refresh System Status"
          >
            <RefreshCw size={10} className={isRefreshing ? "animate-spin" : ""} />
            Refresh
          </button>
          
          {systemStatus ? (
            <>
              {/* CPU Info */}
              <div className="badge" title={`CPU: ${systemStatus.hardware.cpu_cores} Cores, RAM: ${systemStatus.hardware.system_ram_gb} GB`}>
                <Cpu size={11} />
                <span>{systemStatus.hardware.cpu_cores}C / {systemStatus.hardware.system_ram_gb}GB</span>
              </div>

              {/* GPU Info */}
              {systemStatus.hardware.gpu_brand !== "CPU" ? (
                <div className="badge gpu" title={`GPU: ${systemStatus.hardware.gpu_name} with ${systemStatus.hardware.vram_total_mb}MB VRAM`}>
                  <GpuIcon size={11} />
                  <span>{systemStatus.hardware.gpu_name.replace("NVIDIA GeForce ", "")} ({Math.round(systemStatus.hardware.vram_total_mb / 1024)}GB)</span>
                </div>
              ) : (
                <div className="badge" title="No discrete GPU found, running in CPU mode.">
                  <Cpu size={11} />
                  <span>CPU Mode</span>
                </div>
              )}

              {/* PyTorch CUDA Status */}
              {systemStatus.pytorch_cuda_available ? (
                <div className="badge cuda" title={`PyTorch Cuda is active on device: ${systemStatus.pytorch_cuda_device}`}>
                  <ShieldAlert size={11} style={{ color: "var(--accent-primary)" }} />
                  <span>CUDA Active</span>
                </div>
              ) : (
                <div className="badge" title="PyTorch CUDA is not available. GPU acceleration for AI is disabled.">
                  <ShieldAlert size={11} style={{ color: "var(--accent-rose)" }} />
                  <span style={{ color: "var(--accent-rose)" }}>CUDA Offline</span>
                </div>
              )}

              {/* FFmpeg Status */}
              <div className="badge" title={`FFmpeg version: ${systemStatus.ffmpeg_version}`}>
                <Wrench size={11} />
                <span>FFmpeg {systemStatus.ffmpeg_version !== "Not Available" ? systemStatus.ffmpeg_version : "Offline"}</span>
              </div>
            </>
          ) : (
            <div className="badge">
              <RefreshCw size={11} className="animate-spin" />
              <span>Detecting Hardware...</span>
            </div>
          )}

          {/* Export Video Action Button */}
          <button 
            onClick={() => setIsExportModalOpen(true)}
            className="btn-primary"
            style={{ 
              padding: "4px 10px", 
              fontSize: "11px", 
              display: "flex", 
              alignItems: "center", 
              gap: "4px",
              background: "linear-gradient(135deg, var(--accent-rose), var(--accent-primary))",
              border: 0,
              boxShadow: "0 2px 8px rgba(244, 63, 94, 0.4)",
              cursor: "pointer",
              borderRadius: "4px",
              color: "#fff",
              fontWeight: "600"
            }}
          >
            <Film size={12} />
            Export Video
          </button>
        </div>
      </header>

      {/* Main Workspace Dashboard */}
      <main className="workspace-grid">
        {/* Upper Split Section: Left, Center, Right Panels */}
        <section className="upper-section">
          {/* Left Panel: Media Pool / Model Vault */}
          <div className="panel">
            <div className="panel-header">
              <div className="tab-container" style={{ margin: 0, width: "100%" }}>
                <button
                  className={`tab-btn ${leftTab === "media" ? "active" : ""}`}
                  onClick={() => setLeftTab("media")}
                >
                  Media Pool
                </button>
                <button
                  className={`tab-btn ${leftTab === "models" ? "active" : ""}`}
                  onClick={() => setLeftTab("models")}
                >
                  Model Vault
                </button>
              </div>
            </div>
            
            {leftTab === "media" ? <MediaPool /> : <ModelManager />}
          </div>

          {/* Center Panel: Program Monitor */}
          <div className="panel" style={{ flex: 1 }}>
            <div className="panel-header">
              <span className="panel-title">
                <Layers size={13} style={{ color: "var(--accent-teal)" }} />
                Program Monitor
              </span>
            </div>
            <MonitorProgram />
          </div>

          {/* Right Panel: Multiple AI & Inspector Tabs */}
          <div className="panel last">
            <div className="panel-header">
              <div className="tab-container" style={{ margin: 0, width: "100%", display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "2px" }}>
                <button
                  className={`tab-btn ${rightTab === "tools" ? "active" : ""}`}
                  style={{ fontSize: "10px", padding: "4px 0" }}
                  onClick={() => setRightTab("tools")}
                >
                  AI Subsystems
                </button>
                <button
                  className={`tab-btn ${rightTab === "generation" ? "active" : ""}`}
                  style={{ fontSize: "10px", padding: "4px 0" }}
                  onClick={() => setRightTab("generation")}
                >
                  AI Generator
                </button>
                <button
                  className={`tab-btn ${rightTab === "visualizer" ? "active" : ""}`}
                  style={{ fontSize: "10px", padding: "4px 0" }}
                  onClick={() => setRightTab("visualizer")}
                >
                  Visualizer
                </button>
                <button
                  className={`tab-btn ${rightTab === "inspector" ? "active" : ""}`}
                  style={{ fontSize: "10px", padding: "4px 0" }}
                  onClick={() => setRightTab("inspector")}
                >
                  Inspector
                </button>
              </div>
            </div>

            {rightTab === "tools" && <ToolUpdater />}
            {rightTab === "generation" && <AiGenerator />}
            {rightTab === "visualizer" && <VisualizerPanel />}
            {rightTab === "inspector" && <ClipInspector />}
          </div>
        </section>

        {/* Lower Section: Timeline Workspace */}
        <section style={{ overflow: "hidden" }}>
          <Timeline />
        </section>
      </main>

      {/* --- Translucent Glassmorphic Export Modal --- */}
      {isExportModalOpen && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(6, 8, 12, 0.75)",
          backdropFilter: "blur(8px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999,
          animation: "fadeIn 0.2s ease"
        }}>
          <div style={{
            background: "rgba(18, 22, 33, 0.9)",
            border: "1px solid var(--border-normal)",
            boxShadow: "0 10px 40px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.05)",
            borderRadius: "12px",
            width: "480px",
            padding: "20px",
            color: "#fff",
            display: "flex",
            flexDirection: "column",
            gap: "14px"
          }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <Film style={{ color: "var(--accent-rose)" }} size={18} />
                <span style={{ fontSize: "14px", fontWeight: "700" }}>Export Project Timeline</span>
              </div>
              <button 
                onClick={() => !isExporting && setIsExportModalOpen(false)}
                disabled={isExporting}
                style={{ 
                  background: "transparent", 
                  border: 0, 
                  color: "var(--text-muted)", 
                  cursor: isExporting ? "not-allowed" : "pointer" 
                }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Content body */}
            {!isExporting && !exportSuccess && !exportError && (
              <>
                <div className="input-group">
                  <label className="input-label" style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                    Target Output Video Path (Absolute Path)
                  </label>
                  <input
                    type="text"
                    value={exportPath}
                    onChange={(e) => setExportPath(e.target.value)}
                    placeholder="e.g. /home/user/output.mp4"
                    style={{ fontSize: "11px", padding: "8px", width: "100%", marginTop: "4px" }}
                  />
                  <span style={{ fontSize: "9px", color: "var(--text-muted)", marginTop: "2px" }}>
                    Multi-track clips, transitions, and generated AI subtitles will be compiled via native GPU-accelerated FFmpeg streams.
                  </span>
                </div>

                <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "6px" }}>
                  <button 
                    onClick={() => setIsExportModalOpen(false)}
                    className="btn-secondary"
                    style={{ fontSize: "11px", padding: "6px 12px" }}
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleExportProject}
                    className="btn-primary"
                    style={{ fontSize: "11px", padding: "6px 16px", background: "var(--accent-primary)", border: 0 }}
                  >
                    Start Compile
                  </button>
                </div>
              </>
            )}

            {/* Exporting Active State */}
            {isExporting && (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", alignItems: "center", padding: "10px 0" }}>
                <Loader2 size={32} className="animate-spin" style={{ color: "var(--accent-rose)" }} />
                <span style={{ fontSize: "12px", fontWeight: "600" }}>Compiling Timeline Assets...</span>
                
                {/* Progress bar container */}
                <div style={{
                  width: "100%",
                  height: "8px",
                  background: "rgba(0,0,0,0.5)",
                  borderRadius: "4px",
                  overflow: "hidden",
                  marginTop: "6px"
                }}>
                  <div style={{
                    width: `${exportProgress * 100}%`,
                    height: "100%",
                    background: "linear-gradient(90deg, var(--accent-rose), var(--accent-primary))",
                    borderRadius: "4px",
                    transition: "width 0.1s linear",
                    boxShadow: "0 0 10px rgba(244, 63, 94, 0.6)"
                  }} />
                </div>
                
                <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                  {exportStatus || "Running video compression kernels..."}
                </span>
              </div>
            )}

            {/* Export Success State */}
            {exportSuccess && (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", alignItems: "center", padding: "10px 0" }}>
                <CheckCircle2 size={36} style={{ color: "var(--accent-teal)" }} />
                <span style={{ fontSize: "13px", fontWeight: "700", color: "var(--accent-teal)" }}>Export Completed!</span>
                <span style={{ fontSize: "10px", color: "var(--text-muted)", textAlign: "center" }}>
                  Your finished MP4 video has been successfully encoded and exported to:
                </span>
                <code style={{ 
                  fontSize: "9px", 
                  color: "var(--accent-teal)", 
                  background: "rgba(0,0,0,0.3)", 
                  padding: "6px 12px", 
                  borderRadius: "4px", 
                  width: "100%", 
                  wordBreak: "break-all",
                  textAlign: "center"
                }}>
                  {exportPath}
                </code>
                
                <button 
                  onClick={() => {
                    setIsExportModalOpen(false);
                    setExportSuccess(false);
                  }}
                  className="btn-primary"
                  style={{ fontSize: "11px", padding: "6px 16px", marginTop: "8px", background: "var(--accent-teal)", border: 0 }}
                >
                  Back to Editor
                </button>
              </div>
            )}

            {/* Export Error State */}
            {exportError && (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", alignItems: "center", padding: "10px 0" }}>
                <AlertTriangle size={36} style={{ color: "var(--accent-rose)" }} />
                <span style={{ fontSize: "13px", fontWeight: "700", color: "var(--accent-rose)" }}>Compilation Failed</span>
                <span style={{ fontSize: "10px", color: "var(--text-muted)", textAlign: "center" }}>
                  An error occurred while compiling your project tracks:
                </span>
                <div style={{
                  maxHeight: "80px",
                  overflowY: "auto",
                  width: "100%",
                  background: "rgba(244, 63, 94, 0.1)",
                  border: "1px solid rgba(244, 63, 94, 0.2)",
                  color: "var(--accent-rose)",
                  fontSize: "9px",
                  padding: "6px",
                  borderRadius: "4px",
                  fontFamily: "monospace",
                  wordBreak: "break-all"
                }}>
                  {exportError}
                </div>
                
                <div style={{ display: "flex", gap: "8px", marginTop: "8px", width: "100%" }}>
                  <button 
                    onClick={() => {
                      setExportError(null);
                    }}
                    className="btn-secondary"
                    style={{ flex: 1, fontSize: "11px", padding: "6px 0" }}
                  >
                    Retry Config
                  </button>
                  <button 
                    onClick={() => {
                      setIsExportModalOpen(false);
                      setExportError(null);
                    }}
                    className="btn-primary"
                    style={{ flex: 1, fontSize: "11px", padding: "6px 0" }}
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
