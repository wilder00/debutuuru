//! Debounced file watching for a repository. Runs inside the agent, i.e. on
//! the same OS as the files: inotify inside WSL/Linux, ReadDirectoryChangesW on
//! Windows. (Windows can't get change events for files inside WSL; that's one
//! of the reasons the agent exists.)

use debutuuru_core::repo::RepoInfo;
use notify::event::{AccessKind, AccessMode};
use notify::{EventKind, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// Quiet period before reporting, and the longest a burst can delay a report.
const QUIET: Duration = Duration::from_millis(300);
const MAX_DELAY: Duration = Duration::from_millis(1500);

/// Watching stops when this is dropped.
pub struct RepoWatch {
    _watcher: notify::RecommendedWatcher,
}

pub fn watch(info: &RepoInfo, on_change: impl Fn() + Send + 'static) -> notify::Result<RepoWatch> {
    let objects = PathBuf::from(&info.common_dir).join("objects");
    // The git folders themselves: Windows reports them as modified whenever
    // a file inside is created or deleted, e.g. the `index.lock` that our
    // own `git status` makes on every refresh, which would refresh again
    // forever. What changed inside is reported with its own path.
    let git_dirs = [
        PathBuf::from(&info.git_dir),
        PathBuf::from(&info.common_dir),
    ];
    let (tx, rx) = mpsc::channel::<()>();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            if !is_change(&ev.kind) {
                return;
            }
            if ev
                .paths
                .iter()
                .any(|p| is_relevant(p, &objects) && !git_dirs.iter().any(|d| same_path(p, d)))
            {
                let _ = tx.send(());
            }
        }
    })?;

    if !info.is_bare {
        watcher.watch(Path::new(&info.root), RecursiveMode::Recursive)?;
    }
    // HEAD/index of this worktree, refs and packed-refs shared by all worktrees.
    // (For a main worktree these are inside root already; duplicates are harmless.)
    let _ = watcher.watch(Path::new(&info.git_dir), RecursiveMode::NonRecursive);
    let _ = watcher.watch(
        &Path::new(&info.common_dir).join("refs"),
        RecursiveMode::Recursive,
    );
    let _ = watcher.watch(Path::new(&info.common_dir), RecursiveMode::NonRecursive);

    // Debounce thread: ends when the watcher (and with it `tx`) is dropped.
    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            let start = Instant::now();
            loop {
                match rx.recv_timeout(QUIET) {
                    Ok(()) if start.elapsed() < MAX_DELAY => continue,
                    Ok(()) | Err(mpsc::RecvTimeoutError::Timeout) => break,
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
            on_change();
        }
    });

    Ok(RepoWatch { _watcher: watcher })
}

/// Object-database writes and lock files are noise: the ref/index update
/// that follows them is what matters.
fn is_relevant(p: &Path, objects: &Path) -> bool {
    // (`Option::is_none_or` would need Rust 1.82; MSRV is 1.80.)
    !p.starts_with(objects) && !matches!(p.extension(), Some(e) if e == "lock")
}

/// Reading isn't changing: inotify (Linux, WSL) reports every file git
/// opens (`HEAD`, `config`, the index…), so each refresh's own `git status`
/// would trigger the next one. Finishing a write still counts.
fn is_change(kind: &EventKind) -> bool {
    match kind {
        EventKind::Access(AccessKind::Close(AccessMode::Write)) => true,
        EventKind::Access(_) => false,
        _ => true,
    }
}

/// `a` and `b` name the same folder (ignoring a trailing separator and, on
/// Windows, `/` vs `\` and letter case).
fn same_path(a: &Path, b: &Path) -> bool {
    let norm = |p: &Path| {
        let s = p.to_string_lossy();
        let s = if cfg!(windows) {
            s.replace('\\', "/").to_lowercase()
        } else {
            s.into_owned()
        };
        s.trim_end_matches('/').to_string()
    };
    norm(a) == norm(b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_are_not_changes() {
        use notify::event::{CreateKind, ModifyKind};
        assert!(!is_change(&EventKind::Access(AccessKind::Open(
            AccessMode::Any
        ))));
        assert!(!is_change(&EventKind::Access(AccessKind::Close(
            AccessMode::Read
        ))));
        assert!(is_change(&EventKind::Access(AccessKind::Close(
            AccessMode::Write
        ))));
        assert!(is_change(&EventKind::Create(CreateKind::File)));
        assert!(is_change(&EventKind::Modify(ModifyKind::Any)));
    }

    #[test]
    fn git_folders_themselves_are_the_same_path() {
        assert!(same_path(Path::new("/r/.git"), Path::new("/r/.git/")));
        assert!(!same_path(Path::new("/r/.git/index"), Path::new("/r/.git")));
        #[cfg(windows)]
        assert!(same_path(Path::new(r"C:\R\.git"), Path::new("c:/r/.git")));
    }

    #[test]
    fn filters_noise() {
        let objects = Path::new("/r/.git/objects");
        assert!(!is_relevant(Path::new("/r/.git/objects/ab/cdef"), objects));
        assert!(!is_relevant(Path::new("/r/.git/index.lock"), objects));
        assert!(is_relevant(Path::new("/r/.git/index"), objects));
        assert!(is_relevant(Path::new("/r/src/main.rs"), objects));
    }
}
