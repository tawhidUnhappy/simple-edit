use std::fs;
use std::path::Path;
use tauri::{AppHandle, Manager};

const WORKSPACE_FILE: &str = "workspace_path.txt";

fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_workspace_dir(app: AppHandle) -> Result<Option<String>, String> {
    let data_dir = app_data_dir(&app)?;
    let p = data_dir.join(WORKSPACE_FILE);
    if p.exists() {
        let s = fs::read_to_string(&p).map_err(|e| e.to_string())?;
        let s = s.trim().to_string();
        if !s.is_empty() {
            return Ok(Some(s));
        }
    }
    Ok(None)
}

#[tauri::command]
pub fn set_workspace_dir(app: AppHandle, path: String) -> Result<(), String> {
    let data_dir = app_data_dir(&app)?;
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    fs::write(data_dir.join(WORKSPACE_FILE), &path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn save_project_file(path: String, json: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    fs::write(&path, json.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_project_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn file_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
pub fn delete_project_file(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.exists() {
        if p.is_file() {
            fs::remove_file(p).map_err(|e| e.to_string())?;
            Ok(())
        } else {
            Err("Target path is not a file".to_string())
        }
    } else {
        Err("File does not exist".to_string())
    }
}

