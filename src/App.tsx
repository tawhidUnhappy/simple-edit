import { useEffect, useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTimelineStore, SystemInfo } from "./store/timelineStore";
import { MediaPool } from "./components/MediaPool";
import { MonitorProgram } from "./components/MonitorProgram";
import { Timeline } from "./components/Timeline";
import { ModelManager } from "./components/ModelManager";
import { ToolUpdater } from "./components/ToolUpdater";
import { AiGenerator } from "./components/AiGenerator";
import { ClipInspector } from "./components/ClipInspector";
import { VisualizerPanel } from "./components/VisualizerPanel";
import { LyricVisualizer } from "./components/LyricVisualizer";
import { LandingPage, addToRecent } from "./components/LandingPage";
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
  AlertTriangle,
  Save,
  ChevronDown,
} from "lucide-react";
import "./App.css";

function App() {
  const {
    systemStatus, setSystemStatus, tracks: timelineTracks, mediaPool,
    hasOpenProject, setHasOpenProject,
    projectPath, setProjectPath, projectName, setProjectName,
    getProjectJson, workspacePath,
    isDirty, markClean,
    zoom, setZoom,
    selectedClipId, playhead, splitClip, deleteClip,
    resetProject,
  } = useTimelineStore();
  const [leftTab, setLeftTab] = useState<"media" | "models">("media");
  const [rightTab, setRightTab] = useState<"tools" | "generation" | "visualizer" | "lyrics" | "inspector">("tools");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [showEditMenu, setShowEditMenu] = useState(false);
  const [showCloseProjectDialog, setShowCloseProjectDialog] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState(projectName);

  useEffect(() => {
    setEditNameValue(projectName);
  }, [projectName]);

  const handleRenameSubmit = () => {
    setIsEditingName(false);
    const trimmed = editNameValue.trim();
    if (trimmed && trimmed !== projectName) {
      setProjectName(trimmed, false);
    } else {
      setEditNameValue(projectName);
    }
  };

  // Stable refs for close-requested handler and keyboard shortcuts
  const isDirtyRef = useRef(isDirty);
  const hasOpenProjectRef = useRef(hasOpenProject);
  const selectedClipIdRef = useRef(selectedClipId);
  const playheadRef = useRef(playhead);
  useEffect(() => { isDirtyRef.current = isDirty; }, [isDirty]);
  useEffect(() => { hasOpenProjectRef.current = hasOpenProject; }, [hasOpenProject]);
  useEffect(() => { selectedClipIdRef.current = selectedClipId; }, [selectedClipId]);
  useEffect(() => { playheadRef.current = playhead; }, [playhead]);

  // --- Export Modal & Compilation State ---
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportPath, setExportPath] = useState("temp/export.mp4");
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

  // Listen for backend export events — must be before any conditional returns
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
    return () => { if (unlisten) unlisten(); };
  }, []);

  const handleSaveProject = useCallback(async () => {
    try {
      setIsSaving(true);
      let savePath = projectPath;
      if (!savePath) {
        if (workspacePath) {
          savePath = `${workspacePath}/${projectName}.seproject`;
          setProjectPath(savePath);
        } else {
          const chosen = await save({
            defaultPath: `${projectName}.seproject`,
            filters: [{ name: "simple-edit Project", extensions: ["seproject"] }],
            title: "Save Project",
          });
          if (!chosen) return;
          savePath = chosen;
          setProjectPath(savePath);
          const name = savePath.replace(/\\/g, "/").split("/").pop()?.replace(/\.seproject$/, "") ?? projectName;
          setProjectName(name, true);
        }
      }
      const json = getProjectJson();
      await invoke("save_project_file", { path: savePath, json });
      markClean();
      try { addToRecent(savePath, projectName); } catch {}
    } catch (e: any) {
      alert(`Failed to save: ${e}`);
    } finally {
      setIsSaving(false);
    }
  }, [projectPath, projectName, workspacePath, getProjectJson, setProjectPath, setProjectName, markClean]);

  const handleSaveAsProject = useCallback(async () => {
    try {
      setIsSaving(true);
      const chosen = await save({
        defaultPath: workspacePath ? `${workspacePath}/${projectName}.seproject` : `${projectName}.seproject`,
        filters: [{ name: "simple-edit Project", extensions: ["seproject"] }],
        title: "Save Project As",
      });
      if (!chosen) return;
      const savePath = chosen;
      setProjectPath(savePath);
      const name = savePath.replace(/\\/g, "/").split("/").pop()?.replace(/\.seproject$/, "") ?? projectName;
      setProjectName(name, true);
      const json = getProjectJson();
      await invoke("save_project_file", { path: savePath, json });
      markClean();
      try { addToRecent(savePath, name); } catch {}
    } catch (e: any) {
      alert(`Failed to save: ${e}`);
    } finally {
      setIsSaving(false);
    }
  }, [projectName, workspacePath, getProjectJson, setProjectPath, setProjectName, markClean]);

  const handleCloseProject = useCallback(async () => {
    if (isDirty) {
      setShowCloseProjectDialog(true);
    } else {
      resetProject();
      setHasOpenProject(false);
    }
  }, [isDirty, resetProject, setHasOpenProject]);

  // Save-on-exit: intercept window close when there are unsaved changes
  // Stable refs for save handlers (avoid stale closures in event listeners and menu actions)
  const handleSaveRef = useRef(handleSaveProject);
  const handleSaveAsRef = useRef(handleSaveAsProject);
  const handleCloseProjectRef = useRef(handleCloseProject);
  useEffect(() => { handleSaveRef.current = handleSaveProject; }, [handleSaveProject]);
  useEffect(() => { handleSaveAsRef.current = handleSaveAsProject; }, [handleSaveAsProject]);
  useEffect(() => { handleCloseProjectRef.current = handleCloseProject; }, [handleCloseProject]);

  useEffect(() => {
    const win = getCurrentWindow();
    let mounted = true;
    let unlisten: (() => void) | undefined;
    (async () => {
      const fn = await win.onCloseRequested(async (event) => {
        if (hasOpenProjectRef.current) {
          // Never close the window from the editor; go back to the projects page instead
          event.preventDefault();
          handleCloseProjectRef.current();
        } else {
          await win.destroy();
        }
      });
      if (mounted) unlisten = fn; else fn();
    })();
    return () => { mounted = false; if (unlisten) unlisten(); };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "s") {
        e.preventDefault();
        if (hasOpenProjectRef.current) handleSaveRef.current();
      }
      if (e.key === "Escape") setShowEditMenu(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
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
          hasAudio: mediaPool.find((m) => m.filePath === c.filePath)?.hasAudio ?? false,
        })),
        locked: !!t.locked,
        muted: !!t.muted,
        hidden: !!t.hidden,
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
          <Layers className="text-white" size={20} style={{ color: "var(--text-bright)" }} />
          <h1 className="brand-logo">simple-edit</h1>
          <span style={{ fontSize: "10px", color: "var(--text-muted)", marginLeft: "4px" }}>v0.1.0-alpha</span>
          
          {isEditingName ? (
            <input
              type="text"
              value={editNameValue}
              onChange={(e) => setEditNameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenameSubmit();
                if (e.key === "Escape") {
                  setIsEditingName(false);
                  setEditNameValue(projectName);
                }
              }}
              onBlur={handleRenameSubmit}
              autoFocus
              style={{
                fontSize: "10px",
                color: "var(--text-bright)",
                background: "rgba(0,0,0,0.25)",
                border: "1px solid var(--border-normal)",
                borderRadius: "4px",
                padding: "2px 6px",
                marginLeft: "8px",
                width: "140px",
                outline: "none",
                fontFamily: "var(--font-sans)",
              }}
            />
          ) : (
            <span
              onDoubleClick={() => setIsEditingName(true)}
              title="Double click to rename project"
              style={{
                fontSize: "10px",
                color: isDirty ? "var(--text-bright)" : "var(--text-muted)",
                marginLeft: "8px",
                opacity: 0.7,
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              — {projectName}{isDirty ? " •" : ""}
            </span>
          )}

          {/* File Menu */}
          <div style={{ position: "relative", marginLeft: "12px" }} onMouseLeave={() => setShowFileMenu(false)}>
            <button
              className="btn-secondary"
              style={{ padding: "3px 10px", fontSize: "11px", display: "flex", alignItems: "center", gap: "4px" }}
              onClick={() => setShowFileMenu((v) => !v)}
            >
              File <ChevronDown size={10} />
            </button>
            {showFileMenu && (
              <div
                onClick={() => setShowFileMenu(false)}
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  left: 0,
                  background: "rgba(18, 22, 33, 0.97)",
                  border: "1px solid var(--border-normal)",
                  borderRadius: "8px",
                  padding: "4px 0",
                  zIndex: 10001,
                  minWidth: "160px",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
                }}
              >
                {[
                  {
                    label: "New Project",
                    disabled: false,
                    action: () => {
                      if (isDirty) {
                        if (confirm("You have unsaved changes. Would you like to create a new project and discard current changes?")) {
                          resetProject();
                          const name = `Project_${new Date().toISOString().slice(0, 10)}`;
                          setProjectName(name, true);
                          setProjectPath(null);
                        }
                      } else {
                        resetProject();
                        const name = `Project_${new Date().toISOString().slice(0, 10)}`;
                        setProjectName(name, true);
                        setProjectPath(null);
                      }
                    }
                  },
                  {
                    label: "Open Project...",
                    disabled: false,
                    action: async () => {
                      if (isDirty) {
                        if (!confirm("You have unsaved changes. Discard them and open another project?")) {
                          return;
                        }
                      }
                      try {
                        const { open } = await import("@tauri-apps/plugin-dialog");
                        const selected = await open({
                          filters: [{ name: "simple-edit Project", extensions: ["seproject"] }],
                          title: "Open Project",
                        });
                        if (!selected) return;
                        const path = selected as string;
                        const json = await invoke<string>("load_project_file", { path });
                        const { loadProjectData } = useTimelineStore.getState();
                        loadProjectData(json);
                        setProjectPath(path);
                        const name = (path.replace(/\\/g, "/").split("/").pop() ?? path).replace(/\.seproject$/, "");
                        setProjectName(name, true);
                        try { addToRecent(path, name); } catch {}
                      } catch (e: any) {
                        alert(`Failed to open project: ${e}`);
                      }
                    }
                  },
                  null,
                  { label: "Save", kbd: "Ctrl+S", disabled: false, action: () => handleSaveProject() },
                  { label: "Save As...", kbd: "", disabled: false, action: () => handleSaveAsProject() },
                  null,
                  { label: "Close Project", disabled: false, action: () => handleCloseProject() },
                ].map((item, i) =>
                  item === null ? (
                    <div key={i} style={{ height: "1px", background: "var(--border-normal)", margin: "3px 0" }} />
                  ) : (
                    <button
                      key={i}
                      onClick={item.disabled ? undefined : item.action}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        width: "100%",
                        padding: "5px 14px",
                        background: "none",
                        border: "none",
                        color: item.disabled ? "rgba(255,255,255,0.25)" : "var(--text-primary)",
                        fontSize: "11px",
                        cursor: item.disabled ? "default" : "pointer",
                        textAlign: "left",
                      }}
                      onMouseEnter={(e) => { if (!item.disabled) (e.currentTarget.style.background = "rgba(255,255,255,0.06)"); }}
                      onMouseLeave={(e) => { (e.currentTarget.style.background = "none"); }}
                    >
                      <span>{item.label}</span>
                      {item.kbd && <span style={{ fontSize: "9px", opacity: 0.45, fontFamily: "var(--font-mono)" }}>{item.kbd}</span>}
                    </button>
                  )
                )}
              </div>
            )}
          </div>

          {/* Edit Menu */}
          <div style={{ position: "relative", marginLeft: "6px" }} onMouseLeave={() => setShowEditMenu(false)}>
            <button
              className="btn-secondary"
              style={{ padding: "3px 10px", fontSize: "11px", display: "flex", alignItems: "center", gap: "4px" }}
              onClick={() => setShowEditMenu((v) => !v)}
            >
              Edit <ChevronDown size={10} />
            </button>
            {showEditMenu && (
              <div
                onClick={() => setShowEditMenu(false)}
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  left: 0,
                  background: "rgba(18, 22, 33, 0.97)",
                  border: "1px solid var(--border-normal)",
                  borderRadius: "8px",
                  padding: "4px 0",
                  zIndex: 10001,
                  minWidth: "160px",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
                }}
              >
                {[
                  { label: "Undo", kbd: "Ctrl+Z", disabled: true, action: () => {} },
                  { label: "Redo", kbd: "Ctrl+Y", disabled: true, action: () => {} },
                  null,
                  { label: "Split Clip", kbd: "S", disabled: !selectedClipId, action: () => { if (selectedClipIdRef.current) splitClip(selectedClipIdRef.current, playheadRef.current); } },
                  { label: "Delete Clip", kbd: "Del", disabled: !selectedClipId, action: () => { if (selectedClipIdRef.current) deleteClip(selectedClipIdRef.current); } },
                  null,
                  { label: "Zoom In", kbd: "+", disabled: false, action: () => setZoom(zoom * 1.2) },
                  { label: "Zoom Out", kbd: "-", disabled: false, action: () => setZoom(zoom / 1.2) },
                ].map((item, i) =>
                  item === null ? (
                    <div key={i} style={{ height: "1px", background: "var(--border-normal)", margin: "3px 0" }} />
                  ) : (
                    <button
                      key={i}
                      onClick={item.disabled ? undefined : item.action}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        width: "100%",
                        padding: "5px 14px",
                        background: "none",
                        border: "none",
                        color: item.disabled ? "rgba(255,255,255,0.25)" : "var(--text-primary)",
                        fontSize: "11px",
                        cursor: item.disabled ? "default" : "pointer",
                        textAlign: "left",
                      }}
                      onMouseEnter={(e) => { if (!item.disabled) (e.currentTarget.style.background = "rgba(255,255,255,0.06)"); }}
                      onMouseLeave={(e) => { (e.currentTarget.style.background = "none"); }}
                    >
                      <span>{item.label}</span>
                      {item.kbd && <span style={{ fontSize: "9px", opacity: 0.45, fontFamily: "var(--font-mono)" }}>{item.kbd}</span>}
                    </button>
                  )
                )}
              </div>
            )}
          </div>
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
                  <ShieldAlert size={11} style={{ color: "var(--text-bright)" }} />
                  <span>CUDA Active</span>
                </div>
              ) : (
                <div className="badge" title="PyTorch CUDA is not available. GPU acceleration for AI is disabled.">
                  <ShieldAlert size={11} style={{ color: "var(--text-muted)" }} />
                  <span style={{ color: "var(--text-muted)" }}>CUDA Offline</span>
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

          {/* Save Project */}
          <button
            onClick={handleSaveProject}
            disabled={isSaving}
            className="btn-secondary"
            style={{ padding: "4px 10px", fontSize: "11px", display: "flex", alignItems: "center", gap: "4px" }}
            title={projectPath ?? "Save Project As…"}
          >
            {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            {projectPath ? "Save" : "Save As…"}
          </button>


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
                <Layers size={13} style={{ color: "var(--text-bright)" }} />
                Program Monitor
              </span>
            </div>
            <MonitorProgram />
          </div>

          {/* Right Panel: Multiple AI & Inspector Tabs */}
          <div className="panel last">
            <div className="panel-header">
              <div className="tab-container" style={{ margin: 0, width: "100%", display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: "2px" }}>
                <button
                  className={`tab-btn ${rightTab === "tools" ? "active" : ""}`}
                  style={{ fontSize: "9px", padding: "4px 0" }}
                  onClick={() => setRightTab("tools")}
                >
                  AI Tools
                </button>
                <button
                  className={`tab-btn ${rightTab === "generation" ? "active" : ""}`}
                  style={{ fontSize: "9px", padding: "4px 0" }}
                  onClick={() => setRightTab("generation")}
                >
                  Generate
                </button>
                <button
                  className={`tab-btn ${rightTab === "lyrics" ? "active" : ""}`}
                  style={{ fontSize: "9px", padding: "4px 0" }}
                  onClick={() => setRightTab("lyrics")}
                >
                  Lyrics
                </button>
                <button
                  className={`tab-btn ${rightTab === "visualizer" ? "active" : ""}`}
                  style={{ fontSize: "9px", padding: "4px 0" }}
                  onClick={() => setRightTab("visualizer")}
                >
                  Visualizer
                </button>
                <button
                  className={`tab-btn ${rightTab === "inspector" ? "active" : ""}`}
                  style={{ fontSize: "9px", padding: "4px 0" }}
                  onClick={() => setRightTab("inspector")}
                >
                  Inspector
                </button>
              </div>
            </div>

            {rightTab === "tools" && <ToolUpdater />}
            {rightTab === "generation" && <AiGenerator />}
            {rightTab === "lyrics" && <LyricVisualizer />}
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
                <Film style={{ color: "var(--text-bright)" }} size={18} />
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
                    style={{ fontSize: "11px", padding: "6px 16px" }}
                  >
                    Start Compile
                  </button>
                </div>
              </>
            )}

            {/* Exporting Active State */}
            {isExporting && (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", alignItems: "center", padding: "10px 0" }}>
                <Loader2 size={32} className="animate-spin" style={{ color: "var(--text-bright)" }} />
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
                    background: "var(--text-bright)",
                    borderRadius: "4px",
                    transition: "width 0.1s linear",
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
                <CheckCircle2 size={36} style={{ color: "var(--text-bright)" }} />
                <span style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-bright)" }}>Export Completed!</span>
                <span style={{ fontSize: "10px", color: "var(--text-muted)", textAlign: "center" }}>
                  Your finished MP4 video has been successfully encoded and exported to:
                </span>
                <code style={{ 
                  fontSize: "9px", 
                  color: "var(--text-bright)", 
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
                  style={{ fontSize: "11px", padding: "6px 16px", marginTop: "8px" }}
                >
                  Back to Editor
                </button>
              </div>
            )}

            {/* Export Error State */}
            {exportError && (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", alignItems: "center", padding: "10px 0" }}>
                <AlertTriangle size={36} style={{ color: "var(--text-bright)" }} />
                <span style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-bright)" }}>Compilation Failed</span>
                <span style={{ fontSize: "10px", color: "var(--text-muted)", textAlign: "center" }}>
                  An error occurred while compiling your project tracks:
                </span>
                <div style={{
                  maxHeight: "80px",
                  overflowY: "auto",
                  width: "100%",
                  background: "var(--bg-panel-light)",
                  border: "1px solid var(--border-normal)",
                  color: "var(--text-normal)",
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

      {/* Unsaved-changes close project dialog */}
      {showCloseProjectDialog && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(6,8,12,0.8)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10002 }}>
          <div style={{ background: "rgba(18, 22, 33, 0.95)", border: "1px solid var(--border-normal)", borderRadius: "12px", padding: "24px", width: "360px", boxShadow: "0 10px 40px rgba(0,0,0,0.8)", display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <AlertTriangle size={20} style={{ color: "var(--text-bright)", flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: "13px", fontWeight: 700 }}>Unsaved Changes</div>
                <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "3px" }}>
                  "{projectName}" has unsaved changes. Save before returning to the projects page?
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button
                className="btn-secondary"
                style={{ fontSize: "11px", padding: "6px 14px" }}
                onClick={() => setShowCloseProjectDialog(false)}
              >
                Cancel
              </button>
              <button
                className="btn-secondary"
                style={{ fontSize: "11px", padding: "6px 14px" }}
                onClick={() => {
                  setShowCloseProjectDialog(false);
                  resetProject();
                  setHasOpenProject(false);
                }}
              >
                Discard
              </button>
              <button
                className="btn-primary"
                style={{ fontSize: "11px", padding: "6px 16px" }}
                onClick={async () => {
                  setShowCloseProjectDialog(false);
                  await handleSaveProject();
                  resetProject();
                  setHasOpenProject(false);
                }}
              >
                Save &amp; Close
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Landing Page overlay — sits on top of the editor so editor components stay mounted */}
      {!hasOpenProject && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9998 }}>
          <LandingPage onEnterEditor={() => setHasOpenProject(true)} />
        </div>
      )}
    </div>
  );
}

export default App;
