# Implementation Plan: Isolated GPU-Accelerated Video Editor (`simple-edit`)

This document is the master implementation blueprint for `simple-edit`, a professional, CapCut-style, open-source video editor wrapper. It is designed to be fully isolated in `./simple-edit/`, highly modular, easily upgradable, and compatible with multiple device architectures (NVIDIA, AMD, Intel, CPU fallback). 

Every phase is broken down into atomic, testable checkmarks with explicit instructions, execution patterns, and validation benchmarks, optimized for sequential execution.

---

## 1. Core Architectural & Portability Mechanics

To eliminate potential points of failure, the application implements the following robust patterns:

1.  **Environment Execution via Micromamba**:
    *   Conda environments require specialized environment variables to load binary packages. Rather than executing `./conda_env/bin/python` directly, all Python execution will go through Micromamba's run command:
        ```bash
        ./bin/micromamba run -p ./conda_env python python/main.py --port <port>
        ```
    *   This automatically injects the correct `PATH`, `LD_LIBRARY_PATH`, and CUDA configurations, preventing dynamic library import errors.
2.  **C++ Engines and Vulkan Fallback**:
    *   Precompiled CUDA binaries for `whisper.cpp` and `stable-diffusion.cpp` require precise CUDA version matches.
    *   To ensure support across all GPUs, the downloader will check driver compatibility. If a driver mismatch is found, it will fall back to **Vulkan-enabled** C++ binaries. Vulkan runs natively on NVIDIA, AMD, and Intel GPUs using standard graphics drivers, avoiding CUDA dependency locks.
3.  **Collision-Free Port Allocation**:
    *   The Rust backend will dynamically request a free port from the OS (by binding a temporary TCP listener to port `0`), spawn the FastAPI Python service with that port, and point its HTTP clients to it.
4.  **Zero-Lag Timeline Rendering**:
    *   Updating React state 60 times a second for the playhead freezes the DOM. The playhead position will be tracked inside a React `useRef` and updated directly via direct DOM manipulation (`playheadRef.current.style.transform = ...`) or drawing directly on the timeline `<canvas>`.
5.  **Dynamic Package Resolution**:
    *   All core dependencies (`pytorch`, `diffusers`, `librosa`, etc.) will be installed using Micromamba binaries from `conda-forge` and `pytorch` channels. Pip will only be used in `--isolated` mode to install local source repos (like IndexTTS2).

---

## 2. Multi-Device Compatibility Matrix

The application dynamically configures its runtimes based on the detected hardware during the bootstrap phase:

| Component | NVIDIA (CUDA) | AMD (ROCm / Vulkan) | Intel / Generic GPU | CPU Only (Fallback) |
| :--- | :--- | :--- | :--- | :--- |
| **FFmpeg** | `h264_nvenc` / `hevc_nvenc` | `h264_vaapi` / `hevc_vaapi` | `h264_vaapi` / `hevc_qsv` | `libx264` (Multi-threaded) |
| **Whisper** | CUDA (`whisper-rs`) | Vulkan / CPU | Vulkan / CPU | CPU (AVX2 / AVX-512) |
| **Stable Diffusion**| CUDA (`stable-diffusion.cpp`) | Vulkan / ROCm | Vulkan | CPU |
| **TTS & Demucs** | PyTorch + CUDA (Conda) | PyTorch + ROCm / CPU | PyTorch + CPU | PyTorch + CPU |

---

## 3. Directory Layout

