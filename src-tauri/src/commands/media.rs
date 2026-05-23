use std::path::Path;
use serde::{Serialize, Deserialize};
use tauri::{AppHandle, command};
use uuid::Uuid;
use crate::video::metadata::get_video_metadata;
use crate::video::proxy::generate_proxy_in_background;
use crate::video::waveform::generate_waveform_in_background;
use crate::video::thumbnails::generate_thumbnails_in_background;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MediaFile {
    pub id: String,
    pub name: String,
    #[serde(rename = "filePath")]
    pub file_path: String,
    pub duration: f64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    #[serde(rename = "hasAudio")]
    pub has_audio: bool,
    #[serde(rename = "sizeBytes")]
    pub size_bytes: u64,
    #[serde(rename = "thumbnailPath")]
    pub thumbnail_path: Option<String>,
    #[serde(rename = "waveformPath")]
    pub waveform_path: Option<String>,
    #[serde(rename = "proxyPath")]
    pub proxy_path: Option<String>,
}

#[command]
pub async fn import_media_file(
    app: AppHandle,
    file_path: String,
) -> Result<MediaFile, String> {
    // 1. Validate file path
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("File does not exist: {}", file_path));
    }

    let name = path.file_name()
        .and_then(|f| f.to_str())
        .unwrap_or("unknown")
        .to_string();

    // 2. Fetch metadata using isolated FFprobe
    let metadata = get_video_metadata(&file_path)?;

    // 3. Generate unique clip id
    let clip_id = Uuid::new_v4().to_string();

    // 4. Detect file category by extension
    let ext = path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    let is_image = matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "svg");
    let is_video = !is_image && metadata.width.is_some();
    let is_audio_only = !is_image && !is_video && metadata.has_audio;

    // 5. Spawn appropriate background tasks based on file type
    // Proxy: video files only (not images or audio-only)
    if is_video {
        generate_proxy_in_background(app.clone(), clip_id.clone(), file_path.clone()).await;
    }

    // Waveform: audio-containing, non-image files
    if metadata.has_audio && !is_image {
        generate_waveform_in_background(app.clone(), clip_id.clone(), file_path.clone()).await;
    }

    // Thumbnails: video files only
    if is_video {
        generate_thumbnails_in_background(app.clone(), clip_id.clone(), file_path.clone()).await;
    }
    let _ = is_audio_only; // suppress unused warning

    // Return the media item immediately (UI will update details once background tasks emit finish events)
    Ok(MediaFile {
        id: clip_id,
        name,
        file_path,
        duration: metadata.duration,
        width: metadata.width,
        height: metadata.height,
        has_audio: metadata.has_audio,
        size_bytes: metadata.size_bytes,
        thumbnail_path: None,
        waveform_path: None,
        proxy_path: None,
    })
}
