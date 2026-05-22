use tokio::process::Command;
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize, Debug, Clone)]
pub struct SubtitleSegment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

#[derive(Deserialize, Debug)]
struct WhisperOutputOffsets {
    from: Option<i64>,
    to: Option<i64>,
}

#[derive(Deserialize, Debug)]
struct WhisperOutputSegment {
    offsets: Option<WhisperOutputOffsets>,
    start: Option<i64>, // fallback
    end: Option<i64>,   // fallback
    text: String,
}

#[derive(Deserialize, Debug)]
struct WhisperOutputResult {
    segments: Vec<WhisperOutputSegment>,
}

#[derive(Deserialize, Debug)]
struct WhisperOutput {
    result: Option<WhisperOutputResult>,
    // In some whisper.cpp versions, segments is at the top level
    segments: Option<Vec<WhisperOutputSegment>>,
}

#[tauri::command]
pub async fn transcribe_video(
    video_path: String,
    model_name: String,
) -> Result<Vec<SubtitleSegment>, String> {
    let cwd = std::env::current_dir().map_err(|e| format!("Failed to get CWD: {}", e))?;
    
    // Ensure temp dir exists
    let temp_dir = cwd.join("temp");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp dir: {}", e))?;

    // Create unique paths for audio extraction
    let run_id = uuid::Uuid::new_v4().to_string();
    let wav_path = temp_dir.join(format!("transcribe_{}.wav", run_id));
    let json_path = temp_dir.join(format!("transcribe_{}.wav.json", run_id));

    // Resolve model path
    let model_path = cwd.join("models").join(&model_name);
    if !model_path.exists() {
        return Err(format!("Whisper model does not exist at {:?}", model_path));
    }

    // Resolve whisper-cli and ffmpeg binaries
    let ffmpeg_bin = cwd.join("bin/ffmpeg");
    let whisper_bin = cwd.join("bin/whisper-cli");

    if !ffmpeg_bin.exists() {
        return Err("FFmpeg binary not found in bin/ffmpeg. Run setup first.".to_string());
    }
    if !whisper_bin.exists() {
        return Err("whisper-cli binary not found in bin/whisper-cli. Compile whisper.cpp first.".to_string());
    }

    // 1. Extract 16kHz mono WAV from the video file using FFmpeg
    let ffmpeg_status = Command::new(&ffmpeg_bin)
        .args(&[
            "-y",
            "-i",
            &video_path,
            "-ar",
            "16000",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            wav_path.to_str().unwrap(),
        ])
        .status()
        .await
        .map_err(|e| format!("Failed to run FFmpeg: {}", e))?;

    if !ffmpeg_status.success() {
        return Err("FFmpeg extraction failed".to_string());
    }

    // 2. Execute whisper-cli to transcribe and produce JSON output
    // The -oj tells whisper.cpp to output json format, which writes to <wav_path>.json
    let whisper_status = Command::new(&whisper_bin)
        .args(&[
            "-m",
            model_path.to_str().unwrap(),
            "-f",
            wav_path.to_str().unwrap(),
            "-oj",
        ])
        .status()
        .await
        .map_err(|e| format!("Failed to run whisper-cli: {}", e))?;

    // Cleanup input WAV immediately
    let _ = std::fs::remove_file(&wav_path);

    if !whisper_status.success() {
        let _ = std::fs::remove_file(&json_path);
        return Err("whisper-cli transcription failed".to_string());
    }

    // 3. Read and parse output JSON
    if !json_path.exists() {
        return Err("Whisper transcription JSON output was not generated".to_string());
    }

    let json_data = std::fs::read_to_string(&json_path)
        .map_err(|e| format!("Failed to read transcription JSON: {}", e))?;

    // Cleanup JSON file
    let _ = std::fs::remove_file(&json_path);

    let output: WhisperOutput = serde_json::from_str(&json_data)
        .map_err(|e| format!("Failed to parse Whisper JSON output: {}. Raw data: {}", e, json_data))?;

    // Normalize segment list from either result.segments or segments directly
    let raw_segments = if let Some(res) = output.result {
        res.segments
    } else if let Some(segs) = output.segments {
        segs
    } else {
        return Err("No segments found in Whisper JSON output".to_string());
    };

    let mut segments = Vec::new();
    for seg in raw_segments {
        let start_ms = if let Some(ref o) = seg.offsets {
            o.from.unwrap_or(0) as u64
        } else {
            seg.start.unwrap_or(0) as u64
        };

        let end_ms = if let Some(ref o) = seg.offsets {
            o.to.unwrap_or(0) as u64
        } else {
            seg.end.unwrap_or(0) as u64
        };

        segments.push(SubtitleSegment {
            start_ms,
            end_ms,
            text: seg.text.trim().to_string(),
        });
    }

    Ok(segments)
}
