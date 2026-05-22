use std::net::TcpListener;
use std::sync::Mutex;
use std::process::{Child, Command};
use std::time::{Duration, Instant};
use tauri::{State, command, AppHandle};

pub struct PythonServerState {
    pub port: Mutex<Option<u16>>,
    pub child: Mutex<Option<Child>>,
}

impl PythonServerState {
    pub fn new() -> Self {
        Self {
            port: Mutex::new(None),
            child: Mutex::new(None),
        }
    }
}

fn get_free_port() -> Option<u16> {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|listener| listener.local_addr())
        .map(|addr| addr.port())
        .ok()
}

#[command]
pub async fn get_python_server_port(
    state: State<'_, PythonServerState>,
    _app: AppHandle,
) -> Result<u16, String> {
    // 1. Check if already running
    {
        let port_guard = state.port.lock().unwrap();
        if let Some(port) = *port_guard {
            return Ok(port);
        }
    }

    // 2. Start server
    let cwd = std::env::current_dir().map_err(|e| format!("Failed to get CWD: {}", e))?;
    let micromamba_path = cwd.join("bin/micromamba");
    let conda_env_path = cwd.join("conda_env");
    let main_py_path = cwd.join("python/main.py");

    if !micromamba_path.exists() {
        return Err("Micromamba binary not found. Please run environment setup.".to_string());
    }
    if !conda_env_path.exists() {
        return Err("Conda environment directory not found. Please run environment setup.".to_string());
    }
    if !main_py_path.exists() {
        return Err("Python server entry point python/main.py not found.".to_string());
    }

    let port = get_free_port().ok_or_else(|| "Failed to allocate free TCP port.".to_string())?;
    println!("[simple-edit] Spawning Python server on port {}...", port);

    let child = Command::new(&micromamba_path)
        .args(&[
            "run",
            "-p",
            conda_env_path.to_str().unwrap_or(""),
            "python",
            main_py_path.to_str().unwrap_or(""),
            "--port",
            &port.to_string(),
        ])
        .spawn()
        .map_err(|e| format!("Failed to spawn Python service: {}", e))?;

    // 3. Store child and port
    {
        let mut port_guard = state.port.lock().unwrap();
        let mut child_guard = state.child.lock().unwrap();
        *port_guard = Some(port);
        *child_guard = Some(child);
    }

    // 4. Ping health check endpoint in a retry loop (max 10 seconds, 100ms intervals)
    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{}/health", port);
    let start_time = Instant::now();
    let timeout = Duration::from_secs(10);

    println!("[simple-edit] Waiting for Python server to report healthy...");
    loop {
        if start_time.elapsed() > timeout {
            return Err("Python server failed to start within timeout period.".to_string());
        }

        // Check if child has exited early
        {
            let mut child_guard = state.child.lock().unwrap();
            if let Some(ref mut child_proc) = *child_guard {
                if let Ok(Some(status)) = child_proc.try_wait() {
                    return Err(format!("Python server process exited prematurely with code: {:?}", status.code()));
                }
            }
        }

        let resp = client.get(&url).timeout(Duration::from_millis(500)).send().await;
        if let Ok(r) = resp {
            if r.status().is_success() {
                println!("[simple-edit] Python server is up and healthy on port {}!", port);
                break;
            }
        }

        tokio::time::sleep(Duration::from_millis(150)).await;
    }

    Ok(port)
}

pub fn kill_python_server(state: &PythonServerState) {
    let mut child_guard = state.child.lock().unwrap();
    if let Some(mut child) = child_guard.take() {
        println!("[simple-edit] Killing Python microservice process...");
        let _ = child.kill();
        let _ = child.wait();
    }
}
