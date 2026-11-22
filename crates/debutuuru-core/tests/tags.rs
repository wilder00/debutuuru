//! Tags against the real git: list lightweight and annotated tags with their
//! details, create both kinds through `Repo`, delete one.

use debutuuru_core::{Location, Repo};
use std::path::{Path, PathBuf};
use std::process::Command;

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .expect("git runs");
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

/// Scratch repo, removed when the test ends.
struct Scratch(PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn list_create_and_delete_tags() {
    let s = Scratch(std::env::temp_dir().join(format!("debutuuru-tags-{}", std::process::id())));
    let dir = &s.0;
    let _ = std::fs::remove_dir_all(dir);
    std::fs::create_dir_all(dir).unwrap();
    git(dir, &["init", "-q", "-b", "main"]);
    // Repo-local identity and no signing, whatever the user's global config says.
    for (k, v) in [
        ("user.name", "Ana"),
        ("user.email", "ana@example.com"),
        ("commit.gpgsign", "false"),
        ("tag.gpgsign", "false"),
    ] {
        git(dir, &["config", k, v]);
    }
    std::fs::write(dir.join("a.txt"), "one\n").unwrap();
    git(dir, &["add", "."]);
    git(dir, &["commit", "-q", "-m", "first"]);
    let first = git(dir, &["rev-parse", "HEAD"]);
    git(dir, &["tag", "v0.1"]);
    std::fs::write(dir.join("a.txt"), "two\n").unwrap();
    git(dir, &["commit", "-q", "-am", "second"]);
    let second = git(dir, &["rev-parse", "HEAD"]);

    let repo = Repo::open(Location::local(dir.to_string_lossy())).unwrap();
    repo.create_tag("v0.2", "HEAD", Some("Release 0.2\n\nBetter numbers."))
        .unwrap();
    repo.create_tag("light", &first, None).unwrap();
    assert!(repo.create_tag("--force", "HEAD", None).is_err());
    assert!(
        repo.create_tag("v0.2", "HEAD", None).is_err(),
        "already exists"
    );

    let tags = repo.tags().unwrap();
    let get = |n: &str| {
        tags.iter()
            .find(|t| t.name == n)
            .unwrap_or_else(|| panic!("{n} in {tags:?}"))
    };
    let v2 = get("v0.2");
    assert!(v2.annotated && !v2.signed);
    assert_eq!(v2.target, second);
    assert_eq!(v2.tagger.as_deref(), Some("Ana"));
    assert_eq!(v2.email.as_deref(), Some("ana@example.com"));
    assert_eq!(v2.message, "Release 0.2\n\nBetter numbers.");
    assert_eq!(v2.commit_subject, "second");
    let v1 = get("v0.1");
    assert!(!v1.annotated && v1.tagger.is_none());
    assert_eq!(
        (v1.target.as_str(), v1.commit_subject.as_str()),
        (first.as_str(), "first")
    );
    assert_eq!(get("light").target, first);

    repo.delete_tag("light").unwrap();
    assert_eq!(repo.tags().unwrap().len(), 2);
}
