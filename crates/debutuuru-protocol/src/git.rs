//! `git.*` methods. Every request names the repository by its path *as seen by
//! the agent* (a Linux path for a WSL agent); the desktop app translates.

use debutuuru_core::changes::DiffSource;
use debutuuru_core::repo::{Branch, Remote, RepoInfo, Status, Worktree};
use debutuuru_core::tags::Tag;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub const MODULE: &str = "git";
/// 2: `git.watch` / `git.unwatch` and the `git.changed` event.
/// 3: remote operations (fetch/pull/push), progress and credential prompts,
///    `remotes` in [`Snapshot`].
/// 4: file browsing: `git.tree` and `git.read_file`.
/// 5: [`OpOutcome::message`], so UIs can word (and translate) the summary.
/// 6: commit changes and diffs of any kind: `git.commit_details` and
///    `git.file_versions`.
/// 7: `git.stat_paths` (follow imports and links) and `git.read_bytes`
///    (images in rendered Markdown).
/// 8: `git.list_files` (quick open).
/// 9: tags: `tags` in [`Snapshot`], `git.create_tag`, `git.delete_tag`,
///    `git.push_tag`, and their [`OutcomeMessage`]s.
/// 10: `git.find_repos` (open a folder of repositories).
/// 11: `DiffSource::Head` and `git.last_change` (a file's changes in Files).
/// 12: deleting branches: `git.branch_deletion_info`, `git.delete_branches`,
///     `git.delete_remote_branches`.
/// 13: `git.update_branch` (bring one branch up to date from its remote
///     without checking it out).
/// 14: `git.grep` (find where a name is defined).
pub const MODULE_VERSION: u32 = 14;

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
/// [`TreeParams`] → `Vec<TreeEntry>`: one folder level, working tree or a commit.
pub const TREE: &str = "git.tree";
/// [`ReadFileParams`] → [`FileContent`]
pub const READ_FILE: &str = "git.read_file";
/// [`RevParams`] → [`debutuuru_core::changes::CommitDetails`]: message, author
/// and the files changed against the first parent.
pub const COMMIT_DETAILS: &str = "git.commit_details";
/// [`FileVersionsParams`] → [`debutuuru_core::changes::FileVersions`]: both
/// sides of a file, so the UI draws any diff view itself.
pub const FILE_VERSIONS: &str = "git.file_versions";
/// [`ReadFileParams`] → `Option<`[`debutuuru_core::changes::LastChange`]`>`: the
/// last commit that changed the file, at `rev` (default HEAD) or before.
pub const LAST_CHANGE: &str = "git.last_change";
/// [`StatPathsParams`] → `Vec<Option<EntryKind>>`, one per path: what exists.
pub const STAT_PATHS: &str = "git.stat_paths";
/// [`GrepParams`] → `Vec<`[`debutuuru_core::search::GrepMatch`]`>`: lines
/// matching any of the patterns.
pub const GREP: &str = "git.grep";
/// [`ReadFileParams`] → [`debutuuru_core::files::FileBytes`] (base64, ≤ 10 MiB).
pub const READ_BYTES: &str = "git.read_bytes";
/// [`TreeParams`] (only `rev` is used) → `Vec<String>`: every file, for quick open.
pub const LIST_FILES: &str = "git.list_files";
/// [`RepoParams`] (`repo` = any folder) → [`debutuuru_core::discover::FoundRepos`]:
/// whether it is a repository, or which repositories are inside it.
pub const FIND_REPOS: &str = "git.find_repos";
/// [`BranchesParams`] → `Vec<`[`debutuuru_core::branches::BranchDeletion`]`>`:
/// what deleting each branch would mean, before deleting anything.
pub const BRANCH_DELETION_INFO: &str = "git.branch_deletion_info";
/// [`DeleteBranchesParams`] → `Vec<`[`debutuuru_core::branches::DeleteResult`]`>`
/// (local branches; one refusal doesn't stop the others).
pub const DELETE_BRANCHES: &str = "git.delete_branches";
/// [`CreateTagParams`] → `null`
pub const CREATE_TAG: &str = "git.create_tag";
/// [`TagParams`] → `null`: deletes the local tag only.
pub const DELETE_TAG: &str = "git.delete_tag";
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
/// [`PushTagParams`] → [`OpOutcome`]: pushes a tag, or deletes it on the remote.
/// [`DeleteRemoteBranchesParams`] → [`OpOutcome`]: `git push <remote> --delete …`.
pub const DELETE_REMOTE_BRANCHES: &str = "git.delete_remote_branches";
pub const PUSH_TAG: &str = "git.push_tag";
/// [`UpdateBranchParams`] → [`OpOutcome`]: fast-forwards a local branch that
/// isn't checked out from its upstream, or fetches one remote branch.
pub const UPDATE_BRANCH: &str = "git.update_branch";
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
pub struct CreateTagParams {
    pub repo: String,
    pub name: String,
    /// Commit to tag (any revision git understands).
    pub rev: String,
    /// Annotated tag with this message; `None` = lightweight.
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BranchesParams {
    pub repo: String,
    /// As listed: `feature/x`, or `origin/feature/x` for remote branches.
    pub branches: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DeleteBranchesParams {
    pub repo: String,
    /// Local branch names.
    pub branches: Vec<String>,
    /// `git branch -D`: also branches that aren't merged.
    #[serde(default)]
    pub force: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DeleteRemoteBranchesParams {
    pub repo: String,
    #[serde(flatten)]
    #[ts(flatten)]
    pub options: RemoteOptions,
    pub remote: String,
    /// Names on the remote (`feature/x`, not `origin/feature/x`).
    pub branches: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TagParams {
    pub repo: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PushTagParams {
    pub repo: String,
    #[serde(flatten)]
    #[ts(flatten)]
    pub options: RemoteOptions,
    pub name: String,
    /// Delete the tag on the remote instead of pushing it.
    #[serde(default)]
    pub delete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DiffParams {
    pub repo: String,
    pub path: String,
    pub staged: bool,
    pub untracked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StatPathsParams {
    pub repo: String,
    /// Commit; `None` = the working tree.
    #[serde(default)]
    #[ts(optional)]
    pub rev: Option<String>,
    /// Repo-relative, `/`-separated (at most 64).
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GrepParams {
    pub repo: String,
    /// Commit; `None` = the working tree (tracked and untracked files).
    #[serde(default)]
    #[ts(optional)]
    pub rev: Option<String>,
    /// POSIX extended regexes; a line matches if any does (at most 32).
    pub patterns: Vec<String>,
    /// Git pathspecs (`*.ts`…) limiting the files; empty = all.
    #[serde(default)]
    #[ts(optional)]
    pub paths: Option<Vec<String>>,
    /// Most matches returned (default 200, at most 1000).
    #[serde(default)]
    #[ts(optional)]
    pub max: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RevParams {
    pub repo: String,
    /// Any revision git understands (a hash, `HEAD~2`…).
    pub rev: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FileVersionsParams {
    pub repo: String,
    pub source: DiffSource,
    pub path: String,
    /// Old name of a renamed or copied file.
    #[serde(default)]
    #[ts(optional)]
    pub orig_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TreeParams {
    pub repo: String,
    /// Commit (any revision git understands); `None` = the working tree.
    #[serde(default)]
    #[ts(optional)]
    pub rev: Option<String>,
    /// Folder relative to the repo root, `/`-separated; `""` = root.
    #[serde(default)]
    pub path: String,
    /// Include .gitignored entries (working tree only), flagged `ignored`.
    #[serde(default)]
    pub show_ignored: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ReadFileParams {
    pub repo: String,
    /// Commit; `None` = the working tree.
    #[serde(default)]
    #[ts(optional)]
    pub rev: Option<String>,
    pub path: String,
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
pub struct UpdateBranchParams {
    pub repo: String,
    #[serde(flatten)]
    #[ts(flatten)]
    pub options: RemoteOptions,
    /// As listed: local `feature/x` or remote `origin/feature/x`.
    pub branch: String,
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
    /// One-line, human summary in English ("Pushed main → origin/main").
    pub summary: String,
    pub hint: Option<FailureHint>,
    /// git's output (stderr), for a "details" view. Never contains answers to prompts.
    pub log: String,
    /// What `summary` says, as data, so a UI can word it in its own language.
    /// `None` when the summary is git's own error line, and from agents
    /// older than module version 5.
    #[serde(default)]
    pub message: Option<OutcomeMessage>,
}

/// The outcomes the agent words itself; see [`OpOutcome::message`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum OutcomeMessage {
    /// `remote: None` = all remotes.
    Fetched {
        remote: Option<String>,
    },
    UpToDate,
    Pulled {
        upstream: String,
    },
    NothingToPush,
    Pushed {
        branch: String,
        target: String,
    },
    /// Pull without an upstream branch.
    NoUpstream,
    /// Push from a repository without remotes.
    NoRemote,
    /// Publishing a branch when several remotes could take it.
    SeveralRemotes,
    Cancelled,
    /// The user rejected the server's host key.
    HostKeyDeclined,
    TagPushed {
        tag: String,
        remote: String,
    },
    TagDeletedOnRemote {
        tag: String,
        remote: String,
    },
    RemoteBranchesDeleted {
        remote: String,
        branches: Vec<String>,
    },
    /// `branch` now matches `from` (a local branch's upstream, or the
    /// remote's copy of a remote branch).
    BranchUpdated {
        branch: String,
        from: String,
    },
    /// Nothing new on the remote for `branch`.
    BranchUpToDate {
        branch: String,
    },
    /// `branch` has commits its upstream doesn't: it can't just move forward.
    BranchDiverged {
        branch: String,
        upstream: String,
    },
    /// Checked out in another worktree: update it there (pull).
    BranchInWorktree {
        branch: String,
        worktree: String,
    },
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
    /// Newest first. Added in module v9.
    #[serde(default)]
    pub tags: Vec<Tag>,
}
