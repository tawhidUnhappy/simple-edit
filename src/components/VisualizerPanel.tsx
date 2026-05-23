import React, { useState, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTimelineStore } from "../store/timelineStore";
import { getAnalyser } from "../lib/audioContext";
import { Music, Zap, Settings, Activity, Loader2 } from "lucide-react";

export const VisualizerPanel: React.FC = () => {
  const { mediaPool, lyricsText } = useTimelineStore();
  const [selectedAudioId, setSelectedAudioId] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisData, setAnalysisData] = useState<any | null>(null);
  const [visualizerStyle, setVisualizerStyle] = useState<"bars" | "ring" | "spectrum" | "syrex">("bars");
  const [glowIntensity, setGlowIntensity] = useState(0);
  const [primaryColor, setPrimaryColor] = useState("#ffffff"); // Monochrome white
  const [secondaryColor, setSecondaryColor] = useState("#555555"); // Monochrome slate grey

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const particlesRef = useRef<{ x: number; y: number; angle: number; speed: number; size: number; alpha: number }[]>([]);

  // LRC Lyrics parsing helper
  const parsedLyrics = useMemo(() => {
    const lines: { time: number; text: string }[] = [];
    for (const raw of (lyricsText || "").split("\n")) {
      const m = raw.match(/^\[(\d{2}):(\d{2})[.:](\d{2,3})\](.*)/);
      if (m) {
        const t = parseInt(m[1]) * 60 + parseInt(m[2]) + parseInt(m[3]) / (m[3].length === 3 ? 1000 : 100);
        lines.push({ time: t, text: m[4].trim() });
      }
    }
    return lines.sort((a, b) => a.time - b.time);
  }, [lyricsText]);
  // Filter audio files
  const audioFiles = mediaPool.filter((m) => m.hasAudio);

  const handleAnalyzeAudio = async () => {
    if (!selectedAudioId) {
      alert("Please select an audio file to analyze.");
      return;
    }
    const media = mediaPool.find((m) => m.id === selectedAudioId);
    if (!media) return;

    setIsAnalyzing(true);
    try {
      // Connect to Python server port
      const port = await invoke<number>("get_python_server_port");
      
      const response = await fetch(`http://127.0.0.1:${port}/audio/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_path: media.filePath }),
      });
      
      if (!response.ok) {
        throw new Error("Analysis failed");
      }
      
      const data = await response.json();
      setAnalysisData(data);
      alert(`Audio analysis complete! BPM: ${data.bpm.toFixed(1)}, Beats: ${data.beats.length}`);
    } catch (e: any) {
      alert(`Analysis failed: ${e.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Canvas drawing loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame = 0;
    const freqBuf = new Uint8Array(128); // matches fftSize=256 → 128 bins

    const draw = () => {
      frame++;
      const w = canvas.width;
      const h = canvas.height;

      // Clear canvas with deep space dark tone
      ctx.fillStyle = "rgba(10, 12, 16, 0.2)"; // trailing motion blur
      ctx.fillRect(0, 0, w, h);

      // Retrieve real-time playhead and playback status from Zustand store
      const state = useTimelineStore.getState();
      const playhead = state.playhead;
      const isPlaying = state.isPlaying;

      // Build frequency array — prefer live analyser, fall back to librosa data, then procedural
      let frequencies: number[] = [];
      const numBars = 48;

      const analyser = getAnalyser();
      if (analyser && isPlaying) {
        analyser.getByteFrequencyData(freqBuf);
        const step = Math.floor(freqBuf.length / numBars);
        for (let i = 0; i < numBars; i++) {
          frequencies.push(freqBuf[i * step] / 255);
        }
      } else if (analysisData) {
        // Map analysis step index to playhead if playing, otherwise advance frame procedurally
        const stepIndex = isPlaying
          ? Math.floor(playhead * 10) % (analysisData.bass.length || 100)
          : frame % (analysisData.bass.length || 100);

        const bassVal = analysisData.bass[stepIndex] || 0.1;
        const midsVal = analysisData.mids[stepIndex] || 0.1;
        const trebleVal = analysisData.treble[stepIndex] || 0.1;

        for (let i = 0; i < numBars; i++) {
          if (i < 12) {
            frequencies.push(bassVal * (1.0 + 0.3 * Math.sin(frame * 0.1 + i)));
          } else if (i < 36) {
            frequencies.push(midsVal * (1.0 + 0.2 * Math.sin(frame * 0.08 + i)));
          } else {
            frequencies.push(trebleVal * (1.0 + 0.4 * Math.sin(frame * 0.15 + i)));
          }
        }
      } else {
        // Idle/standard wave generation
        for (let i = 0; i < numBars; i++) {
          const wave = 0.2 + 0.3 * Math.sin(frame * 0.05 + i * 0.2) + 0.1 * Math.sin(frame * 0.12 - i * 0.4);
          frequencies.push(wave);
        }
      }

      // No neon glows by default
      ctx.shadowBlur = 0;

      if (visualizerStyle === "bars") {
        // 1. Neon Equalizer Bars
        const barWidth = (w - (numBars * 3)) / numBars;
        for (let i = 0; i < numBars; i++) {
          const val = frequencies[i];
          const barHeight = val * (h * 0.7);
          
          // Gradient HSL
          const grad = ctx.createLinearGradient(0, h, 0, h - barHeight);
          grad.addColorStop(0, secondaryColor);
          grad.addColorStop(1, primaryColor);
          
          ctx.fillStyle = grad;
          
          // Render rounded rect bars
          const x = i * (barWidth + 3) + 10;
          const y = h - barHeight - 10;
          ctx.beginPath();
          ctx.roundRect(x, y, barWidth, barHeight, 2);
          ctx.fill();
        }
      } else if (visualizerStyle === "ring") {
        // 2. Circular Glowing Ring
        const cx = w / 2;
        const cy = h / 2;
        const baseRadius = Math.min(w, h) * 0.22;
        
        // Dynamic scale from bass frequency
        const bassVal = frequencies[0] || 0.1;
        const radGlow = baseRadius + (bassVal * 25);

        ctx.shadowColor = primaryColor;
        ctx.strokeStyle = primaryColor;
        ctx.lineWidth = 3;

        ctx.beginPath();
        for (let i = 0; i < numBars; i++) {
          const angle = (i / numBars) * Math.PI * 2;
          const val = frequencies[i];
          const offsetRadius = radGlow + (val * 40);
          
          const x = cx + Math.cos(angle) * offsetRadius;
          const y = cy + Math.sin(angle) * offsetRadius;
          
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.closePath();
        ctx.stroke();

        // Draw inner cyan ring
        ctx.shadowColor = secondaryColor;
        ctx.strokeStyle = secondaryColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, radGlow - 10, 0, Math.PI * 2);
        ctx.stroke();
      } else if (visualizerStyle === "spectrum") {
        // 3. Neon Waveform Spectrum
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.strokeStyle = primaryColor;

        const sliceWidth = w / numBars;
        for (let i = 0; i < numBars; i++) {
          const val = frequencies[i];
          const x = i * sliceWidth;
          const y = (h / 2) + (val * (h * 0.4) * Math.sin(i * 0.4 + frame * 0.1));

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      } else if (visualizerStyle === "syrex") {
        // 4. Premium Syrex-Style Lyric Video Visualizer
        const cx = w / 2;
        const cy = h / 2;
        const bassVal = frequencies[0] || 0.1;

        // Beat-reactive background scale zoom
        const bgScale = 1.0 + bassVal * 0.04;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(bgScale, bgScale);
        ctx.translate(-cx, -cy);

        // Starfield dynamic particles system
        if (particlesRef.current.length === 0) {
          const parts = [];
          for (let i = 0; i < 120; i++) {
            parts.push({
              x: Math.random() - 0.5,
              y: Math.random() - 0.5,
              angle: Math.random() * Math.PI * 2,
              speed: 0.002 + Math.random() * 0.006,
              size: 0.8 + Math.random() * 1.5,
              alpha: 0.1 + Math.random() * 0.7,
            });
          }
          particlesRef.current = parts;
        }

        ctx.fillStyle = primaryColor;
        particlesRef.current.forEach((p) => {
          p.x += Math.cos(p.angle) * p.speed * (1.0 + bassVal * 3);
          p.y += Math.sin(p.angle) * p.speed * (1.0 + bassVal * 3);

          // Reset if particle moves out of range
          if (Math.abs(p.x) > 0.5 || Math.abs(p.y) > 0.5) {
            p.x = (Math.random() - 0.5) * 0.1;
            p.y = (Math.random() - 0.5) * 0.1;
            p.angle = Math.random() * Math.PI * 2;
          }

          const px = cx + p.x * w;
          const py = cy + p.y * h;
          ctx.globalAlpha = p.alpha;
          ctx.beginPath();
          ctx.arc(px, py, p.size, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.globalAlpha = 1.0;

        // Draw radial audio spectrum spokes
        const baseRadius = Math.min(w, h) * 0.22;
        const coreRadius = baseRadius * (1.0 + bassVal * 0.15);

        ctx.strokeStyle = primaryColor;
        ctx.lineWidth = 1.5;
        const totalSpokes = 64;
        for (let i = 0; i < totalSpokes; i++) {
          const angle = (i / totalSpokes) * Math.PI * 2 + frame * 0.002;
          const freqVal = frequencies[i % numBars] || 0.1;
          const spokeLen = freqVal * 30;

          const startX = cx + Math.cos(angle) * coreRadius;
          const startY = cy + Math.sin(angle) * coreRadius;
          const endX = cx + Math.cos(angle) * (coreRadius + spokeLen);
          const endY = cy + Math.sin(angle) * (coreRadius + spokeLen);

          ctx.beginPath();
          ctx.moveTo(startX, startY);
          ctx.lineTo(endX, endY);
          ctx.stroke();
        }

        // Draw outer pulsing circle ring
        ctx.shadowColor = primaryColor;
        ctx.shadowBlur = glowIntensity;
        ctx.strokeStyle = primaryColor;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0; // Reset shadows

        // Draw inner rotating hexagon
        ctx.strokeStyle = secondaryColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const hexAngleOffset = frame * 0.015;
        const hexRadius = coreRadius * 0.7;
        for (let i = 0; i < 6; i++) {
          const angle = (i / 6) * Math.PI * 2 + hexAngleOffset;
          const x = cx + Math.cos(angle) * hexRadius;
          const y = cy + Math.sin(angle) * hexRadius;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();

        ctx.restore(); // Restore background scale translation

        // Render current subtitle line at the bottom center of the visualizer canvas
        const currentPlayhead = playhead;
        let activeLine = "";
        for (const l of parsedLyrics) {
          if (l.time <= currentPlayhead) {
            activeLine = l.text;
          }
        }

        if (activeLine) {
          ctx.save();
          ctx.fillStyle = "#ffffff";
          ctx.font = "bold 11px sans-serif";
          ctx.textAlign = "center";
          ctx.shadowBlur = 4;
          ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
          ctx.fillText(activeLine, cx, h - 14);
          ctx.restore();
        }
      }

      // Reset shadows
      ctx.shadowBlur = 0;

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [analysisData, visualizerStyle, glowIntensity, primaryColor, secondaryColor, parsedLyrics]);

  return (
    <div className="panel-content" style={{ display: "flex", flexDirection: "column", height: "100%", gap: "8px" }}>
      <label className="input-label" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <Activity size={13} style={{ color: "var(--text-bright)" }} />
        Beat-Reactive Visualizer Panel
      </label>

      {/* Render Canvas */}
      <div style={{
        position: "relative",
        height: "160px",
        borderRadius: "8px",
        border: "1px solid var(--border-normal)",
        background: "var(--bg-darker)",
        overflow: "hidden",
        boxShadow: "inset 0 4px 20px rgba(0,0,0,0.6)"
      }}>
        <canvas ref={canvasRef} width={380} height={160} style={{ width: "100%", height: "100%" }} />
        
        {analysisData && (
          <div style={{
            position: "absolute",
            top: "8px",
            right: "8px",
            background: "var(--bg-darker)",
            border: "1px solid var(--border-normal)",
            padding: "2px 6px",
            borderRadius: "4px",
            fontSize: "9px",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            gap: "4px"
          }}>
            <Zap size={8} /> {analysisData.bpm.toFixed(0)} BPM
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px" }}>
        <div className="input-group">
          <label className="input-label">Select Audio Track</label>
          <select
            value={selectedAudioId}
            onChange={(e) => setSelectedAudioId(e.target.value)}
            style={{ fontSize: "11px" }}
          >
            <option value="">-- Choose imported audio --</option>
            {audioFiles.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({Math.round(m.duration)}s)
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          <button
            className="btn-primary"
            onClick={handleAnalyzeAudio}
            disabled={isAnalyzing || !selectedAudioId}
            style={{ flex: 1 }}
          >
            {isAnalyzing ? (
              <>
                <Loader2 size={12} className="animate-spin" /> Analyzing Beats...
              </>
            ) : (
              <>
                <Music size={12} /> Analyze Beat Mapping (Librosa)
              </>
            )}
          </button>
        </div>

        {/* Visualizer Style Settings */}
        <div className="card-list" style={{ marginTop: "4px" }}>
          <span className="input-label" style={{ fontSize: "10px", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "4px" }}>
            <Settings size={10} /> Style Customizer
          </span>

          <div style={{ display: "flex", gap: "6px", margin: "4px 0" }}>
            {["bars", "ring", "spectrum", "syrex"].map((style) => (
              <button
                key={style}
                onClick={() => setVisualizerStyle(style as any)}
                className={`btn-secondary ${visualizerStyle === style ? "active" : ""}`}
                style={{
                  flex: 1,
                  fontSize: "10px",
                  padding: "4px 0",
                  borderColor: visualizerStyle === style ? "var(--border-focus)" : "var(--border-normal)",
                  color: visualizerStyle === style ? "#fff" : "var(--text-muted)",
                }}
              >
                {style.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="item-card-row" style={{ fontSize: "11px", display: "flex", alignItems: "center", justifyContent: "space-between", margin: "4px 0" }}>
            <span>Glow Intensity</span>
            <input
              type="range"
              min="0"
              max="30"
              value={glowIntensity}
              onChange={(e) => setGlowIntensity(parseInt(e.target.value))}
              style={{ width: "100px", accentColor: primaryColor }}
            />
          </div>

          <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px" }}>
              <span style={{ fontSize: "9px", color: "var(--text-muted)" }}>Color A</span>
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                style={{ width: "100%", height: "24px", padding: 0, border: 0, cursor: "pointer", borderRadius: "4px", background: "transparent" }}
              />
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px" }}>
              <span style={{ fontSize: "9px", color: "var(--text-muted)" }}>Color B</span>
              <input
                type="color"
                value={secondaryColor}
                onChange={(e) => setSecondaryColor(e.target.value)}
                style={{ width: "100%", height: "24px", padding: 0, border: 0, cursor: "pointer", borderRadius: "4px", background: "transparent" }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
