use serde::Serialize;

use sha2::{Digest, Sha256};
use std::{fs, io::Write, path::Path};
use tempfile::NamedTempFile;

#[derive(Debug, Serialize)]
pub struct Failure {
    pub name: String,
    pub message: String,
}
pub type Result<T> = std::result::Result<T, Failure>;
impl Failure {
    pub fn new(name: &str, message: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            message: message.into(),
        }
    }
}
impl From<std::io::Error> for Failure {
    fn from(error: std::io::Error) -> Self {
        let name = match error.kind() {
            std::io::ErrorKind::NotFound => "NotFoundError",
            std::io::ErrorKind::PermissionDenied => "FilePermissionError",
            std::io::ErrorKind::InvalidData => "FileEncodingError",
            _ => "Error",
        };
        Self::new(name, error.to_string())
    }
}
impl From<serde_json::Error> for Failure {
    fn from(error: serde_json::Error) -> Self {
        Self::new("StorageError", error.to_string())
    }
}
pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn sync_parent(path: &Path) -> Result<()> {
    #[cfg(unix)]
    fs::File::open(
        path.parent()
            .ok_or_else(|| Failure::new("Error", "Missing parent folder."))?,
    )?
    .sync_all()?;
    Ok(())
}
fn staged(path: &Path, bytes: &[u8]) -> Result<NamedTempFile> {
    let mut file = NamedTempFile::new_in(
        path.parent()
            .ok_or_else(|| Failure::new("Error", "Missing parent folder."))?,
    )?;
    file.write_all(bytes)?;
    file.as_file().sync_all()?;
    Ok(file)
}
pub(crate) fn atomic_replace(path: &Path, bytes: &[u8]) -> Result<()> {
    let file = staged(path, bytes)?;
    if let Ok(metadata) = fs::metadata(path) {
        file.as_file().set_permissions(metadata.permissions())?;
    }
    file.persist(path)
        .map_err(|error| Failure::from(error.error))?;
    sync_parent(path)
}
pub(crate) fn exclusive(path: &Path, bytes: &[u8]) -> Result<()> {
    staged(path, bytes)?
        .persist_noclobber(path)
        .map_err(|error| Failure::from(error.error))?;
    sync_parent(path)
}
/// Export destinations are selected separately from autosave and always use an OS save dialog.
pub fn export_file(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Ok(info) = fs::symlink_metadata(path) {
        if info.file_type().is_symlink() {
            return Err(Failure::new(
                "FilePermissionError",
                "Select the actual export destination, not a symbolic link.",
            ));
        }
    }
    let before = fs::read(path).ok().map(|bytes| hash(&bytes));
    let pending = staged(path, bytes)?;
    if let Ok(info) = fs::metadata(path) {
        pending.as_file().set_permissions(info.permissions())?;
    }
    if fs::read(path).ok().map(|bytes| hash(&bytes)) != before {
        return Err(Failure::new(
            "FileConflictError",
            "The export destination changed while saving. Export again.",
        ));
    }
    if before.is_none() {
        pending
            .persist_noclobber(path)
            .map_err(|error| Failure::from(error.error))?;
    } else {
        pending
            .persist(path)
            .map_err(|error| Failure::from(error.error))?;
    }
    sync_parent(path)
}
