//! Browsing a repository's files: the working tree as it is on disk, or the
//! tree of any commit. One folder level per call, so huge folders
//! (`node_modules`, `target`) cost nothing until they're opened.

use crate::{Error, Repo, Result};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use ts_rs::TS;

/// Files larger than this are shown truncated.
pub const MAX_FILE_BYTES: usize = 2 * 1024 * 1024;
/// Largest file [`Repo::read_bytes`] returns (images in rendered Markdown).
pub const MAX_BYTES: u64 = 10 * 1024 * 1024;
/// Paths [`Repo::stat_paths`] checks per call.
pub const MAX_STAT_PATHS: usize = 64;
/// Files [`Repo::list_files`] returns at most (quick open).
pub const MAX_LIST_FILES: usize = 200_000;
/// Bytes inspected for NULs to decide a file is binary (same idea as git).
const BINARY_SNIFF: usize = 8000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum EntryKind {
    File,
    Dir,
    Symlink,
    /// A nested repository (submodule): shown, not expanded.
    Submodule,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TreeEntry {
    pub name: String,
    /// Relative to the repository root, `/`-separated.
    pub path: String,
    pub kind: EntryKind,
    /// Matched by .gitignore (working tree only; tracked files never are).
    pub ignored: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FileContent {
    pub path: String,
    #[ts(type = "number")]
    pub size: u64,
    /// Contains NUL bytes: not shown as text.
    pub binary: bool,
    /// Only the first [`MAX_FILE_BYTES`] are in `text`.
    pub truncated: bool,
    /// UTF-8 (lossy) text; `None` for binary files.
    pub text: Option<String>,
    /// For symlinks in the working tree: where it points (never followed).
    pub link_target: Option<String>,
}

/// Raw file content (base64), for images.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FileBytes {
    pub path: String,
    #[ts(type = "number")]
    pub size: u64,
    pub base64: String,
}

impl Repo {
    /// What each of `paths` is at `rev` (or in the working tree): a file, a
    /// folder…, or `None` if it doesn't exist or isn't a valid repo path.
    /// Used to resolve imports and links to the file they point to.
    pub fn stat_paths(
        &self,
        rev: Option<&str>,
        paths: &[String],
    ) -> Result<Vec<Option<EntryKind>>> {
        if paths.len() > MAX_STAT_PATHS {
            return Err(Error::InvalidPath(format!(
                "at most {MAX_STAT_PATHS} paths per call"
            )));
        }
        let clean: Vec<Option<String>> = paths
            .iter()
            .map(|p| clean_rel(p).ok().filter(|p| !p.is_empty()))
            .collect();
        match rev {
            None => Ok(clean
                .iter()
                .map(|p| p.as_deref().and_then(|p| self.kind_on_disk(p)))
                .collect()),
            Some(rev) => {
                let rev = check_rev(rev)?;
                let wanted: Vec<&str> = clean.iter().flatten().map(String::as_str).collect();
                if wanted.is_empty() {
                    return Ok(vec![None; paths.len()]);
                }
                // One ls-tree for all of them: exact paths list their own entry.
                let mut args = vec!["ls-tree", "-z", rev, "--"];
                args.extend(&wanted);
                let found = self.runner().git(&args)?;
                let kinds: Vec<(String, EntryKind)> = found
                    .split('\0')
                    .filter_map(|line| {
                        let (meta, path) = line.split_once('\t')?;
                        Some((path.to_string(), kind_of_mode(meta.split(' ').next()?)))
                    })
                    .collect();
                Ok(clean
                    .iter()
                    .map(|p| {
                        let p = p.as_deref()?;
                        kinds.iter().find(|(k, _)| k == p).map(|(_, kind)| *kind)
                    })
                    .collect())
            }
        }
    }

    /// Every file of the repository, for quick open: at `rev`, or in the
    /// working tree (tracked and untracked, without .gitignored ones and
    /// without tracked files deleted from disk). Sorted, at most
    /// [`MAX_LIST_FILES`].
    pub fn list_files(&self, rev: Option<&str>) -> Result<Vec<String>> {
        let split = |out: String| -> Vec<String> {
            out.split('\0')
                .filter(|p| !p.is_empty())
                .map(str::to_string)
                .collect()
        };
        let mut files = match rev {
            Some(rev) => split(self.runner().git(&[
                "ls-tree",
                "-r",
                "-z",
                "--name-only",
                check_rev(rev)?,
            ])?),
            None => {
                let all = split(self.runner().git(&[
                    "ls-files",
                    "-z",
                    "--cached",
                    "--others",
                    "--exclude-standard",
                    "--deduplicate",
                ])?);
                let deleted: std::collections::HashSet<String> =
                    split(self.runner().git(&["ls-files", "-z", "--deleted"])?)
                        .into_iter()
                        .collect();
                all.into_iter().filter(|p| !deleted.contains(p)).collect()
            }
        };
        files.sort();
        files.dedup();
        files.truncate(MAX_LIST_FILES);
        Ok(files)
    }

    /// The bytes of `path` (base64), up to [`MAX_BYTES`].
    pub fn read_bytes(&self, rev: Option<&str>, path: &str) -> Result<FileBytes> {
        use base64::Engine;
        let path = clean_rel(path)?;
        let bytes = match rev {
            Some(rev) => {
                let spec = format!("{}:{path}", check_rev(rev)?);
                let size: u64 = self
                    .runner()
                    .git(&["cat-file", "-s", &spec])?
                    .trim()
                    .parse()
                    .map_err(|_| Error::Parse(spec.clone()))?;
                too_big(size)?;
                let out = self.runner().output(&["cat-file", "blob", &spec])?;
                if !out.status.success() {
                    return Err(Error::Git(
                        String::from_utf8_lossy(&out.stderr).trim().to_string(),
                    ));
                }
                out.stdout
            }
            None => {
                let full = self.inside_root(&path)?;
                let meta = std::fs::metadata(&full).map_err(io_err)?;
                if !meta.is_file() {
                    return Err(Error::InvalidPath(format!("{path} is not a file")));
                }
                too_big(meta.len())?;
                std::fs::read(&full).map_err(io_err)?
            }
        };
        Ok(FileBytes {
            path,
            size: bytes.len() as u64,
            base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
        })
    }

    fn kind_on_disk(&self, rel: &str) -> Option<EntryKind> {
        let full = self.inside_root(rel).ok()?;
        let meta = std::fs::symlink_metadata(&full).ok()?;
        Some(if meta.file_type().is_symlink() {
            EntryKind::Symlink
        } else if meta.is_dir() {
            if full.join(".git").exists() {
                EntryKind::Submodule
            } else {
                EntryKind::Dir
            }
        } else {
            EntryKind::File
        })
    }

    /// Children of `dir` (`""` = root) at `rev`, or in the working tree when
    /// `rev` is `None`. Folders first, then files, by name.
    pub fn tree(&self, rev: Option<&str>, dir: &str, show_ignored: bool) -> Result<Vec<TreeEntry>> {
        let dir = clean_rel(dir)?;
        let mut entries = match rev {
            Some(rev) => self.tree_at(check_rev(rev)?, &dir)?,
            None => self.tree_on_disk(&dir, show_ignored)?,
        };
        entries.sort_by(|a, b| {
            let dir_first =
                |e: &TreeEntry| !matches!(e.kind, EntryKind::Dir | EntryKind::Submodule);
            dir_first(a)
                .cmp(&dir_first(b))
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
                .then_with(|| a.name.cmp(&b.name))
        });
        Ok(entries)
    }

    /// Content of `path` at `rev`, or from the working tree when `rev` is `None`.
    pub fn read_file(&self, rev: Option<&str>, path: &str) -> Result<FileContent> {
        let path = clean_rel(path)?;
        if path.is_empty() {
            return Err(Error::InvalidPath("a file path is required".into()));
        }
        match rev {
            Some(rev) => self.read_at(check_rev(rev)?, &path),
            None => self.read_on_disk(&path),
        }
    }

    fn tree_at(&self, rev: &str, dir: &str) -> Result<Vec<TreeEntry>> {
        let mut args = vec!["ls-tree", "-z", rev];
        let prefix = format!("{dir}/");
        if !dir.is_empty() {
            args.extend(["--", prefix.as_str()]);
        }
        let out = self.runner().git(&args)?;
        out.split('\0')
            .filter(|l| !l.is_empty())
            .map(|line| {
                // "<mode> SP <type> SP <object> TAB <path>"
                let (meta, path) = line
                    .split_once('\t')
                    .ok_or_else(|| Error::Parse(line.into()))?;
                let kind = kind_of_mode(meta.split(' ').next().unwrap_or(""));
                Ok(TreeEntry {
                    name: path.rsplit('/').next().unwrap_or(path).to_string(),
                    path: path.to_string(),
                    kind,
                    ignored: false,
                })
            })
            .collect()
    }

    fn tree_on_disk(&self, dir: &str, show_ignored: bool) -> Result<Vec<TreeEntry>> {
        let base = self.inside_root(dir)?;
        let mut entries = Vec::new();
        for item in std::fs::read_dir(&base).map_err(io_err)? {
            let item = item.map_err(io_err)?;
            let name = item.file_name().to_string_lossy().into_owned();
            if name == ".git" {
                continue;
            }
            let ft = item.file_type().map_err(io_err)?;
            let kind = if ft.is_symlink() {
                EntryKind::Symlink
            } else if ft.is_dir() {
                if item.path().join(".git").exists() {
                    EntryKind::Submodule
                } else {
                    EntryKind::Dir
                }
            } else {
                EntryKind::File
            };
            let path = if dir.is_empty() {
                name.clone()
            } else {
                format!("{dir}/{name}")
            };
            entries.push(TreeEntry {
                name,
                path,
                kind,
                ignored: false,
            });
        }
        let ignored = self.ignored(entries.iter().map(|e| e.path.as_str()))?;
        entries.retain_mut(|e| {
            e.ignored = ignored.iter().any(|p| p == &e.path);
            show_ignored || !e.ignored
        });
        Ok(entries)
    }

    /// Which of `paths` .gitignore matches (`git check-ignore`, one call).
    fn ignored<'a>(&self, paths: impl Iterator<Item = &'a str>) -> Result<Vec<String>> {
        let input: Vec<u8> = paths.flat_map(|p| p.bytes().chain([0])).collect();
        if input.is_empty() {
            return Ok(vec![]);
        }
        let mut cmd = self.runner().command(&["check-ignore", "-z", "--stdin"]);
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let mut child = cmd.spawn().map_err(|source| Error::Spawn {
            program: "git".into(),
            source,
        })?;
        // Write from a thread: a large listing could fill both pipes.
        let mut stdin = child.stdin.take().expect("piped");
        let writer = std::thread::spawn(move || stdin.write_all(&input));
        let out = child.wait_with_output().map_err(io_err)?;
        let _ = writer.join();
        // Exit 1 = nothing ignored; 128 = error (e.g. bare repo): treat as none.
        Ok(String::from_utf8_lossy(&out.stdout)
            .split('\0')
            .filter(|p| !p.is_empty())
            .map(str::to_string)
            .collect())
    }

    pub(crate) fn read_at(&self, rev: &str, path: &str) -> Result<FileContent> {
        let spec = format!("{rev}:{path}");
        let size: u64 = self
            .runner()
            .git(&["cat-file", "-s", &spec])?
            .trim()
            .parse()
            .map_err(|_| Error::Parse(spec.clone()))?;
        let out = self.runner().output(&["cat-file", "blob", &spec])?;
        if !out.status.success() {
            return Err(Error::Git(
                String::from_utf8_lossy(&out.stderr).trim().to_string(),
            ));
        }
        Ok(content(path, size, out.stdout, None))
    }

    pub(crate) fn read_on_disk(&self, path: &str) -> Result<FileContent> {
        let full = self.inside_root(path)?;
        let meta = std::fs::symlink_metadata(&full).map_err(io_err)?;
        if meta.file_type().is_symlink() {
            let target = std::fs::read_link(&full).map_err(io_err)?;
            return Ok(content(
                path,
                meta.len(),
                vec![],
                Some(target.to_string_lossy().into_owned()),
            ));
        }
        if meta.is_dir() {
            return Err(Error::InvalidPath(format!("{path} is a folder")));
        }
        let mut bytes = Vec::new();
        use std::io::Read;
        std::fs::File::open(&full)
            .map_err(io_err)?
            .take(MAX_FILE_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(io_err)?;
        Ok(content(path, meta.len(), bytes, None))
    }

    /// `rel` under the working tree root, refusing anything that resolves
    /// outside it (e.g. through a symlinked folder).
    fn inside_root(&self, rel: &str) -> Result<PathBuf> {
        let root = Path::new(&self.info.root);
        if rel.is_empty() {
            return Ok(root.to_path_buf());
        }
        let full = root.join(rel);
        let real_root = root.canonicalize().map_err(io_err)?;
        // The final component may be a symlink we must not follow: check its parent.
        let parent = full.parent().unwrap_or(root);
        let real_parent = parent.canonicalize().map_err(io_err)?;
        if !real_parent.starts_with(&real_root) {
            return Err(Error::InvalidPath(format!(
                "{rel} is outside the repository"
            )));
        }
        Ok(full)
    }
}

fn kind_of_mode(mode: &str) -> EntryKind {
    match mode {
        "040000" => EntryKind::Dir,
        "160000" => EntryKind::Submodule,
        "120000" => EntryKind::Symlink,
        _ => EntryKind::File,
    }
}

fn too_big(size: u64) -> Result<()> {
    if size > MAX_BYTES {
        return Err(Error::InvalidPath(format!(
            "file too large ({size} bytes, the limit is {MAX_BYTES})"
        )));
    }
    Ok(())
}

fn content(path: &str, size: u64, mut bytes: Vec<u8>, link_target: Option<String>) -> FileContent {
    let binary = bytes[..bytes.len().min(BINARY_SNIFF)].contains(&0);
    let truncated = bytes.len() > MAX_FILE_BYTES;
    bytes.truncate(MAX_FILE_BYTES);
    FileContent {
        path: path.to_string(),
        size,
        binary,
        truncated,
        text: (!binary && link_target.is_none())
            .then(|| String::from_utf8_lossy(&bytes).into_owned()),
        link_target,
    }
}

/// A repo-relative path with `/` separators; no `..`, no absolute paths.
pub(crate) fn clean_rel(p: &str) -> Result<String> {
    let p = p.replace('\\', "/");
    let p = p.trim_matches('/');
    let mut parts = Vec::new();
    for c in Path::new(p).components() {
        match c {
            Component::Normal(s) => parts.push(s.to_string_lossy().into_owned()),
            Component::CurDir => {}
            _ => {
                return Err(Error::InvalidPath(format!(
                    "{p}: only paths inside the repository"
                )))
            }
        }
    }
    Ok(parts.join("/"))
}

/// A revision for `ls-tree`/`cat-file`: never an option.
pub(crate) fn check_rev(rev: &str) -> Result<&str> {
    if rev.is_empty() || rev.starts_with('-') || rev.contains(['\0', '\n']) {
        return Err(Error::InvalidPath(format!("invalid revision: {rev}")));
    }
    Ok(rev)
}

fn io_err(e: std::io::Error) -> Error {
    Error::Io(e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_paths_stay_inside() {
        assert_eq!(clean_rel("").unwrap(), "");
        assert_eq!(clean_rel("src\\lib.rs").unwrap(), "src/lib.rs");
        assert_eq!(clean_rel("/src/./a/").unwrap(), "src/a");
        assert!(clean_rel("../etc/passwd").is_err());
        assert!(clean_rel("src/../../x").is_err());
        assert!(check_rev("--output=x").is_err());
        assert!(check_rev("HEAD~1").is_ok());
    }

    #[test]
    fn binary_and_truncation() {
        let c = content("a", 3, b"a\0b".to_vec(), None);
        assert!(c.binary && c.text.is_none());
        let big = vec![b'x'; MAX_FILE_BYTES + 1];
        let c = content("b", big.len() as u64, big, None);
        assert!(c.truncated && !c.binary);
        assert_eq!(c.text.unwrap().len(), MAX_FILE_BYTES);
    }
}
