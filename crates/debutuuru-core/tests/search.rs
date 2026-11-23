//! `Repo::grep` against the real git: working tree (with untracked files, not
//! ignored ones), a past commit, pathspecs and POSIX classes.

use debutuuru_core::{Location, Repo};
use std::path::{Path, PathBuf};
use std::process::Command;

fn git(dir: &Path, args: &[&str]) {
    let out = Command::new("git")
        .current_dir(dir)
        .args([
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "-c",
            "commit.gpgsign=false",
        ])
        .args(args)
        .output()
        .expect("git runs");
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

fn scratch() -> PathBuf {
    let p = std::env::temp_dir().join(format!("debutuuru-search-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&p);
    std::fs::create_dir_all(&p).unwrap();
    p
}

fn s(v: &[&str]) -> Vec<String> {
    v.iter().map(|x| x.to_string()).collect()
}

#[test]
fn finds_definitions_in_the_working_tree_and_at_a_commit() {
    let dir = scratch();
    git(&dir, &["init", "-q", "-b", "main"]);
    std::fs::create_dir_all(dir.join("src")).unwrap();
    std::fs::write(
        dir.join("src/api.ts"),
        "import x from 'y';\n\nexport function load() {}\n",
    )
    .unwrap();
    std::fs::write(dir.join(".gitignore"), "*.log\n").unwrap();
    git(&dir, &["add", "."]);
    git(&dir, &["commit", "-q", "-m", "one"]);
    std::fs::write(dir.join("src/new.ts"), "export const load = 1;\n").unwrap();
    std::fs::write(dir.join("debug.log"), "function load\n").unwrap();
    std::fs::write(dir.join("lib.rs"), "fn load() {}\n").unwrap();

    let repo = Repo::open(Location::local(dir.to_str().unwrap())).unwrap();
    let pats = s(&[
        "(^|[^A-Za-z0-9_$])function[[:space:]]+load([^A-Za-z0-9_$]|$)",
        "(const|let|var)[[:space:]]+load([^A-Za-z0-9_$]|$)",
    ]);
    let ts = s(&["*.ts"]);

    // Working tree: the untracked file too, never the ignored one.
    let found = repo.grep(None, &pats, &ts, 200).unwrap();
    let at: Vec<_> = found.iter().map(|m| (m.path.as_str(), m.line)).collect();
    assert_eq!(at, [("src/api.ts", 3), ("src/new.ts", 1)]);
    assert_eq!(found[0].text, "export function load() {}");

    // At the commit: only what it had, with plain paths.
    let found = repo.grep(Some("HEAD"), &pats, &ts, 200).unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].path, "src/api.ts");

    // Pathspecs and the cap.
    assert!(repo
        .grep(None, &pats, &s(&["*.rs"]), 200)
        .unwrap()
        .is_empty());
    assert_eq!(repo.grep(None, &pats, &[], 1).unwrap().len(), 1);
    // Nothing found is not an error; bad input is.
    assert!(repo
        .grep(None, &s(&["nothing_like_this"]), &[], 200)
        .unwrap()
        .is_empty());
    assert!(repo.grep(None, &[], &[], 200).is_err());
    assert!(repo.grep(Some("-x"), &pats, &[], 200).is_err());
}
