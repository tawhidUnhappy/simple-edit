use tokio::process::Command;
use tauri::{AppHandle, Emitter};
use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
pub struct WaveformProgress {
    pub clip_id: String,
    pub status: String, // "processing", "completed", "failed"
    pub waveform_path: Option<String>,
    pub error: Option<String>,
}

pub async fn generate_waveform_in_background(
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
        let waveforms_dir = cwd.join("temp/waveforms");

        if let Err(e) = std::fs::create_dir_all(&waveforms_dir) {
            emit_error(app_clone, clip_id_clone, format!("Failed to create waveforms directory: {}", e));
            return;
        }

        let output_filename = format!("{}.json", clip_id_clone);
        let output_path = waveforms_dir.join(&output_filename);
        let absolute_output_path = output_path.to_string_lossy().to_string();

        // Emit starting progress
        let _ = app_clone.emit("waveform-progress", WaveformProgress {
            clip_id: clip_id_clone.clone(),
            status: "processing".to_string(),
            waveform_path: None,
            error: None,
        });

        // Run isolated FFmpeg command to extract 8-bit unsigned PCM at 100Hz directly to stdout
        let output = Command::new(&ffmpeg_path)
            .args(&[
                "-i", &input_file_path,
                "-ac", "1",          // mono
                "-f", "u8",          // 8-bit unsigned integers
                "-ar", "100",        // 100 samples per second
                "-",                 // output to stdout
            ])
            .output()
            .await;

        match output {
            Ok(out) => {
                if out.status.success() {
                    // Extract PCM bytes, each byte represents a sample from 0 to 255
                    // Let's normalize it to numbers between -1.0 and 1.0 (or just scale to 0.0 - 1.0)
                    let samples: Vec<f32> = out.stdout
                        .iter()
                        .map(|&val| {
                            // Convert 0-255 u8 to -1.0 to 1.0 f32
                            (val as f32 - 128.0) / 128.0
                        })
                        .collect();

                    // Save the float list as JSON
                    match serde_json::to_string(&samples) {
                        Ok(json_str) => {
                            if let Err(e) = std::fs::write(&output_path, json_str) {
                                emit_error(app_clone, clip_id_clone, format!("Failed to write waveform file: {}", e));
                            } else {
                                let _ = app_clone.emit("waveform-progress", WaveformProgress {
                                    clip_id: clip_id_clone,
                                    status: "completed".to_string(),
                                    waveform_path: Some(absolute_output_path),
                                    error: None,
                                });
                            }
                        }
                        Err(e) => {
                            emit_error(app_clone, clip_id_clone, format!("Failed to serialize PCM samples: {}", e));
                        }
                    }
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
    let _ = app.emit("waveform-progress", ProxyProgress {
        clip_id,
        status: "failed".to_string(),
        proxy_path: None,
        error: Some(error_msg),
    });
}

// Helper struct duplicate just for compile safety if required
#[derive(Serialize, Clone, Debug)]
struct ProxyProgress {
    clip_id: String,
    status: String,
    proxy_path: Option<String>,
    error: Option<String>,
}
