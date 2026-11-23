//! Folders that hold several repositories: a folder per ticket with a
//! worktree of each project in it, or a folder of clones. Opening one opens
//! the repositories found inside.

use crate::runner::GitRunner;
use crate::{Location, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;
use ts_rs::TS;

/// How deep to look: the folder's children and grandchildren
/// (`NED-2550/ssr-site`, `clients/acme/api`).
pub const MAX_DEPTH: usize = 2;
/// Stop after this many repositories.
pub const MAX_REPOS: usize = 64;

/// Folders never worth looking into (or watching).
pub const SKIP: &[&str] = &["node_modules", "target", "vendor", "dist", "build"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FoundRepos {
    /// The folder is a repository or inside one: open it as usual.
    pub inside_repo: bool,
    /// Otherwise, the repositories and worktrees found in it (absolute
    /// paths, sorted), at most [`MAX_REPOS`].
    pub repos: Vec<String>,
}

/// What opening `dir` means: one repository, or the ones inside it.
pub fn find_repos(dir: &str) -> Result<FoundRepos> {
    let runner = GitRunner::new(Location::local(dir));
    if runner.git(&["rev-parse", "--git-dir"]).is_ok() {
        return Ok(FoundRepos {
            inside_repo: true,
            repos: Vec::new(),
        });
    }
    let mut repos = Vec::new();
    walk(Path::new(dir), 0, &mut repos);
    repos.sort_by_key(|p| p.to_lowercase());
    Ok(FoundRepos {
        inside_repo: false,
        repos,
    })
}

fn walk(dir: &Path, depth: usize, out: &mut Vec<String>) {
    if depth >= MAX_DEPTH || out.len() >= MAX_REPOS {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut dirs: Vec<_> = entries
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .map(|e| e.path())
        .filter(|p| {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            !name.starts_with('.') && !SKIP.contains(&name)
        })
        .collect();
    dirs.sort();
    for d in dirs {
        if out.len() >= MAX_REPOS {
            return;
        }
        // `.git` is a folder in a clone and a file in a linked worktree.
        if d.join(".git").exists() {
            out.push(d.to_string_lossy().into_owned());
        } else {
            walk(&d, depth + 1, out);
        }
    }
}
