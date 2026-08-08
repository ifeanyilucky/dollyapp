//! Serves media entries out of a packed `.dol` file over a custom `dol://`
//! URI scheme, so the editor's `<video>`/`<audio>` elements can play
//! `screen.mov`/`mic.wav` straight out of the single-file recording without
//! ever unpacking it to disk.
//!
//! A `.dol` file is a zip whose media entries are *Stored* (uncompressed —
//! see `bundle::container`), so each entry's bytes sit contiguously in the
//! archive at a fixed offset (`ZipFile::data_start`). That lets this handler
//! seek straight into the file and serve an HTTP `Range` request without
//! decompressing — or even reading — anything else. This is the same trick
//! Tauri's own `asset:` protocol uses for plain files, mirrored here for
//! entries that live inside an archive.
//!
//! The `.dol`'s absolute path travels as a percent-encoded `bundle` query
//! parameter in the URL (see `media_url`), and the handler restricts itself
//! to files inside `~/Movies/Dolly` — the protocol equivalent of the
//! asset-protocol scope (`$VIDEO/Dolly/**`).

use std::borrow::Cow;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use http::header::{
    ACCEPT_RANGES, ACCESS_CONTROL_EXPOSE_HEADERS, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE,
    RANGE,
};
use http::{Method, StatusCode};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use tauri::http::{Request, Response};
use zip::CompressionMethod;

use crate::bundle::names;

/// The URI scheme this module registers. URLs look like
/// `dol://localhost/screen.mov?bundle=%2FUsers%2F...%2FRecording%201.dol`.
pub const SCHEME: &str = "dol";

/// Cap on a single range response. WebKit asks for media in bounded chunks
/// and never needs the whole (potentially multi-gigabyte) file at once —
/// mirrors the `asset:` protocol's own cap, for the same reason.
const MAX_RANGE_LEN: u64 = 1000 * 1024;

/// Builds the `dol://` URL the frontend can feed a `<video>`/`<audio>` or
/// `fetch()` for `entry` (e.g. `screen.mov`) inside `bundle_path`.
pub fn media_url(bundle_path: &Path, entry: &str) -> String {
    let path = bundle_path.display().to_string();
    let encoded = utf8_percent_encode(&path, NON_ALPHANUMERIC);
    format!("{SCHEME}://localhost/{entry}?bundle={encoded}")
}

fn mime_type(entry: &str) -> &'static str {
    match entry {
        names::SCREEN_VIDEO => "video/quicktime",
        names::MIC_AUDIO | names::SYSTEM_AUDIO => "audio/wav",
        names::META | names::CURSOR | names::PROJECT => "application/json",
        _ => "application/octet-stream",
    }
}

/// Registers the `dol` scheme handler on the Tauri builder. The handler is
/// synchronous (same contract as the built-in `asset:` protocol) and cheap:
/// opening a zip to read its central directory is fast even for large files,
/// and the media bytes themselves are only ever touched inside a bounded
/// range.
pub fn register(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.register_uri_scheme_protocol(SCHEME, |ctx, request| serve(ctx.app_handle(), &request))
}

