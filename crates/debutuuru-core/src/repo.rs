//! High-level repository operations. All of them go through the real `git`
//! binary (host or WSL), so behaviour matches what the user sees in a shell.
//!
//! Worktrees: a linked worktree has a `.git` *file* (not a folder) pointing into
//! the main repo's `.git/worktrees/<name>`. We never inspect `.git` ourselves;
//! `git rev-parse` resolves it, and `is_linked_worktree` is derived from
//! `git_dir != common_dir`.

use crate::graph::{self, GraphRow};
use crate::runner::GitRunner;
use crate::{Error, Location, Result};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RepoInfo {
    pub location: Location,
    /// Top-level directory of this working tree (git dir for bare repos).
    pub root: String,
    pub git_dir: String,
    pub common_dir: String,
    pub is_bare: bool,
    pub is_linked_worktree: bool,
    /// `None` when HEAD is detached.
    pub head_branch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Worktree {
    pub path: String,
    pub head: Option<String>,
    pub branch: Option<String>,
    pub bare: bool,
    pub detached: bool,
    pub locked: bool,
    pub prunable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Branch {
    pub name: String,
    pub is_remote: bool,
    pub is_head: bool,
    pub upstream: Option<String>,
    pub sha: String,
    pub subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Commit {
    pub hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    /// Unix seconds. Exposed to TS as `number` (safe until year 285 million).
    #[ts(type = "number")]
    pub time: i64,
    pub refs: Vec<String>,
    pub subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LogEntry {
    #[serde(flatten)]
    pub commit: Commit,
    pub graph: GraphRow,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FileChange {
    pub path: String,
    pub orig_path: Option<String>,
    /// Index (staged) status letter, ' ' if none.
    pub index: char,
    /// Working tree status letter, ' ' if none, '?' if untracked.
    pub worktree: char,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub struct Status {
    pub branch: String,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<FileChange>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Remote {
    pub name: String,
    pub fetch_url: String,
    pub push_url: String,
    /// `ssh` (git@host:… or ssh://), `https`, `http`, `file`, or `other`.
    pub transport: String,
}

pub struct Repo {
    runner: GitRunner,
    pub info: RepoInfo,
}

impl Repo {
    /// Opens the repository containing `location` (works from any subfolder,
    /// from a linked worktree, and for repos living inside WSL).
    pub fn open(location: Location) -> Result<Self> {
        if location.wsl_distro.is_none() && !std::path::Path::new(&location.path).is_dir() {
            return Err(Error::NotARepo(location.path));
        }
        let probe = GitRunner::new(location.clone());
        let bare = probe.output(&["rev-parse", "--is-bare-repository"])?;
        if !bare.status.success() {
            return Err(Error::NotARepo(location.path));
        }
        let is_bare = String::from_utf8_lossy(&bare.stdout).trim() == "true";

        let dirs = probe.git(&[
            "rev-parse",
            "--path-format=absolute",
            "--absolute-git-dir",
            "--git-common-dir",
        ])?;
        let mut it = dirs.lines();
        let git_dir = it
            .next()
            .ok_or_else(|| Error::Parse(dirs.clone()))?
            .to_string();
        let common_dir = it
            .next()
            .ok_or_else(|| Error::Parse(dirs.clone()))?
            .to_string();
        let root = if is_bare {
            git_dir.clone()
        } else {
            probe
                .git(&["rev-parse", "--show-toplevel"])?
                .trim()
                .to_string()
        };

        let runner = GitRunner::new(Location {
            wsl_distro: location.wsl_distro.clone(),
            path: root.clone(),
        });
        let head = runner.output(&["symbolic-ref", "--short", "-q", "HEAD"])?;
        let head_branch = head
            .status
            .success()
            .then(|| String::from_utf8_lossy(&head.stdout).trim().to_string());

        let info = RepoInfo {
            is_linked_worktree: git_dir != common_dir,
            location: Location {
                wsl_distro: location.wsl_distro,
                path: root.clone(),
            },
            root,
            git_dir,
            common_dir,
            is_bare,
            head_branch,
        };
        Ok(Self { runner, info })
    }

    /// Current branch, read live (the value in `info` is from open time).
    pub fn head_branch(&self) -> Result<Option<String>> {
        let head = self
            .runner
            .output(&["symbolic-ref", "--short", "-q", "HEAD"])?;
        Ok(head
            .status
            .success()
            .then(|| String::from_utf8_lossy(&head.stdout).trim().to_string()))
    }

    /// The underlying runner (for operations that need streaming or custom env).
    pub fn runner(&self) -> &GitRunner {
        &self.runner
    }

    pub fn remotes(&self) -> Result<Vec<Remote>> {
        let out = self.runner.git(&["remote", "-v"])?;
        let mut list: Vec<Remote> = Vec::new();
        for line in out.lines() {
            // "origin\tgit@github.com:me/x.git (fetch)"
            let Some((name, rest)) = line.split_once('\t') else {
                continue;
            };
            let Some((url, kind)) = rest.rsplit_once(' ') else {
                continue;
            };
            let r = match list.iter_mut().find(|r| r.name == name) {
                Some(r) => r,
                None => {
                    list.push(Remote {
                        name: name.to_string(),
                        fetch_url: String::new(),
                        push_url: String::new(),
                        transport: transport_of(url).to_string(),
                    });
                    list.last_mut().expect("just pushed")
                }
            };
            if kind == "(push)" {
                r.push_url = url.to_string();
            } else {
                r.fetch_url = url.to_string();
            }
        }
        Ok(list)
    }

    /// `origin/main` if the current branch tracks something.
    pub fn upstream(&self) -> Result<Option<String>> {
        let out =
            self.runner
                .output(&["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])?;
        Ok(out
            .status
            .success()
            .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string()))
    }

    pub fn worktrees(&self) -> Result<Vec<Worktree>> {
        let out = self.runner.git(&["worktree", "list", "--porcelain"])?;
        let mut list = Vec::new();
        for block in out.split("\n\n").filter(|b| !b.trim().is_empty()) {
            let mut wt = Worktree {
                path: String::new(),
                head: None,
                branch: None,
                bare: false,
                detached: false,
                locked: false,
                prunable: false,
            };
            for line in block.lines() {
                let (key, val) = line.split_once(' ').unwrap_or((line, ""));
                match key {
                    "worktree" => wt.path = val.to_string(),
                    "HEAD" => wt.head = Some(val.to_string()),
                    "branch" => wt.branch = Some(val.trim_start_matches("refs/heads/").to_string()),
                    "bare" => wt.bare = true,
                    "detached" => wt.detached = true,
                    "locked" => wt.locked = true,
                    "prunable" => wt.prunable = true,
                    _ => {}
                }
            }
            if wt.path.is_empty() {
                return Err(Error::Parse(block.to_string()));
            }
            list.push(wt);
        }
        Ok(list)
    }

    pub fn branches(&self) -> Result<Vec<Branch>> {
        const FMT: &str = "%(HEAD)%1f%(refname)%1f%(refname:short)%1f%(upstream:short)%1f%(objectname)%1f%(contents:subject)";
        let out = self.runner.git(&[
            "for-each-ref",
            &format!("--format={FMT}"),
            "refs/heads",
            "refs/remotes",
        ])?;
        let mut list = Vec::new();
        for line in out.lines() {
            let f: Vec<&str> = line.split('\u{1f}').collect();
            if f.len() < 6 {
                return Err(Error::Parse(line.to_string()));
            }
            if f[1].ends_with("/HEAD") {
                continue; // symbolic remote HEAD, not a real branch
            }
            list.push(Branch {
                is_head: f[0] == "*",
                is_remote: f[1].starts_with("refs/remotes/"),
                name: f[2].to_string(),
                upstream: (!f[3].is_empty()).then(|| f[3].to_string()),
                sha: f[4].to_string(),
                subject: f[5].to_string(),
            });
        }
        Ok(list)
    }

    /// Commits of all refs in topological order, with graph lanes computed.
    pub fn log(&self, limit: usize) -> Result<Vec<LogEntry>> {
        const FMT: &str = "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s";
        let n = limit.to_string();
        let out = match self
            .runner
            .git(&["log", "--all", "--topo-order", "-n", &n, FMT])
        {
            Ok(o) => o,
            Err(Error::Git(m)) if m.contains("does not have any commits") => String::new(),
            Err(e) => return Err(e),
        };
        let mut commits = Vec::new();
        for line in out.lines() {
            let f: Vec<&str> = line.splitn(7, '\u{1f}').collect();
            if f.len() < 7 {
                return Err(Error::Parse(line.to_string()));
            }
            commits.push(Commit {
                hash: f[0].to_string(),
                parents: f[1].split_whitespace().map(String::from).collect(),
                author: f[2].to_string(),
                email: f[3].to_string(),
                time: f[4].parse().map_err(|_| Error::Parse(line.to_string()))?,
                refs: f[5]
                    .split(", ")
                    .filter(|s| !s.is_empty())
                    .map(String::from)
                    .collect(),
                subject: f[6].to_string(),
            });
        }
        let input: Vec<_> = commits
            .iter()
            .map(|c| (c.hash.clone(), c.parents.clone()))
            .collect();
        let rows = graph::layout(&input);
        Ok(commits
            .into_iter()
            .zip(rows)
            .map(|(commit, graph)| LogEntry { commit, graph })
            .collect())
    }

    pub fn status(&self) -> Result<Status> {
        let out = self.runner.git(&[
            "status",
            "--porcelain=v1",
            "-z",
            "-b",
            "--untracked-files=all",
        ])?;
        let mut parts = out.split('\0').filter(|s| !s.is_empty());
        let mut status = Status::default();
        while let Some(entry) = parts.next() {
            if let Some(b) = entry.strip_prefix("## ") {
                parse_branch_line(b, &mut status);
                continue;
            }
            let mut chars = entry.chars();
            let (x, y) = (chars.next().unwrap_or(' '), chars.next().unwrap_or(' '));
            let path = entry
                .get(3..)
                .ok_or_else(|| Error::Parse(entry.to_string()))?
                .to_string();
            // Renames/copies are followed by the original path as its own entry.
            let orig_path = if x == 'R' || x == 'C' || y == 'R' || y == 'C' {
                parts.next().map(String::from)
            } else {
                None
            };
            status.files.push(FileChange {
                path,
                orig_path,
                index: x,
                worktree: y,
            });
        }
        Ok(status)
    }

    pub fn stage(&self, paths: &[String]) -> Result<()> {
        self.with_paths(&["add", "--"], paths)
    }

    pub fn unstage(&self, paths: &[String]) -> Result<()> {
        self.with_paths(&["restore", "--staged", "--"], paths)
    }

    pub fn commit(&self, message: &str) -> Result<String> {
        if message.trim().is_empty() {
            return Err(Error::Git("empty commit message".into()));
        }
        self.runner.git(&["commit", "-m", message])
    }

    pub fn checkout(&self, branch: &str) -> Result<()> {
        self.runner.git(&["checkout", branch]).map(|_| ())
    }

    pub fn diff(&self, path: &str, staged: bool, untracked: bool) -> Result<String> {
        let args: Vec<&str> = if untracked {
            vec!["diff", "--no-color", "--no-index", "--", "/dev/null", path]
        } else if staged {
            vec!["diff", "--no-color", "--cached", "--", path]
        } else {
            vec!["diff", "--no-color", "--", path]
        };
        // `--no-index` exits with 1 when files differ, so don't treat that as failure.
        let out = self.runner.output(&args)?;
        if out.status.success() || (untracked && out.status.code() == Some(1)) {
            Ok(String::from_utf8_lossy(&out.stdout).into_owned())
        } else {
            Err(Error::Git(
                String::from_utf8_lossy(&out.stderr).trim().to_string(),
            ))
        }
    }

    fn with_paths(&self, base: &[&str], paths: &[String]) -> Result<()> {
        let mut args: Vec<&str> = base.to_vec();
        args.extend(paths.iter().map(String::as_str));
        self.runner.git(&args).map(|_| ())
    }
}

/// Classifies a remote URL the way git does (scp-like `user@host:path` is ssh).
pub fn transport_of(url: &str) -> &'static str {
    let lower = url.to_ascii_lowercase();
    if lower.starts_with("ssh://") || lower.starts_with("git+ssh://") {
        "ssh"
    } else if lower.starts_with("https://") {
        "https"
    } else if lower.starts_with("http://") {
        "http"
    } else if lower.starts_with("file://")
        || url.starts_with('/')
        || url.starts_with('.')
        || url.get(1..3) == Some(":\\")
        || url.get(1..3) == Some(":/")
    {
        "file"
    } else if !url.contains("://")
        && url
            .split_once(':')
            .is_some_and(|(host, _)| !host.contains('/'))
    {
        "ssh"
    } else {
        "other"
    }
}

fn parse_branch_line(b: &str, status: &mut Status) {
    let (name_part, tracking) = match b.split_once(" [") {
        Some((n, t)) => (n, Some(t.trim_end_matches(']'))),
        None => (b, None),
    };
    status.branch = if let Some(n) = name_part.strip_prefix("No commits yet on ") {
        n.to_string()
    } else {
        name_part
            .split("...")
            .next()
            .unwrap_or(name_part)
            .to_string()
    };
    for item in tracking.unwrap_or("").split(", ") {
        if let Some(n) = item.strip_prefix("ahead ") {
            status.ahead = n.parse().unwrap_or(0);
        } else if let Some(n) = item.strip_prefix("behind ") {
            status.behind = n.parse().unwrap_or(0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transports() {
        assert_eq!(transport_of("git@github.com:wilder00/debutuuru.git"), "ssh");
        assert_eq!(transport_of("ssh://git@host:22/x.git"), "ssh");
        assert_eq!(transport_of("https://github.com/x/y.git"), "https");
        assert_eq!(transport_of("/srv/git/x.git"), "file");
        assert_eq!(transport_of("C:\\repos\\x.git"), "file");
        assert_eq!(transport_of("C:/repos/x.git"), "file");
        assert_eq!(transport_of("../other"), "file");
    }

    #[test]
    fn branch_line_variants() {
        let mut s = Status::default();
        parse_branch_line("main...origin/main [ahead 2, behind 1]", &mut s);
        assert_eq!((s.branch.as_str(), s.ahead, s.behind), ("main", 2, 1));

        let mut s = Status::default();
        parse_branch_line("No commits yet on dev", &mut s);
        assert_eq!(s.branch, "dev");
    }
}
