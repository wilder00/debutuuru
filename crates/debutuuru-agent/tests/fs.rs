//! `fs.*`: browsing and watching a plain folder (a ticket folder with notes
//! next to its repositories).

use debutuuru_agent::Agent;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver};
use std::sync::Arc;
use std::time::Duration;

fn ticket(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("debutuuru-fs-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("notes/plans")).unwrap();
    std::fs::write(dir.join("notes/plans/step-1.md"), "# Step 1\n").unwrap();
    std::fs::write(dir.join("README.md"), "ticket").unwrap();
    std::fs::create_dir_all(dir.join("api")).unwrap();
    git(&dir.join("api"), &["init", "-q"]);
    dir
}

fn git(dir: &Path, args: &[&str]) {
    assert!(std::process::Command::new("git")
        .current_dir(dir)
        .args(args)
        .status()
        .unwrap()
        .success());
}

fn names(v: Value) -> Vec<(String, String)> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|e| {
            (
                e["path"].as_str().unwrap().to_string(),
                e["kind"].as_str().unwrap().to_string(),
            )
        })
        .collect()
}

#[test]
fn browses_a_plain_folder() {
    let dir = ticket("browse");
    let repo = dir.to_string_lossy().to_string();
    let a = Agent::with_default_modules();

    let root = names(a.dispatch("fs.tree", json!({ "repo": repo })).unwrap());
    assert_eq!(
        root,
        vec![
            ("api".to_string(), "submodule".to_string()),
            ("notes".to_string(), "dir".to_string()),
            ("README.md".to_string(), "file".to_string()),
        ]
    );
    let plans = names(
        a.dispatch("fs.tree", json!({ "repo": repo, "path": "notes/plans" }))
            .unwrap(),
    );
    assert_eq!(
        plans,
        vec![("notes/plans/step-1.md".to_string(), "file".to_string())]
    );

    let file = a
        .dispatch(
            "fs.read_file",
            json!({ "repo": repo, "path": "notes/plans/step-1.md" }),
        )
        .unwrap();
    assert_eq!(file["text"], "# Step 1\n");
    let kinds = a
        .dispatch(
            "fs.stat_paths",
            json!({ "repo": repo, "paths": ["notes", "nope.md", "../x"] }),
        )
        .unwrap();
    assert_eq!(kinds, json!(["dir", null, null]));

    // Quick open: the notes, not the repository's files.
    std::fs::write(dir.join("api/main.rs"), "").unwrap();
    let files = a
        .dispatch("fs.list_files", json!({ "repo": repo }))
        .unwrap();
    assert_eq!(files, json!(["README.md", "notes/plans/step-1.md"]));

    // Nothing outside the folder.
    assert!(a
        .dispatch(
            "fs.read_file",
            json!({ "repo": dir.join("notes").to_string_lossy(), "path": "../README.md" })
        )
        .is_err());
    let _ = std::fs::remove_dir_all(&dir);
}

fn changes(a: &Agent) -> Receiver<()> {
    let (tx, rx) = mpsc::channel();
    a.set_event_sink(Arc::new(move |ev| {
        if ev.topic == "fs.changed" {
            let _ = tx.send(());
        }
    }));
    rx
}

fn drain(rx: &Receiver<()>) {
    while rx.recv_timeout(Duration::from_millis(800)).is_ok() {}
}

#[test]
fn watching_reports_notes_but_not_the_repositories() {
    let dir = ticket("watch");
    let repo = dir.to_string_lossy().to_string();
    let a = Agent::with_default_modules();
    let rx = changes(&a);
    a.dispatch("fs.watch", json!({ "repo": repo })).unwrap();
    drain(&rx);

    std::fs::write(dir.join("notes/plans/step-2.md"), "# Step 2\n").unwrap();
    assert!(
        rx.recv_timeout(Duration::from_secs(5)).is_ok(),
        "a new note wasn't reported"
    );
    drain(&rx);

    // A folder created after watching started: its files count too.
    std::fs::create_dir_all(dir.join("reviews")).unwrap();
    assert!(
        rx.recv_timeout(Duration::from_secs(5)).is_ok(),
        "a new folder wasn't reported"
    );
    drain(&rx);
    std::fs::write(dir.join("reviews/r1.md"), "ok").unwrap();
    assert!(
        rx.recv_timeout(Duration::from_secs(5)).is_ok(),
        "a file in a new folder wasn't reported"
    );
    drain(&rx);

    // Work inside a repository belongs to its own tab.
    std::fs::write(dir.join("api/main.rs"), "fn main() {}").unwrap();
    git(&dir.join("api"), &["status", "--porcelain"]);
    assert!(
        rx.recv_timeout(Duration::from_millis(1500)).is_err(),
        "a change inside a repository was reported"
    );

    a.dispatch("fs.unwatch", json!({ "repo": repo })).unwrap();
    let _ = std::fs::remove_dir_all(&dir);
}
