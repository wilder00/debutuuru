//! Deleting branches: what it would mean for each one (so the UI can warn
//! before anything happens), and deleting local branches. Deleting on a
//! remote is a remote operation (the agent runs it with progress and
//! credential prompts).

use crate::{Error, Repo, Result};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// What deleting one branch means.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BranchDeletion {
    /// As listed: `feature/x`, or `origin/feature/x` for a remote branch.
    pub name: String,
    pub is_remote: bool,
    /// For a remote branch: the remote and the branch's name there.
    pub remote: Option<String>,
    pub remote_branch: Option<String>,
    /// Tip commit, to restore it with `git branch <name> <sha>`.
    pub sha: String,
    /// The checked-out branch of this worktree: git won't delete it.
    pub is_head: bool,
    /// Checked out in another worktree (its path): git won't delete it.
    pub worktree: Option<String>,
    pub upstream: Option<String>,
    /// Commits not in the upstream (not pushed). 0 without upstream.
    pub ahead: u32,
    /// Commits no other branch, tag or remote branch has: deleting the
    /// branch leaves them reachable only through the reflog for a while.
    #[ts(type = "number")]
    pub unique_commits: u64,
    /// Every commit is in HEAD (merged into the current branch).
    pub merged_into_head: bool,
}

/// Result of deleting one local branch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DeleteResult {
    pub name: String,
    /// git's message when it refused (not merged, checked out…).
    pub error: Option<String>,
}

impl Repo {
    /// What deleting each of `names` would mean (local `x` or remote `origin/x`).
    pub fn branch_deletion_info(&self, names: &[String]) -> Result<Vec<BranchDeletion>> {
        let branches = self.branches()?;
        let worktrees = self.worktrees()?;
        let remotes = self.remotes()?;
        let mut out = Vec::new();
        for name in names {
            check_branch(name)?;
            let b = branches
                .iter()
                .find(|b| &b.name == name)
                .ok_or_else(|| Error::Git(format!("no branch named {name}")))?;
            let refname = if b.is_remote {
                format!("refs/remotes/{name}")
            } else {
                format!("refs/heads/{name}")
            };
            // `origin/feature/x` → (`origin`, `feature/x`); remote names may
            // contain slashes too, so match the known ones, longest first.
            let (remote, remote_branch) = if b.is_remote {
                let mut names: Vec<&str> = remotes.iter().map(|r| r.name.as_str()).collect();
                names.sort_by_key(|n| std::cmp::Reverse(n.len()));
                match names.iter().find_map(|r| {
                    name.strip_prefix(&format!("{r}/"))
                        .map(|rest| (r.to_string(), rest.to_string()))
                }) {
                    Some((r, rest)) => (Some(r), Some(rest)),
                    None => (None, None),
                }
            } else {
                (None, None)
            };
            let worktree = if b.is_remote {
                None
            } else {
                worktrees
                    .iter()
                    .find(|w| w.branch.as_deref() == Some(name.as_str()) && !b.is_head)
                    .map(|w| w.path.clone())
            };
            let ahead = match &b.upstream {
                // `x@{upstream}` works whether the upstream is remote or local.
                Some(_) if !b.is_remote => self
                    .count(&[&format!("{name}@{{upstream}}..{refname}")])
                    .unwrap_or(0) as u32,
                _ => 0,
            };
            let unique_commits =
                self.count(&[&refname, "--not", &format!("--exclude={refname}"), "--all"])?;
            let merged_into_head = self
                .runner()
                .output(&["merge-base", "--is-ancestor", &b.sha, "HEAD"])?
                .status
                .success();
            out.push(BranchDeletion {
                name: name.clone(),
                is_remote: b.is_remote,
                remote,
                remote_branch,
                sha: b.sha.clone(),
                is_head: b.is_head,
                worktree,
                upstream: b.upstream.clone(),
                ahead,
                unique_commits,
                merged_into_head,
            });
        }
        Ok(out)
    }

    /// Deletes local branches one by one, so one refusal doesn't stop the
    /// rest. `force` = `-D` (also when not merged).
    pub fn delete_branches(&self, names: &[String], force: bool) -> Result<Vec<DeleteResult>> {
        let flag = if force { "-D" } else { "-d" };
        let mut out = Vec::new();
        for name in names {
            check_branch(name)?;
            let error = self
                .runner()
                .git(&["branch", flag, name])
                .err()
                .map(|e| match e {
                    Error::Git(m) => m,
                    other => other.to_string(),
                });
            out.push(DeleteResult {
                name: name.clone(),
                error,
            });
        }
        Ok(out)
    }

    fn count(&self, args: &[&str]) -> Result<u64> {
        let mut a = vec!["rev-list", "--count"];
        a.extend_from_slice(args);
        let out = self.runner().git(&a)?;
        out.trim().parse().map_err(|_| Error::Parse(out))
    }
}

/// Names that could read as options or aren't branch names.
pub fn check_branch(name: &str) -> Result<()> {
    if name.is_empty()
        || name.starts_with('-')
        || name.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err(Error::Git(format!("invalid branch name: {name:?}")));
    }
    Ok(())
}
