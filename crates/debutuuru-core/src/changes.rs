//! What changed: the files of a commit (against its first parent, like
//! GitHub) and the two versions of one file, so a UI can draw any diff view
//! (unified, side by side, whole file) and decide itself about whitespace,
//! context and word-level highlights.

use crate::files::{check_rev, clean_rel, FileContent};
use crate::{Error, Repo, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChangedFile {
    pub path: String,
    /// Where a renamed or copied file came from.
    pub orig_path: Option<String>,
    /// `A`dded, `M`odified, `D`eleted, `R`enamed, `C`opied, `T`ype changed.
    pub status: char,
    /// Lines added and removed; `None` for binary files.
    pub additions: Option<u32>,
    pub deletions: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CommitDetails {
    pub hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    /// Unix seconds.
    #[ts(type = "number")]
    pub time: i64,
    pub committer: String,
    #[ts(type = "number")]
    pub commit_time: i64,
    pub subject: String,
    /// The message after the subject line (may be empty).
    pub body: String,
    /// Against the first parent (everything, for a root commit).
    pub files: Vec<ChangedFile>,
}

/// Which two versions of a file to compare.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum DiffSource {
    /// Index → working tree (not staged yet).
    Unstaged,
    /// HEAD → index.
    Staged,
    /// Nothing → working tree.
    Untracked,
    /// First parent → this commit.
    Commit { rev: String },
}

/// Both sides of a file diff; `None` where the file doesn't exist (added or
/// deleted). Each side follows [`FileContent`]'s limits (binary, truncated).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FileVersions {
    pub old: Option<FileContent>,
    pub new: Option<FileContent>,
}

impl Repo {
    pub fn commit_details(&self, rev: &str) -> Result<CommitDetails> {
        let rev = check_rev(rev)?;
        const FMT: &str = "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ct%x1f%s%x1f%b";
        let out = self.runner().git(&[
            "show",
            "-s",
            "--no-color",
            "--no-show-signature",
            FMT,
            rev,
            "--",
        ])?;
        let f: Vec<&str> = out.splitn(9, '\u{1f}').collect();
        if f.len() < 9 {
            return Err(Error::Parse(out));
        }
        let time = |s: &str| s.trim().parse().map_err(|_| Error::Parse(s.to_string()));
        let hash = f[0].to_string();
        let parents: Vec<String> = f[1].split_whitespace().map(String::from).collect();
        let files = self.changed_files(&hash, parents.first().map(String::as_str))?;
        Ok(CommitDetails {
            parents,
            author: f[2].to_string(),
            email: f[3].to_string(),
            time: time(f[4])?,
            committer: f[5].to_string(),
            commit_time: time(f[6])?,
            subject: f[7].to_string(),
            body: f[8].trim_end().to_string(),
            files,
            hash,
        })
    }

    /// `commit` against `parent` (or against nothing for a root commit).
    fn changed_files(&self, commit: &str, parent: Option<&str>) -> Result<Vec<ChangedFile>> {
        let run = |what: &str| {
            let mut args = vec!["diff-tree", "-r", "-z", "-M", "--no-commit-id", what];
            match parent {
                Some(p) => args.extend([p, commit]),
                None => args.extend(["--root", commit]),
            }
            self.runner().git(&args)
        };
        let mut files = parse_name_status(&run("--name-status")?)?;
        let stats = parse_numstat(&run("--numstat")?);
        for f in &mut files {
            if let Some(&(add, del)) = stats.iter().find(|(p, _)| p == &f.path).map(|(_, s)| s) {
                (f.additions, f.deletions) = (add, del);
            }
        }
        Ok(files)
    }

