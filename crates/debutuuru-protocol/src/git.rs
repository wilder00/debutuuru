//! `git.*` methods. Every request names the repository by its path *as seen by
//! the agent* (a Linux path for a WSL agent); the desktop app translates.

use debutuuru_core::repo::{Branch, Remote, RepoInfo, Status, Worktree};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub const MODULE: &str = "git";
/// 2: `git.watch` / `git.unwatch` and the `git.changed` event.
/// 3: remote operations (fetch/pull/push), progress and credential prompts,
///    `remotes` in [`Snapshot`].
pub const MODULE_VERSION: u32 = 3;

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

/// [`FetchParams`] → [`OpOutcome`]
pub const FETCH: &str = "git.fetch";
/// [`PullParams`] → [`OpOutcome`]
pub const PULL: &str = "git.pull";
/// [`PushParams`] → [`OpOutcome`]
pub const PUSH: &str = "git.push";
/// [`CancelParams`] → `null`. Stops a running remote operation.
pub const CANCEL: &str = "git.cancel";
/// [`PromptReply`] → `null`. Answers a [`PROMPT`] event.
pub const PROMPT_REPLY: &str = "git.prompt_reply";

/// Event topic, payload [`ChangedEvent`]: files, index or refs changed
/// (debounced). The UI reloads the repo.
pub const CHANGED: &str = "git.changed";
/// Event topic, payload [`ProgressEvent`].
pub const PROGRESS: &str = "git.progress";
/// Event topic, payload [`PromptEvent`]: git or ssh needs input from the user
/// (passphrase, password, unknown host key). Answer with [`PROMPT_REPLY`].
pub const PROMPT: &str = "git.prompt";

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

/// Options shared by every remote operation.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct RemoteOptions {
    /// Chosen by the app; used for progress events and [`CANCEL`].
    pub op_id: String,
    /// Overrides the SSH program (`GIT_SSH_COMMAND`), e.g. `wsl.exe -e ssh` so
    /// Windows repos use the SSH keys that live in WSL. `None` = the user's
    /// own git/ssh configuration, untouched.
    pub ssh_command: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FetchParams {
    pub repo: String,
    #[serde(flatten)]
    #[ts(flatten)]
    pub options: RemoteOptions,
    /// `None` = all remotes.
    #[serde(default)]
    pub remote: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum PullMode {
    /// Whatever the user's git config says (`pull.rebase`, `pull.ff`).
    #[default]
    Default,
    FfOnly,
    Rebase,
    Merge,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PullParams {
    pub repo: String,
    #[serde(flatten)]
    #[ts(flatten)]
    pub options: RemoteOptions,
    #[serde(default)]
    pub mode: PullMode,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PushParams {
    pub repo: String,
    #[serde(flatten)]
    #[ts(flatten)]
    pub options: RemoteOptions,
    /// `--force-with-lease`: refuses if the remote moved since the last fetch.
    #[serde(default)]
    pub force_with_lease: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CancelParams {
    pub op_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ProgressEvent {
    pub repo: String,
    pub op_id: String,
    /// Latest progress line from git, e.g. "Receiving objects:  45% (90/200)".
    pub text: String,
    pub percent: Option<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum PromptKind {
    /// Password, passphrase, token: hide the input.
    Secret,
    /// Username and other visible text.
    Text,
    /// yes/no question, e.g. accepting a new SSH host key.
    Confirm,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PromptEvent {
    /// Answer with this id.
    pub id: String,
    pub repo: String,
    pub op_id: String,
    /// Exactly what git/ssh asked (may contain a host key fingerprint).
    pub prompt: String,
    pub kind: PromptKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PromptReply {
    pub repo: String,
    pub id: String,
    /// `None` cancels: git/ssh treat it as a failed authentication.
    pub answer: Option<String>,
}

/// Why a remote operation failed, so the UI can say what to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum FailureHint {
    /// SSH key not accepted / no key available.
    SshAuth,
    /// HTTPS credentials rejected.
    HttpsAuth,
    /// The host key is unknown or changed.
    HostKey,
    /// Remote has commits you don't have: pull first.
    Rejected,
    /// Local and remote diverged and git needs a pull strategy.
    Diverged,
    /// Uncommitted changes block the pull.
    LocalChanges,
    Conflict,
    Network,
    NoRemote,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct OpOutcome {
    pub ok: bool,
    /// One-line, human summary ("Pushed main → origin/main").
    pub summary: String,
    pub hint: Option<FailureHint>,
    /// git's output (stderr), for a "details" view. Never contains answers to prompts.
    pub log: String,
}

/// Everything the sidebar and changes panel need, in one round trip.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Snapshot {
    pub info: RepoInfo,
    pub status: Status,
    pub branches: Vec<Branch>,
    pub worktrees: Vec<Worktree>,
    /// Added in module v3.
    #[serde(default)]
    pub remotes: Vec<Remote>,
    /// Tracking branch of HEAD, e.g. `origin/main`. Added in module v3.
    #[serde(default)]
    pub upstream: Option<String>,
}
