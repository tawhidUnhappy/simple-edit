use std::process::Command;
use serde::{Serialize, Deserialize};
use sysinfo::System;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HardwareInfo {
    pub gpu_brand: String, // "NVIDIA", "AMD", "Intel", or "CPU"
    pub gpu_name: String,
    pub vram_total_mb: u64,
    pub nvidia_driver_version: Option<String>,
    pub cpu_cores: usize,
    pub system_ram_gb: u64,
}

pub fn detect_hardware() -> HardwareInfo {
    let mut sys = System::new_all();
    sys.refresh_all();

    let cpu_cores = sys.cpus().len();
    let system_ram_gb = sys.total_memory() / (1024 * 1024 * 1024); // sysinfo total_memory is in bytes

    // Default to CPU mode
    let mut gpu_brand = "CPU".to_string();
    let mut gpu_name = "Generic CPU / Fallback".to_string();
    let mut vram_total_mb = 0;
    let mut nvidia_driver_version = None;

    // Check if nvidia-smi works and query the GPU info
    let output = Command::new("nvidia-smi")
        .args(&[
            "--query-gpu=gpu_name,memory.total,driver_version",
            "--format=csv,noheader,nounits",
        ])
        .output();

    if let Ok(out) = output {
        if out.status.success() {
            if let Ok(stdout_str) = String::from_utf8(out.stdout) {
                let parts: Vec<&str> = stdout_str.split(',').map(|s| s.trim()).collect();
                if parts.len() >= 3 {
                    gpu_brand = "NVIDIA".to_string();
                    gpu_name = parts[0].to_string();
                    vram_total_mb = parts[1].parse::<u64>().unwrap_or(0);
                    nvidia_driver_version = Some(parts[2].to_string());
                }
            }
        }
    }

    // Fallback detection for AMD/Intel or if nvidia-smi failed but nvidia modules exist
    if gpu_brand == "CPU" {
        // Try reading proc nvidia version just in case
        if std::path::Path::new("/proc/driver/nvidia/version").exists() {
            gpu_brand = "NVIDIA".to_string();
            gpu_name = "NVIDIA GPU (nvidia-smi unavailable)".to_string();
            if let Ok(contents) = std::fs::read_to_string("/proc/driver/nvidia/version") {
                if let Some(pos) = contents.find("NVRM version:") {
                    let version_str: String = contents[pos..]
                        .split_whitespace()
                        .nth(5) // Extract version like 595.71.05
                        .unwrap_or("")
                        .to_string();
                    if !version_str.is_empty() {
                        nvidia_driver_version = Some(version_str);
                    }
                }
            }
        } else {
            // Check for AMD/Intel graphics cards by listing /sys/class/drm/
            // and checking if any vendor devices match
            if let Ok(entries) = std::fs::read_dir("/sys/class/drm") {
                for entry in entries.filter_map(Result::ok) {
                    let path = entry.path();
                    // Just look for card0, card1, etc. and check their device vendor
                    if let Some(filename) = path.file_name().and_then(|f| f.to_str()) {
                        if filename.starts_with("card") && !filename.contains("-") {
                            let vendor_path = path.join("device/vendor");
                            if let Ok(vendor_hex) = std::fs::read_to_string(vendor_path) {
                                let vendor_clean = vendor_hex.trim().to_lowercase();
                                if vendor_clean.contains("0x1002") || vendor_clean.contains("amd") {
                                    gpu_brand = "AMD".to_string();
                                    gpu_name = "AMD Radeon GPU".to_string();
                                    vram_total_mb = 4096; // Placeholder/Estimated fallback
                                    break;
                                } else if vendor_clean.contains("0x8086") || vendor_clean.contains("intel") {
                                    gpu_brand = "Intel".to_string();
                                    gpu_name = "Intel HD/Arc Graphics".to_string();
                                    vram_total_mb = 2048; // Placeholder/Estimated fallback
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    HardwareInfo {
        gpu_brand,
        gpu_name,
        vram_total_mb,
        nvidia_driver_version,
        cpu_cores,
        system_ram_gb,
    }
}
