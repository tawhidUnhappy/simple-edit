// Declare modules
pub mod utils;
pub mod commands;
pub mod video;
pub mod engines;

use commands::download::DownloadManager;
use commands::python_server::PythonServerState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(DownloadManager::new())
        .manage(PythonServerState::new())
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap::check_system_status,
            commands::download::resolve_civitai_url,
            commands::download::start_download,
            commands::download::pause_download,
            commands::download::resume_download,
            commands::download::cancel_download,
            commands::download::list_local_models,
            commands::updater::update_tool_repo,
            commands::media::import_media_file,
            commands::python_server::get_python_server_port,
            commands::timeline::export_project,
            engines::whisper::transcribe_video,
            engines::sd::generate_sd_image
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.try_state::<PythonServerState>() {
                    commands::python_server::kill_python_server(&state);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
