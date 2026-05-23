use tokio::process::Command;

#[tauri::command]
pub async fn generate_sd_image(
    prompt: String,
    negative_prompt: String,
    seed: i64,
    steps: u32,
    sampler: String,
    width: u32,
    height: u32,
    cfg_scale: f32,
    checkpoint_name: String,
) -> Result<String, String> {
    let root = crate::utils::paths::workspace_root()?;

    // Ensure temp/generated exists
    let output_dir = root.join("temp/generated");
    std::fs::create_dir_all(&output_dir)
        .map_err(|e| format!("Failed to create output dir: {}", e))?;

    // Unique filename
    let run_id = uuid::Uuid::new_v4().to_string();
    let output_path = output_dir.join(format!("sd_{}.png", run_id));

    // Resolve checkpoint path
    let checkpoint_path = root.join("models").join(&checkpoint_name);
    if !checkpoint_path.exists() {
        return Err(format!("Stable Diffusion checkpoint does not exist at {:?}", checkpoint_path));
    }

    // Resolve sd-cli binary
    let sd_bin = root.join("bin/sd-cli");
    if !sd_bin.exists() {
        return Err("sd-cli binary not found in bin/sd-cli. Compile stable-diffusion.cpp first.".to_string());
    }

    let seed_str = if seed < 0 {
        // Generate pseudo-random seed using system time milliseconds
        match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
            Ok(dur) => (dur.as_millis() as u32).to_string(),
            Err(_) => "42".to_string(),
        }
    } else {
        seed.to_string()
    };

    // Run sd-cli
    let mut cmd = Command::new(&sd_bin);
    cmd.args(&[
        "-m", checkpoint_path.to_str().unwrap(),
        "-p", &prompt,
        "-n", &negative_prompt,
        "-o", output_path.to_str().unwrap(),
        "--steps", &steps.to_string(),
        "--cfg-scale", &cfg_scale.to_string(),
        "--seed", &seed_str,
        "-W", &width.to_string(),
        "-H", &height.to_string(),
    ]);

    // Add sampler option if it's provided and not empty
    if !sampler.is_empty() {
        cmd.args(&["--sampling-method", &sampler]);
    }

    let status = cmd.status().await
        .map_err(|e| format!("Failed to execute sd-cli: {}", e))?;

    if !status.success() {
        return Err("sd-cli generation failed".to_string());
    }

    if !output_path.exists() {
        return Err("Generation completed but output image file was not found".to_string());
    }

    Ok(output_path.to_str().unwrap().to_string())
}
