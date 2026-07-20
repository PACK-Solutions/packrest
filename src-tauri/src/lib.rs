use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

// One OpenAPI bundle read from a user-picked source directory.
#[derive(Serialize)]
struct SourceSpec {
    api: String,
    content: String,
}

// Read every `<dir>/<api>/v1/openapi.bundle.yaml` under a user-selected
// directory and return their contents. This is the native counterpart of the
// former `lib/sync.ts` local copy: the JS side (lib/sync.ts) filters excluded
// APIs, diffs against the previous bundle, and writes into the app-data specs
// dir via tauri-plugin-fs. Doing the arbitrary-directory read in Rust avoids
// having to widen the tauri-plugin-fs scope to the whole filesystem.
#[tauri::command]
fn read_source_specs(dir: String) -> Result<Vec<SourceSpec>, String> {
    let base = Path::new(&dir);
    if !base.is_dir() {
        return Err(format!("Source introuvable : {dir}"));
    }
    let entries = fs::read_dir(base).map_err(|e| e.to_string())?;
    let mut out: Vec<SourceSpec> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let api = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };
        let bundle = path.join("v1").join("openapi.bundle.yaml");
        if bundle.is_file() {
            if let Ok(content) = fs::read_to_string(&bundle) {
                out.push(SourceSpec { api, content });
            }
        }
    }
    Ok(out)
}

// Filter for the native save dialog (mirrors lib/dialog.ts SaveFilter).
#[derive(Deserialize)]
struct SaveFilter {
    name: String,
    extensions: Vec<String>,
}

// Save bytes to a user-chosen path. The native save dialog is opened *inside*
// this command so the destination is never supplied by the webview: an injected
// or compromised frontend cannot turn this into an arbitrary-file-write (e.g.
// ~/.zshrc, LaunchAgents). Returns the chosen path, or None if the user
// cancelled. Used by the Bruno export to write a .zip / .yml where the user
// picks, which tauri-plugin-fs's scope would otherwise forbid outside $APPDATA.
//
// MUST be `async`: Tauri runs sync commands on the main thread, but
// `blocking_save_file` dispatches the dialog to the main thread and blocks the
// caller until it closes — on the main thread that deadlocks (the app freezes).
// An async command runs on the async runtime, off the main thread, so the main
// loop stays free to drive the dialog.
#[tauri::command]
async fn save_file(
    app: AppHandle,
    default_name: String,
    filters: Vec<SaveFilter>,
    contents: Vec<u8>,
) -> Result<Option<String>, String> {
    let mut builder = app.dialog().file().set_file_name(&default_name);
    for f in &filters {
        let exts: Vec<&str> = f.extensions.iter().map(|s| s.as_str()).collect();
        builder = builder.add_filter(&f.name, &exts);
    }
    let Some(chosen) = builder.blocking_save_file() else {
        return Ok(None); // user cancelled
    };
    let path = chosen.into_path().map_err(|e| e.to_string())?;
    fs::write(&path, contents).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![read_source_specs, save_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
