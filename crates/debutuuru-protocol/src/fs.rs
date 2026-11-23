//! `fs.*` methods: a plain folder that isn't a repository, browsed read-only
//! (the notes and plans next to a ticket's worktrees). Paths are relative to
//! the folder and never leave it. Like `git.*`, `repo` is the folder's path
//! as seen by the agent; the desktop app fills it in.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub const MODULE: &str = "fs";
/// 1: tree, read_file, read_bytes, stat_paths, list_files, watch/unwatch and
///    `fs.changed`.
pub const MODULE_VERSION: u32 = 1;

/// [`FolderParams`] → `Vec<String>`: every file outside the repositories
/// inside, for quick open.
pub const LIST_FILES: &str = "fs.list_files";

/// [`FolderPathParams`] → `Vec<TreeEntry>`: one level, folders first.
/// Repositories inside come as `submodule`.
pub const TREE: &str = "fs.tree";
/// [`FolderPathParams`] → `FileContent`
pub const READ_FILE: &str = "fs.read_file";
/// [`FolderPathParams`] → `FileBytes` (base64, ≤ 10 MiB).
pub const READ_BYTES: &str = "fs.read_bytes";
/// [`FolderPathsParams`] → `Vec<Option<EntryKind>>`, one per path.
pub const STAT_PATHS: &str = "fs.stat_paths";
/// [`FolderParams`] → `null`. Starts emitting [`CHANGED`] for this folder
/// (idempotent). Repositories inside aren't watched: they have their own tabs.
pub const WATCH: &str = "fs.watch";
/// [`FolderParams`] → `null`
pub const UNWATCH: &str = "fs.unwatch";

/// Event: [`FolderChangedEvent`], files in the folder changed.
pub const CHANGED: &str = "fs.changed";

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FolderParams {
    /// The folder.
    pub repo: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FolderPathParams {
    pub repo: String,
    /// Relative to the folder, `/`-separated; `""` = the folder itself.
    #[serde(default)]
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FolderPathsParams {
    pub repo: String,
    /// Relative to the folder (at most 64).
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FolderChangedEvent {
    /// Same string the app passed to `fs.watch`.
    pub repo: String,
}
