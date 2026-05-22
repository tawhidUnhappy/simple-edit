use tokio::process::Command;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone, Debug)]
pub struct GitUpdateProgress {
    pub repo_name: String,
    pub status: String, // "starting", "cloning", "pulling", "completed", "failed"
    pub log_output: String,
}

#[tauri::command]
pub async fn update_tool_repo(
    app: AppHandle,
    repo_name: String,
    git_url: String,
) -> Result<String, String> {
    let cwd = std::env::current_dir().map_err(|e| format!("Failed to get CWD: {}", e))?;
    let repos_dir = cwd.join("python/repos");
    
    // Ensure python/repos exists
    std::fs::create_dir_all(&repos_dir)
        .map_err(|e| format!("Failed to create python/repos directory: {}", e))?;

    let repo_path = repos_dir.join(&repo_name);
    let app_clone = app.clone();
    let repo_name_clone = repo_name.clone();
    let cwd_clone = cwd.clone();

    tokio::spawn(async move {
        let repo_exists = repo_path.exists();
        let status_str = if repo_exists { "pulling" } else { "cloning" };

        let _ = app_clone.emit("git-update", GitUpdateProgress {
            repo_name: repo_name_clone.clone(),
            status: "starting".to_string(),
            log_output: format!("Starting git {} action for {}", status_str, repo_name_clone),
        });

        let mut cmd = Command::new("git");
        cmd.env("GIT_CONFIG_NOSYSTEM", "1"); // Ensure absolute sandbox isolation

        if repo_exists {
            cmd.arg("-C")
               .arg(&repo_path)
               .args(&["pull", "origin", "main"]);
        } else {
            cmd.args(&["clone", &git_url])
               .arg(&repo_path);
        }

        let output = cmd.output().await;

        match output {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                let combined_log = format!("STDOUT:\n{}\nSTDERR:\n{}", stdout, stderr);

                if out.status.success() {
                    let mut log_output = combined_log;
                    let build_success = if repo_name_clone == "stable-diffusion.cpp" || repo_name_clone == "whisper.cpp" {
                        let _ = app_clone.emit("git-update", GitUpdateProgress {
                            repo_name: repo_name_clone.clone(),
                            status: "updating".to_string(), // Keep as updating, but log build start
                            log_output: format!("Git update completed successfully. Starting compilation via build_tool.sh...\n\n{}", log_output),
                        });

                        let build_status = Command::new(cwd_clone.join("bin/build_tool.sh"))
                            .arg(&repo_name_clone)
                            .output()
                            .await;

                        match build_status {
                            Ok(build_out) => {
                                let b_stdout = String::from_utf8_lossy(&build_out.stdout).to_string();
                                let b_stderr = String::from_utf8_lossy(&build_out.stderr).to_string();
                                log_output = format!("{}\n\n=== COMPILATION LOGS ===\nSTDOUT:\n{}\nSTDERR:\n{}", log_output, b_stdout, b_stderr);
                                build_out.status.success()
                            }
                            Err(e) => {
                                log_output = format!("{}\n\n=== COMPILATION FAILED ===\nFailed to execute build_tool.sh: {}", log_output, e);
                                false
                            }
                        }
                    } else {
                        true
                    };

                    if build_success {
                        let _ = app_clone.emit("git-update", GitUpdateProgress {
                            repo_name: repo_name_clone,
                            status: "completed".to_string(),
                            log_output,
                        });
                    } else {
                        let _ = app_clone.emit("git-update", GitUpdateProgress {
                            repo_name: repo_name_clone,
                            status: "failed".to_string(),
                            log_output,
                        });
                    }
                } else {
                    let _ = app_clone.emit("git-update", GitUpdateProgress {
                        repo_name: repo_name_clone,
                        status: "failed".to_string(),
                        log_output: format!("Command exited with status code: {:?}\n\n{}", out.status.code(), combined_log),
                    });
                }
            }
            Err(e) => {
                let _ = app_clone.emit("git-update", GitUpdateProgress {
                    repo_name: repo_name_clone,
                    status: "failed".to_string(),
                    log_output: format!("Failed to spawn git process: {}", e),
                });
            }
        }
    });

    Ok(format!("Update triggered for {}", repo_name))
}
