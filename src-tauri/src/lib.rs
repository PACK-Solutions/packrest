use std::fs;
use std::path::Path;

use serde::Serialize;

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

// Write raw bytes to an arbitrary user-chosen path (from the save dialog).
// Used by the Bruno export to write a .zip / .yml where the user picks, which
// tauri-plugin-fs's scope would otherwise forbid outside $APPDATA.
#[tauri::command]
fn write_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![read_source_specs, write_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
