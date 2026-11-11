mod manuscripts;
mod storage;

use manuscripts::Library;
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use storage::{Failure, Result};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

struct Desktop {
    library: Library,
    pending: Mutex<Vec<PathBuf>>,
    closing: AtomicBool,
    protected_roots: Vec<PathBuf>,
}

#[tauri::command]
async fn manuscripts(
    state: tauri::State<'_, Desktop>,
    action: String,
    body: Value,
) -> Result<Value> {
    state.library.run(&action, &body)
}

fn is_stf(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("stf"))
}

fn protected(path: &Path, roots: &[PathBuf]) -> bool {
    let candidate = path.to_string_lossy().to_lowercase();
    roots.iter().any(|root| {
        let root = root.to_string_lossy().to_lowercase();
        candidate == root
            || candidate
                .strip_prefix(&root)
                .is_some_and(|rest| rest.starts_with(std::path::MAIN_SEPARATOR))
    })
}

fn read_import(path: &Path, roots: &[PathBuf]) -> Result<Vec<u8>> {
    use std::io::Read;
    let path = path.canonicalize()?;
    if protected(&path, roots) {
        return Err(Failure::new(
            "FilePermissionError",
            "Choose a manuscript outside application data.",
        ));
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let metadata = std::fs::metadata(&path)?;
    if !["stf", "txt", "docx"].contains(&extension.as_str())
        || !metadata.is_file()
        || metadata.len() > manuscripts::MAX_FILE as u64
    {
        return Err(Failure::new(
            "FileError",
            "Choose an STF, DOCX, or TXT manuscript under 50 MB.",
        ));
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take(manuscripts::MAX_FILE as u64 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > manuscripts::MAX_FILE {
        return Err(Failure::new(
            "FileError",
            "Choose a manuscript under 50 MB.",
        ));
    }
    Ok(bytes)
}

#[tauri::command]
async fn desktop_import(
    app: tauri::AppHandle,
    state: tauri::State<'_, Desktop>,
) -> Result<tauri::ipc::Response> {
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Import manuscript")
        .add_filter("Manuscripts", &["stf", "txt", "docx"]);
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&window);
    }
    let path = dialog
        .blocking_pick_file()
        .ok_or_else(|| Failure::new("AbortError", "Import cancelled."))?
        .into_path()
        .map_err(|error| Failure::new("FilePermissionError", error.to_string()))?;
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    let bytes = read_import(&path, &state.protected_roots)?;
    // Binary IPC avoids serializing a potentially large Word ZIP as JSON numbers.
    let mut payload = Vec::with_capacity(4 + name.len() + bytes.len());
    payload.extend_from_slice(&(name.len() as u32).to_le_bytes());
    payload.extend_from_slice(name.as_bytes());
    payload.extend_from_slice(&bytes);
    Ok(tauri::ipc::Response::new(payload))
}

#[tauri::command]
async fn associated_manuscripts(state: tauri::State<'_, Desktop>) -> Result<Vec<Value>> {
    let paths = std::mem::take(
        &mut *state
            .pending
            .lock()
            .map_err(|_| Failure::new("StorageError", "The open-file queue is unavailable."))?,
    );
    Ok(paths
        .iter()
        .map(|path| {
            let name = path.file_name().unwrap_or_default().to_string_lossy();
            let source = read_import(path, &state.protected_roots).and_then(|bytes| {
                String::from_utf8(bytes)
                    .map_err(|_| Failure::new("FileEncodingError", "STF documents must use UTF-8."))
            });
            match source {
                Ok(source) => json!({"name":name, "source":source}),
                Err(error) => json!({"name":name, "error":error.message}),
            }
        })
        .collect())
}

#[tauri::command]
async fn desktop_export(
    app: tauri::AppHandle,
    state: tauri::State<'_, Desktop>,
    name: String,
    bytes: Vec<u8>,
) -> Result<()> {
    let extension = name.rsplit('.').next().unwrap_or_default();
    if name.contains(['/', '\\', ':'])
        || !["stf", "txt", "docx", "epub", "pdf", "png"].contains(&extension)
    {
        return Err(Failure::new("FileError", "Invalid export filename."));
    }
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Export manuscript")
        .set_file_name(&name)
        .add_filter("Manuscript", &[extension]);
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&window);
    }
    let path = dialog
        .blocking_save_file()
        .ok_or_else(|| Failure::new("AbortError", "Export cancelled."))?
        .into_path()
        .map_err(|error| Failure::new("FilePermissionError", error.to_string()))?;
    let parent = path
        .parent()
        .ok_or_else(|| Failure::new("FileError", "Choose an export folder."))?
        .canonicalize()?;
    if protected(&parent, &state.protected_roots) {
        return Err(Failure::new(
            "FilePermissionError",
            "Choose an export folder outside application data.",
        ));
    }
    let filename = path
        .file_name()
        .ok_or_else(|| Failure::new("FileError", "Choose an export filename."))?;
    storage::export_file(&parent.join(filename), &bytes)
}

