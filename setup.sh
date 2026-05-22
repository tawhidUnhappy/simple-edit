#!/bin/bash
set -e

WORKSPACE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "=== Starting simple-edit Setup ==="
echo "Workspace: $WORKSPACE"

# 1. Create directory structure
mkdir -p "$WORKSPACE/bin"
mkdir -p "$WORKSPACE/models"
mkdir -p "$WORKSPACE/python"
mkdir -p "$WORKSPACE/temp"
mkdir -p "$WORKSPACE/temp/downloads"

# 2. Download and unpack isolated Node.js
if [ ! -d "$WORKSPACE/bin/node" ]; then
    echo "Downloading isolated Node.js v22.22.3..."
    curl -L "https://nodejs.org/dist/v22.22.3/node-v22.22.3-linux-x64.tar.xz" -o "$WORKSPACE/temp/downloads/node.tar.xz"
    
    echo "Extracting Node.js..."
    mkdir -p "$WORKSPACE/bin/node_temp"
    tar -xJf "$WORKSPACE/temp/downloads/node.tar.xz" -C "$WORKSPACE/bin/node_temp" --strip-components=1
    mv "$WORKSPACE/bin/node_temp" "$WORKSPACE/bin/node"
    rm "$WORKSPACE/temp/downloads/node.tar.xz"
    echo "Node.js successfully isolated in bin/node"
else
    echo "Node.js is already installed in bin/node"
fi

export PATH="$WORKSPACE/bin/node/bin:$PATH"
echo "Node version: $(node --version)"
echo "NPM version: $(npm --version)"

# 3. Download and unpack Micromamba
if [ ! -f "$WORKSPACE/bin/micromamba" ]; then
    echo "Downloading Micromamba..."
    curl -L "https://micro.mamba.pm/api/micromamba/linux-64/latest" -o "$WORKSPACE/temp/downloads/micromamba.tar.bz2"
    echo "Extracting Micromamba..."
    tar -xvjf "$WORKSPACE/temp/downloads/micromamba.tar.bz2" -C "$WORKSPACE/bin" bin/micromamba
    # Move out of bin/bin if it got extracted there
    if [ -f "$WORKSPACE/bin/bin/micromamba" ]; then
        mv "$WORKSPACE/bin/bin/micromamba" "$WORKSPACE/bin/micromamba"
        rm -rf "$WORKSPACE/bin/bin"
    fi
    chmod +x "$WORKSPACE/bin/micromamba"
    rm "$WORKSPACE/temp/downloads/micromamba.tar.bz2"
    echo "Micromamba downloaded and extracted successfully."
else
    echo "Micromamba already exists in bin/micromamba"
fi

echo "Micromamba version: $("$WORKSPACE/bin/micromamba" --version)"

# 4. Create isolated Conda Environment and install python + ffmpeg + server dependencies
if [ ! -d "$WORKSPACE/conda_env" ]; then
    echo "Initializing Conda Environment inside ./conda_env..."
    # We install python=3.10, ffmpeg, fastapi, uvicorn, pydantic, numpy, soundfile, librosa, and pillow via conda-forge
    "$WORKSPACE/bin/micromamba" create -p "$WORKSPACE/conda_env" python=3.10 ffmpeg fastapi uvicorn pydantic numpy soundfile librosa pillow -c conda-forge --yes
    echo "Conda environment created successfully."
else
    echo "Conda environment already exists in ./conda_env"
fi

# 5. Create symbolic links for ffmpeg and ffprobe in bin/
if [ ! -f "$WORKSPACE/bin/ffmpeg" ]; then
    ln -s "$WORKSPACE/conda_env/bin/ffmpeg" "$WORKSPACE/bin/ffmpeg"
    echo "Created symlink bin/ffmpeg -> conda_env/bin/ffmpeg"
fi

if [ ! -f "$WORKSPACE/bin/ffprobe" ]; then
    ln -s "$WORKSPACE/conda_env/bin/ffprobe" "$WORKSPACE/bin/ffprobe"
    echo "Created symlink bin/ffprobe -> conda_env/bin/ffprobe"
fi

# Verify symlink execution
echo "Isolated FFmpeg version:"
"$WORKSPACE/bin/ffmpeg" -version | head -n 1

echo "=== Setup complete! Isolated workspace initialized. ==="
