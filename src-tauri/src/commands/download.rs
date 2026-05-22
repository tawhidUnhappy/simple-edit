use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::time::{Instant, Duration};
use tokio::sync::Mutex;
use serde::{Serialize, Deserialize};
use tauri::{AppHandle, Emitter, State};
use reqwest::header::{HeaderMap, HeaderValue, RANGE};
use uuid::Uuid;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CivitaiFile {
    pub name: String,
    pub id: u64,
    pub size_kb: f64,
    #[serde(rename = "downloadUrl")]
    pub download_url: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CivitaiModelVersion {
    pub id: u64,
    pub name: String,
    pub files: Vec<CivitaiFile>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CivitaiModelResponse {
    pub id: u64,
    pub name: String,
    #[serde(rename = "modelVersions")]
    pub model_versions: Vec<CivitaiModelVersion>,
}

#[derive(Serialize, Clone, Debug)]
pub struct DownloadProgressPayload {
    pub task_id: String,
    pub url: String,
    pub filename: String,
    pub bytes_downloaded: u64,
    pub bytes_total: u64,
    pub speed_mb_s: f64,
    pub percent: f32,
    pub status: String, // "downloading", "paused", "completed", "failed", "cancelled"
    pub error: Option<String>,
}

pub struct ActiveDownload {
    pub url: String,
    pub dest_path: String,
    pub filename: String,
    pub is_paused: Arc<AtomicBool>,
    pub is_cancelled: Arc<AtomicBool>,
}

pub struct DownloadManager {
    pub tasks: Mutex<HashMap<String, ActiveDownload>>,
}

impl DownloadManager {
    pub fn new() -> Self {
        Self {
            tasks: Mutex::new(HashMap::new()),
        }
    }
}

// Helper to resolve Civitai URLs to a direct download URL
#[tauri::command]
pub async fn resolve_civitai_url(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("simple-edit-downloader/1.0")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    // Parse model ID or model version ID from URL
    // Examples:
    // https://civitai.com/models/9409/or-anything-xl
    // https://civitai.com/models/9409?modelVersionId=12345
    let mut model_id = None;
    let mut version_id = None;

    if let Ok(parsed_url) = reqwest::Url::parse(&url) {
        // Check for modelVersionId query param
        for (key, val) in parsed_url.query_pairs() {
            if key == "modelVersionId" {
                version_id = val.parse::<u64>().ok();
            }
        }

        // Check for model ID in path segments
        let segments: Vec<&str> = parsed_url.path_segments()
            .map(|s| s.collect())
            .unwrap_or_default();
        
        // Find index of "models" and get the next segment
        if let Some(pos) = segments.iter().position(|&x| x == "models") {
            if pos + 1 < segments.len() {
                model_id = segments[pos + 1].parse::<u64>().ok();
            }
        }
    }

    if let Some(vid) = version_id {
        // Direct model version API
        let api_url = format!("https://civitai.com/api/v1/model-versions/{}", vid);
        let resp = client.get(&api_url)
            .send()
            .await
            .map_err(|e| format!("Civitai API request failed: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("Civitai API returned error status: {}", resp.status()));
        }

        let version_info: CivitaiModelVersion = resp.json()
            .await
            .map_err(|e| format!("Failed to parse Civitai API response: {}", e))?;

        // Find primary .safetensors or largest file
        if let Some(file) = version_info.files.iter().find(|f| f.name.ends_with(".safetensors")) {
            return Ok(file.download_url.clone());
        } else if let Some(file) = version_info.files.first() {
            return Ok(file.download_url.clone());
        }
    } else if let Some(mid) = model_id {
        // General model API, fetch latest version
        let api_url = format!("https://civitai.com/api/v1/models/{}", mid);
        let resp = client.get(&api_url)
            .send()
            .await
            .map_err(|e| format!("Civitai API request failed: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("Civitai API returned error status: {}", resp.status()));
        }

        let model_info: CivitaiModelResponse = resp.json()
            .await
            .map_err(|e| format!("Failed to parse Civitai API response: {}", e))?;

        if let Some(latest_version) = model_info.model_versions.first() {
            if let Some(file) = latest_version.files.iter().find(|f| f.name.ends_with(".safetensors")) {
                return Ok(file.download_url.clone());
            } else if let Some(file) = latest_version.files.first() {
                return Ok(file.download_url.clone());
            }
        }
    }

    // If parsing failed or we can't find it, return the original URL (it might be a direct link already)
    Ok(url)
}

#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    manager: State<'_, DownloadManager>,
    url: String,
    dest_relative_path: String,
    task_id_opt: Option<String>,
) -> Result<String, String> {
    let task_id = task_id_opt.unwrap_or_else(|| Uuid::new_v4().to_string());
    
    // Resolve absolute path in workspace
    let cwd = std::env::current_dir().map_err(|e| format!("Failed to get CWD: {}", e))?;
    let absolute_dest = cwd.join(&dest_relative_path);

    // Create target directory if it doesn't exist
    if let Some(parent) = absolute_dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directories: {}", e))?;
    }

    let filename = absolute_dest.file_name()
        .and_then(|f| f.to_str())
        .unwrap_or("model.bin")
        .to_string();

    let is_paused = Arc::new(AtomicBool::new(false));
    let is_cancelled = Arc::new(AtomicBool::new(false));

    // Register active download
    let active_task = ActiveDownload {
        url: url.clone(),
        dest_path: dest_relative_path.clone(),
        filename: filename.clone(),
        is_paused: is_paused.clone(),
        is_cancelled: is_cancelled.clone(),
    };

    {
        let mut tasks = manager.tasks.lock().await;
        tasks.insert(task_id.clone(), active_task);
    }

    // Spawn download in background thread
    let task_id_clone = task_id.clone();
    let url_clone = url.clone();
    let absolute_dest_clone = absolute_dest.clone();
    let app_clone = app.clone();

    tokio::spawn(async move {
        let result = perform_resumable_download(
            app_clone.clone(),
            task_id_clone.clone(),
            url_clone,
            absolute_dest_clone,
            filename,
            is_paused,
            is_cancelled,
        ).await;

        if let Err(e) = result {
            let _ = app_clone.emit("download-progress", DownloadProgressPayload {
                task_id: task_id_clone,
                url: url.clone(),
                filename: dest_relative_path,
                bytes_downloaded: 0,
                bytes_total: 0,
                speed_mb_s: 0.0,
                percent: 0.0,
                status: "failed".to_string(),
                error: Some(e),
            });
        }
    });

    Ok(task_id)
}

#[tauri::command]
pub async fn pause_download(
    manager: State<'_, DownloadManager>,
    task_id: String,
) -> Result<(), String> {
    let tasks = manager.tasks.lock().await;
    if let Some(task) = tasks.get(&task_id) {
        task.is_paused.store(true, Ordering::SeqCst);
        Ok(())
    } else {
        Err("Download task not found".to_string())
    }
}

#[tauri::command]
pub async fn resume_download(
    app: AppHandle,
    manager: State<'_, DownloadManager>,
    task_id: String,
) -> Result<(), String> {
    let mut tasks = manager.tasks.lock().await;
    if let Some(task) = tasks.remove(&task_id) {
        // Restart the download (perform_resumable_download will resume writing)
        let is_paused = Arc::new(AtomicBool::new(false));
        let is_cancelled = Arc::new(AtomicBool::new(false));
        
        let url = task.url.clone();
        let dest_relative_path = task.dest_path.clone();
        let filename = task.filename.clone();

        let cwd = std::env::current_dir().map_err(|e| format!("Failed to get CWD: {}", e))?;
        let absolute_dest = cwd.join(&dest_relative_path);

        let active_task = ActiveDownload {
            url: url.clone(),
            dest_path: dest_relative_path.clone(),
            filename: filename.clone(),
            is_paused: is_paused.clone(),
            is_cancelled: is_cancelled.clone(),
        };

        tasks.insert(task_id.clone(), active_task);

        let task_id_clone = task_id.clone();
        let app_clone = app.clone();

        tokio::spawn(async move {
            let result = perform_resumable_download(
                app_clone.clone(),
                task_id_clone.clone(),
                url,
                absolute_dest,
                filename,
                is_paused,
                is_cancelled,
            ).await;

            if let Err(e) = result {
                let _ = app_clone.emit("download-progress", DownloadProgressPayload {
                    task_id: task_id_clone,
                    url: "".to_string(),
                    filename: dest_relative_path,
                    bytes_downloaded: 0,
                    bytes_total: 0,
                    speed_mb_s: 0.0,
                    percent: 0.0,
                    status: "failed".to_string(),
                    error: Some(e),
                });
            }
        });
        Ok(())
    } else {
        Err("Download task not found".to_string())
    }
}

#[tauri::command]
pub async fn cancel_download(
    manager: State<'_, DownloadManager>,
    task_id: String,
) -> Result<(), String> {
    let mut tasks = manager.tasks.lock().await;
    if let Some(task) = tasks.remove(&task_id) {
        task.is_cancelled.store(true, Ordering::SeqCst);
        Ok(())
    } else {
        Err("Download task not found".to_string())
    }
}

// Perform download with support for pause, cancellation, and range-based resumes
async fn perform_resumable_download(
    app: AppHandle,
    task_id: String,
    url: String,
    dest_path: PathBuf,
    filename: String,
    is_paused: Arc<AtomicBool>,
    is_cancelled: Arc<AtomicBool>,
) -> Result<(), String> {
    let part_path = dest_path.with_extension("part");

    // Check current size of local .part file
    let mut start_bytes = 0;
    if part_path.exists() {
        if let Ok(metadata) = std::fs::metadata(&part_path) {
            start_bytes = metadata.len();
        }
    }

    let client = reqwest::Client::builder()
        .user_agent("simple-edit-downloader/1.0")
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))?;

    // Prepare range headers if we have existing progress
    let mut headers = HeaderMap::new();
    if start_bytes > 0 {
        let range_header = HeaderValue::from_str(&format!("bytes={}-", start_bytes))
            .map_err(|_| "Invalid range header".to_string())?;
        headers.insert(RANGE, range_header);
    }

    let mut response = client.get(&url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    let status = response.status();
    let is_partial = status == reqwest::StatusCode::PARTIAL_CONTENT;

    // Determine total bytes
    let content_length = response.content_length().unwrap_or(0);
    let bytes_total = if is_partial {
        start_bytes + content_length
    } else {
        content_length
    };

    // Open file to write/append
    let mut file = if is_partial && start_bytes > 0 {
        OpenOptions::new()
            .write(true)
            .append(true)
            .open(&part_path)
            .map_err(|e| format!("Failed to open part file for append: {}", e))?
    } else {
        start_bytes = 0;
        OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&part_path)
            .map_err(|e| format!("Failed to create part file: {}", e))?
    };

    let mut bytes_downloaded = start_bytes;
    let mut last_emit = Instant::now();
    let mut speed_instant = Instant::now();
    let mut speed_bytes = 0;
    let mut speed_mb_s = 0.0;

    // Process stream chunks
    while let Some(chunk) = response.chunk().await.map_err(|e| format!("Failed to read chunk: {}", e))? {
        if is_cancelled.load(Ordering::SeqCst) {
            let _ = app.emit("download-progress", DownloadProgressPayload {
                task_id: task_id.clone(),
                url: url.clone(),
                filename: filename.clone(),
                bytes_downloaded,
                bytes_total,
                speed_mb_s: 0.0,
                percent: (bytes_downloaded as f32 / bytes_total as f32) * 100.0,
                status: "cancelled".to_string(),
                error: None,
            });
            let _ = std::fs::remove_file(&part_path);
            return Ok(());
        }

        if is_paused.load(Ordering::SeqCst) {
            let _ = app.emit("download-progress", DownloadProgressPayload {
                task_id: task_id.clone(),
                url: url.clone(),
                filename: filename.clone(),
                bytes_downloaded,
                bytes_total,
                speed_mb_s: 0.0,
                percent: (bytes_downloaded as f32 / bytes_total as f32) * 100.0,
                status: "paused".to_string(),
                error: None,
            });
            return Ok(());
        }

        file.write_all(&chunk)
            .map_err(|e| format!("Failed to write to disk: {}", e))?;

        bytes_downloaded += chunk.len() as u64;
        speed_bytes += chunk.len() as u64;

        // Calculate download speed every 1 second
        if speed_instant.elapsed() >= Duration::from_secs(1) {
            let secs = speed_instant.elapsed().as_secs_f64();
            speed_mb_s = (speed_bytes as f64 / (1024.0 * 1024.0)) / secs;
            speed_bytes = 0;
            speed_instant = Instant::now();
        }

        // Emit progress every 100ms
        if last_emit.elapsed() >= Duration::from_millis(100) {
            let percent = if bytes_total > 0 {
                (bytes_downloaded as f32 / bytes_total as f32) * 100.0
            } else {
                0.0
            };

            let _ = app.emit("download-progress", DownloadProgressPayload {
                task_id: task_id.clone(),
                url: url.clone(),
                filename: filename.clone(),
                bytes_downloaded,
                bytes_total,
                speed_mb_s,
                percent,
                status: "downloading".to_string(),
                error: None,
            });

            last_emit = Instant::now();
        }
    }

    // Flush and rename file to final destination on success
    file.sync_all().map_err(|e| format!("Failed to sync file: {}", e))?;
    drop(file);

    std::fs::rename(&part_path, &dest_path)
        .map_err(|e| format!("Failed to rename final downloaded file: {}", e))?;

    // Emit complete status
    let _ = app.emit("download-progress", DownloadProgressPayload {
        task_id: task_id.clone(),
        url: url.clone(),
        filename: filename.clone(),
        bytes_downloaded: bytes_total,
        bytes_total,
        speed_mb_s: 0.0,
        percent: 100.0,
        status: "completed".to_string(),
        error: None,
    });

    Ok(())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LocalModelInfo {
    pub name: String,
    pub size: String,
    pub path: String,
    pub model_type: String,
}

#[tauri::command]
pub async fn list_local_models() -> Result<Vec<LocalModelInfo>, String> {
    let cwd = std::env::current_dir().map_err(|e| format!("Failed to get CWD: {}", e))?;
    let models_dir = cwd.join("models");
    
    if !models_dir.exists() {
        return Ok(Vec::new());
    }

    let mut list = Vec::new();
    let subdirs = vec!["stable-diffusion", "whisper", "tts", "rvc"];
    
    for subdir in subdirs {
        let path = models_dir.join(subdir);
        if !path.exists() {
            continue;
        }

        if let Ok(entries) = std::fs::read_dir(path) {
            for entry in entries.filter_map(Result::ok) {
                let file_path = entry.path();
                if file_path.is_file() {
                    let file_name = file_path.file_name().unwrap_or_default().to_string_lossy().to_string();
                    if file_name.starts_with('.') {
                        continue;
                    }
                    let metadata = entry.metadata().ok();
                    let size_bytes = metadata.map(|m| m.len()).unwrap_or(0);
                    let size_str = if size_bytes > 1024 * 1024 * 1024 {
                        format!("{:.2} GB", size_bytes as f64 / (1024.0 * 1024.0 * 1024.0))
                    } else {
                        format!("{:.2} MB", size_bytes as f64 / (1024.0 * 1024.0))
                    };

                    list.push(LocalModelInfo {
                        name: file_name,
                        size: size_str,
                        path: format!("models/{}/{}", subdir, file_path.file_name().unwrap().to_string_lossy()),
                        model_type: subdir.to_string(),
                    });
                }
            }
        }
    }

    Ok(list)
}
