//! End-to-end test against the real git binary, including linked worktrees
//! (where `.git` is a file, not a folder).

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

fn scratch(name: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!("debutuuru-test-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&p);
    std::fs::create_dir_all(&p).unwrap();
    p
}

#[test]
fn main_repo_and_linked_worktree() {
    let base = scratch("wt");
    let main = base.join("main");
    let linked = base.join("linked");
    std::fs::create_dir_all(&main).unwrap();

    git(&main, &["init", "-q", "-b", "main"]);
    std::fs::write(main.join("a.txt"), "hello\n").unwrap();
    git(&main, &["add", "."]);
    git(&main, &["commit", "-q", "-m", "first"]);
    git(
        &main,
        &[
            "worktree",
            "add",
            "-q",
            "-b",
            "feature",
            linked.to_str().unwrap(),
        ],
    );

    // The linked worktree has a `.git` FILE.
    assert!(linked.join(".git").is_file());

    let m = Repo::open(Location::local(main.to_str().unwrap())).unwrap();
    assert!(!m.info.is_linked_worktree);
    assert_eq!(m.info.head_branch.as_deref(), Some("main"));

    let l = Repo::open(Location::local(linked.to_str().unwrap())).unwrap();
    assert!(l.info.is_linked_worktree);
    assert_eq!(l.info.head_branch.as_deref(), Some("feature"));
    assert_eq!(l.info.common_dir, m.info.common_dir);

    // Both see both worktrees.
    assert_eq!(l.worktrees().unwrap().len(), 2);
    assert_eq!(m.worktrees().unwrap().len(), 2);

    // Stage + commit inside the linked worktree.
    std::fs::write(linked.join("b.txt"), "new\n").unwrap();
    let st = l.status().unwrap();
    assert_eq!(st.branch, "feature");
    assert_eq!(st.files.len(), 1);
    assert_eq!(st.files[0].worktree, '?');
    assert!(l.diff("b.txt", false, true).unwrap().contains("+new"));
    l.stage(&["b.txt".to_string()]).unwrap();
    assert_eq!(l.status().unwrap().files[0].index, 'A');
    l.commit("second").unwrap();

    let log = l.log(10).unwrap();
    assert_eq!(log.len(), 2);
    assert_eq!(log[0].commit.subject, "second");
    assert!(l
        .branches()
        .unwrap()
        .iter()
        .any(|b| b.name == "feature" && b.is_head));

    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn not_a_repo_is_an_error() {
    let dir = scratch("none");
    assert!(Repo::open(Location::local(dir.to_str().unwrap())).is_err());
    let _ = std::fs::remove_dir_all(&dir);
}
