use serde::{Serialize, Deserialize};
use tokio::process::Command;
use tokio::sync::mpsc;
use tauri::{AppHandle, Emitter};
use std::process::Stdio;

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
    #[serde(rename = "hasAudio", default)]
    pub has_audio: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Track {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub track_type: String,
    pub clips: Vec<Clip>,
    pub locked: Option<bool>,
    pub muted: Option<bool>,
    pub hidden: Option<bool>,
}

#[derive(Serialize, Clone)]
pub struct ExportProgress {
    pub progress: f64,
    pub status: String,
}

// Build a chained atempo filter string for speed values outside [0.5, 2.0].
fn build_atempo_chain(speed: f64) -> String {
    if (speed - 1.0).abs() < 0.01 {
        return String::new();
    }
    let mut chain = Vec::new();
    let mut remaining = speed;
    while remaining > 2.0 + 1e-6 {
        chain.push("atempo=2.0".to_string());
        remaining /= 2.0;
    }
    while remaining < 0.5 - 1e-6 {
        chain.push("atempo=0.5".to_string());
        remaining *= 2.0;
    }
    if (remaining - 1.0).abs() > 0.01 {
        chain.push(format!("atempo={:.4}", remaining));
    }
    if chain.is_empty() { String::new() } else { format!(",{}", chain.join(",")) }
}

