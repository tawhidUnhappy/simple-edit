use std::path::PathBuf;

/// Finds the workspace root (the directory containing `bin/`, `conda_env/`, etc.).
///
/// In `tauri dev` the binary's CWD is `src-tauri/`, not the project root.
/// In an AppImage the runtime sets `APPDIR` to the mount root.
/// This function checks all three cases so callers never need to care about the
/// launch context.
pub fn workspace_root() -> Result<PathBuf, String> {
    // AppImage runtime sets APPDIR to the mount root
    if let Ok(appdir) = std::env::var("APPDIR") {
        return Ok(PathBuf::from(appdir));
    }

    let cwd = std::env::current_dir()
        .map_err(|e| format!("Failed to get working directory: {}", e))?;

    // Direct: launched from the project root (production or explicit path)
    if cwd.join("bin").is_dir() {
        return Ok(cwd);
    }

    // One level up: tauri dev sets CWD to src-tauri/
    if let Some(parent) = cwd.parent() {
        if parent.join("bin").is_dir() {
            return Ok(parent.to_path_buf());
        }
    }

    Err(format!(
        "Cannot locate workspace root (bin/ not found). CWD was: {}",
        cwd.display()
    ))
}
