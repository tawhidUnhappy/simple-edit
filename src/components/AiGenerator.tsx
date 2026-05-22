import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTimelineStore } from "../store/timelineStore";
import { 
  Sparkles, 
  Languages, 
  Loader2, 
  Image, 
  FileText, 
  Plus, 
  Check, 
  Mic, 
  Volume2, 
  Video, 
  Scissors, 
  Music,
  Download,
  AlertCircle
} from "lucide-react";

export const AiGenerator: React.FC = () => {
  const { mediaPool, addMediaFile, tracks, addClip, addTrack } = useTimelineStore();
  const [activeTab, setActiveTab] = useState<"whisper" | "sd" | "voice" | "video">("whisper");

  // --- Whisper Transcription State ---
  const [selectedVideoId, setSelectedVideoId] = useState("");
  const [selectedWhisperModel, setSelectedWhisperModel] = useState("");
  const [whisperModels, setWhisperModels] = useState<any[]>([]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeResult, setTranscribeResult] = useState<string | null>(null);

  // --- Stable Diffusion State ---
  const [selectedSdModel, setSelectedSdModel] = useState("");
  const [sdModels, setSdModels] = useState<any[]>([]);
  const [prompt, setPrompt] = useState("");
  const [negPrompt, setNegPrompt] = useState("blurry, bad quality, low resolution");
  const [steps, setSteps] = useState(20);
  const [cfgScale, setCfgScale] = useState(7.5);
  const [seed, setSeed] = useState(-1);
  const [resolution, setResolution] = useState("512x512");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImagePath, setGeneratedImagePath] = useState<string | null>(null);
  const [isAddingImage, setIsAddingImage] = useState(false);

  // --- Voice Lab State ---
  const [selectedAudioSplitId, setSelectedAudioSplitId] = useState("");
  const [isSplitting, setIsSplitting] = useState(false);
  const [splitResult, setSplitResult] = useState<any | null>(null);
  const [isAddingStem, setIsAddingStem] = useState<string | null>(null);

  const [ttsText, setTtsText] = useState("");
  const [ttsRefAudioId, setTtsRefAudioId] = useState("");
  const [ttsDuration, setTtsDuration] = useState("");
  const [ttsSpeed, setTtsSpeed] = useState(1.0);
  const [ttsEmotion, setTtsEmotion] = useState("neutral");
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [generatedAudioPath, setGeneratedAudioPath] = useState<string | null>(null);
  const [isAddingTts, setIsAddingTts] = useState(false);

  // --- AI Video State ---
  const [selectedBaseImageId, setSelectedBaseImageId] = useState("");
  const [videoPrompt, setVideoPrompt] = useState("");
  const [videoDuration, setVideoDuration] = useState(2.0);
  const [videoFps, setVideoFps] = useState(16);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [generatedVideoPath, setGeneratedVideoPath] = useState<string | null>(null);
  const [isAddingVideo, setIsAddingVideo] = useState(false);

  // Fetch local models to populate selections
  const loadModels = async () => {
    try {
      const models = await invoke<any[]>("list_local_models");
      const wModels = models.filter((m) => m.model_type === "whisper");
      const sModels = models.filter((m) => m.model_type === "stable-diffusion");
      setWhisperModels(wModels);
      setSdModels(sModels);

      if (wModels.length > 0 && !selectedWhisperModel) {
        setSelectedWhisperModel(wModels[0].name);
      }
      if (sModels.length > 0 && !selectedSdModel) {
        setSelectedSdModel(sModels[0].name);
      }
    } catch (e) {
      console.error("Failed to load local models:", e);
    }
  };

  useEffect(() => {
    loadModels();
  }, []);

  // Filter lists from Media Pool
  const videoFiles = mediaPool.filter((m) => m.width || m.height);
  const audioFiles = mediaPool.filter((m) => m.hasAudio);
  const imageFiles = mediaPool.filter((m) => m.width && m.height && !m.hasAudio && !m.duration);

  // Shared file import helper
  const handleImportToPool = async (filePath: string, type: "image" | "audio" | "video") => {
    try {
      const media = await invoke<any>("import_media_file", { filePath });
      addMediaFile({
        id: media.id,
        name: media.name,
        filePath: media.filePath,
        duration: media.duration,
        width: media.width,
        height: media.height,
        hasAudio: media.hasAudio,
        sizeBytes: media.sizeBytes,
        thumbnailPath: media.thumbnailPath || (type === "image" ? media.filePath : undefined),
        waveformPath: media.waveformPath,
        proxyPath: media.proxyPath,
      });
      return media;
    } catch (e: any) {
      throw new Error(`Failed to import file: ${e.message || e}`);
    }
  };

  // --- Whisper transcription handler ---
  const handleTranscribe = async () => {
    if (!selectedVideoId || !selectedWhisperModel) {
      alert("Please select a video file and Whisper model weights.");
      return;
    }
    const media = mediaPool.find((m) => m.id === selectedVideoId);
    if (!media) return;

    setIsTranscribing(true);
    setTranscribeResult(null);

    try {
      const segments = await invoke<any[]>("transcribe_video", {
        videoPath: media.filePath,
        modelName: `whisper/${selectedWhisperModel}`,
      });

      // Find or create subtitle track
      let subTrack = tracks.find((t) => t.type === "subtitle");
      if (!subTrack) {
        addTrack("subtitle", "Subtitle Track");
      }

      // Buffer track finding
      setTimeout(() => {
        const targetTrack = tracks.find((t) => t.type === "subtitle") || tracks[0];
        
        segments.forEach((seg) => {
          const startSec = seg.start_ms / 1000.0;
          const endSec = seg.end_ms / 1000.0;
          const duration = endSec - startSec;

          addClip(targetTrack.id, {
            name: seg.text.length > 15 ? seg.text.substring(0, 15) + "..." : seg.text,
            filePath: "",
            type: "subtitle",
            duration: duration,
            startOffset: 0,
            endOffset: duration,
            timeStart: startSec,
            volume: 1.0,
            speed: 1.0,
            text: seg.text,
            color: "rgba(245, 158, 11, 0.45)", // soft translucent orange
          });
        });
      }, 100);

      setTranscribeResult(`Transcribed ${segments.length} segments successfully!`);
    } catch (e: any) {
      setTranscribeResult(`Error: ${e.toString()}`);
    } finally {
      setIsTranscribing(false);
    }
  };

  // --- Stable Diffusion Image Generation ---
  const handleGenerateImage = async () => {
    if (!prompt.trim() || !selectedSdModel) {
      alert("Please enter a prompt and select Stable Diffusion model weights.");
      return;
    }

    const [wStr, hStr] = resolution.split("x");
    const width = parseInt(wStr);
    const height = parseInt(hStr);

    setIsGenerating(true);
    setGeneratedImagePath(null);

    try {
      const imgPath = await invoke<string>("generate_sd_image", {
        prompt: prompt.trim(),
        negativePrompt: negPrompt.trim(),
        seed,
        steps,
        sampler: "euler_a",
        width,
        height,
        cfgScale,
        checkpointName: `stable-diffusion/${selectedSdModel}`,
      });
      setGeneratedImagePath(imgPath);
    } catch (e: any) {
      alert(`Stable Diffusion compilation/run failed: ${e}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAddGeneratedToMedia = async () => {
    if (!generatedImagePath) return;
    setIsAddingImage(true);

    try {
      await handleImportToPool(generatedImagePath, "image");
      alert("Generated image imported to Media Pool!");
      setGeneratedImagePath(null);
      setPrompt("");
    } catch (e: any) {
      alert(`Failed to import image: ${e.message}`);
    } finally {
      setIsAddingImage(false);
    }
  };

  // --- Voice Lab: Stem Separation ---
  const handleSplitAudio = async () => {
    if (!selectedAudioSplitId) {
      alert("Please select an audio file to separate.");
      return;
    }
    const media = mediaPool.find((m) => m.id === selectedAudioSplitId);
    if (!media) return;

    setIsSplitting(true);
    setSplitResult(null);

    try {
      const port = await invoke<number>("get_python_server_port");
      const response = await fetch(`http://127.0.0.1:${port}/demucs/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_path: media.filePath }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "Stem split failed");
      }

      const data = await response.json();
      setSplitResult(data);
    } catch (e: any) {
      alert(`Stem Splitter failed: ${e.message || e}`);
    } finally {
      setIsSplitting(false);
    }
  };

  const handleImportStem = async (stemPath: string, nameKey: string) => {
    setIsAddingStem(nameKey);
    try {
      await handleImportToPool(stemPath, "audio");
      alert(`Stem "${nameKey}" imported to Media Pool!`);
    } catch (e: any) {
      alert(`Failed to import stem: ${e.message}`);
    } finally {
      setIsAddingStem(null);
    }
  };

  // --- Voice Lab: Speech Synthesis (TTS) ---
  const handleSynthesizeTts = async () => {
    if (!ttsText.trim()) {
      alert("Please enter narration text.");
      return;
    }

    setIsSynthesizing(true);
    setGeneratedAudioPath(null);

    try {
      let refVoicePath: string | undefined = undefined;
      if (ttsRefAudioId) {
        const media = mediaPool.find((m) => m.id === ttsRefAudioId);
        if (media) refVoicePath = media.filePath;
      }

      const port = await invoke<number>("get_python_server_port");
      const response = await fetch(`http://127.0.0.1:${port}/tts/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: ttsText.trim(),
          ref_voice_path: refVoicePath,
          target_duration: ttsDuration ? parseFloat(ttsDuration) : null,
          emotion: ttsEmotion,
          speed: ttsSpeed,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "Speech synthesis failed");
      }

      const data = await response.json();
      setGeneratedAudioPath(data.audio_path);
    } catch (e: any) {
      alert(`Narration failed: ${e.message || e}`);
    } finally {
      setIsSynthesizing(false);
    }
  };

  const handleImportTts = async () => {
    if (!generatedAudioPath) return;
    setIsAddingTts(true);
    try {
      await handleImportToPool(generatedAudioPath, "audio");
      alert("Synthesized narration imported to Media Pool!");
      setGeneratedAudioPath(null);
      setTtsText("");
    } catch (e: any) {
      alert(`Failed to import speech: ${e.message}`);
    } finally {
      setIsAddingTts(false);
    }
  };

  // --- AI Video Generator (SVD / Kinetic Fallback) ---
  const handleGenerateVideo = async () => {
    if (!videoPrompt.trim()) {
      alert("Please enter a video prompt.");
      return;
    }

    setIsGeneratingVideo(true);
    setGeneratedVideoPath(null);

    try {
      let imgPath: string | undefined = undefined;
      if (selectedBaseImageId) {
        const media = mediaPool.find((m) => m.id === selectedBaseImageId);
        if (media) imgPath = media.filePath;
      }

      const port = await invoke<number>("get_python_server_port");
      const response = await fetch(`http://127.0.0.1:${port}/video/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: videoPrompt.trim(),
          image_path: imgPath,
          duration: videoDuration,
          fps: videoFps,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "Video compilation failed");
      }

      const data = await response.json();
      setGeneratedVideoPath(data.video_path);
    } catch (e: any) {
      alert(`Video Generator failed: ${e.message || e}`);
    } finally {
      setIsGeneratingVideo(false);
    }
  };

  const handleImportVideo = async () => {
    if (!generatedVideoPath) return;
    setIsAddingVideo(true);
    try {
      await handleImportToPool(generatedVideoPath, "video");
      alert("Generated video imported to Media Pool!");
      setGeneratedVideoPath(null);
      setVideoPrompt("");
    } catch (e: any) {
      alert(`Failed to import video: ${e.message}`);
    } finally {
      setIsAddingVideo(false);
    }
  };

  return (
    <div className="panel-content" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Sub tabs */}
      <div className="tab-container" style={{ margin: "0 0 10px 0", display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "2px" }}>
        <button
          className={`tab-btn ${activeTab === "whisper" ? "active" : ""}`}
          style={{ padding: "5px 0", fontSize: "10px", display: "flex", alignItems: "center", justifyContent: "center", gap: "2px" }}
          onClick={() => setActiveTab("whisper")}
        >
          <Languages size={10} /> Subtitles
        </button>
        <button
          className={`tab-btn ${activeTab === "sd" ? "active" : ""}`}
          style={{ padding: "5px 0", fontSize: "10px", display: "flex", alignItems: "center", justifyContent: "center", gap: "2px" }}
          onClick={() => setActiveTab("sd")}
        >
          <Sparkles size={10} /> Image
        </button>
        <button
          className={`tab-btn ${activeTab === "voice" ? "active" : ""}`}
          style={{ padding: "5px 0", fontSize: "10px", display: "flex", alignItems: "center", justifyContent: "center", gap: "2px" }}
          onClick={() => setActiveTab("voice")}
        >
          <Mic size={10} /> Voice Lab
        </button>
        <button
          className={`tab-btn ${activeTab === "video" ? "active" : ""}`}
          style={{ padding: "5px 0", fontSize: "10px", display: "flex", alignItems: "center", justifyContent: "center", gap: "2px" }}
          onClick={() => setActiveTab("video")}
        >
          <Video size={10} /> Video
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px", paddingRight: "4px" }}>
        {/* --- Subtitles Tab (Whisper) --- */}
        {activeTab === "whisper" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div className="input-group">
              <label className="input-label">Select Video File</label>
              <select
                value={selectedVideoId}
                onChange={(e) => setSelectedVideoId(e.target.value)}
                style={{ fontSize: "11px" }}
              >
                <option value="">-- Choose imported clip --</option>
                {videoFiles.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({Math.round(m.duration)}s)
                  </option>
                ))}
              </select>
            </div>

            <div className="input-group">
              <label className="input-label" style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Whisper Weights (.bin)</span>
                <span style={{ fontSize: "9px", color: "var(--accent-teal)", cursor: "pointer" }} onClick={loadModels}>
                  Refresh
                </span>
              </label>
              <select
                value={selectedWhisperModel}
                onChange={(e) => setSelectedWhisperModel(e.target.value)}
                style={{ fontSize: "11px" }}
              >
                <option value="">-- Choose Whisper model --</option>
                {whisperModels.map((m) => (
                  <option key={m.path} value={m.name}>
                    {m.name} ({m.size})
                  </option>
                ))}
              </select>
              {whisperModels.length === 0 && (
                <span style={{ fontSize: "9px", color: "var(--accent-orange)", marginTop: "2px" }}>
                  Download whisper-base.bin in Model Vault first!
                </span>
              )}
            </div>

            <button
              className="btn-primary"
              onClick={handleTranscribe}
              disabled={isTranscribing || !selectedVideoId || !selectedWhisperModel}
              style={{ marginTop: "6px" }}
            >
              {isTranscribing ? (
                <>
                  <Loader2 size={12} className="animate-spin" /> Transcribing Audio...
                </>
              ) : (
                <>
                  <FileText size={12} /> Auto-Generate Subtitles
                </>
              )}
            </button>

            {transcribeResult && (
              <div 
                className="item-card" 
                style={{ 
                  marginTop: "8px", 
                  fontSize: "11px", 
                  color: transcribeResult.startsWith("Error") ? "var(--accent-rose)" : "var(--accent-teal)",
                  backgroundColor: "rgba(12, 16, 26, 0.4)",
                  border: "1px solid var(--border-normal)"
                }}
              >
                {transcribeResult}
              </div>
            )}
          </div>
        )}

        {/* --- Image Gen Tab (Stable Diffusion) --- */}
        {activeTab === "sd" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div className="input-group">
              <label className="input-label" style={{ display: "flex", justifyContent: "space-between" }}>
                <span>SD Checkpoint (.safetensors)</span>
                <span style={{ fontSize: "9px", color: "var(--accent-teal)", cursor: "pointer" }} onClick={loadModels}>
                  Refresh
                </span>
              </label>
              <select
                value={selectedSdModel}
                onChange={(e) => setSelectedSdModel(e.target.value)}
                style={{ fontSize: "11px" }}
              >
                <option value="">-- Choose SD model --</option>
                {sdModels.map((m) => (
                  <option key={m.path} value={m.name}>
                    {m.name} ({m.size})
                  </option>
                ))}
              </select>
              {sdModels.length === 0 && (
                <span style={{ fontSize: "9px", color: "var(--accent-orange)", marginTop: "2px" }}>
                  Download SD checkpoint in Model Vault first!
                </span>
              )}
            </div>

            <div style={{ display: "flex", gap: "8px" }}>
              <div className="input-group" style={{ flex: 1 }}>
                <label className="input-label">Resolution</label>
                <select value={resolution} onChange={(e) => setResolution(e.target.value)} style={{ fontSize: "11px" }}>
                  <option value="512x512">512 x 512 (Square)</option>
                  <option value="768x768">768 x 768</option>
                  <option value="512x768">512 x 768 (Portrait)</option>
                  <option value="768x512">768 x 512 (Landscape)</option>
                </select>
              </div>
              <div className="input-group" style={{ flex: 1 }}>
                <label className="input-label">Steps</label>
                <input
                  type="number"
                  min="5"
                  max="100"
                  value={steps}
                  onChange={(e) => setSteps(parseInt(e.target.value) || 20)}
                  style={{ fontSize: "11px", padding: "6px" }}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: "8px" }}>
              <div className="input-group" style={{ flex: 1 }}>
                <label className="input-label">CFG Scale</label>
                <input
                  type="number"
                  min="1.0"
                  max="30.0"
                  step="0.5"
                  value={cfgScale}
                  onChange={(e) => setCfgScale(parseFloat(e.target.value) || 7.0)}
                  style={{ fontSize: "11px", padding: "6px" }}
                />
              </div>
              <div className="input-group" style={{ flex: 1 }}>
                <label className="input-label">Seed</label>
                <input
                  type="number"
                  value={seed}
                  onChange={(e) => setSeed(parseInt(e.target.value) || -1)}
                  style={{ fontSize: "11px", padding: "6px" }}
                />
              </div>
            </div>

            <div className="input-group">
              <label className="input-label">Prompt</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="A beautiful futuristic sci-fi city scene, cinematic lighting..."
                rows={3}
                style={{ fontSize: "11px", padding: "6px", width: "100%", backgroundColor: "#06080e", border: "1px solid var(--border-normal)", borderRadius: "4px", color: "#fff" }}
              />
            </div>

            <div className="input-group">
              <label className="input-label">Negative Prompt</label>
              <textarea
                value={negPrompt}
                onChange={(e) => setNegPrompt(e.target.value)}
                placeholder="blurry, ugly, text, watermark..."
                rows={1}
                style={{ fontSize: "11px", padding: "6px", width: "100%", backgroundColor: "#06080e", border: "1px solid var(--border-normal)", borderRadius: "4px", color: "#fff" }}
              />
            </div>

            <button
              className="btn-primary"
              onClick={handleGenerateImage}
              disabled={isGenerating || !prompt.trim() || !selectedSdModel}
              style={{ marginTop: "4px" }}
            >
              {isGenerating ? (
                <>
                  <Loader2 size={12} className="animate-spin" /> Compiling/Generating SD...
                </>
              ) : (
                <>
                  <Image size={12} /> Generate Image (C++)
                </>
              )}
            </button>

            {generatedImagePath && (
              <div className="item-card" style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "10px", alignItems: "center" }}>
                <span style={{ fontSize: "10px", color: "var(--accent-teal)", fontWeight: "600", width: "100%", textAlign: "left" }}>
                  GENERATED IMAGE PATH:
                </span>
                <code style={{ fontSize: "8px", color: "var(--text-muted)", wordBreak: "break-all", background: "rgba(0,0,0,0.3)", padding: "4px", borderRadius: "2px" }}>
                  {generatedImagePath}
                </code>
                
                <button
                  className="btn-primary"
                  onClick={handleAddGeneratedToMedia}
                  disabled={isAddingImage}
                  style={{ width: "100%", fontSize: "11px" }}
                >
                  {isAddingImage ? (
                    <>
                      <Loader2 size={11} className="animate-spin" /> Transcoding Media...
                    </>
                  ) : (
                    <>
                      <Plus size={11} /> Import to Media Pool
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {/* --- Voice Lab Tab --- */}
        {activeTab === "voice" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            
            {/* Stem Splitter Card */}
            <div className="card-list" style={{ border: "1px solid var(--border-normal)", padding: "8px", borderRadius: "6px" }}>
              <span className="input-label" style={{ fontSize: "11px", fontWeight: "600", display: "flex", alignItems: "center", gap: "4px", color: "var(--accent-teal)", marginBottom: "6px" }}>
                <Scissors size={12} /> Demucs Vocal Stem Splitter
              </span>

              <div className="input-group">
                <select
                  value={selectedAudioSplitId}
                  onChange={(e) => setSelectedAudioSplitId(e.target.value)}
                  style={{ fontSize: "11px" }}
                >
                  <option value="">-- Choose track to split --</option>
                  {audioFiles.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({Math.round(m.duration)}s)
                    </option>
                  ))}
                </select>
              </div>

              <button
                className="btn-primary"
                onClick={handleSplitAudio}
                disabled={isSplitting || !selectedAudioSplitId}
                style={{ width: "100%", marginTop: "6px", fontSize: "11px" }}
              >
                {isSplitting ? (
                  <>
                    <Loader2 size={12} className="animate-spin" /> Splitting Stems (Demucs)...
                  </>
                ) : (
                  <>
                    <Scissors size={12} /> Split Stems (vocals/drums/bass)
                  </>
                )}
              </button>

              {splitResult && (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "8px" }}>
                  <span style={{ fontSize: "9px", color: "var(--text-muted)" }}>Select stem to import:</span>
                  {[
                    { key: "Vocals", path: splitResult.vocals_path },
                    { key: "Drums", path: splitResult.drums_path },
                    { key: "Bass", path: splitResult.bass_path },
                    { key: "Instrumental", path: splitResult.other_path }
                  ].map((stem) => (
                    <button
                      key={stem.key}
                      onClick={() => handleImportStem(stem.path, stem.key)}
                      disabled={isAddingStem !== null}
                      className="btn-secondary"
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        fontSize: "10px",
                        padding: "4px 8px"
                      }}
                    >
                      <span>{stem.key}</span>
                      {isAddingStem === stem.key ? (
                        <Loader2 size={10} className="animate-spin" />
                      ) : (
                        <Download size={10} />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Vocal Synthesizer Card */}
            <div className="card-list" style={{ border: "1px solid var(--border-normal)", padding: "8px", borderRadius: "6px" }}>
              <span className="input-label" style={{ fontSize: "11px", fontWeight: "600", display: "flex", alignItems: "center", gap: "4px", color: "var(--accent-rose)", marginBottom: "6px" }}>
                <Volume2 size={12} /> IndexTTS2 Voice Narrator
              </span>

              <div className="input-group">
                <label className="input-label">Narration Text</label>
                <textarea
                  value={ttsText}
                  onChange={(e) => setTtsText(e.target.value)}
                  placeholder="Welcome to the future of AI-assisted video editing..."
                  rows={2}
                  style={{ fontSize: "11px", padding: "6px", width: "100%", backgroundColor: "#06080e", border: "1px solid var(--border-normal)", borderRadius: "4px", color: "#fff" }}
                />
              </div>

              <div className="input-group" style={{ marginTop: "4px" }}>
                <label className="input-label">Voice Clone Speaker (Optional)</label>
                <select
                  value={ttsRefAudioId}
                  onChange={(e) => setTtsRefAudioId(e.target.value)}
                  style={{ fontSize: "11px" }}
                >
                  <option value="">-- Standard Voice --</option>
                  {audioFiles.map((m) => (
                    <option key={m.id} value={m.id}>
                      Clone: {m.name}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginTop: "4px" }}>
                <div className="input-group">
                  <label className="input-label">Speed</label>
                  <select
                    value={ttsSpeed}
                    onChange={(e) => setTtsSpeed(parseFloat(e.target.value))}
                    style={{ fontSize: "11px" }}
                  >
                    <option value="0.8">0.8x (Slow)</option>
                    <option value="1.0">1.0x (Normal)</option>
                    <option value="1.2">1.2x (Fast)</option>
                    <option value="1.5">1.5x (Super Fast)</option>
                  </select>
                </div>
                <div className="input-group">
                  <label className="input-label">Emotion</label>
                  <select
                    value={ttsEmotion}
                    onChange={(e) => setTtsEmotion(e.target.value)}
                    style={{ fontSize: "11px" }}
                  >
                    <option value="neutral">Neutral</option>
                    <option value="happy">Happy</option>
                    <option value="serious">Serious</option>
                    <option value="energetic">Energetic</option>
                  </select>
                </div>
              </div>

              <div className="input-group" style={{ marginTop: "4px" }}>
                <label className="input-label">Target Duration (s) (Optional)</label>
                <input
                  type="number"
                  placeholder="e.g. 5.5"
                  step="0.5"
                  value={ttsDuration}
                  onChange={(e) => setTtsDuration(e.target.value)}
                  style={{ fontSize: "11px", padding: "6px" }}
                />
              </div>

              <button
                className="btn-primary"
                onClick={handleSynthesizeTts}
                disabled={isSynthesizing || !ttsText.trim()}
                style={{ width: "100%", marginTop: "8px", fontSize: "11px" }}
              >
                {isSynthesizing ? (
                  <>
                    <Loader2 size={12} className="animate-spin" /> Synthesizing Speech...
                  </>
                ) : (
                  <>
                    <Volume2 size={12} /> Synthesize Speech (IndexTTS2)
                  </>
                )}
              </button>

              {generatedAudioPath && (
                <div className="item-card" style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px", alignItems: "center" }}>
                  <span style={{ fontSize: "9px", color: "var(--accent-teal)", alignSelf: "flex-start" }}>SYNTHESIS COMPLETE:</span>
                  <button
                    className="btn-primary"
                    onClick={handleImportTts}
                    disabled={isAddingTts}
                    style={{ width: "100%", fontSize: "10px" }}
                  >
                    {isAddingTts ? (
                      <Loader2 size={10} className="animate-spin" />
                    ) : (
                      <>
                        <Plus size={10} /> Import to Media Pool
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* --- AI Video Tab --- */}
        {activeTab === "video" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div className="input-group">
              <label className="input-label">Input Image (Optional Base)</label>
              <select
                value={selectedBaseImageId}
                onChange={(e) => setSelectedBaseImageId(e.target.value)}
                style={{ fontSize: "11px" }}
              >
                <option value="">-- Choose Image --</option>
                {imageFiles.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
              <div className="input-group">
                <label className="input-label">Duration (s)</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  step="0.5"
                  value={videoDuration}
                  onChange={(e) => setVideoDuration(parseFloat(e.target.value) || 2.0)}
                  style={{ fontSize: "11px", padding: "6px" }}
                />
              </div>
              <div className="input-group">
                <label className="input-label">Framerate (FPS)</label>
                <select
                  value={videoFps}
                  onChange={(e) => setVideoFps(parseInt(e.target.value))}
                  style={{ fontSize: "11px" }}
                >
                  <option value="8">8 FPS (Fast)</option>
                  <option value="12">12 FPS</option>
                  <option value="16">16 FPS (Smooth)</option>
                  <option value="24">24 FPS (Cinematic)</option>
                </select>
              </div>
            </div>

            <div className="input-group">
              <label className="input-label">Prompt / Caption</label>
              <textarea
                value={videoPrompt}
                onChange={(e) => setVideoPrompt(e.target.value)}
                placeholder="Cinematic zoom-in on an astronaut walking in dark neon cyberspace..."
                rows={3}
                style={{ fontSize: "11px", padding: "6px", width: "100%", backgroundColor: "#06080e", border: "1px solid var(--border-normal)", borderRadius: "4px", color: "#fff" }}
              />
            </div>

            <button
              className="btn-primary"
              onClick={handleGenerateVideo}
              disabled={isGeneratingVideo || !videoPrompt.trim()}
              style={{ marginTop: "6px" }}
            >
              {isGeneratingVideo ? (
                <>
                  <Loader2 size={12} className="animate-spin" /> Compiling Video clip...
                </>
              ) : (
                <>
                  <Video size={12} /> Generate Video Clip
                </>
              )}
            </button>

            {generatedVideoPath && (
              <div className="item-card" style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "10px", alignItems: "center" }}>
                <span style={{ fontSize: "9px", color: "var(--accent-teal)", alignSelf: "flex-start" }}>GENERATED MP4 PATH:</span>
                <code style={{ fontSize: "8px", color: "var(--text-muted)", wordBreak: "break-all", background: "rgba(0,0,0,0.3)", padding: "4px", borderRadius: "2px" }}>
                  {generatedVideoPath}
                </code>
                <button
                  className="btn-primary"
                  onClick={handleImportVideo}
                  disabled={isAddingVideo}
                  style={{ width: "100%", fontSize: "11px" }}
                >
                  {isAddingVideo ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : (
                    <>
                      <Plus size={10} /> Import to Media Pool
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
