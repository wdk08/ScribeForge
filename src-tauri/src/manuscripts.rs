use crate::storage::{atomic_replace, exclusive, Failure, Result};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

pub const MAX_FILE: usize = 50 * 1024 * 1024;

pub struct Library {
    root: PathBuf,
}

fn storage_error(message: &str) -> Failure {
    Failure::new("StorageError", message)
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 120
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}

fn read_record(path: &Path) -> Result<Option<Value>> {
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if !meta.is_file() || meta.len() > 2 * MAX_FILE as u64 + 65536 {
        return Err(storage_error(
            "Invalid manuscript storage file. The file was preserved.",
        ));
    }
    let record: Value = serde_json::from_slice(&fs::read(path)?)?;
    Ok(Some(record))
}

impl Library {
    pub fn new(root: PathBuf) -> Result<Self> {
        for path in [
            root.parent()
                .ok_or_else(|| storage_error("Invalid manuscript folder."))?,
            root.as_path(),
        ] {
            match fs::symlink_metadata(path) {
                Ok(meta) if meta.is_dir() && path.canonicalize()? == path => {}
                Ok(_) => {
                    return Err(storage_error(
                        "The manuscript storage path contains a symbolic link.",
                    ))
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    if let Err(error) = fs::create_dir(path) {
                        if error.kind() != std::io::ErrorKind::AlreadyExists
                            || !fs::symlink_metadata(path)?.is_dir()
                            || path.canonicalize()? != path
                        {
                            return Err(error.into());
                        }
                    }
                }
                Err(error) => return Err(error.into()),
            }
        }
        Ok(Self { root })
    }

    pub fn run(&self, action: &str, body: &Value) -> Result<Value> {
        if self.root.canonicalize()? != self.root {
            return Err(storage_error(
                "The manuscript storage folder changed. Restart StoryForge to review it.",
            ));
        }
        // Hold one OS lock across the revision check and atomic commit, including
        // when Windows opens an associated document in another process.
        let lock_path = self.root.join(".lock");
        if fs::symlink_metadata(&lock_path).is_ok_and(|meta| !meta.is_file()) {
            return Err(storage_error("Invalid manuscript library lock."));
        }
        let lock = fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(lock_path)?;
        lock.lock()?;

        if action == "list" {
            let mut items = Vec::new();
            for entry in fs::read_dir(&self.root)? {
                let path = entry?.path();
                if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                    continue;
                }
                let Some(id) = path
                    .file_stem()
                    .and_then(|name| name.to_str())
                    .filter(|id| valid_id(id))
                else {
                    continue;
                };
                match read_record(&path) {
                    Ok(Some(record)) if record["deletedAt"].is_null() => items.push(json!({
                        "id": id, "metadata": record["current"]["metadata"], "updated": record["updated"],
                        "preview": record["preview"], "revision": record["revision"], "activity": record["activity"]
                    })),
                    Ok(_) => {},
                    Err(error) => items.push(json!({"id": id, "error":error.message})),
                }
            }
            return Ok(json!(items));
        }

        let id = body["id"]
            .as_str()
            .filter(|id| valid_id(id))
            .ok_or_else(|| storage_error("Invalid manuscript identifier."))?;
        let path = self.root.join(format!("{id}.json"));
        let stored = read_record(&path)?;
        if action == "get" {
            return Ok(stored
                .filter(|record| record["deletedAt"].is_null() || body["includeDeleted"] == true)
                .unwrap_or(Value::Null));
        }
        if !["put", "archive", "restore"].contains(&action) {
            return Err(storage_error("Unknown manuscript storage operation."));
        }