```
simple-edit/
  ├── setup.sh                 # Bootstrap shell script
  ├── Cargo.toml               # Rust dependencies
  ├── tauri.conf.json          # Tauri configurations
  ├── src/                     # Rust backend source files
  │    ├── main.rs             # Bootstrapper & Custom URI Protocols
  │    ├── commands/           # Tauri IPC commands modules
  │    │    ├── bootstrap.rs   # Micromamba config & GPU checkers
  │    │    ├── download.rs    # Segmented chunk downloader
  │    │    └── timeline.rs    # Timeline JSON project manager
  │    ├── engines/            # Native C++ wrappers
  │    │    ├── whisper.rs     # whisper-rs bridge
  │    │    └── sd.rs          # stable-diffusion.cpp process wrapper
  │    └── video/              # FFmpeg bindings
  │         ├── metadata.rs    # FFprobe parser
  │         ├── compiler.rs    # FFmpeg complex filtergraph builder
  │         └── waveform.rs    # Audio PCM parser
  ├── src-ui/                  # Frontend Vite + React + TS
  │    ├── package.json        # Web dependencies (zustand, tailwind, framer-motion)
  │    ├── src/
  │    │    ├── main.tsx       # UI entrypoint
  │    │    ├── index.css      # Dark-theme tailwind styling
  │    │    ├── store/
  │    │    │    └── timelineStore.ts # Zustand timeline engine
  │    │    └── components/
  │    │         ├── MediaPool.tsx
  │    │         ├── MonitorProgram.tsx
  │    │         ├── Timeline.tsx
  │    │         ├── ModelManager.tsx
  │    │         ├── ToolUpdater.tsx
  │    │         └── VisualizerPanel.tsx
  ├── bin/                     # Precompiled binaries (Micromamba, FFmpeg, SDCli)
  ├── conda_env/               # Isolated Micromamba environment
  ├── python/                  # Python AI Service code
  │    ├── main.py             # FastAPI server entry point
  │    ├── requirements.txt    # Local repository python dependencies
  │    ├── modules/
  │    │    ├── tts_runner.py      # IndexTTS2 wrapper
  │    │    ├── demucs_runner.py   # Demucs wrapper
  │    │    └── visualizer.py      # Librosa analyzer
  │    └── repos/              # Git-cloned AI repositories
  ├── models/                  # Downloaded weights (.safetensors, GGML)
  └── temp/                    # Temporary video proxies, waveforms, & downloads
```

---

## 4. Phase-by-Phase Execution Plan

### Phase 1: Environment Isolation & Micromamba Setup (Steps 1-5)

*   **Step 1: Folder Structures & Environment Detection**
    *   Create base folder structures: `bin`, `conda_env`, `models`, `python`, `temp`.
    *   Implement GPU detector inside `src/utils/hardware.rs` parsing `/proc/driver/nvidia/version` or checking if `nvidia-smi` exists. Report: GPU Type, CUDA Capability, VRAM Size.
    *   *Validation*: Run unit test verifying hardware detector returns correct structures without crashing on non-Nvidia hardware.

*   **Step 2: Micromamba Bootstrapper**
    *   Download static standalone Micromamba binary for Linux x86_64 into `bin/micromamba` using `reqwest` in Rust.
    *   Set file execution permissions on `bin/micromamba`.
    *   *Validation*: Verify `./bin/micromamba --help` exits with status `0` when spawned via Rust.

*   **Step 3: Conda Environment Initialization**
    *   Spawn Micromamba from Rust to initialize `./conda_env/` with: `python=3.10`, `pytorch`, `torchvision`, `torchaudio`, `pytorch-cuda=12.1` (or CPU wheel if no NVIDIA GPU detected) from `pytorch` and `nvidia` channels.
    *   *Validation*: Verify `./bin/micromamba run -p ./conda_env python -c "import torch; print(torch.cuda.is_available())"` outputs `True` (or `False` if CPU fallback).

*   **Step 4: Isolated FFmpeg & FFprobe Setup**
    *   Detect GPU type. Download static FFmpeg and FFprobe binaries from static builds repository into `bin/ffmpeg` and `bin/ffprobe`.
    *   *Validation*: Run `./bin/ffmpeg -version` via Rust and verify NVENC codecs are listed (for NVIDIA) or VAAPI is listed (for AMD/Intel).

*   **Step 5: System Check & Verification API**
    *   Implement Tauri command `check_system_status` returning a JSON describing: Rust status, Micromamba presence, Python presence, PyTorch CUDA capability, and FFmpeg version.
    *   *Validation*: Launch Tauri backend and verify frontend gets successful response payload with correct isolated paths.

---

### Phase 2: Resumable Downloader & Civitai Manager (Steps 6-9)

*   **Step 6: Resumable Downloader Module (Rust)**
    *   Implement `src/commands/download.rs`. Create HTTP downloader using `reqwest` that requests chunks, checks local file sizes for range-based resume requests (`Range: bytes=X-`), and streams progress.
    *   *Validation*: Start a download, cancel it halfway, resume it, and verify the final file's SHA256 matches.

*   **Step 7: Civitai API Resolver**
    *   Add a Civitai resolver inside `src/commands/download.rs`. Take a Civitai model URL, call `https://civitai.com/api/v1/models/9409`, extract the latest model version's primary `.safetensors` download URL, and route it to the Downloader.
    *   *Validation*: Input URL, assert correct `.safetensors` download link is resolved.