    /// The old and new version of `path` for `source`. `orig_path` is the old
    /// name of a renamed file.
    pub fn file_versions(
        &self,
        source: &DiffSource,
        path: &str,
        orig_path: Option<&str>,
    ) -> Result<FileVersions> {
        let path = clean_rel(path)?;
        if path.is_empty() {
            return Err(Error::InvalidPath("a file path is required".into()));
        }
        let old_path = match orig_path {
            Some(p) => clean_rel(p)?,
            None => path.clone(),
        };
        Ok(match source {
            DiffSource::Unstaged => FileVersions {
                old: self.blob("", &old_path)?,
                new: self.on_disk(&path)?,
            },
            DiffSource::Staged => FileVersions {
                old: self.blob("HEAD", &old_path)?,
                new: self.blob("", &path)?,
            },
            DiffSource::Untracked => FileVersions {
                old: None,
                new: self.on_disk(&path)?,
            },
            DiffSource::Commit { rev } => {
                let rev = check_rev(rev)?;
                FileVersions {
                    // `rev^1` doesn't exist for a root commit: no old side.
                    old: self.blob(&format!("{rev}^1"), &old_path)?,
                    new: self.blob(rev, &path)?,
                }
            }
        })
    }

    /// `path` at `rev` (`""` = the index), or `None` if it isn't there.
    fn blob(&self, rev: &str, path: &str) -> Result<Option<FileContent>> {
        let spec = format!("{rev}:{path}");
        let exists = self.runner().output(&["cat-file", "-e", &spec])?;
        if !exists.status.success() {
            return Ok(None);
        }
        self.read_at(rev, path).map(Some)
    }

    fn on_disk(&self, path: &str) -> Result<Option<FileContent>> {
        if std::fs::symlink_metadata(Path::new(&self.info.root).join(path)).is_err() {
            return Ok(None);
        }
        self.read_on_disk(path).map(Some)
    }
}

/// `git diff-tree --name-status -z`: `M\0path\0`, `R100\0old\0new\0`…
fn parse_name_status(out: &str) -> Result<Vec<ChangedFile>> {
    let mut parts = out.split('\0').filter(|s| !s.is_empty());
    let mut files = Vec::new();
    while let Some(code) = parts.next() {
        let status = code
            .chars()
            .next()
            .ok_or_else(|| Error::Parse(code.into()))?;
        let first = parts.next().ok_or_else(|| Error::Parse(code.into()))?;
        let (path, orig_path) = if matches!(status, 'R' | 'C') {
            let new = parts.next().ok_or_else(|| Error::Parse(code.into()))?;
            (new.to_string(), Some(first.to_string()))
        } else {
            (first.to_string(), None)
        };
        files.push(ChangedFile {
            path,
            orig_path,
            status,
            additions: None,
            deletions: None,
        });
    }
    Ok(files)
}

type Stat = (Option<u32>, Option<u32>);

/// `git diff-tree --numstat -z`: `1\t2\tpath\0`, or `1\t2\t\0old\0new\0` for
/// renames; `-\t-\t` for binary files.
fn parse_numstat(out: &str) -> Vec<(String, Stat)> {
    let mut parts = out.split('\0');
    let mut stats = Vec::new();
    while let Some(entry) = parts.next() {
        let mut f = entry.splitn(3, '\t');
        let (Some(add), Some(del), Some(path)) = (f.next(), f.next(), f.next()) else {
            continue;
        };
        let path = if path.is_empty() {
            // Rename: old and new path follow as their own entries.
            parts.next();
            parts.next().unwrap_or_default()
        } else {
            path
        };
        stats.push((path.to_string(), (add.parse().ok(), del.parse().ok())));
    }
    stats
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_status_with_renames() {
        let f = parse_name_status("M\0src/a.rs\0R087\0old.txt\0new.txt\0A\0b c.md\0").unwrap();
        assert_eq!(f.len(), 3);
        assert_eq!((f[0].status, f[0].path.as_str()), ('M', "src/a.rs"));
        assert_eq!(f[1].orig_path.as_deref(), Some("old.txt"));
        assert_eq!((f[1].status, f[1].path.as_str()), ('R', "new.txt"));
        assert_eq!(f[2].path, "b c.md");
    }

    #[test]
    fn numstat_with_renames_and_binaries() {
        let s = parse_numstat("3\t1\tsrc/a.rs\0-\t-\tlogo.png\0\x30\t2\t\0old.txt\0new.txt\0");
        assert_eq!(s[0], ("src/a.rs".into(), (Some(3), Some(1))));
        assert_eq!(s[1], ("logo.png".into(), (None, None)));
        assert_eq!(s[2], ("new.txt".into(), (Some(0), Some(2))));
    }
}