        let current = &body["current"];
        let revision = stored
            .as_ref()
            .map_or(Some(0), |record| record["revision"].as_u64())
            .ok_or_else(|| {
                storage_error("Invalid stored revision. The original file was preserved.")
            })?;
        if body["revision"].as_u64() != Some(revision) {
            return Err(storage_error("This manuscript changed in another window. Export your version or save it as a new manuscript."));
        }
        let next = revision
            .checked_add(1)
            .ok_or_else(|| storage_error("Invalid stored revision."))?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        if action != "put" {
            let mut record = stored.ok_or_else(|| storage_error("The manuscript is missing."))?;
            if record["id"] != id || record["deletedAt"].is_null() != (action == "archive") {
                return Err(storage_error(
                    "The manuscript is no longer available for this action.",
                ));
            }
            record["deletedAt"] = if action == "archive" {
                json!(now)
            } else {
                Value::Null
            };
            record["revision"] = json!(next);
            atomic_replace(&path, &serde_json::to_vec(&record)?)?;
            return Ok(json!(next));
        }
        if stored
            .as_ref()
            .is_some_and(|record| !record["deletedAt"].is_null())
        {
            return Err(storage_error("This manuscript was removed from the library. Save your changes as a new manuscript."));
        }
        if current["documentId"] != id
            || current["format"] != "storyforge"
            || current["version"] != 1
            || !current["content"]["content"].is_array()
            || serde_json::to_vec(current)?.len() > MAX_FILE
        {
            return Err(storage_error(
                "Invalid or oversized manuscript. Your previous save was preserved.",
            ));
        }
        if let Some(record) = &stored {
            if record["current"]["documentId"] != id || record["current"]["version"] != 1 {
                return Err(storage_error("The stored manuscript requires recovery. Save this version as a new manuscript."));
            }
        }

        let record = json!({
            "id":id, "revision":next, "current":current, "preview":body["preview"],
            "previous": stored.as_ref().map(|record| &record["current"]),
            "activity": body.get("activity").or_else(|| stored.as_ref().and_then(|record| record.get("activity"))),
            "updated":now
        });
        let bytes = serde_json::to_vec(&record)?;
        if stored.is_some() {
            atomic_replace(&path, &bytes)?;
        } else {
            exclusive(&path, &bytes)?;
        }
        Ok(json!(next))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storyforge_library_isolation_and_atomic_recovery() {
        let temp = tempfile::tempdir().unwrap();
        let base = temp.path().canonicalize().unwrap();
        let old = base.join("com.scriptforge.desktop");
        fs::create_dir(&old).unwrap();
        fs::write(old.join("original"), b"untouched").unwrap();
        let prod = base.join("com.storyforge.desktop/manuscripts");
        let dev = Library::new(base.join("com.storyforge.desktop.dev/manuscripts")).unwrap();
        let manuscript = |revision, text| {
            json!({"id":"story", "revision": revision, "current": {
                "format":"storyforge", "version":1, "documentId":"story", "metadata":{"title":"Book"}, "content":{"content":[text]}
            }})
        };
        assert_eq!(dev.run("put", &manuscript(0, "Hello 🪶")).unwrap(), 1);
        assert_eq!(dev.run("put", &manuscript(1, "New")).unwrap(), 2);
        assert!(dev.run("put", &manuscript(1, "Stale")).is_err());
        assert!(dev.run("get", &json!({"id":"../original"})).is_err());
        let record = Library::new(dev.root.clone())
            .unwrap()
            .run("get", &json!({"id":"story"}))
            .unwrap();
        assert_eq!(record["current"]["content"]["content"][0], "New");
        assert_eq!(record["previous"]["content"]["content"][0], "Hello 🪶");
        assert_eq!(
            dev.run("archive", &json!({"id":"story","revision":2}))
                .unwrap(),
            3
        );
        assert_eq!(dev.run("get", &json!({"id":"story"})).unwrap(), Value::Null);
        assert_eq!(dev.run("list", &json!({})).unwrap(), json!([]));
        assert!(dev.run("put", &manuscript(3, "Stale")).is_err());
        assert_eq!(
            dev.run("restore", &json!({"id":"story","revision":3}))
                .unwrap(),
            4
        );
        assert_eq!(dev.run("list", &json!({})).unwrap()[0]["revision"], 4);
        assert!(!prod.exists());
        assert_eq!(fs::read(old.join("original")).unwrap(), b"untouched");
    }
}
