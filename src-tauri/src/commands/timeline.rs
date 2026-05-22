use crate::video::compiler::{Track, run_ffmpeg_export};
use tauri::{AppHandle, command};

#[command]
pub async fn export_project(
    app: AppHandle,
    tracks: Vec<Track>,
    output_path: String,
) -> Result<String, String> {
    println!("[simple-edit] Triggering timeline export to: {}", output_path);
    run_ffmpeg_export(app, tracks, output_path).await
}
