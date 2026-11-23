//! `fs.*` methods: read-only browsing of a plain folder (see
//! `debutuuru_protocol::fs`), and watching it.

use crate::watch::{self, FolderWatch};
use crate::{handle_with, Events, Module};
use debutuuru_core::files::Folder;
use debutuuru_protocol::fs::*;
use debutuuru_protocol::{ModuleInfo, RpcError};
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

pub struct FsModule {
    /// Active watchers by folder. Dropping one stops it.
    watches: Mutex<HashMap<String, FolderWatch>>,
    events: Events,
}

impl FsModule {
    pub fn new(events: Events) -> Self {
        Self {
            watches: Mutex::default(),
            events,
        }
    }

    fn watch(&self, folder: String) -> Result<(), String> {
        let mut watches = self.watches.lock().unwrap_or_else(|e| e.into_inner());
        if watches.contains_key(&folder) {
            return Ok(());
        }
        let events = self.events.clone();
        let key = folder.clone();
        let w = watch::watch_folder(Path::new(&folder), move || {
            events.emit(CHANGED, FolderChangedEvent { repo: key.clone() })
        })
        .map_err(|e| format!("cannot watch {folder}: {e}"))?;
        watches.insert(folder, w);
        Ok(())
    }
}

impl Module for FsModule {
    fn info(&self) -> ModuleInfo {
        ModuleInfo {
            name: MODULE.into(),
            version: MODULE_VERSION,
        }
    }

    fn handle(&self, method: &str, params: Value) -> Option<Result<Value, RpcError>> {
        Some(match method {
            TREE => handle_with(params, |p: FolderPathParams| {
                Folder::new(&p.repo).tree(&p.path)
            }),
            READ_FILE => handle_with(params, |p: FolderPathParams| {
                Folder::new(&p.repo).read_file(&p.path)
            }),
            READ_BYTES => handle_with(params, |p: FolderPathParams| {
                Folder::new(&p.repo).read_bytes(&p.path)
            }),
            STAT_PATHS => handle_with(params, |p: FolderPathsParams| {
                Folder::new(&p.repo).stat_paths(&p.paths)
            }),
            LIST_FILES => handle_with(params, |p: FolderParams| Folder::new(&p.repo).list_files()),
            WATCH => handle_with(params, |p: FolderParams| self.watch(p.repo)),
            UNWATCH => handle_with(params, |p: FolderParams| {
                self.watches
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(&p.repo);
                Ok::<_, String>(())
            }),
            _ => return None,
        })
    }
}