*   **Step 8: UI Downloader Dashboard**
    *   Build `ModelManager.tsx` in React. Provide fields to paste custom download URLs or Civitai links.
    *   Connect to Tauri's download progress event stream. Render: Speed (MB/s), Percent Complete, ETA, and Pause/Cancel buttons.
    *   *Validation*: Successfully download a test model and show correct UI progress.

*   **Step 9: Git Submodule Updater**
    *   Implement Rust command `update_tool_repo(repo_name, git_url)`. Run `git clone` or `git pull` inside `python/repos/` using `tokio::process::Command` with the environment variable `GIT_CONFIG_NOSYSTEM=1` to ensure isolation.
    *   *Validation*: Clone a repository (like IndexTTS2) and verify commit logs inside `python/repos/indextts2/`.

---

### Phase 3: Video Engine & Proxy Processing (Steps 10-13)

*   **Step 10: Tauri Custom Asset Protocol**
    *   Register `asset://` URI scheme in `src/main.rs`. Convert `asset://localhost/path/to/file` to the absolute disk path, verify it is inside the project workspace directory (for security), and stream it using range responses.
    *   *Validation*: Render a `<video src="asset://localhost/absolute/path/to/proxy.mp4" />` in React and verify video plays and scrubs smoothly.

*   **Step 11: Proxy Generator Engine**
    *   Implement `src/video/proxy.rs`. Spawn `./bin/ffmpeg` in the background:
      ```bash
      ./bin/ffmpeg -i input.mp4 -vf "scale=-2:480" -c:v libx264 -preset superfast -crf 28 -c:a aac -b:a 96k temp/proxies/<clip_id>.mp4
      ```
    *   *Validation*: Confirm the transcoded proxy file exists in `temp/proxies/` and is fully playable.

*   **Step 12: Audio Waveform Extractor**
    *   Implement `src/video/waveform.rs`. Spawn FFmpeg to extract PCM values at 100Hz and save them to a `.json` array in `temp/waveforms/`.
    *   *Validation*: Import a video with audio, check that the generated JSON matches the length of the audio track.

*   **Step 13: Timeline Thumbnail Cacher**
    *   Extract frames at 1fps using FFmpeg and cache them as JPEGs inside `temp/thumbnails/`.
    *   *Validation*: Verify thumbnails exist and can be loaded in the UI using the custom `asset://` scheme.

---

### Phase 4: Zustand Timeline & Layout (Steps 14-17)

*   **Step 14: Dark-Slate Design Layout**
    *   Build the main editor grid layout (Media Pool, Inspector, Monitors, Timeline) styled with slate HSL colors in `index.css`.
    *   *Validation*: Verify panel layouts adapt responsively to window resizes.

*   **Step 15: Zustand Timeline Store**
    *   Build `timelineStore.ts` containing the project timeline schema (Tracks, Clips, Splits, Playhead).
    *   Implement timeline actions: Add clip, delete clip, split clip at playhead, trim start/end.
    *   *Validation*: Write store tests checking that splitting a 10s clip at 4s creates two clips (0-4s and 4-10s).

*   **Step 16: Canvas Ruler & Timeline Viewport**
    *   Implement a virtualized canvas timecode ruler. Render only visible clips on tracks.
    *   *Validation*: Verify timeline scrolls smoothly at 60fps even with 100+ clips.

*   **Step 17: Playhead Monitor Sync (Ref Loop)**
    *   Implement playhead tracking via React `useRef` to update the playhead indicator position without triggering re-renders during playback.
    *   Synchronize playhead position with the `<video>` elements in the Program Monitor using `requestAnimationFrame`.
    *   *Validation*: Play a proxy video and confirm the timeline playhead slides smoothly.

---

### Phase 5: Native AI Engines: Whisper & Stable Diffusion (Steps 18-20)

*   **Step 18: Native Whisper Subsystem (Rust)**
    *   Build C++ `whisper.cpp` (`whisper-cli`) or link `whisper-rs`.
    *   Implement `src/engines/whisper.rs`. Add transcription command: extract audio, run Whisper on it, and output time-aligned segments.
    *   *Validation*: Transcribe a test WAV file and confirm output JSON segments match the speech audio.

*   **Step 19: Native Stable Diffusion (C++)**
    *   Integrate `stable-diffusion.cpp` (`sd-cli`) in Rust backend.
    *   Implement `src/engines/sd.rs`. Accept: prompt, negative prompt, seed, steps, sampler, resolution, and checkpoint path.
    *   *Validation*: Load a downloaded Civitai model file and generate a `.png` image matching the prompt.

