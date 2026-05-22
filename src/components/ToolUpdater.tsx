import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { GitBranch, RefreshCw, Terminal, CheckCircle, AlertTriangle } from "lucide-react";

interface GitUpdateProgress {
  repo_name: string;
  status: string; // "starting", "cloning", "pulling", "completed", "failed"
  log_output: string;
}

interface ToolRepo {
  name: string;
  url: string;
  description: string;
  status: "not_installed" | "updating" | "installed" | "failed";
}

export const ToolUpdater: React.FC = () => {
  const [repos, setRepos] = useState<ToolRepo[]>([
    {
      name: "IndexTTS2",
      url: "https://github.com/RVC-Boss/GPT-SoVITS.git", // using GPT-SoVITS or a customized fork as index voice generator
      description: "State-of-the-art zero-shot Voice Cloner and Narrator",
      status: "not_installed",
    },
    {
      name: "Demucs",
      url: "https://github.com/facebookresearch/demucs.git",
      description: "Audio source separation (vocals, bass, drums stems generator)",
      status: "not_installed",
    },
    {
      name: "stable-diffusion.cpp",
      url: "https://github.com/leejet/stable-diffusion.cpp.git",
      description: "Super light native C++ Stable Diffusion generator",
      status: "not_installed",
    },
    {
      name: "whisper.cpp",
      url: "https://github.com/ggerganov/whisper.cpp.git",
      description: "Fast native C++ speech-to-text (Whisper) transcriber",
      status: "not_installed",
    },
  ]);

  const [activeRepoLog, setActiveRepoLog] = useState("");
  const [activeRepoName, setActiveRepoName] = useState<string | null>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Listen to git update events
    const unlisten = listen<GitUpdateProgress>("git-update", (event) => {
      const payload = event.payload;

      setRepos((prev) =>
        prev.map((repo) => {
          if (repo.name === payload.repo_name) {
            let status = repo.status;
            if (payload.status === "starting" || payload.status === "cloning" || payload.status === "pulling") {
              status = "updating";
            } else if (payload.status === "completed") {
              status = "installed";
            } else if (payload.status === "failed") {
              status = "failed";
            }
            return { ...repo, status };
          }
          return repo;
        })
      );

      if (payload.repo_name === activeRepoName || activeRepoName === null) {
        setActiveRepoName(payload.repo_name);
        setActiveRepoLog((prev) => `${prev}\n[${payload.status.toUpperCase()}] ${payload.log_output}`);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [activeRepoName]);

  useEffect(() => {
    // Auto-scroll terminal log
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [activeRepoLog]);

  const handleUpdate = async (repoName: string, url: string) => {
    setActiveRepoName(repoName);
    setActiveRepoLog(`[STARTING] Triggering isolated clone/pull for ${repoName} inside python/repos/...\nURL: ${url}`);
    
    setRepos((prev) =>
      prev.map((r) => (r.name === repoName ? { ...r, status: "updating" } : r))
    );

    try {
      await invoke("update_tool_repo", {
        repoName,
        gitUrl: url,
      });
    } catch (e: any) {
      setActiveRepoLog((prev) => `${prev}\n[ERROR] Failed to start updater: ${e}`);
      setRepos((prev) =>
        prev.map((r) => (r.name === repoName ? { ...r, status: "failed" } : r))
      );
    }
  };

  return (
    <div className="panel-content">
      <div className="card-list">
        <label className="input-label">AI Repositories & Native Libraries</label>
        {repos.map((repo) => (
          <div className="item-card" key={repo.name}>
            <div className="item-card-row">
              <span className="item-title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <GitBranch size={14} style={{ color: "var(--accent-primary)" }} />
                {repo.name}
              </span>
              
              <span className="item-meta" style={{
                color: repo.status === "installed" ? "var(--accent-teal)" :
                       repo.status === "updating" ? "var(--accent-orange)" :
                       repo.status === "failed" ? "var(--accent-rose)" :
                       "var(--text-muted)"
              }}>
                {repo.status.toUpperCase()}
              </span>
            </div>

            <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: "2px 0 6px 0" }}>
              {repo.description}
            </p>

            <div className="item-card-row">
              <button
                className="btn-secondary"
                style={{ padding: "4px 10px", fontSize: "11px", flex: 1 }}
                onClick={() => handleUpdate(repo.name, repo.url)}
                disabled={repo.status === "updating"}
              >
                {repo.status === "updating" ? (
                  <>
                    <RefreshCw className="animate-spin" size={12} /> Syncing Repo...
                  </>
                ) : (
                  <>
                    <RefreshCw size={12} /> Fetch & Build Update
                  </>
                )}
              </button>
            </div>
          </div>
        ))}
      </div>

      {activeRepoName && (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" }}>
          <label className="input-label" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Terminal size={12} style={{ color: "var(--accent-teal)" }} />
            Console Output Log: {activeRepoName}
          </label>
          <div className="terminal-output">
            {activeRepoLog}
            <div ref={terminalEndRef} />
          </div>
        </div>
      )}
    </div>
  );
};
