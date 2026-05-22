use tokio::process::Command;
use tauri::{AppHandle, Emitter};
use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
pub struct ThumbnailProgress {
    pub clip_id: String,
    pub status: String, // "processing", "completed", "failed"
    pub thumbnails_dir: Option<String>,
    pub error: Option<String>,
}

pub async fn generate_thumbnails_in_background(
    app: AppHandle,
    clip_id: String,
    input_file_path: String,
) {
    let app_clone = app.clone();
    let clip_id_clone = clip_id.clone();

    tokio::spawn(async move {
        let root = match crate::utils::paths::workspace_root() {
            Ok(r) => r,
            Err(e) => {
                emit_error(app_clone, clip_id_clone, e);
                return;
            }
        };

        let ffmpeg_path = root.join("bin/ffmpeg");
        let clip_thumbnails_dir = root.join("temp/thumbnails").join(&clip_id_clone);

        if let Err(e) = std::fs::create_dir_all(&clip_thumbnails_dir) {
            emit_error(app_clone, clip_id_clone, format!("Failed to create clip thumbnail directory: {}", e));
            return;
        }

        let absolute_output_dir = clip_thumbnails_dir.to_string_lossy().to_string();

        // Notify UI that we are starting processing
        let _ = app_clone.emit("thumbnail-progress", ThumbnailProgress {
            clip_id: clip_id_clone.clone(),
            status: "processing".to_string(),
            thumbnails_dir: None,
            error: None,
        });

        // Run isolated FFmpeg to extract frames at 1fps
        // -vf fps=1: scale to width 120 and keep aspect ratio (-1)
        let output = Command::new(&ffmpeg_path)
            .args(&[
                "-y",
                "-i", &input_file_path,
                "-vf", "fps=1,scale=120:-1",
                format!("{}/thumb_%04d.jpg", clip_thumbnails_dir.to_str().unwrap_or("")).as_str(),
            ])
            .output()
            .await;

        match output {
            Ok(out) => {
                if out.status.success() {
                    let _ = app_clone.emit("thumbnail-progress", ThumbnailProgress {
                        clip_id: clip_id_clone,
                        status: "completed".to_string(),
                        thumbnails_dir: Some(absolute_output_dir),
                        error: None,
                    });
                } else {
                    let err_str = String::from_utf8_lossy(&out.stderr).to_string();
                    emit_error(app_clone, clip_id_clone, format!("FFmpeg failed: {}", err_str));
                }
            }
            Err(e) => {
                emit_error(app_clone, clip_id_clone, format!("Failed to spawn FFmpeg: {}", e));
            }
        }
    });
}

fn emit_error(app: AppHandle, clip_id: String, error_msg: String) {
    let _ = app.emit("thumbnail-progress", ThumbnailProgress {
        clip_id,
        status: "failed".to_string(),
        thumbnails_dir: None,
        error: Some(error_msg),
    });
}
