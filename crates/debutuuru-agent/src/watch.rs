//! Debounced file watching for a repository. Runs inside the agent, i.e. on
//! the same OS as the files: inotify inside WSL/Linux, ReadDirectoryChangesW on
//! Windows. (Windows can't get change events for files inside WSL; that's one
//! of the reasons the agent exists.)

use debutuuru_core::repo::RepoInfo;
use notify::event::{AccessKind, AccessMode};
use notify::{EventKind, RecursiveMode, Watcher};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex};
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

/// Watching stops when this is dropped.
pub struct FolderWatch {
    _watcher: Arc<Mutex<notify::RecommendedWatcher>>,
}

/// Watches a plain folder (a ticket folder): its own entries, and every
/// folder inside that isn't a repository, recursively. Repositories are left
/// out (their tabs watch them) and so are `node_modules`-like folders, so
/// inotify (Linux, WSL) doesn't need a watch per folder of every project.
/// Folders created later are picked up after the next change.
pub fn watch_folder(
    root: &Path,
    on_change: impl Fn() + Send + 'static,
) -> notify::Result<FolderWatch> {
    let (tx, rx) = mpsc::channel::<()>();
    let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            // A repository's own folder changes whenever git writes in it.
            if is_change(&ev.kind) && ev.paths.iter().any(|p| !p.join(".git").exists()) {
                let _ = tx.send(());
            }
        }
    })?;
    let watcher = Arc::new(Mutex::new(watcher));
    let root = root.to_path_buf();
    watcher
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .watch(&root, RecursiveMode::NonRecursive)?;
    let mut inside = HashSet::new();
    sync_subfolders(&watcher, &root, &mut inside);

    let weak = Arc::downgrade(&watcher);
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
            let Some(w) = weak.upgrade() else { return };
            sync_subfolders(&w, &root, &mut inside);
            drop(w);
            on_change();
        }
    });
    Ok(FolderWatch { _watcher: watcher })
}

/// Watches the root's subfolders that should be (recursively), and stops
/// watching the ones that are gone or became repositories.
fn sync_subfolders(
    watcher: &Mutex<notify::RecommendedWatcher>,
    root: &Path,
    watched: &mut HashSet<PathBuf>,
) {
    let wanted: HashSet<PathBuf> = std::fs::read_dir(root)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .map(|e| e.path())
        .filter(|p| {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            name != ".git"
                && !debutuuru_core::discover::SKIP.contains(&name)
                && !p.join(".git").exists()
        })
        .collect();
    let mut w = watcher.lock().unwrap_or_else(|e| e.into_inner());
    for gone in watched.difference(&wanted).cloned().collect::<Vec<_>>() {
        let _ = w.unwatch(&gone);
        watched.remove(&gone);
    }
    for new in wanted {
        if !watched.contains(&new) && w.watch(&new, RecursiveMode::Recursive).is_ok() {
            watched.insert(new);
        }
    }
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
