//! A ticket folder with a clone and a linked worktree inside, one nested a
//! level deeper, plus folders that must be skipped.

use debutuuru_core::discover::find_repos;
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

/// Scratch folder, removed when the test ends.
struct Scratch(PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn finds_clones_and_worktrees_in_a_ticket_folder() {
    let s =
        Scratch(std::env::temp_dir().join(format!("debutuuru-discover-{}", std::process::id())));
    let _ = std::fs::remove_dir_all(&s.0);
    let (main, ticket) = (s.0.join("projects/ssr-site"), s.0.join("NED-2550"));
    std::fs::create_dir_all(&main).unwrap();
    std::fs::create_dir_all(ticket.join("node_modules/pkg/.git")).unwrap();
    std::fs::create_dir_all(ticket.join(".cache/x/.git")).unwrap();
    std::fs::create_dir_all(ticket.join("notes")).unwrap();
    git(&main, &["init", "-q", "-b", "main"]);
    git(&main, &["commit", "-q", "--allow-empty", "-m", "first"]);
    // A linked worktree (`.git` is a file) and a clone one level deeper.
    git(
        &main,
        &[
            "worktree",
            "add",
            "-q",
            "-b",
            "NED-2550",
            &ticket.join("ssr-site").to_string_lossy(),
        ],
    );
    std::fs::create_dir_all(ticket.join("backend")).unwrap();
    git(
        &ticket.join("backend"),
        &["clone", "-q", &main.to_string_lossy(), "ms-listing"],
    );

    let found = find_repos(&ticket.to_string_lossy()).unwrap();
    assert!(!found.inside_repo);
    let names: Vec<String> = found
        .repos
        .iter()
        .map(|p| {
            Path::new(p)
                .strip_prefix(&ticket)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/")
        })
        .collect();
    assert_eq!(names, ["backend/ms-listing", "ssr-site"]);

    // A repository, or a folder inside one, opens as itself.
    assert!(
        find_repos(&ticket.join("ssr-site").to_string_lossy())
            .unwrap()
            .inside_repo
    );
    assert!(find_repos(&main.to_string_lossy()).unwrap().inside_repo);
    // An empty folder finds nothing.
    let empty = find_repos(&ticket.join("notes").to_string_lossy()).unwrap();
    assert!(!empty.inside_repo && empty.repos.is_empty());
}
