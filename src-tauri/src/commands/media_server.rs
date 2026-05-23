use axum::{
    extract::Query,
    http::{header, HeaderMap, StatusCode},
    response::Response,
    routing::get,
    Router,
};
use std::collections::HashMap;
use std::io::SeekFrom;
use std::path::Path;
use std::sync::Mutex;
use tauri::State;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::net::TcpListener;

pub struct MediaServerState {
    port: Mutex<Option<u16>>,
}

impl MediaServerState {
    pub fn new() -> Self {
        Self { port: Mutex::new(None) }
    }
}

#[tauri::command]
pub async fn get_media_server_port(state: State<'_, MediaServerState>) -> Result<u16, String> {
    {
        let guard = state.port.lock().unwrap();
        if let Some(port) = *guard {
            return Ok(port);
        }
    }
    let port = start_server().await?;
    *state.port.lock().unwrap() = Some(port);
    Ok(port)
}

async fn start_server() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Media server bind failed: {e}"))?;
    let port = listener.local_addr()
        .map_err(|e| format!("Media server addr failed: {e}"))?
        .port();

    let app = Router::new().route("/file", get(serve_file));
    tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });

    Ok(port)
}

async fn serve_file(
    Query(params): Query<HashMap<String, String>>,
    req_headers: HeaderMap,
) -> Result<Response, StatusCode> {
    let path_str = params.get("path").ok_or(StatusCode::BAD_REQUEST)?;
    let path = Path::new(path_str);

    if !path.exists() {
        return Err(StatusCode::NOT_FOUND);
    }

    let meta = tokio::fs::metadata(path)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let total: u64 = meta.len();

    let mime = mime_guess::from_path(path)
        .first_or_octet_stream()
        .to_string();

    // Handle Range request — required for HTML5 video seeking
    if let Some(range_val) = req_headers.get(header::RANGE) {
        let range_str = range_val.to_str().map_err(|_| StatusCode::BAD_REQUEST)?;
        let (start, end) = parse_range(range_str, total)
            .ok_or(StatusCode::RANGE_NOT_SATISFIABLE)?;
        let len = end - start + 1;

        let mut file = tokio::fs::File::open(path)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        file.seek(SeekFrom::Start(start))
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        // Stream the requested byte range without allocating the whole slice at once
        let taken = file.take(len);
        let stream = tokio_util::io::ReaderStream::new(taken);

        return Ok(Response::builder()
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_TYPE, &mime)
            .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{total}"))
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CONTENT_LENGTH, len.to_string())
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(axum::body::Body::from_stream(stream))
            .unwrap());
    }

    // Full-file response — stream without reading into memory
    let file = tokio::fs::File::open(path)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let stream = tokio_util::io::ReaderStream::new(file);

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, &mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, total.to_string())
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(axum::body::Body::from_stream(stream))
        .unwrap())
}

/// Parses `bytes=START-[END]` and clamps to [0, total).
fn parse_range(range: &str, total: u64) -> Option<(u64, u64)> {
    let s = range.strip_prefix("bytes=")?;
    let mut it = s.split('-');
    let start: u64 = it.next()?.parse().ok()?;
    let end: u64 = match it.next()? {
        "" => total.saturating_sub(1),
        e => e.parse().ok()?,
    };
    if start <= end && end < total {
        Some((start, end))
    } else {
        None
    }
}
