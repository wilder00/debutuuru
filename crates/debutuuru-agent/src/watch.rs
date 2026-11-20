//! Debounced file watching for a repository. Runs inside the agent, i.e. on
//! the same OS as the files: inotify inside WSL/Linux, ReadDirectoryChangesW on
//! Windows. (Windows can't get change events for files inside WSL; that's one
//! of the reasons the agent exists.)

use debutuuru_core::repo::RepoInfo;
use notify::{RecursiveMode, Watcher};
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
    let (tx, rx) = mpsc::channel::<()>();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            if ev.paths.iter().any(|p| is_relevant(p, &objects)) {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_noise() {
        let objects = Path::new("/r/.git/objects");
        assert!(!is_relevant(Path::new("/r/.git/objects/ab/cdef"), objects));
        assert!(!is_relevant(Path::new("/r/.git/index.lock"), objects));
        assert!(is_relevant(Path::new("/r/.git/index"), objects));
        assert!(is_relevant(Path::new("/r/src/main.rs"), objects));
    }
}
