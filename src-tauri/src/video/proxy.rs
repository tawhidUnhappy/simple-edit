use tokio::process::Command;
use tauri::{AppHandle, Emitter};
use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
pub struct ProxyProgress {
    pub clip_id: String,
    pub status: String, // "processing", "completed", "failed"
    pub proxy_path: Option<String>,
    pub error: Option<String>,
}

pub async fn generate_proxy_in_background(
    app: AppHandle,
    clip_id: String,
    input_file_path: String,
) {
    let app_clone = app.clone();
    let clip_id_clone = clip_id.clone();

    tokio::spawn(async move {
        let cwd = match std::env::current_dir() {
            Ok(dir) => dir,
            Err(e) => {
                emit_error(app_clone, clip_id_clone, format!("Failed to get CWD: {}", e));
                return;
            }
        };

        let ffmpeg_path = cwd.join("bin/ffmpeg");
        let proxies_dir = cwd.join("temp/proxies");

        if let Err(e) = std::fs::create_dir_all(&proxies_dir) {
            emit_error(app_clone, clip_id_clone, format!("Failed to create proxies directory: {}", e));
            return;
        }

        let output_filename = format!("{}.mp4", clip_id_clone);
        let output_path = proxies_dir.join(&output_filename);
        let absolute_output_path = output_path.to_string_lossy().to_string();

        // Notify UI that we are starting processing
        let _ = app_clone.emit("proxy-progress", ProxyProgress {
            clip_id: clip_id_clone.clone(),
            status: "processing".to_string(),
            proxy_path: None,
            error: None,
        });

        // Run isolated FFmpeg proxy downscaler command (Fast H264, 480p)
        let output = Command::new(&ffmpeg_path)
            .args(&[
                "-y", // overwrite existing
                "-i", &input_file_path,
                "-vf", "scale=-2:480",
                "-c:v", "libx264",
                "-preset", "superfast",
                "-crf", "28",
                "-c:a", "aac",
                "-b:a", "96k",
                output_path.to_str().unwrap_or(""),
            ])
            .output()
            .await;

        match output {
            Ok(out) => {
                if out.status.success() {
                    let _ = app_clone.emit("proxy-progress", ProxyProgress {
                        clip_id: clip_id_clone,
                        status: "completed".to_string(),
                        proxy_path: Some(absolute_output_path),
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
    let _ = app.emit("proxy-progress", ProxyProgress {
        clip_id,
        status: "failed".to_string(),
        proxy_path: None,
        error: Some(error_msg),
    });
}
