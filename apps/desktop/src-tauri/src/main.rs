// Hide the extra console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use debutuuru_core::repo::{Branch, LogEntry, RepoInfo, Status, Worktree};
use debutuuru_core::{Error, Location, Repo};
use serde::Serialize;

/// Runs blocking git work off the UI thread.
async fn blocking<T, F>(f: F) -> Result<T, Error>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, Error> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| Error::Git(e.to_string()))?
}

fn open(path: &str) -> Result<Repo, Error> {
    Repo::open(Location::parse(path))
}

#[derive(Serialize)]
struct Snapshot {
    info: RepoInfo,
    status: Status,
    branches: Vec<Branch>,
    worktrees: Vec<Worktree>,
    log: Vec<LogEntry>,
}

/// Path passed on the command line (`debutuuru open <path>`), if any.
#[tauri::command]
fn initial_path() -> Option<String> {
    std::env::args().nth(1).filter(|a| !a.starts_with('-'))
}

#[tauri::command]
fn app_version() -> &'static str {
    debutuuru_core::VERSION
}

#[tauri::command]
async fn load_repo(path: String, limit: usize) -> Result<Snapshot, Error> {
    blocking(move || {
        let r = open(&path)?;
        Ok(Snapshot {
            status: r.status()?,
            branches: r.branches()?,
            worktrees: r.worktrees()?,
            log: r.log(limit)?,
            info: r.info.clone(),
        })
    })
    .await
}

#[tauri::command]
async fn stage(path: String, files: Vec<String>) -> Result<(), Error> {
    blocking(move || open(&path)?.stage(&files)).await
}

#[tauri::command]
async fn unstage(path: String, files: Vec<String>) -> Result<(), Error> {
    blocking(move || open(&path)?.unstage(&files)).await
}

#[tauri::command]
async fn commit(path: String, message: String) -> Result<String, Error> {
    blocking(move || open(&path)?.commit(&message)).await
}

#[tauri::command]
async fn checkout(path: String, branch: String) -> Result<(), Error> {
    blocking(move || open(&path)?.checkout(&branch)).await
}

#[tauri::command]
async fn diff(path: String, file: String, staged: bool, untracked: bool) -> Result<String, Error> {
    blocking(move || open(&path)?.diff(&file, staged, untracked)).await
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            initial_path,
            app_version,
            load_repo,
            stage,
            unstage,
            commit,
            checkout,
            diff
        ])
        .run(tauri::generate_context!())
        .expect("error while running Debutuuru");
}
