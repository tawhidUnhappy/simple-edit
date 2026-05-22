use std::process::Command;
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VideoMetadata {
    pub duration: f64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub has_audio: bool,
    pub size_bytes: u64,
}

pub fn get_video_metadata(file_path: &str) -> Result<VideoMetadata, String> {
    let root = crate::utils::paths::workspace_root()?;
    let ffprobe_path = root.join("bin/ffprobe");

    if !ffprobe_path.exists() {
        return Err(format!("ffprobe not found at {:?}. Run setup.sh first.", ffprobe_path));
    }

    // Call ffprobe to fetch format info in JSON
    let output = Command::new(&ffprobe_path)
        .args(&[
            "-v", "error",
            "-show_format",
            "-show_streams",
            "-of", "json",
            file_path,
        ])
        .output()
        .map_err(|e| format!("Failed to execute ffprobe: {}", e))?;

    if !output.status.success() {
        let err_str = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("ffprobe error: {}", err_str));
    }

    let stdout_str = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value = serde_json::from_str(&stdout_str)
        .map_err(|e| format!("Failed to parse ffprobe json: {}", e))?;

    // Parse duration
    let duration_str = parsed["format"]["duration"].as_str().unwrap_or("0.0");
    let duration = duration_str.parse::<f64>().unwrap_or(0.0);

    // Parse size
    let size_str = parsed["format"]["size"].as_str().unwrap_or("0");
    let size_bytes = size_str.parse::<u64>().unwrap_or(0);

    // Parse streams
    let mut width = None;
    let mut height = None;
    let mut has_audio = false;

    if let Some(streams) = parsed["streams"].as_array() {
        for stream in streams {
            let codec_type = stream["codec_type"].as_str().unwrap_or("");
            if codec_type == "video" {
                if let Some(w) = stream["width"].as_u64() {
                    width = Some(w as u32);
                }
                if let Some(h) = stream["height"].as_u64() {
                    height = Some(h as u32);
                }
            } else if codec_type == "audio" {
                has_audio = true;
            }
        }
    }

    Ok(VideoMetadata {
        duration,
        width,
        height,
        has_audio,
        size_bytes,
    })
}
