import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Layers, FolderOpen, Plus, PlusCircle, Clock, Folder, Loader2, AlertCircle, Film, X, Trash2 } from "lucide-react";
import { useTimelineStore } from "../store/timelineStore";

const RECENT_KEY = "simple-edit:recentProjects";

interface RecentProject {
  path: string;
  name: string;
  savedAt: number; // timestamp ms
}

function loadRecent(): RecentProject[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveRecent(list: RecentProject[]) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 12)));
}

export function addToRecent(path: string, name: string) {
  const list = loadRecent();
  const filtered = list.filter((p) => p.path !== path);
  saveRecent([{ path, name, savedAt: Date.now() }, ...filtered]);
}

function nameFromPath(path: string): string {
  return (path.replace(/\\/g, "/").split("/").pop() ?? path).replace(/\.seproject$/, "");
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

interface LandingPageProps {
  onEnterEditor: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onEnterEditor }) => {
  const { setWorkspacePath, setProjectPath, setProjectName, loadProjectData, resetProject } = useTimelineStore();

  const [localWorkspace, setLocalWorkspace] = useState<string | null>(null);
  const [isCheckingWorkspace, setIsCheckingWorkspace] = useState(true);
  const [showWorkspacePicker, setShowWorkspacePicker] = useState(false);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<RecentProject | null>(null);
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      try {
        const wp = await invoke<string | null>("get_workspace_dir");
        if (wp) {
          setLocalWorkspace(wp);
          setWorkspacePath(wp);
        } else {
          setShowWorkspacePicker(true);
        }
      } catch {
        setShowWorkspacePicker(true);
      }
      setRecentProjects(loadRecent());
      setIsCheckingWorkspace(false);
    };
    init();
  }, []);

  const handleChooseWorkspace = async () => {
    try {
      const selected = await open({ directory: true, title: "Choose Workspace Folder" });
      if (!selected) return;
      const path = selected as string;
      await invoke("set_workspace_dir", { path });
      setLocalWorkspace(path);
      setWorkspacePath(path);
      setShowWorkspacePicker(false);
    } catch (e: any) {
      setErrorMsg(e.toString());
    }
  };

  const handleNewProject = () => {
    resetProject();
    const name = `Project_${new Date().toISOString().slice(0, 10)}`;
    setProjectName(name, true);
    setProjectPath(null);
    onEnterEditor();
  };

  const handleOpenProject = async () => {
    try {
      const selected = await open({
        filters: [{ name: "simple-edit Project", extensions: ["seproject"] }],
        title: "Open Project",
      });
      if (!selected) return;
      const path = selected as string;
      setIsLoading(true);
      const json = await invoke<string>("load_project_file", { path });
      loadProjectData(json);
      setProjectPath(path);
      const name = nameFromPath(path);
      setProjectName(name, true);
      addToRecent(path, name);
      setRecentProjects(loadRecent());
      onEnterEditor();
    } catch (e: any) {
      setErrorMsg(e.toString());
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenRecent = async (proj: RecentProject) => {
    try {
      setIsLoading(true);
      const json = await invoke<string>("load_project_file", { path: proj.path });
      loadProjectData(json);
      setProjectPath(proj.path);
      setProjectName(proj.name, true);
      addToRecent(proj.path, proj.name);
      setRecentProjects(loadRecent());
      onEnterEditor();
    } catch (e: any) {
      setErrorMsg(`Cannot open "${proj.name}": ${e.toString()}`);
    } finally {
      setIsLoading(false);
    }
  };

  const removeFromRecent = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = loadRecent().filter((p) => p.path !== path);
    saveRecent(updated);
    setRecentProjects(updated);
  };

  const handleDeleteProject = async () => {
    if (!projectToDelete) return;
    setIsLoading(true);
    try {
      await invoke("delete_project_file", { path: projectToDelete.path });
    } catch (e: any) {
      console.warn("Delete command error (possibly file already missing):", e);
    }
    // Always clean up from recent list
    const updated = loadRecent().filter((p) => p.path !== projectToDelete.path);
    saveRecent(updated);
    setRecentProjects(updated);
    setProjectToDelete(null);
    setIsLoading(false);
  };


  if (isCheckingWorkspace) {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-darker)" }}>
        <Loader2 size={28} className="animate-spin" style={{ color: "var(--text-muted)" }} />
      </div>
    );
  }

  return (
    <div style={{ height: "100vh", width: "100vw", background: "var(--bg-darker)", display: "flex", overflow: "hidden" }}>
      {/* Left sidebar */}
      <div style={{
        width: "280px",
        flexShrink: 0,
        background: "var(--bg-main)",
        borderRight: "1px solid var(--border-dim)",
        display: "flex",
        flexDirection: "column",
        padding: "32px 24px",
        gap: "0",
      }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "40px" }}>
          <Layers size={28} style={{ color: "var(--text-bright)" }} />
          <div>
            <div style={{ fontSize: "18px", fontWeight: "700", color: "var(--text-bright)" }}>simple-edit</div>
            <div style={{ fontSize: "9px", color: "var(--text-muted)", letterSpacing: "1.5px", textTransform: "uppercase" }}>v0.1.0-alpha</div>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "32px" }}>
          <button
            onClick={handleNewProject}
            disabled={isLoading}
            style={{
              display: "flex", alignItems: "center", gap: "10px",
              padding: "12px 16px",
              background: "var(--bg-panel)",
              border: "1px solid var(--border-normal)", borderRadius: "10px",
              color: "var(--text-normal)", fontSize: "13px", fontWeight: "600",
              cursor: "pointer", textAlign: "left",
              transition: "border-color 0.15s, background 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--text-muted)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-normal)"; }}
          >
            <div style={{ width: "30px", height: "30px", borderRadius: "8px", background: "var(--bg-darker)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Plus size={16} />
            </div>
            <div>
              <div>New Project</div>
              <div style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: "400" }}>Start from scratch</div>
            </div>
          </button>

          <button
            onClick={handleOpenProject}
            disabled={isLoading}
            style={{
              display: "flex", alignItems: "center", gap: "10px",
              padding: "12px 16px",
              background: "var(--bg-panel)",
              border: "1px solid var(--border-normal)", borderRadius: "10px",
              color: "var(--text-normal)", fontSize: "13px", fontWeight: "600",
              cursor: "pointer", textAlign: "left",
              transition: "border-color 0.15s, background 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--text-muted)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-normal)"; }}
          >
            <div style={{ width: "30px", height: "30px", borderRadius: "8px", background: "var(--bg-darker)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <FolderOpen size={16} style={{ color: "var(--text-normal)" }} />
            </div>
            <div>
              <div>Open Project</div>
              <div style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: "400" }}>.seproject file</div>
            </div>
          </button>
        </div>

        {/* Workspace info */}
        <div style={{ marginTop: "auto" }}>
          <div style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" }}>Workspace</div>
          <div
            onClick={() => setShowWorkspacePicker(true)}
            style={{
              display: "flex", alignItems: "center", gap: "8px",
              padding: "8px 10px",
              background: "var(--bg-panel)", border: "1px solid var(--border-dim)", borderRadius: "8px",
              cursor: "pointer", transition: "border-color 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--border-normal)")}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border-dim)")}
          >
            <Folder size={12} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
            <span style={{ fontSize: "10px", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {localWorkspace ?? "Not set — click to choose"}
            </span>
          </div>
        </div>
      </div>

      {/* Main content area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "32px 36px", overflow: "hidden" }}>
        {/* Header row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "28px" }}>
          <div>
            <div style={{ fontSize: "22px", fontWeight: "700", color: "var(--text-bright)" }}>Recent Projects</div>
            <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
              {recentProjects.length === 0 ? "No projects yet — create or open one" : `${recentProjects.length} project${recentProjects.length !== 1 ? "s" : ""}`}
            </div>
          </div>
          {isLoading && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--text-muted)", fontSize: "12px" }}>
              <Loader2 size={14} className="animate-spin" />
              Loading…
            </div>
          )}
        </div>

        {/* Error message */}
        {errorMsg && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", color: "var(--text-muted)", fontSize: "11px", marginBottom: "16px", background: "var(--bg-panel)", border: "1px solid var(--border-dim)", padding: "10px 14px", borderRadius: "8px" }}>
            <AlertCircle size={13} style={{ marginTop: "1px", flexShrink: 0 }} />
            <span style={{ flex: 1, wordBreak: "break-word" }}>{errorMsg}</span>
            <button onClick={() => setErrorMsg(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", flexShrink: 0, padding: 0 }}>
              <X size={13} />
            </button>
          </div>
        )}

        {/* Recent projects grid */}
        {recentProjects.length === 0 ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "16px", opacity: 0.5 }}>
            <div style={{ width: "72px", height: "72px", borderRadius: "16px", background: "var(--bg-panel)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Film size={32} style={{ color: "var(--text-muted)" }} />
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "14px", fontWeight: "600", color: "var(--text-normal)", marginBottom: "4px" }}>No recent projects</div>
              <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>Create a new project to get started</div>
            </div>
          </div>
        ) : (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: "14px",
            overflowY: "auto",
            paddingRight: "4px",
          }}>
            {recentProjects.map((proj) => (
              <div
                key={proj.path}
                onClick={() => handleOpenRecent(proj)}
                style={{
                  background: "var(--bg-panel)",
                  border: "1px solid var(--border-dim)",
                  borderRadius: "12px",
                  overflow: "hidden",
                  cursor: "pointer",
                  transition: "border-color 0.15s, transform 0.15s",
                  position: "relative",
                }}
                onMouseEnter={(e) => {
                  setHoveredCard(proj.path);
                  e.currentTarget.style.borderColor = "var(--border-normal)";
                  e.currentTarget.style.transform = "translateY(-2px)";
                }}
                onMouseLeave={(e) => {
                  setHoveredCard(null);
                  e.currentTarget.style.borderColor = "var(--border-dim)";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                {/* Thumbnail area */}
                <div style={{
                  height: "110px",
                  background: "var(--bg-darker)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderBottom: "1px solid var(--border-dim)",
                  position: "relative",
                }}>
                  <Film size={28} style={{ color: "var(--text-muted)", opacity: 0.4 }} />
                  
                  {/* Action buttons (only show when hovered) */}
                  <div style={{
                    position: "absolute",
                    top: "8px",
                    right: "8px",
                    display: "flex",
                    gap: "6px",
                    opacity: hoveredCard === proj.path ? 1 : 0,
                    pointerEvents: hoveredCard === proj.path ? "auto" : "none",
                    transition: "opacity 0.15s ease",
                  }}>
                    {/* Remove from recent list */}
                    <button
                      onClick={(e) => removeFromRecent(proj.path, e)}
                      style={{
                        background: "rgba(10, 12, 16, 0.85)",
                        border: "1px solid var(--border-dim)",
                        borderRadius: "50%",
                        width: "24px",
                        height: "24px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        color: "var(--text-muted)",
                        transition: "color 0.15s, background 0.15s",
                      }}
                      onMouseEnter={(e) => {
                        e.stopPropagation();
                        e.currentTarget.style.color = "var(--text-bright)";
                        e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
                      }}
                      onMouseLeave={(e) => {
                        e.stopPropagation();
                        e.currentTarget.style.color = "var(--text-muted)";
                        e.currentTarget.style.background = "rgba(10, 12, 16, 0.85)";
                      }}
                      title="Remove from list"
                    >
                      <X size={12} />
                    </button>

                    {/* Permanently Delete Project File */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setProjectToDelete(proj);
                      }}
                      style={{
                        background: "rgba(10, 12, 16, 0.85)",
                        border: "1px solid var(--border-dim)",
                        borderRadius: "50%",
                        width: "24px",
                        height: "24px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        color: "#ef4444",
                        transition: "color 0.15s, background 0.15s",
                      }}
                      onMouseEnter={(e) => {
                        e.stopPropagation();
                        e.currentTarget.style.color = "#f87171";
                        e.currentTarget.style.background = "rgba(239, 68, 68, 0.15)";
                      }}
                      onMouseLeave={(e) => {
                        e.stopPropagation();
                        e.currentTarget.style.color = "#ef4444";
                        e.currentTarget.style.background = "rgba(10, 12, 16, 0.85)";
                      }}
                      title="Permanently delete project file from disk"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                {/* Project info */}
                <div style={{ padding: "10px 12px" }}>
                  <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-bright)", marginBottom: "4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {proj.name}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "4px", marginBottom: "4px" }}>
                    <Clock size={10} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                    <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>{timeAgo(proj.savedAt)}</span>
                  </div>
                  <div style={{ fontSize: "9px", color: "var(--text-muted)", opacity: 0.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={proj.path}>
                    {proj.path}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Workspace picker modal */}
      {showWorkspacePicker && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000 }}>
          <div style={{ background: "var(--bg-panel)", border: "1px solid var(--border-normal)", borderRadius: "14px", padding: "32px", width: "420px", display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <PlusCircle size={16} style={{ color: "var(--text-bright)" }} />
              <span style={{ fontSize: "16px", fontWeight: "700", color: "var(--text-bright)" }}>Choose Workspace</span>
            </div>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", lineHeight: "1.7" }}>
              Select a folder where simple-edit will store your projects, proxy files, exports, and AI model outputs. You can change this later.
            </p>
            {localWorkspace && (
              <div style={{ fontSize: "11px", color: "var(--text-muted)", background: "var(--bg-darker)", border: "1px solid var(--border-dim)", borderRadius: "6px", padding: "8px 10px", wordBreak: "break-all" }}>
                {localWorkspace}
              </div>
            )}
            {errorMsg && (
              <div style={{ fontSize: "11px", color: "var(--text-normal)" }}>{errorMsg}</div>
            )}
            <div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
              <button
                className="btn-secondary"
                style={{ flex: 1, fontSize: "12px", padding: "8px 0" }}
                onClick={() => setShowWorkspacePicker(false)}
              >
                {localWorkspace ? "Keep Current" : "Skip for Now"}
              </button>
              <button
                className="btn-primary"
                style={{ flex: 1, fontSize: "12px", padding: "8px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
                onClick={handleChooseWorkspace}
              >
                <FolderOpen size={13} />
                Browse Folder
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permanent delete project confirmation modal */}
      {projectToDelete && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(6, 8, 12, 0.8)",
          backdropFilter: "blur(6px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 10001,
        }}>
          <div style={{
            background: "rgba(18, 22, 33, 0.95)",
            border: "1px solid var(--border-normal)",
            boxShadow: "0 10px 40px rgba(0, 0, 0, 0.8)",
            borderRadius: "14px",
            padding: "24px",
            width: "380px",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "#ef4444" }}>
              <Trash2 size={20} />
              <span style={{ fontSize: "15px", fontWeight: "700" }}>Delete Project Permanently?</span>
            </div>
            <div style={{ fontSize: "11px", color: "var(--text-muted)", lineHeight: "1.6" }}>
              Are you sure you want to permanently delete <strong style={{ color: "var(--text-bright)" }}>"{projectToDelete.name}"</strong>?
              <div style={{ marginTop: "6px", color: "#f87171" }}>
                This will delete the file on disk:
              </div>
              <code style={{
                display: "block",
                fontSize: "9px",
                fontFamily: "var(--font-mono)",
                background: "rgba(0,0,0,0.3)",
                padding: "6px 10px",
                borderRadius: "4px",
                marginTop: "4px",
                wordBreak: "break-all",
                color: "var(--text-normal)",
              }}>
                {projectToDelete.path}
              </code>
              <div style={{ marginTop: "8px", fontWeight: "600", color: "#f87171" }}>
                This action is irreversible!
              </div>
            </div>
            <div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
              <button
                className="btn-secondary"
                style={{ flex: 1, fontSize: "11px", padding: "8px 0" }}
                onClick={() => setProjectToDelete(null)}
                disabled={isLoading}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                style={{
                  flex: 1,
                  fontSize: "11px",
                  padding: "8px 0",
                  background: "#ef4444",
                  borderColor: "#ef4444",
                  color: "#fff",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#f87171";
                  e.currentTarget.style.borderColor = "#f87171";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#ef4444";
                  e.currentTarget.style.borderColor = "#ef4444";
                }}
                onClick={handleDeleteProject}
                disabled={isLoading}
              >
                {isLoading ? "Deleting..." : "Permanently Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Close button at the top right of the landing page */}
      <button
        onClick={() => getCurrentWindow().close()}
        style={{
          position: "absolute",
          top: "24px",
          right: "24px",
          background: "rgba(255,255,255,0.03)",
          border: "1px solid var(--border-dim)",
          borderRadius: "8px",
          width: "32px",
          height: "32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          color: "var(--text-muted)",
          transition: "background 0.15s, color 0.15s, border-color 0.15s",
          zIndex: 9999,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(239, 68, 68, 0.15)";
          e.currentTarget.style.color = "#f87171";
          e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.3)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,0.03)";
          e.currentTarget.style.color = "var(--text-muted)";
          e.currentTarget.style.borderColor = "var(--border-dim)";
        }}
        title="Exit Application"
      >
        <X size={16} />
      </button>
    </div>
  );
};
