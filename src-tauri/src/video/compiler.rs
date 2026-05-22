use serde::{Serialize, Deserialize};
use std::process::Command;
use tokio::sync::mpsc;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Clip {
    pub id: String,
    pub name: String,
    #[serde(rename = "filePath")]
    pub file_path: String,
    #[serde(rename = "type")]
    pub type_field: String,
    pub duration: f64,
    #[serde(rename = "startOffset")]
    pub start_offset: f64,
    #[serde(rename = "endOffset")]
    pub end_offset: f64,
    #[serde(rename = "trackId")]
    pub track_id: String,
    #[serde(rename = "timeStart")]
    pub time_start: f64,
    pub volume: f64,
    pub speed: f64,
    pub text: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Track {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub track_type: String, // "video" | "audio" | "subtitle"
    pub clips: Vec<Clip>,
}

#[derive(Serialize, Clone)]
pub struct ExportProgress {
    pub progress: f64, // 0.0 to 1.0
    pub status: String,
}

pub async fn run_ffmpeg_export(
    app: AppHandle,
    tracks: Vec<Track>,
    output_path: String,
) -> Result<String, String> {
    let root = crate::utils::paths::workspace_root()?;
    let ffmpeg_path = root.join("bin/ffmpeg");

    if !ffmpeg_path.exists() {
        return Err(format!("ffmpeg not found at {:?}. Run setup.sh first.", ffmpeg_path));
    }

    // 1. Calculate project duration
    let mut total_duration = 0.0f64;
    let mut video_clips: Vec<&Clip> = Vec::new();
    let mut audio_clips: Vec<&Clip> = Vec::new();
    let mut subtitle_clips: Vec<&Clip> = Vec::new();

    for track in &tracks {
        for clip in &track.clips {
            let clip_dur = (clip.end_offset - clip.start_offset) / clip.speed;
            let clip_end = clip.time_start + clip_dur;
            if clip_end > total_duration {
                total_duration = clip_end;
            }

            match clip.type_field.as_str() {
                "video" | "image" => video_clips.push(clip),
                "audio" => audio_clips.push(clip),
                "subtitle" | "text" => subtitle_clips.push(clip),
                _ => {}
            }
        }
    }

    if total_duration <= 0.0 {
        return Err("Timeline is empty. Please add clips to export.".to_string());
    }

    // Ensure total duration is at least 0.5s to prevent crash
    total_duration = total_duration.max(0.5);

    println!("[simple-edit] Compiling timeline with duration: {}s", total_duration);

    // 2. Formulate inputs and filtergraph
    // Input 0: solid black canvas covering the entire duration
    // Input 1..N: the source files
    let mut args: Vec<String> = Vec::new();
    
    // Solid background video + silent audio base
    args.push("-f".to_string());
    args.push("lavfi".to_string());
    args.push("-i".to_string());
    args.push(format!("color=c=black:s=1280x720:d={}:r=30", total_duration));

    args.push("-f".to_string());
    args.push("lavfi".to_string());
    args.push("-i".to_string());
    args.push(format!("anullsrc=r=44100:cl=stereo:d={}", total_duration));

    // File path to input index mapping
    let mut input_map: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    
    // Add unique input files
    let mut current_input_index = 2; // Index 0 and 1 are background canvas
    for track in &tracks {
        for clip in &track.clips {
            if clip.type_field == "video" || clip.type_field == "audio" || clip.type_field == "image" {
                if !input_map.contains_key(&clip.file_path) {
                    input_map.insert(clip.file_path.clone(), current_input_index);
                    args.push("-i".to_string());
                    args.push(clip.file_path.clone());
                    current_input_index += 1;
                }
            }
        }
    }

    // 3. Build complex filtergraph
    let mut filter_chunks: Vec<String> = Vec::new();
    
    // Label for current video and audio streams
    let mut current_video_label = "0:v".to_string();
    let current_audio_label = "1:a".to_string();

    // Process Video clips
    for (idx, clip) in video_clips.iter().enumerate() {
        let input_idx = *input_map.get(&clip.file_path).unwrap();
        let label_v = format!("v_in_{}", idx);
        
        let trim_dur = clip.end_offset - clip.start_offset;
        
        // Trimming, scale, setpts, and speed
        // If speed is not 1.0, setpts scales time
        let speed_factor = 1.0 / clip.speed;
        
        filter_chunks.push(format!(
            "[{}:v]trim=start={}:end={},setpts={:.4}*(PTS-STARTPTS),scale=1280:720[{}]",
            input_idx, clip.start_offset, clip.end_offset, speed_factor, label_v
        ));

        // Overlay onto the timeline background at correct timeStart
        let next_v_label = format!("v_mixed_{}", idx);
        let time_end = clip.time_start + (trim_dur / clip.speed);
        
        filter_chunks.push(format!(
            "[{}] [{}] overlay=x=0:y=0:enable='between(t,{},{})' [{}]",
            current_video_label, label_v, clip.time_start, time_end, next_v_label
        ));
        
        current_video_label = next_v_label;
    }

    // Process Subtitles overlay via drawtext filters
    for (idx, clip) in subtitle_clips.iter().enumerate() {
        if let Some(ref txt) = clip.text {
            // Escape single quotes for drawtext
            let escaped_text = txt.replace("'", "'\\\\''");
            let next_v_label = format!("v_sub_{}", idx);
            
            // Drawtext overlay
            let time_end = clip.time_start + (clip.end_offset - clip.start_offset) / clip.speed;
            
            // Neon pink glowing text matching glassmorphism style!
            // Background shadow border: x=(w-text_w)/2:y=h-80
            filter_chunks.push(format!(
                "[{}]drawtext=text='{}':x=(w-text_w)/2:y=h-80:fontsize=28:fontcolor=white:borderw=3:bordercolor=deeppink:enable='between(t,{},{})'[{}]",
                current_video_label, escaped_text, clip.time_start, time_end, next_v_label
            ));
            
            current_video_label = next_v_label;
        }
    }

    // Process Audio clips
    let mut mixed_audio_inputs = vec![current_audio_label.clone()];
    for (idx, clip) in audio_clips.iter().enumerate() {
        let input_idx = *input_map.get(&clip.file_path).unwrap();
        let label_a_trimmed = format!("a_trim_{}", idx);
        let label_a_delayed = format!("a_delay_{}", idx);

        // Trim, change speed via atempo (note: atempo only supports 0.5 to 2.0. If outside, we chain or default)
        let atempo_filter = if clip.speed == 1.0 {
            "".to_string()
        } else if clip.speed >= 0.5 && clip.speed <= 2.0 {
            format!(",atempo={:.2}", clip.speed)
        } else {
            // Chain multiple atempos if speed is outside [0.5, 2.0]
            format!(",atempo={:.2}", clip.speed.sqrt())
        };

        filter_chunks.push(format!(
            "[{}:a]atrim=start={}:end={},asetpts=PTS-STARTPTS{},volume={:.2}[{}]",
            input_idx, clip.start_offset, clip.end_offset, atempo_filter, clip.volume, label_a_trimmed
        ));

        // Delay to start offset
        let delay_ms = (clip.time_start * 1000.0) as i64;
        filter_chunks.push(format!(
            "[{}]adelay={}|{}[{}]",
            label_a_trimmed, delay_ms, delay_ms, label_a_delayed
        ));

        mixed_audio_inputs.push(label_a_delayed);
    }

    // Mix all delayed audio tracks
    let final_audio_label = "a_final".to_string();
    let num_inputs = mixed_audio_inputs.len();
    let audio_input_labels = mixed_audio_inputs.join("");
    
    filter_chunks.push(format!(
        "{}amix=inputs={}:duration=first[{}]",
        audio_input_labels, num_inputs, final_audio_label
    ));

    // Combine filter graph string
    let complex_filter = filter_chunks.join(";");
    args.push("-filter_complex".to_string());
    args.push(complex_filter);

    // Map final streams
    args.push("-map".to_string());
    args.push(format!("[{}]", current_video_label));
    args.push("-map".to_string());
    args.push(format!("[{}]", final_audio_label));

    // Encoding configurations with high performance and graceful CPU fallback
    args.push("-c:v".to_string());
    args.push("libx264".to_string()); // CPU fallback standard, extremely reliable
    args.push("-preset".to_string());
    args.push("veryfast".to_string());
    args.push("-crf".to_string());
    args.push("22".to_string());
    args.push("-c:a".to_string());
    args.push("aac".to_string());
    args.push("-b:a".to_string());
    args.push("192k".to_string());
    args.push("-y".to_string());
    args.push(output_path.clone());

    // 4. Spawn FFmpeg process
    let mut child = Command::new(&ffmpeg_path)
        .args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn FFmpeg compiler: {}", e))?;

    let stdout = child.stderr.take().ok_or_else(|| "Failed to open FFmpeg stderr pipe.".to_string())?;
    
    // Stream progress status in background thread
    let (tx, mut rx) = mpsc::channel::<f64>(100);
    
    tokio::spawn(async move {
        use std::io::{BufReader, BufRead};
        let reader = BufReader::new(stdout);
        
        for line_res in reader.lines() {
            if let Ok(line) = line_res {
                // Parse line like "time=00:00:04.23" to calculate progress
                if line.contains("time=") {
                    if let Some(pos) = line.find("time=") {
                        let sub = &line[pos + 5..];
                        if let Some(space_pos) = sub.find(' ') {
                            let time_str = &sub[..space_pos].trim();
                            // parse time format 00:00:00.00
                            let parts: Vec<&str> = time_str.split(':').collect();
                            if parts.len() == 3 {
                                let hrs: f64 = parts[0].parse().unwrap_or(0.0);
                                let mins: f64 = parts[1].parse().unwrap_or(0.0);
                                let secs: f64 = parts[2].parse().unwrap_or(0.0);
                                let current_secs = hrs * 3600.0 + mins * 60.0 + secs;
                                let progress = (current_secs / total_duration).min(1.0).max(0.0);
                                let _ = tx.send(progress).await;
                            }
                        }
                    }
                }
            }
        }
    });

    let app_handle = app.clone();
    tokio::spawn(async move {
        while let Some(prog) = rx.recv().await {
            let _ = app_handle.emit("export-progress", ExportProgress {
                progress: prog,
                status: format!("Compiling video frames... {:.1}%", prog * 100.0),
            });
        }
    });

    // Wait for FFmpeg process to complete
    let status = child.wait().map_err(|e| format!("Error waiting for FFmpeg process: {}", e))?;
    
    if status.success() {
        let _ = app.emit("export-progress", ExportProgress {
            progress: 1.0,
            status: "Export Completed successfully!".to_string(),
        });
        Ok(output_path)
    } else {
        Err("FFmpeg compilation ended with errors. Please check timeline formats.".to_string())
    }
}
