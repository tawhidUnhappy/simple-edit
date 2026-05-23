import React, { useState, useEffect, useMemo, useRef } from "react";
import { useTimelineStore } from "../store/timelineStore";
import { Edit3, Check, Music2 } from "lucide-react";

interface LyricLine {
  time: number;
  text: string;
}

function parseLRC(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split("\n")) {
    const m = raw.match(/^\[(\d{2}):(\d{2})[.:](\d{2,3})\](.*)/);
    if (m) {
      const t = parseInt(m[1]) * 60 + parseInt(m[2]) + parseInt(m[3]) / (m[3].length === 3 ? 1000 : 100);
      const text = m[4].trim();
      if (text) lines.push({ time: t, text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

function formatTime(secs: number) {
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toFixed(2).padStart(5, "0");
  return `${m}:${s}`;
}

export const LyricVisualizer: React.FC = () => {
  const { lyricsText, setLyricsText, playhead } = useTimelineStore();
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState(lyricsText);
  const activeRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const lines = useMemo(() => parseLRC(lyricsText), [lyricsText]);

  // Active line index
  const currentIdx = useMemo(() => {
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time <= playhead) idx = i;
    }
    return idx;
  }, [lines, playhead]);

  // Scroll active line into view only when it's outside the visible container area
  useEffect(() => {
    const el = activeRef.current;
    const container = containerRef.current;
    if (!el || !container) return;
    const elRect = el.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    if (elRect.top < cRect.top || elRect.bottom > cRect.bottom) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [currentIdx]);

  const handleSave = () => {
    setLyricsText(draft);
    setEditMode(false);
  };

  const handleEdit = () => {
    setDraft(lyricsText);
    setEditMode(true);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", borderBottom: "1px solid var(--border-normal)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <Music2 size={12} style={{ color: "var(--text-bright)" }} />
          <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted)" }}>LRC Lyrics</span>
        </div>
        {editMode ? (
          <button
            className="btn-primary"
            style={{ padding: "3px 10px", fontSize: "10px", display: "flex", alignItems: "center", gap: "4px" }}
            onClick={handleSave}
          >
            <Check size={10} /> Save
          </button>
        ) : (
          <button
            className="btn-secondary"
            style={{ padding: "3px 10px", fontSize: "10px", display: "flex", alignItems: "center", gap: "4px" }}
            onClick={handleEdit}
          >
            <Edit3 size={10} /> Edit
          </button>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {editMode ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "10px 12px", gap: "8px" }}>
            <span style={{ fontSize: "9px", color: "var(--text-muted)", opacity: 0.6 }}>
              LRC format: [MM:SS.xx]Line text
            </span>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={"[00:00.00]First line\n[00:05.00]Second line\n[00:10.00]Third line"}
              spellCheck={false}
              style={{
                flex: 1,
                background: "rgba(0,0,0,0.25)",
                border: "1px solid var(--border-normal)",
                borderRadius: "6px",
                color: "var(--text-primary)",
                fontSize: "10px",
                fontFamily: "var(--font-mono)",
                padding: "8px",
                resize: "none",
                outline: "none",
                lineHeight: 1.7,
              }}
            />
          </div>
        ) : (
          <div ref={containerRef} style={{ flex: 1, overflowY: "auto", padding: "8px 12px", display: "flex", flexDirection: "column", gap: "1px" }}>
            {lines.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100px", color: "var(--text-muted)", gap: "8px" }}>
                <Music2 size={22} style={{ opacity: 0.3 }} />
                <span style={{ fontSize: "10px", opacity: 0.4 }}>No lyrics. Click Edit to add LRC.</span>
              </div>
            ) : (
              lines.map((line, i) => {
                const isCurrent = i === currentIdx;
                const distance = Math.abs(i - currentIdx);
                return (
                  <div
                    key={i}
                    ref={isCurrent ? activeRef : null}
                    style={{
                      padding: "5px 8px",
                      borderRadius: "5px",
                      background: isCurrent ? "var(--bg-panel-light)" : "transparent",
                      borderLeft: isCurrent ? "2px solid var(--text-bright)" : "2px solid transparent",
                      transition: "all 0.15s ease",
                      opacity: distance > 4 ? 0.25 : distance > 2 ? 0.55 : 1,
                    }}
                  >
                    <span style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "8px",
                      color: isCurrent ? "var(--text-bright)" : "var(--text-muted)",
                      marginRight: "8px",
                      opacity: 0.6,
                    }}>
                      {formatTime(line.time)}
                    </span>
                    <span style={{
                      fontSize: isCurrent ? "12px" : "10px",
                      fontWeight: isCurrent ? 700 : 400,
                      color: isCurrent ? "#fff" : "var(--text-muted)",
                      transition: "font-size 0.15s ease, color 0.15s ease",
                    }}>
                      {line.text}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
};
