# 🎬 simple-edit

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey.svg)]()
[![Rust](https://img.shields.io/badge/Rust-Tauri%20Backend-orange.svg)](https://www.rust-lang.org/)
[![FastAPI](https://img.shields.io/badge/Python-FastAPI%20AI-green.svg)](https://fastapi.tiangolo.com/)

`simple-edit` is a **fully isolated, portable, and GPU-accelerated desktop video editor** built using **Tauri, React (TypeScript), Rust, and Python**. It matches modern, dark-slate glassmorphic aesthetics while hosting embedded AI engines directly on your machine—free from dynamic linkage conflicts, license restrictions, or dynamic cloud API fees.

---

## 🌟 Why simple-edit is Better

Traditional video editors are either heavy, bloated systems that pollute your global OS environment with dynamic drivers, or simple web tools that lock your files behind subscription paywalls and laggy cloud rendering APIs. `simple-edit` breaks this mold:

### 1. 100% Portability & Isolation (Zero Global Pollution)
*   **Micromamba Encapsulation**: The entire Python FastAPI and AI environment runs in an isolated directory (`./conda_env/`) controlled directly by CWD relative paths.
*   **No Global Pollution**: Zero global python path alterations, zero dynamic driver contamination, and zero environment variable conflicts. 
*   **Self-Contained Binaries**: FFmpeg, FFprobe, Whisper, and Stable Diffusion binaries are dynamically compiled and hosted strictly in `./bin/`.

### 2. High-Performance Native AI Engines
*   **Auto Subtitles (Whisper.cpp)**: Fast, offline speech-to-text compiled locally and aligned directly as editable, styled timeline clips.
*   **Image Generation (Stable-Diffusion.cpp)**: Native C++ implementation of Stable Diffusion leveraging Vulkan/CUDA GPU kernels to generate royalty-free visual assets in seconds.

### 3. Graceful DSP Fallbacks
To guarantee absolute stability on all systems (from low-end laptops to high-end workstations), heavy AI subsystems dynamically check hardware and fall back to custom Digital Signal Processing (DSP) algorithms instantly if GPU acceleration is offline or model weights are missing:
*   *Vocal Splitting*: Demucs AI splits instrumental stems, falling back to custom FFmpeg highpass/lowpass filters.
*   *Narrator Synthesis*: IndexTTS2 synthesizes cloned voices, falling back to a modulated formant carrier hum.
*   *Video Creator*: SVD diffusers compile panning clips, falling back to Pillow Kinetic Typography Ken Burns transitions.

### 4. Native FFmpeg Complex Graph Compiler
Our Rust-based compilation engine (`compiler.rs`) parses multi-layered tracks (video overlays, speed adjustments, volume envelopes, styled captions, and visual positioning) and maps them into an optimized FFmpeg `-filter_complex` CLI execution, utilizing hardware acceleration (`h264_nvenc`, `vaapi`) when available.

---

## 🚀 Key Features

*   **Zustand Timeline Workspace**: Premium desktop layout with timeline rulers, magnetic snapping, speed multipliers, drag-and-drop media clips, and multi-track audio/video layering.
*   **Beat-Reactive Music Visualizer**: Dynamic visual spectrums (Neon Equalizer, Glowing Circle Rings, Waveform Spectrums) driven by beat-mapping and spectral analysis (`librosa`).
*   **Voice Lab & Cloner**: Synthesize high-fidelity voice lines matching custom duration limits and speed metrics, with optional reference microphone speaker cloning.
*   **Subtitle Styler**: Subtitle Inspector offering live preview controls for HSL colors, border glow effects, font sizes, alignments, and text shadows.

---

## 📦 Installation Guide

### Prerequisites
*   **Rust / Cargo**: Install standard Rust compiler tools (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`).
*   **Node.js**: Node version 18 or above.
*   **System Tools**: `build-essential`, `cmake`, and `curl` for initial builds.

### Step-by-Step Installation

1.  **Clone the Repository**:
    ```bash
    git clone https://github.com/yourusername/simple-edit.git
    cd simple-edit
    ```

2.  **Bootstrap the Isolated Environment**:
    Run our automated initialization script to download Micromamba, configure isolated paths, download static FFmpeg binaries, and build the conda-forge dependencies:
    ```bash
    chmod +x setup.sh
    ./setup.sh
    ```
    *This installs uvicorn, torch, torchaudio, demucs, diffusers, transformers, accelerate, and librosa inside the local directory.*

3.  **Install Frontend Packages**:
    ```npm
    npm install
    ```

4.  **Launch the Application in Development Mode**:
    ```bash
    npm run tauri dev
    ```
    *Tauri will dynamically allocate a free socket port for the FastAPI server daemon, boot the Python service inside micromamba, run the React UI, and establish health-checks.*

---

## 🎮 How to Use

### 1. Model Vault & Subsystem Builder
*   Go to **Model Vault** (Left tab drawer). Paste model URLs (e.g. Whisper base ggml, SD safetensors checkpoints) and queue download.
*   Go to **AI Subsystems** (Right tab drawer) and click **Update Subsystem** to automatically compile native C++ engines tuned to your GPU drivers (CUDA, Vulkan, or AVX-512 CPU fallbacks).

### 2. Narrative Synthesis & Vocal Splitting
*   Navigate to **AI Generator -> Voice Lab**:
    - Select a music track and click **Split Stems** to instantly extract vocal track stems.
    - Input standard text, optionally upload a speaker voice clone sample, configure emotion, and generate narration tracks directly mapped to timeline grids.

### 3. Audio Visualization
*   Navigate to **Visualizer Panel** on the right side.
*   Load an imported soundtrack and trigger **Analyze Beat Mapping**.
*   Select your visualizer style (Equalizer Bars, Rings, Waveforms), customize neon glow boundaries, and watch it react in real-time.

### 4. Compilation & Export
*   Click **Export Video** in the top navigation bar.
*   Specify your target output path (e.g., the default dynamic relative path `temp/export.mp4` or a custom absolute path).
*   Click **Start Compile** to watch the progress modal stream active frame percentages and compression details directly from our FFmpeg compiler threads.

---

## 🗺️ Future Roadmap

*   [ ] **Real-Time Voice Conversion (RVC)**: Integrated neural voice-changing modules for live timeline track modeling.
*   [ ] **Vector Waveform Caching**: Smooth vectorized canvas previews for multi-track audio assets.
*   [ ] **Collab Editing Channels**: Peer-to-peer timeline sync networks utilizing WebRTC datachannels.
*   [ ] **Shader-Based Effects Panel**: Custom WebGL transitions, light-leak overlays, and cinematic LUT filters.

---

## 🤝 Credits & Attributions

`simple-edit` stands on the shoulders of these outstanding open-source libraries:

*   **[Tauri](https://tauri.app/)** - Security-focused, lightweight Rust-to-Webview desktop framework.
*   **[FFmpeg](https://ffmpeg.org/)** - The ultimate CLI multimedia transcoding and filtergraph engine.
*   **[Whisper.cpp](https://github.com/ggerganov/whisper.cpp)** - High-performance C++ inference engine for OpenAI's Whisper model.
*   **[Stable-Diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp)** - C++ Stable Diffusion generator utilizing Vulkan, CUDA, and CPU backends.
*   **[Meta Demucs](https://github.com/facebookresearch/demucs)** - State-of-the-art music source separation neural network.
*   **[Librosa](https://librosa.org/)** - Standard python package for acoustic feature extraction and beat tracking.
*   **[Micromamba](https://mamba.readthedocs.io/en/latest/user_guide/micromamba.html)** - Ultra-fast, isolated Conda package manager.
*   **[Zustand](https://github.com/pmndrs/zustand)** - Minimalist, fast, and scalable React state management hook.

---

## 📄 License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.
