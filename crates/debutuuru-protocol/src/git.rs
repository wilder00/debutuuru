//! `git.*` methods. Every request names the repository by its path *as seen by
//! the agent* (a Linux path for a WSL agent); the desktop app translates.

use debutuuru_core::repo::{Branch, RepoInfo, Status, Worktree};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub const MODULE: &str = "git";
/// 2: added `git.watch` / `git.unwatch` and the `git.changed` event.
pub const MODULE_VERSION: u32 = 2;

/// [`RepoParams`] → [`Snapshot`]
pub const SNAPSHOT: &str = "git.snapshot";
/// [`LogParams`] → `Vec<LogEntry>`
pub const LOG: &str = "git.log";
/// [`PathsParams`] → `null`
pub const STAGE: &str = "git.stage";
/// [`PathsParams`] → `null`
pub const UNSTAGE: &str = "git.unstage";
/// [`CommitParams`] → `string` (git output)
pub const COMMIT: &str = "git.commit";
/// [`CheckoutParams`] → `null`
pub const CHECKOUT: &str = "git.checkout";
/// [`DiffParams`] → `string` (unified diff)
pub const DIFF: &str = "git.diff";
/// [`RepoParams`] → `null`. Starts emitting [`CHANGED`] for this repo (idempotent).
pub const WATCH: &str = "git.watch";
/// [`RepoParams`] → `null`
pub const UNWATCH: &str = "git.unwatch";

/// Event topic, payload [`ChangedEvent`]: files, index or refs changed
/// (debounced). The UI reloads the repo.
pub const CHANGED: &str = "git.changed";

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChangedEvent {
    /// Same string the app passed to `git.watch`.
    pub repo: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RepoParams {
    pub repo: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LogParams {
    pub repo: String,
    pub limit: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PathsParams {
    pub repo: String,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CommitParams {
    pub repo: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CheckoutParams {
    pub repo: String,
    pub branch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DiffParams {
    pub repo: String,
    pub path: String,
    pub staged: bool,
    pub untracked: bool,
}

/// Everything the sidebar and changes panel need, in one round trip.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Snapshot {
    pub info: RepoInfo,
    pub status: Status,
    pub branches: Vec<Branch>,
    pub worktrees: Vec<Worktree>,
}