#[tauri::command]
fn desktop_close(app: tauri::AppHandle, state: tauri::State<'_, Desktop>) {
    state.closing.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[tauri::command]
fn print_manuscript(window: tauri::WebviewWindow) -> Result<()> {
    window
        .print()
        .map_err(|error| Failure::new("PrintError", error.to_string()))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            let base = root
                .parent()
                .ok_or("Application data has no parent directory")?;
            std::fs::create_dir_all(base)?;
            let base = base.canonicalize()?;
            let identifier = app.config().identifier.as_str();
            let previous = match identifier {
                "com.scribeforge.desktop" => "com.storyforge.desktop",
                "com.scribeforge.desktop.dev" => "com.storyforge.desktop.dev",
                _ => return Err("Unexpected ScribeForge application identifier.".into()),
            };
            let root = base.join(identifier);
            let protected_roots = [
                "com.scribeforge.desktop",
                "com.scribeforge.desktop.dev",
                "com.storyforge.desktop",
                "com.storyforge.desktop.dev",
                "com.scriptforge.desktop",
                "com.scriptforge.desktop.dev",
            ]
            .iter()
            .map(|identifier| base.join(identifier))
            .collect();
            let paths = std::env::args_os()
                .skip(1)
                .map(PathBuf::from)
                .filter(|path| is_stf(path))
                .collect();
            let library = Library::new(root.join("manuscripts")).map_err(|error| error.message)?;
            library
                .migrate_from(&base.join(previous).join("manuscripts"))
                .map_err(|error| {
                    format!(
                        "Could not copy the previous library. Original documents were kept. {}",
                        error.message
                    )
                })?;
            app.manage(Desktop {
                library,
                pending: Mutex::new(paths),
                closing: AtomicBool::new(false),
                protected_roots,
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if !window.state::<Desktop>().closing.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.emit("scribeforge-close-requested", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            manuscripts,
            associated_manuscripts,
            desktop_import,
            desktop_export,
            desktop_close,
            print_manuscript
        ])
        .build(tauri::generate_context!())
        .expect("ScribeForge could not start")
        .run(|app, event| match event {
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Opened { urls } => {
                if let Ok(mut pending) = app.state::<Desktop>().pending.lock() {
                    pending.extend(
                        urls.into_iter()
                            .filter_map(|url| url.to_file_path().ok())
                            .filter(|path| is_stf(path)),
                    );
                }
                let _ = app.emit("scribeforge-open-requested", ());
            }
            tauri::RunEvent::ExitRequested { api, .. }
                if !app.state::<Desktop>().closing.load(Ordering::SeqCst) =>
            {
                api.prevent_exit();
                let _ = app.emit("scribeforge-close-requested", ());
            }
            _ => {}
        });
}