// Escape special characters in FFmpeg drawtext filter text values.
fn escape_drawtext(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 8);
    for ch in text.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '\'' => out.push_str("\\'"),
            ':' => out.push_str("\\:"),
            _ => out.push(ch),
        }
    }
    out
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

    // 1. Categorise clips and measure total duration
    let mut total_duration = 0.0f64;
    let mut video_clips: Vec<&Clip> = Vec::new();
    let mut audio_clips: Vec<&Clip> = Vec::new();
    let mut subtitle_clips: Vec<&Clip> = Vec::new();

    for track in &tracks {
        let is_hidden = track.hidden.unwrap_or(false);
        let is_muted = track.muted.unwrap_or(false);

        for clip in &track.clips {
            let clip_dur = (clip.end_offset - clip.start_offset) / clip.speed;
            let clip_end = clip.time_start + clip_dur;
            if clip_end > total_duration {
                total_duration = clip_end;
            }

            match clip.type_field.as_str() {
                "video" | "image" => {
                    if !is_hidden { video_clips.push(clip); }
                }
                "audio" => {
                    if !is_muted { audio_clips.push(clip); }
                }
                "subtitle" | "text" => {
                    if !is_hidden { subtitle_clips.push(clip); }
                }
                _ => {}
            }
        }
    }

    if total_duration <= 0.0 {
        return Err("Timeline is empty. Please add clips to export.".to_string());
    }
    total_duration = total_duration.max(0.5);

    println!("[simple-edit] Compiling timeline with duration: {}s", total_duration);

    // 2. Build FFmpeg input list
    //    Index 0: black video canvas   Index 1: silent audio base
    let mut args: Vec<String> = Vec::new();

    args.push("-f".to_string());
    args.push("lavfi".to_string());
    args.push("-i".to_string());
    args.push(format!("color=c=black:s=1280x720:d={}:r=30", total_duration));

    args.push("-f".to_string());
    args.push("lavfi".to_string());
    args.push("-i".to_string());
    args.push(format!("anullsrc=r=44100:cl=stereo:d={}", total_duration));

    let mut input_map: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut current_input_index = 2usize;

    for track in &tracks {
        let is_hidden = track.hidden.unwrap_or(false);
        let is_muted = track.muted.unwrap_or(false);

        for clip in &track.clips {
            match clip.type_field.as_str() {
                "video" | "image" => { if is_hidden { continue; } }
                "audio" => { if is_muted { continue; } }
                _ => { continue; }
            }
            if !input_map.contains_key(&clip.file_path) {
                input_map.insert(clip.file_path.clone(), current_input_index);
                args.push("-i".to_string());
                args.push(clip.file_path.clone());
                current_input_index += 1;
            }
        }
    }

    // 3. Build complex filtergraph
    let mut filter_chunks: Vec<String> = Vec::new();
    let mut current_video_label = "0:v".to_string();
    // Start audio mix with the silent base; real streams are appended below.
    let mut mixed_audio_inputs: Vec<String> = vec!["1:a".to_string()];

    // --- Video / Image clips ---
    for (idx, clip) in video_clips.iter().enumerate() {
        let input_idx = *input_map.get(&clip.file_path)
            .ok_or_else(|| format!("No input index for clip '{}' ({})", clip.name, clip.file_path))?;
        let label_v = format!("v_in_{}", idx);
        let trim_dur = clip.end_offset - clip.start_offset;
        let speed_factor = 1.0 / clip.speed;

        if clip.type_field == "image" {
            filter_chunks.push(format!(
                "[{}:v]loop=1:size=1:start=0,trim=duration={:.4},setpts=PTS-STARTPTS+{:.4}/TB,scale=1280:720[{}]",
                input_idx, trim_dur / clip.speed, clip.time_start, label_v
            ));
        } else {
            filter_chunks.push(format!(
                "[{}:v]trim=start={:.4}:end={:.4},setpts={:.4}*(PTS-STARTPTS)+{:.4}/TB,scale=1280:720[{}]",
                input_idx, clip.start_offset, clip.end_offset, speed_factor, clip.time_start, label_v
            ));

            // Also extract embedded audio from video files that have an audio stream.
            if clip.has_audio {
                let label_a_trimmed = format!("va_trim_{}", idx);
                let label_a_delayed = format!("va_delay_{}", idx);
                let atempo = build_atempo_chain(clip.speed);
                filter_chunks.push(format!(
                    "[{}:a]atrim=start={:.4}:end={:.4},asetpts=PTS-STARTPTS{},volume={:.2}[{}]",
                    input_idx, clip.start_offset, clip.end_offset, atempo, clip.volume, label_a_trimmed
                ));
                let delay_ms = (clip.time_start * 1000.0) as i64;
                filter_chunks.push(format!(
                    "[{}]adelay={}|{}[{}]",
                    label_a_trimmed, delay_ms, delay_ms, label_a_delayed
                ));
                mixed_audio_inputs.push(label_a_delayed);
            }
        }

        let next_v_label = format!("v_mixed_{}", idx);
        let time_end = clip.time_start + (trim_dur / clip.speed);
        filter_chunks.push(format!(
            "[{}][{}]overlay=x=0:y=0:enable='between(t,{:.4},{:.4})'[{}]",
            current_video_label, label_v, clip.time_start, time_end, next_v_label
        ));
        current_video_label = next_v_label;
    }

    // --- Subtitle / text clips ---
    for (idx, clip) in subtitle_clips.iter().enumerate() {
        if let Some(ref txt) = clip.text {
            let escaped = escape_drawtext(txt);
            let next_v_label = format!("v_sub_{}", idx);
            let time_end = clip.time_start + (clip.end_offset - clip.start_offset) / clip.speed;
            filter_chunks.push(format!(
                "[{}]drawtext=text='{}':x=(w-text_w)/2:y=h-80:fontsize=28:fontcolor=white:borderw=3:bordercolor=deeppink:enable='between(t,{:.4},{:.4})'[{}]",
                current_video_label, escaped, clip.time_start, time_end, next_v_label
            ));
            current_video_label = next_v_label;
        }
    }

    // --- Standalone audio-track clips ---
    for (idx, clip) in audio_clips.iter().enumerate() {
        let input_idx = *input_map.get(&clip.file_path)
            .ok_or_else(|| format!("No input index for audio clip '{}' ({})", clip.name, clip.file_path))?;
        let label_a_trimmed = format!("a_trim_{}", idx);
        let label_a_delayed = format!("a_delay_{}", idx);
        let atempo = build_atempo_chain(clip.speed);

        filter_chunks.push(format!(
            "[{}:a]atrim=start={:.4}:end={:.4},asetpts=PTS-STARTPTS{},volume={:.2}[{}]",
            input_idx, clip.start_offset, clip.end_offset, atempo, clip.volume, label_a_trimmed
        ));
        let delay_ms = (clip.time_start * 1000.0) as i64;
        filter_chunks.push(format!(
            "[{}]adelay={}|{}[{}]",
            label_a_trimmed, delay_ms, delay_ms, label_a_delayed
        ));
        mixed_audio_inputs.push(label_a_delayed);
    }

    // --- Mix all audio streams ---
    // When there is only the silent base (no real audio), amix=inputs=1 is rejected by some
    // FFmpeg builds — use a plain acopy passthrough instead.
    let final_audio_label = "a_final".to_string();
    if mixed_audio_inputs.len() == 1 {
        filter_chunks.push(format!("[{}]acopy[{}]", mixed_audio_inputs[0], final_audio_label));
    } else {
        let num_inputs = mixed_audio_inputs.len();
        let audio_labels: String = mixed_audio_inputs.iter().map(|s| format!("[{}]", s)).collect();
        filter_chunks.push(format!(
            "{}amix=inputs={}:duration=longest[{}]",
            audio_labels, num_inputs, final_audio_label
        ));
    }

    let complex_filter = filter_chunks.join(";");
    args.push("-filter_complex".to_string());
    args.push(complex_filter);

    args.push("-map".to_string());
    args.push(format!("[{}]", current_video_label));
    args.push("-map".to_string());
    args.push(format!("[{}]", final_audio_label));

    args.push("-c:v".to_string());
    args.push("libx264".to_string());
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

    // 4. Spawn FFmpeg — tokio::process::Command so .wait().await never blocks the executor.
    let mut child = Command::new(&ffmpeg_path)
        .args(&args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn FFmpeg compiler: {}", e))?;

    let stderr_pipe = child.stderr.take()
        .ok_or_else(|| "Failed to open FFmpeg stderr pipe.".to_string())?;

    let (tx, mut rx) = mpsc::channel::<f64>(100);

    // Parse FFmpeg's stderr progress lines asynchronously.
    tokio::spawn(async move {
        use tokio::io::{AsyncBufReadExt, BufReader};
        let mut reader = BufReader::new(stderr_pipe);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    if let Some(pos) = line.find("time=") {
                        let sub = &line[pos + 5..];
                        let time_str = sub.split_whitespace().next().unwrap_or("").trim();
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

    // 5. Wait for FFmpeg to finish (non-blocking — uses tokio runtime).
    let status = child.wait().await
        .map_err(|e| format!("Error waiting for FFmpeg process: {}", e))?;

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