fn serve(app: &tauri::AppHandle, request: &Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let mut resp = Response::builder()
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Allow-Headers", "Range");

    let bundle = match bundle_path_from_request(app, request) {
        Ok(path) => path,
        Err(status) => return empty(status),
    };

    // Skip the leading `/` — `dol://localhost/screen.mov` → `screen.mov`.
    let entry = request.uri().path().trim_start_matches('/').to_string();

    let file = match File::open(&bundle) {
        Ok(file) => file,
        Err(e) => {
            tracing::error!("dol:// failed to open {}: {e}", bundle.display());
            return empty(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };
    let mut archive = match zip::ZipArchive::new(file) {
        Ok(archive) => archive,
        Err(e) => {
            tracing::error!("dol:// {} is not a valid zip: {e}", bundle.display());
            return empty(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };
    let meta = match archive.by_name(&entry) {
        Ok(meta) => meta,
        Err(_) => {
            tracing::warn!("dol:// entry {entry} not found in {}", bundle.display());
            return empty(StatusCode::NOT_FOUND);
        }
    };
    let total = meta.size();
    let data_start = meta.data_start();
    let is_stored = meta.compression() == CompressionMethod::Stored;
    drop(meta);
    drop(archive);

    resp = resp.header(CONTENT_TYPE, mime_type(&entry));

    // Media entries are always Stored, so their bytes can be read by raw
    // file offset. Any other entry (small JSON) is read whole and
    // decompressed, then served/sliced from memory — just a safety net,
    // since the editor reads those via IPC instead of this protocol.
    if !is_stored {
        return serve_in_memory(&bundle, &entry, request, resp, total);
    }

    let raw = match File::open(&bundle) {
        Ok(file) => file,
        Err(e) => {
            tracing::error!("dol:// failed to reopen {}: {e}", bundle.display());
            return empty(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };
    serve_stored(raw, data_start, total, request, resp)
}

fn serve_stored(
    mut file: File,
    data_start: u64,
    total: u64,
    request: &Request<Vec<u8>>,
    resp: http::response::Builder,
) -> Response<Cow<'static, [u8]>> {
    if request.method() == Method::HEAD {
        return resp
            .header(CONTENT_LENGTH, total)
            .body(Vec::new().into())
            .unwrap();
    }

    if let Some(range) = request.headers().get(RANGE).and_then(|v| v.to_str().ok()) {
        let resp = resp
            .header(ACCEPT_RANGES, "bytes")
            .header(ACCESS_CONTROL_EXPOSE_HEADERS, "content-range");

        let (start, end) = match parse_single_range(range, total) {
            Some(r) => r,
            None => return not_satisfiable(resp, total),
        };
        let nbytes = (end + 1 - start) as usize;

        let mut buf = Vec::with_capacity(nbytes);
        if let Err(e) = file
            .seek(SeekFrom::Start(data_start + start))
            .and_then(|_| file.take(nbytes as u64).read_to_end(&mut buf))
        {
            tracing::error!("dol:// range read failed: {e}");
            return empty(StatusCode::INTERNAL_SERVER_ERROR);
        }

        return resp
            .header(CONTENT_RANGE, format!("bytes {start}-{end}/{total}"))
            .header(CONTENT_LENGTH, end + 1 - start)
            .status(StatusCode::PARTIAL_CONTENT)
            .body(buf.into())
            .unwrap();
    }

    // No Range header (e.g. the export path's whole-file fetch): serve it
    // all, the same way the `asset:` protocol serves a full plain file.
    let mut buf = Vec::with_capacity(total as usize);
    if let Err(e) = file
        .seek(SeekFrom::Start(data_start))
        .and_then(|_| file.take(total).read_to_end(&mut buf))
    {
        tracing::error!("dol:// full read failed: {e}");
        return empty(StatusCode::INTERNAL_SERVER_ERROR);
    }
    resp.header(CONTENT_LENGTH, total)
        .body(buf.into())
        .unwrap()
}

/// Serves a deflated entry by reading it whole and slicing the result.
fn serve_in_memory(
    bundle: &Path,
    entry: &str,
    request: &Request<Vec<u8>>,
    resp: http::response::Builder,
    total: u64,
) -> Response<Cow<'static, [u8]>> {
    let Ok(file) = File::open(bundle) else {
        return empty(StatusCode::INTERNAL_SERVER_ERROR);
    };
    let mut archive = match zip::ZipArchive::new(file) {
        Ok(archive) => archive,
        Err(_) => return empty(StatusCode::INTERNAL_SERVER_ERROR),
    };
    let mut bytes = match archive.by_name(entry) {
        Ok(mut file) => {
            let mut buf = Vec::with_capacity(file.size() as usize);
            if file.read_to_end(&mut buf).is_err() {
                return empty(StatusCode::INTERNAL_SERVER_ERROR);
            }
            buf
        }
        Err(_) => return empty(StatusCode::NOT_FOUND),
    };

    if request.method() == Method::HEAD {
        return resp
            .header(CONTENT_LENGTH, total)
            .body(Vec::new().into())
            .unwrap();
    }

    if let Some(range) = request.headers().get(RANGE).and_then(|v| v.to_str().ok()) {
        let resp = resp
            .header(ACCEPT_RANGES, "bytes")
            .header(ACCESS_CONTROL_EXPOSE_HEADERS, "content-range");
        let (start, end) = match parse_single_range(range, total) {
            Some(r) => r,
            None => return not_satisfiable(resp, total),
        };
        let slice = bytes.drain(start as usize..=(end as usize)).collect::<Vec<_>>();
        return resp
            .header(CONTENT_RANGE, format!("bytes {start}-{end}/{total}"))
            .header(CONTENT_LENGTH, end + 1 - start)
            .status(StatusCode::PARTIAL_CONTENT)
            .body(slice.into())
            .unwrap();
    }

    resp.header(CONTENT_LENGTH, total)
        .body(std::mem::take(&mut bytes).into())
        .unwrap()
}

/// Parses a single-part `Range` header into an inclusive (start, end) pair,
/// capped at `MAX_RANGE_LEN` like the `asset:` protocol. `None` when the
/// header is malformed or unsatisfiable.
fn parse_single_range(range: &str, total: u64) -> Option<(u64, u64)> {
    let first = http_range::HttpRange::parse(range, total).ok()?.first()?.to_owned();
    let start = first.start;
    if start >= total {
        return None;
    }
    let end = (start + first.length - 1).min(total - 1).min(start + MAX_RANGE_LEN - 1);
    Some((start, end))
}

fn empty(status: StatusCode) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .header("Access-Control-Allow-Origin", "*")
        .status(status)
        .body(Vec::new().into())
        .unwrap()
}

fn not_satisfiable(resp: http::response::Builder, total: u64) -> Response<Cow<'static, [u8]>> {
    resp.status(StatusCode::RANGE_NOT_SATISFIABLE)
        .header(CONTENT_RANGE, format!("bytes */{total}"))
        .body(Vec::new().into())
        .unwrap()
}

/// Extracts and validates the `.dol` path from the URL's `bundle` query
/// parameter: must decode to a real file with a `.dol` extension that lives
/// inside the app's own recordings directory.
fn bundle_path_from_request(
    app: &tauri::AppHandle,
    request: &Request<Vec<u8>>,
) -> Result<PathBuf, StatusCode> {
    let query = request.uri().query().ok_or(StatusCode::BAD_REQUEST)?;
    let value = query
        .split('&')
        .find_map(|pair| {
            let (key, value) = pair.split_once('=')?;
            (key == "bundle").then_some(value)
        })
        .ok_or(StatusCode::BAD_REQUEST)?;

    let decoded = percent_encoding::percent_decode_str(value)
        .decode_utf8()
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    let bundle = PathBuf::from(decoded.as_ref());

    if bundle.extension().and_then(|e| e.to_str()) != Some(names::EXTENSION) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let Ok(canon) = bundle.canonicalize() else {
        return Err(StatusCode::NOT_FOUND);
    };

    let base = crate::projects::recordings_dir(app)
        .ok()
        .and_then(|dir| dir.canonicalize().ok())
        .ok_or(StatusCode::FORBIDDEN)?;
    if !canon.starts_with(&base) {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(bundle)
}
