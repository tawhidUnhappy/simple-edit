use std::process::Command;
use serde::{Serialize, Deserialize};
use crate::utils::hardware::{detect_hardware, HardwareInfo};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SystemStatus {
    pub hardware: HardwareInfo,
    pub micromamba_exists: bool,
    pub conda_env_exists: bool,
    pub python_working: bool,
    pub python_version: String,
    pub pytorch_cuda_available: bool,
    pub pytorch_cuda_device: String,
    pub ffmpeg_exists: bool,
    pub ffmpeg_version: String,
}

#[tauri::command]
pub async fn check_system_status() -> Result<SystemStatus, String> {
    // 1. Detect hardware
    let hardware = detect_hardware();

    // 2. Resolve paths relative to current working directory
    let cwd = std::env::current_dir().map_err(|e| format!("Failed to get CWD: {}", e))?;
    
    let micromamba_path = cwd.join("bin/micromamba");
    let conda_env_path = cwd.join("conda_env");
    let ffmpeg_path = cwd.join("bin/ffmpeg");

    let micromamba_exists = micromamba_path.exists();
    let conda_env_exists = conda_env_path.exists();
    let ffmpeg_exists = ffmpeg_path.exists();

    let mut python_working = false;
    let mut python_version = "Not Available".to_string();
    let mut pytorch_cuda_available = false;
    let mut pytorch_cuda_device = "".to_string();
    let mut ffmpeg_version = "Not Available".to_string();

    // If micromamba & conda_env exist, run check scripts
    if micromamba_exists && conda_env_exists {
        // Check Python version
        let py_ver_output = Command::new(&micromamba_path)
            .args(&[
                "run",
                "-p",
                conda_env_path.to_str().unwrap_or(""),
                "python",
                "--version",
            ])
            .output();

        if let Ok(out) = py_ver_output {
            if out.status.success() {
                python_working = true;
                let full_str = String::from_utf8(out.stdout).unwrap_or_default();
                python_version = full_str.trim().to_string();
                if python_version.is_empty() {
                    // Python --version sometimes prints to stderr
                    let err_str = String::from_utf8(out.stderr).unwrap_or_default();
                    python_version = err_str.trim().to_string();
                }
            }
        }

        // Check PyTorch and CUDA availability
        // We write a tiny python snippet to check CUDA
        let py_torch_code = "import torch; print(f'{torch.__version__}|{torch.cuda.is_available()}|{torch.cuda.get_device_name(0) if torch.cuda.is_available() else \"\"}')";
        let py_torch_output = Command::new(&micromamba_path)
            .args(&[
                "run",
                "-p",
                conda_env_path.to_str().unwrap_or(""),
                "python",
                "-c",
                py_torch_code,
            ])
            .output();

        if let Ok(out) = py_torch_output {
            if out.status.success() {
                let full_str = String::from_utf8(out.stdout).unwrap_or_default();
                let parts: Vec<&str> = full_str.trim().split('|').collect();
                if parts.len() >= 3 {
                    pytorch_cuda_available = parts[1] == "True";
                    pytorch_cuda_device = parts[2].to_string();
                }
            }
        }
    }

    // Check FFmpeg version
    if ffmpeg_exists {
        let ffmpeg_output = Command::new(&ffmpeg_path)
            .arg("-version")
            .output();

        if let Ok(out) = ffmpeg_output {
            if out.status.success() {
                let full_str = String::from_utf8(out.stdout).unwrap_or_default();
                if let Some(line) = full_str.lines().next() {
                    // Extract version text like: "ffmpeg version 8.1.1" or similar
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 3 && parts[1] == "version" {
                        ffmpeg_version = parts[2].to_string();
                    } else if parts.len() >= 2 {
                        ffmpeg_version = parts[1].to_string();
                    } else {
                        ffmpeg_version = line.to_string();
                    }
                }
            }
        }
    }

    Ok(SystemStatus {
        hardware,
        micromamba_exists,
        conda_env_exists,
        python_working,
        python_version,
        pytorch_cuda_available,
        pytorch_cuda_device,
        ffmpeg_exists,
        ffmpeg_version,
    })
}
