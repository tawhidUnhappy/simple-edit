import React, { useRef, useEffect } from "react";
import { getAnalyser } from "../lib/audioContext";
import { playheadBus } from "../lib/playheadBus";

interface LyricLine { time: number; text: string; }

function parseLRC(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split("\n")) {
    const m = raw.match(/^\[(\d{2}):(\d{2})[.:](\d{2,3})\](.*)/);
    if (m) {
      const t = parseInt(m[1]) * 60 + parseInt(m[2]) + parseInt(m[3]) / (m[3].length === 3 ? 1000 : 100);
      lines.push({ time: t, text: m[4].trim() });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  size: number; alpha: number; rotation: number;
}

interface Props {
  backgroundSrc: string | null;
  artistName: string;
  songTitle: string;
  lyricsText: string;
}

export const SyrexCanvas: React.FC<Props> = ({ backgroundSrc, artistName, songTitle, lyricsText }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const bgRef = useRef<HTMLImageElement | null>(null);
  const playheadRef = useRef(0);
  const parsedLyricsRef = useRef<LyricLine[]>([]);
  const lastLyricRef = useRef("");
  const lyricFadeStartRef = useRef(0);
  const particlesRef = useRef<Particle[]>([]);
  const freqBuf = useRef(new Uint8Array(128));

  // Keep playhead in sync at 60fps via bus
  useEffect(() => playheadBus.on((t) => { playheadRef.current = t; }), []);

  // Parse lyrics
  useEffect(() => { parsedLyricsRef.current = parseLRC(lyricsText); }, [lyricsText]);

  // Load background image
  useEffect(() => {
    if (!backgroundSrc) { bgRef.current = null; return; }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { bgRef.current = img; };
    img.onerror = () => { bgRef.current = null; };
    img.src = backgroundSrc;
  }, [backgroundSrc]);

  // Init particles once
  useEffect(() => {
    const arr: Particle[] = [];
    for (let i = 0; i < 70; i++) {
      arr.push({
        x: Math.random(), y: Math.random(),
        vx: (Math.random() - 0.5) * 0.0008,
        vy: -(0.0008 + Math.random() * 0.0025),
        size: 1.2 + Math.random() * 2.8,
        alpha: 0.15 + Math.random() * 0.75,
        rotation: Math.random() * Math.PI * 2,
      });
    }
    particlesRef.current = arr;
  }, []);

  // Main draw loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;

    // Pre-define glitch panel positions (right side, cascading inward)
    const panels = [
      { x: W * 0.80, y: H * 0.14, w: W * 0.24, h: 22, label: "G.........." },
      { x: W * 0.83, y: H * 0.24, w: W * 0.21, h: 22, label: "G........" },
      { x: W * 0.86, y: H * 0.34, w: W * 0.18, h: 22, label: "Error" },
      { x: W * 0.88, y: H * 0.44, w: W * 0.16, h: 20, label: "Fail" },
      { x: W * 0.90, y: H * 0.53, w: W * 0.14, h: 18, label: "..." },
    ];

    const drawDiamond = (x: number, y: number, s: number) => {
      ctx.beginPath();
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s * 0.5, y);
      ctx.lineTo(x, y + s);
      ctx.lineTo(x - s * 0.5, y);
      ctx.closePath();
      ctx.fill();
    };

    let frame = 0;

    const tick = () => {
      frame++;
      const now = performance.now();

      // Frequency data
      const analyser = getAnalyser();
      const buf = freqBuf.current;
      if (analyser) {
        analyser.getByteFrequencyData(buf);
      } else {
        // idle procedural waves
        for (let i = 0; i < buf.length; i++) {
          buf[i] = Math.floor(60 + 50 * Math.sin(frame * 0.04 + i * 0.25) + 30 * Math.sin(frame * 0.09 - i * 0.15));
        }
      }

      const bass = buf[2] / 255;
      const mid = buf[14] / 255;

      // Current lyric lookup (10fps store is fine — lyrics change at second boundaries)
      const playhead = playheadRef.current;
      let lyric = "";
      for (const l of parsedLyricsRef.current) {
        if (l.time <= playhead) lyric = l.text; else break;
      }
      if (lyric !== lastLyricRef.current) {
        lastLyricRef.current = lyric;
        lyricFadeStartRef.current = now;
      }
      const lyricAlpha = Math.min((now - lyricFadeStartRef.current) / 180, 1);

      // ── CLEAR ────────────────────────────────────────────────────────────
      ctx.clearRect(0, 0, W, H);

      // ── BACKGROUND ───────────────────────────────────────────────────────
      const bg = bgRef.current;
      if (bg) {
        const scale = Math.max(W / bg.naturalWidth, H / bg.naturalHeight);
        const bw = bg.naturalWidth * scale;
        const bh = bg.naturalHeight * scale;
        const bx = (W - bw) / 2;
        const by = (H - bh) / 2;

        // Base layer
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        ctx.drawImage(bg, bx, by, bw, bh);

        // Chromatic aberration: screen-blend offset copies at very low alpha
        ctx.globalCompositeOperation = "screen";
        ctx.globalAlpha = 0.09;
        ctx.drawImage(bg, bx - 4, by, bw, bh); // left shift → red fringe on right edges
        ctx.drawImage(bg, bx + 4, by, bw, bh); // right shift → blue fringe on left edges
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      } else {
        // Fallback dark background
        ctx.fillStyle = "#080810";
        ctx.fillRect(0, 0, W, H);
      }

      // ── VIGNETTE ─────────────────────────────────────────────────────────
      const vig = ctx.createRadialGradient(W / 2, H * 0.45, H * 0.15, W / 2, H * 0.45, H * 0.85);
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(1, "rgba(0,0,0,0.72)");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, W, H);

      // ── GLITCH PANELS ────────────────────────────────────────────────────
      const pAlpha = 0.18 + bass * 0.55;
      for (const p of panels) {
        ctx.globalAlpha = pAlpha;
        // Panel body
        ctx.fillStyle = "rgba(15,8,4,0.82)";
        ctx.fillRect(p.x, p.y, p.w, p.h);
        // Title bar
        ctx.fillStyle = `rgba(180,120,60,${0.25 + bass * 0.45})`;
        ctx.fillRect(p.x, p.y, p.w, 10);
        // Border
        ctx.strokeStyle = `rgba(220,160,80,${0.35 + bass * 0.5})`;
        ctx.lineWidth = 0.8;
        ctx.strokeRect(p.x, p.y, p.w, p.h);
        // Label text
        ctx.globalAlpha = pAlpha * 0.9;
        ctx.fillStyle = "#ccbbaa";
        ctx.font = "7px 'JetBrains Mono', monospace";
        ctx.textAlign = "left";
        ctx.fillText(p.label, p.x + 3, p.y + 8);
        // Inner content lines
        ctx.fillStyle = `rgba(180,130,80,${0.15 + bass * 0.2})`;
        ctx.fillRect(p.x + 2, p.y + 14, p.w * 0.7, 1);
        ctx.fillRect(p.x + 2, p.y + 17, p.w * 0.4, 1);
      }
      ctx.globalAlpha = 1;

      // ── PARTICLES (sparkle diamonds) ─────────────────────────────────────
      for (const p of particlesRef.current) {
        p.y += p.vy * (1 + bass * 2.5);
        p.x += p.vx;
        p.rotation += 0.025;
        if (p.y < -0.04) { p.y = 1.04; p.x = Math.random(); }
        if (p.x < -0.05 || p.x > 1.05) p.x = Math.random();

        ctx.globalAlpha = p.alpha * (0.4 + mid * 0.6);
        ctx.fillStyle = "#ffffff";
        ctx.save();
        ctx.translate(p.x * W, p.y * H);
        ctx.rotate(p.rotation);
        drawDiamond(0, 0, p.size);
        ctx.restore();
      }
      ctx.globalAlpha = 1;

      // ── CITYSCAPE EQUALIZER ──────────────────────────────────────────────
      const numB = 40;
      const bw = W / numB;
      const binsPerB = Math.floor(buf.length / numB);
      const maxSkyH = H * 0.35;

      // Building silhouettes
      ctx.fillStyle = "rgba(0,0,0,0.94)";
      for (let i = 0; i < numB; i++) {
        let sum = 0;
        for (let b = 0; b < binsPerB; b++) sum += buf[i * binsPerB + b];
        const freq = sum / binsPerB / 255;

        // Stagger minimum heights so it looks like a real skyline
        const minBase = 0.06 + (Math.sin(i * 1.3) * 0.5 + 0.5) * 0.08;
        const bh = H * (minBase + freq * (maxSkyH / H - minBase));
        const bx = i * bw;
        const by = H - bh;

        ctx.fillRect(bx + 0.5, by, bw - 1, bh);

        // Rooftop ledge on taller buildings
        if (bh > H * 0.1 && i % 3 !== 1) {
          ctx.fillRect(bx + bw * 0.15, by - 4, bw * 0.7, 4);
        }
        // Antenna on every 5th building
        if (i % 5 === 0 && bh > H * 0.12) {
          ctx.fillRect(bx + bw * 0.45, by - 12, bw * 0.1, 12);
        }
      }

      // ── ARTIST / TITLE CARD ──────────────────────────────────────────────
      const titleBaseY = H - 10;
      ctx.textAlign = "center";

      ctx.font = `500 ${Math.round(H * 0.028)}px 'Inter', sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.65)";
      ctx.fillText((artistName || "ARTIST NAME").toUpperCase(), W / 2, titleBaseY - Math.round(H * 0.045));

      const titleSize = Math.round(H * 0.042);
      ctx.font = `700 ${titleSize}px 'Inter', sans-serif`;
      ctx.lineWidth = Math.max(3, titleSize * 0.2);
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.strokeText((songTitle || "SONG TITLE").toUpperCase(), W / 2, titleBaseY);
      ctx.fillStyle = "#ffffff";
      ctx.fillText((songTitle || "SONG TITLE").toUpperCase(), W / 2, titleBaseY);

      // ── LYRICS ───────────────────────────────────────────────────────────
      if (lyric) {
        const lyricY = Math.round(H * 0.09);
        const lyricSize = Math.round(H * 0.062);
        ctx.globalAlpha = lyricAlpha;
        ctx.font = `700 ${lyricSize}px 'Inter', sans-serif`;
        ctx.textAlign = "center";
        ctx.lineWidth = Math.max(4, lyricSize * 0.2);
        ctx.strokeStyle = "rgba(0,0,0,0.92)";
        ctx.strokeText(lyric, W / 2, lyricY);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(lyric, W / 2, lyricY);
        ctx.globalAlpha = 1;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []); // empty — reads from refs only

  return (
    <canvas
      ref={canvasRef}
      width={640}
      height={360}
      style={{ width: "100%", height: "auto", display: "block", borderRadius: "6px", background: "#000" }}
    />
  );
};
