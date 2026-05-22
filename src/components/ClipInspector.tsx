import React from "react";
import { useTimelineStore, Clip } from "../store/timelineStore";
import { Sliders, Type, Volume2, Clock, Trash2, Layout } from "lucide-react";

export const ClipInspector: React.FC = () => {
  const { selectedClipId, tracks, updateClipProperties, deleteClip, setSelectedClipId } = useTimelineStore();

  // Find selected clip
  let selectedClip: Clip | null = null;
  for (const track of tracks) {
    const found = track.clips.find((c) => c.id === selectedClipId);
    if (found) {
      selectedClip = found;
      break;
    }
  }

  if (!selectedClip) {
    return (
      <div className="panel-content" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", gap: "8px" }}>
        <Sliders size={24} style={{ opacity: 0.4 }} />
        <span style={{ fontSize: "11px" }}>Select a clip on the timeline to inspect</span>
      </div>
    );
  }

  const clip = selectedClip;

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateClipProperties(clip.id, { text: e.target.value, name: e.target.value });
  };

  const handlePropertyChange = (property: string, value: any) => {
    updateClipProperties(clip.id, { [property]: value });
  };

  const handleDelete = () => {
    deleteClip(clip.id);
    setSelectedClipId(null);
  };

  // Subtitle/Text styling helper defaults stored in clip itself
  const fontSize = clip.text ? (clip as any).fontSize || 16 : 16;
  const fontColor = clip.text ? (clip as any).fontColor || "#ffffff" : "#ffffff";
  const strokeColor = clip.text ? (clip as any).strokeColor || "#000000" : "#000000";
  const strokeWidth = clip.text ? (clip as any).strokeWidth || 2 : 2;
  const alignment = clip.text ? (clip as any).alignment || "center" : "center";

  return (
    <div className="panel-content" style={{ padding: "12px", gap: "14px", overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border-normal)", paddingBottom: "8px" }}>
        <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-light)" }}>
          Clip Inspector
        </span>
        <button 
          onClick={handleDelete}
          className="btn-secondary" 
          style={{ padding: "3px 6px", fontSize: "10px", color: "var(--accent-rose)", borderColor: "rgba(244, 63, 94, 0.2)" }}
        >
          <Trash2 size={10} /> Delete Clip
        </button>
      </div>

      {/* Basic Settings */}
      <div className="card-list" style={{ gap: "10px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <label className="input-label" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <Layout size={10} /> Clip Name
          </label>
          <input
            type="text"
            value={clip.name}
            onChange={(e) => handlePropertyChange("name", e.target.value)}
            style={{ fontSize: "11px", padding: "6px" }}
          />
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
            <label className="input-label" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <Clock size={10} /> Speed
            </label>
            <input
              type="number"
              min="0.1"
              max="5.0"
              step="0.1"
              value={clip.speed}
              onChange={(e) => handlePropertyChange("speed", parseFloat(e.target.value) || 1.0)}
              style={{ fontSize: "11px", padding: "6px" }}
            />
          </div>
          {(clip.type === "video" || clip.type === "audio") && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
              <label className="input-label" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <Volume2 size={10} /> Volume
              </label>
              <input
                type="number"
                min="0.0"
                max="1.0"
                step="0.1"
                value={clip.volume}
                onChange={(e) => handlePropertyChange("volume", parseFloat(e.target.value) || 1.0)}
                style={{ fontSize: "11px", padding: "6px" }}
              />
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
            <label className="input-label">In Point (s)</label>
            <input
              type="number"
              min="0"
              max={clip.duration}
              step="0.1"
              value={clip.startOffset}
              onChange={(e) => handlePropertyChange("startOffset", parseFloat(e.target.value) || 0.0)}
              style={{ fontSize: "11px", padding: "6px" }}
            />
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
            <label className="input-label">Out Point (s)</label>
            <input
              type="number"
              min="0"
              max={clip.duration}
              step="0.1"
              value={clip.endOffset}
              onChange={(e) => handlePropertyChange("endOffset", parseFloat(e.target.value) || clip.duration)}
              style={{ fontSize: "11px", padding: "6px" }}
            />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <label className="input-label">Timeline Track Position (s)</label>
          <input
            type="number"
            min="0"
            step="0.1"
            value={clip.timeStart}
            onChange={(e) => handlePropertyChange("timeStart", parseFloat(e.target.value) || 0.0)}
            style={{ fontSize: "11px", padding: "6px" }}
          />
        </div>
      </div>

      {/* Subtitle / Text Specific Styling */}
      {clip.type === "subtitle" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "4px", borderTop: "1px solid var(--border-normal)", paddingTop: "12px" }}>
          <label className="input-label" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <Type size={11} style={{ color: "var(--accent-teal)" }} /> Text Caption
          </label>
          <textarea
            value={clip.text || ""}
            onChange={handleTextChange}
            rows={3}
            placeholder="Edit subtitle text..."
            style={{ fontSize: "11px", resize: "vertical", width: "100%", padding: "6px", backgroundColor: "#06080e", border: "1px solid var(--border-normal)", borderRadius: "4px", color: "var(--text-light)" }}
          />

          <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "4px" }}>
            <span style={{ fontSize: "10px", fontWeight: "600", color: "var(--text-muted)" }}>SUBTITLE STYLE</span>
            
            {/* Font Size */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "11px" }}>
              <span>Font Size</span>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", width: "70%" }}>
                <input
                  type="range"
                  min="8"
                  max="48"
                  value={fontSize}
                  onChange={(e) => handlePropertyChange("fontSize", parseInt(e.target.value))}
                  style={{ flex: 1, accentColor: "var(--accent-teal)" }}
                />
                <span style={{ width: "24px", textAlign: "right" }}>{fontSize}px</span>
              </div>
            </div>

            {/* Colors */}
            <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>Text Color</span>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <input
                    type="color"
                    value={fontColor}
                    onChange={(e) => handlePropertyChange("fontColor", e.target.value)}
                    style={{ width: "24px", height: "24px", border: "none", background: "none", cursor: "pointer" }}
                  />
                  <span style={{ fontSize: "10px" }}>{fontColor.toUpperCase()}</span>
                </div>
              </div>

              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>Stroke Color</span>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <input
                    type="color"
                    value={strokeColor}
                    onChange={(e) => handlePropertyChange("strokeColor", e.target.value)}
                    style={{ width: "24px", height: "24px", border: "none", background: "none", cursor: "pointer" }}
                  />
                  <span style={{ fontSize: "10px" }}>{strokeColor.toUpperCase()}</span>
                </div>
              </div>
            </div>

            {/* Stroke Width */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "11px", marginTop: "4px" }}>
              <span>Stroke Width</span>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", width: "70%" }}>
                <input
                  type="range"
                  min="0"
                  max="8"
                  value={strokeWidth}
                  onChange={(e) => handlePropertyChange("strokeWidth", parseInt(e.target.value))}
                  style={{ flex: 1, accentColor: "var(--accent-teal)" }}
                />
                <span style={{ width: "24px", textAlign: "right" }}>{strokeWidth}px</span>
              </div>
            </div>

            {/* Alignment */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "11px", marginTop: "4px" }}>
              <span>Align</span>
              <select 
                value={alignment} 
                onChange={(e) => handlePropertyChange("alignment", e.target.value)}
                style={{ fontSize: "10px", padding: "4px", width: "70%" }}
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