*   **Step 20: Subtitle Timeline Integration**
    *   Connect the Whisper output to a dedicated Subtitle track.
    *   Provide inspectors to customize font size, color, stroke, and alignments.
    *   *Validation*: Double-click a subtitle clip, edit text, and verify updates instantly render in the Program monitor overlay.

---

### Phase 6: IndexTTS2 & Demucs (Python Service) (Steps 21-24)

*   **Step 21: FastAPI Python Host Startup**
    *   Write Rust wrapper to allocate a random free port and start the Python microservice:
      ```bash
      ./bin/micromamba run -p ./conda_env python python/main.py --port <random_port>
      ```
    *   Implement server health checks and auto-shutdown tracking.
    *   *Validation*: Rust successfully launches the FastAPI server and connects to `/health`.

*   **Step 22: Meta Demucs Audio Splitter**
    *   Implement `POST /demucs/split` in Python. Take an audio track, run Demucs separation, and return separated stems (vocals, drums, bass, other) back to the Media Pool.
    *   *Validation*: Split an audio track and verify that vocal and background music stems are created separately.

*   **Step 23: IndexTTS2 Wrapper & Duration Controls**
    *   Implement `POST /tts/generate` in Python. Parse inputs: text prompt, reference voice file, target duration, emotion-timbre sliders, temperature.
    *   Use IndexTTS2's duration controller to match generated speech length to the target duration.
    *   *Validation*: Generate TTS audio with a target duration of exactly `4.5` seconds and confirm the output file is `4.5` seconds.

*   **Step 24: Voice Manager UI Integration**
    *   Build TTS and Demucs panels in the editor UI. Support recording reference audio samples directly from the microphone.
    *   *Validation*: Record a reference voice, generate a cloned TTS narration, and drop it onto the audio track.

---

### Phase 7: SVD & CogVideoX Video Generation (Steps 25-26)

*   **Step 25: Local Video Generation Backend**
    *   Implement `POST /video/generate` in Python using `diffusers` SVD (Stable Video Diffusion) or CogVideoX pipelines.
    *   Support text-to-video and image-to-video (generating a video from a Stable Diffusion image).
    *   *Validation*: Generate a 2-second video from an input image and check that it plays correctly on the timeline.

*   **Step 26: Unified AI Control Panel**
    *   Create the UI panel for SD and SVD controls: dials for steps, guidance scale, negative prompt, seed, model selection.
    *   *Validation*: Generate an image using a Civitai model, send it to SVD, and verify the resulting video clip is imported.

---

### Phase 8: Music Visualizer & Beat-Reactive FX (Steps 27-29)

*   **Step 8.1: Real-time Audio Analyzer (Frontend)**:
    *   Build `VisualizerPanel.tsx`. Connect player audio to a Web Audio API `AnalyserNode`.
    *   Implement canvas loops drawing **Frequency Bars**, **Circular Wave**, and **Neon Spectrum** with glowing shadows.
    *   *Validation*: Play timeline audio and verify canvas displays active equalizer bars matching the music.

*   **Step 8.2: Beat & Frequency Feature Extraction (Python)**:
    *   Create `POST /audio/analyze` using `librosa`. Extract beat timestamps and Bass/Mids/Treble amplitudes. Save to a JSON file.
    *   *Validation*: Analyze a track and confirm the JSON contains valid timestamps mapping to high-amplitude beats.

*   **Step 8.3: Beat-Reactive UI FX & Export Renderer**:
    *   Add a visualizer rendering engine:
        1.  *Preview*: Scale overlay elements dynamically based on the audio frequency values.
        2.  *Export*: Compile visualizer frames using OpenCV/Pillow based on the JSON beat data and overlay them onto the final video.
    *   *Validation*: Export a video with a visualizer and confirm the animations synchronize perfectly with the audio beats.

---

### Phase 9: Automation & Compiler (Steps 30-32)

*   **Step 30: Edit Automation Engine**
    *   Implement JSON project script parsing (import, align, compile).
    *   *Validation*: Load a JSON template and verify it automatically reconstructs the edit tracks.

*   **Step 31: FFmpeg Filtergraph Compiler**
    *   Write Rust compiler translating the timeline tracks, volume controls, speeds, text elements, and visualizers into a single complex FFmpeg command.
    *   *Validation*: Compile a complex project and verify the generated command has correct filter inputs/outputs.

*   **Step 32: GPU Export Pipeline**
    *   Execute the compiled FFmpeg command using NVENC/VAAPI encoders. Track progress and display a completion dialog.
    *   *Validation*: Export a 1-minute video with filters in under 15 seconds using GPU acceleration, and verify the output is playable.
