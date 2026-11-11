// Keep updater URLs, verified artifacts, and installer execution on the native side.
use serde::Serialize;
use std::{
    sync::atomic::Ordering,
    time::{Duration, Instant},
};
use tauri::{async_runtime::Mutex, AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub struct Updates(Mutex<Pending>);

#[derive(Default)]
struct Pending {
    checked: bool,
    dismissed: bool,
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
}

#[derive(Serialize)]
pub struct Available {
    version: String,
}

fn configured(app: &AppHandle) -> bool {
    app.config().identifier == "com.scribeforge.desktop"
        && app
            .config()
            .plugins
            .0
            .get("updater")
            .and_then(|config| config.get("pubkey"))
            .and_then(|key| key.as_str())
            .is_some_and(|key| !key.trim().is_empty())
}

#[tauri::command]
pub async fn desktop_update_check(
    app: AppHandle,
    state: State<'_, Updates>,
) -> Result<Option<Available>, String> {
    if !configured(&app) {
        return Ok(None);
    }
    let mut pending = state.0.lock().await;
    if !pending.checked {
        pending.checked = true;
        let updater = app
            .updater_builder()
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|error| error.to_string())?;
        if let Some(mut update) = updater.check().await.map_err(|error| error.to_string())? {
            let url = &update.download_url;
            if url.scheme() != "https"
                || url.host_str() != Some("github.com")
                || !url
                    .path()
                    .starts_with("/wdk08/ScribeForge/releases/download/")
                || url.port().is_some()
                || !url.username().is_empty()
                || url.password().is_some()
                || update.signature.trim().is_empty()
            {
                return Err(
                    "The ScribeForge update has an invalid release URL or signature.".into(),
                );
            }
            update.timeout = Some(Duration::from_secs(300));
            pending.update = Some(update);
        }
    }
    Ok(pending
        .update
        .as_ref()
        .filter(|_| !pending.dismissed)
        .map(|update| Available {
            version: update.version.clone(),
        }))
}

#[tauri::command]
pub async fn desktop_update_dismiss(state: State<'_, Updates>) -> Result<(), String> {
    let mut pending = state.0.lock().await;
    pending.dismissed = true;
    pending.bytes = None;
    Ok(())
}

#[tauri::command]
pub async fn desktop_update_download(
    app: AppHandle,
    state: State<'_, Updates>,
) -> Result<(), String> {
    let mut pending = state.0.lock().await;
    let update = pending
        .update
        .as_ref()
        .filter(|_| !pending.dismissed)
        .ok_or("No update is available.")?;
    if pending.bytes.is_some() {
        return Ok(());
    }
    let mut downloaded = 0u64;
    let mut last_progress = None::<Instant>;
    let bytes = update
        .download(
            |chunk, total| {
                downloaded += chunk as u64;
                if last_progress.is_none_or(|time| time.elapsed() >= Duration::from_millis(120))
                    || total == Some(downloaded)
                {
                    last_progress = Some(Instant::now());
                    let _ = app.emit(
                        "scribeforge-update-progress",
                        serde_json::json!({ "downloaded": downloaded, "total": total }),
                    );
                }
            },
            || {},
        )
        .await
        .map_err(|error| error.to_string())?;
    pending.bytes = Some(bytes);
    Ok(())
}

#[tauri::command]
pub async fn desktop_update_install(
    app: AppHandle,
    state: State<'_, Updates>,
) -> Result<(), String> {
    let mut pending = state.0.lock().await;
    let update = pending
        .update
        .as_ref()
        .filter(|_| !pending.dismissed)
        .ok_or("No update is available.")?
        .clone();
    let bytes = pending
        .bytes
        .take()
        .ok_or("Download and verify the update first.")?;
    // The webview invokes this command only after locking editing and flushing the manuscript.
    // On Windows Tauri hands off to NSIS, which restarts the application after installation.
    tauri::async_runtime::spawn_blocking(move || update.install(bytes))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    pending.dismissed = true;
    app.state::<super::Desktop>()
        .closing
        .store(true, Ordering::SeqCst);
    app.request_restart();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use serde_json::json;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };

    // Public Tauri updater fixture. Its signature binds the payload "test" to version 2.0.0.
    const KEY: &str = "untrusted comment: minisign public key: A49EF4746FA6E6D7\nRWTX5qZvdPSepDGWg2bz8n6ArQnBMwgQK1geVosorcbLzcunD+KJ+cYe";
    const SIGNATURE: &str = "untrusted comment: signature from tauri secret key\nRUTX5qZvdPSepPF2zsjvP/L/TQtBLRnWRvaq+4omK1UEugtQp/USrGiI1v762sDy3id3aor7bRC9ETyeot6lMHHrWoZ5hjUM1Qc=\ntrusted comment: timestamp:1791649051\tfile:payload\tversion:2.0.0\nDDq2CLOEl5cQmC2eJRHlnZPVViOZsu1CjpPKQoei4A/XBfkDqGO0B+QMrcrHgEQ5qV3mne75tdFWhJpqUXh9AA==";

    #[test]
    fn updater_detects_newer_version_reports_progress_and_checks_signature() {
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().plugins.0.insert(
            "updater".into(),
            json!({
                "pubkey": STANDARD.encode(KEY),
                "requireSignedVersion": true,
                "dangerousInsecureTransportProtocol": true,
            }),
        );
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .build(context)
            .unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let mut manifest = json!({
            "version": "2.0.0",
            "platforms": { "test-target": { "url": format!("{base}/payload"), "signature": STANDARD.encode(SIGNATURE) }},
        });
        let manifest_bytes = manifest.to_string().into_bytes();
        let server = thread::spawn(move || {
            for body in [&manifest_bytes[..], b"test"] {
                let (mut socket, _) = listener.accept().unwrap();
                let mut request = [0; 4096];
                socket.read(&mut request).unwrap();
                write!(
                    socket,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                )
                .unwrap();
                socket.write_all(body).unwrap();
            }
        });
        let updater = app
            .updater_builder()
            .target("test-target")
            .timeout(Duration::from_secs(5))
            .no_proxy()
            .endpoints(vec![format!("{base}/latest.json").parse().unwrap()])
            .unwrap()
            .build()
            .unwrap();
        tauri::async_runtime::block_on(async {
            let update = updater.check().await.unwrap().unwrap();
            assert_eq!(update.version, "2.0.0");
            let mut downloaded = 0;
            let bytes = update
                .download(
                    |chunk, total| {
                        assert_eq!(total, Some(4));
                        downloaded += chunk;
                    },
                    || {},
                )
                .await
                .unwrap();
            assert_eq!(downloaded, 4);
            assert_eq!(bytes, b"test");
            assert!(update.verify(b"tampered").is_err());
            manifest["version"] = json!("3.0.0");
            let mismatch = updater.restore_update(manifest.clone()).unwrap().unwrap();
            assert!(mismatch.verify(&bytes).is_err());
            manifest["version"] = json!("0.0.0");
            assert!(updater.restore_update(manifest).unwrap().is_none());
        });
        server.join().unwrap();
    }
}
