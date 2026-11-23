//! Commit details and file versions against the real git: a root commit, a
//! commit with a rename, a binary and a deletion, plus staged, unstaged and
//! untracked changes.

use debutuuru_core::changes::DiffSource;
use debutuuru_core::{Location, Repo};
use std::path::{Path, PathBuf};
use std::process::Command;

fn git(dir: &Path, args: &[&str]) -> String {
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
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

/// Scratch repo, removed when the test ends.
struct Scratch(PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn scratch() -> Scratch {
    let p = std::env::temp_dir().join(format!("debutuuru-changes-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&p);
    std::fs::create_dir_all(&p).unwrap();
    Scratch(p)
}

fn text(v: &Option<debutuuru_core::files::FileContent>) -> Option<&str> {
    v.as_ref().and_then(|c| c.text.as_deref())
}

#[test]
fn commit_files_and_versions() {
    let s = scratch();
    let dir = &s.0;
    git(dir, &["init", "-q", "-b", "main"]);
    std::fs::write(dir.join("a.txt"), "one\ntwo\n").unwrap();
    std::fs::write(
        dir.join("old-name.md"),
        "a long enough text\nto be seen as a rename\nby git\n",
    )
    .unwrap();
    std::fs::write(dir.join("gone.txt"), "bye\n").unwrap();
    git(dir, &["add", "."]);
    git(dir, &["commit", "-q", "-m", "first"]);
    let root = git(dir, &["rev-parse", "HEAD"]);

    std::fs::write(dir.join("a.txt"), "one\n2\nthree\n").unwrap();
    git(dir, &["mv", "old-name.md", "new-name.md"]);
    git(dir, &["rm", "-q", "gone.txt"]);
    std::fs::write(dir.join("logo.bin"), [0u8, 1, 2]).unwrap();
    git(dir, &["add", "."]);
    git(
        dir,
        &[
            "commit",
            "-q",
            "-m",
            "second",
            "-m",
            "Body line 1\n\nBody line 2",
        ],
    );

    let repo = Repo::open(Location::local(dir.to_str().unwrap())).unwrap();

    // Root commit: everything added, against nothing.
    let first = repo.commit_details(&root).unwrap();
    assert!(first.parents.is_empty());
    assert_eq!(first.subject, "first");
    assert!(first.files.iter().all(|f| f.status == 'A'));
    assert_eq!(first.files.len(), 3);

    let second = repo.commit_details("HEAD").unwrap();
    assert_eq!(second.parents, std::slice::from_ref(&root));
    assert_eq!(
        (second.subject.as_str(), second.body.as_str()),
        ("second", "Body line 1\n\nBody line 2")
    );
    let by_path = |p: &str| {
        second
            .files
            .iter()
            .find(|f| f.path == p)
            .unwrap_or_else(|| panic!("{p} listed"))
    };
    let a = by_path("a.txt");
    assert_eq!(
        (a.status, a.additions, a.deletions),
        ('M', Some(2), Some(1))
    );
    let renamed = by_path("new-name.md");
    assert_eq!(
        (renamed.status, renamed.orig_path.as_deref()),
        ('R', Some("old-name.md"))
    );
    assert_eq!(by_path("gone.txt").status, 'D');
    let bin = by_path("logo.bin");
    assert_eq!((bin.status, bin.additions), ('A', None));

    // Versions of a commit's files.
    let src = DiffSource::Commit { rev: "HEAD".into() };
    let v = repo.file_versions(&src, "a.txt", None).unwrap();
    assert_eq!(
        (text(&v.old), text(&v.new)),
        (Some("one\ntwo\n"), Some("one\n2\nthree\n"))
    );
    let v = repo
        .file_versions(&src, "new-name.md", Some("old-name.md"))
        .unwrap();
    assert!(v.old.is_some() && v.new.is_some());
    let v = repo.file_versions(&src, "gone.txt", None).unwrap();
    assert!(v.old.is_some() && v.new.is_none());
    let v = repo.file_versions(&src, "logo.bin", None).unwrap();
    assert!(v.old.is_none() && v.new.as_ref().unwrap().binary);
    let v = repo
        .file_versions(&DiffSource::Commit { rev: root }, "a.txt", None)
        .unwrap();
    assert!(v.old.is_none() && text(&v.new) == Some("one\ntwo\n"));

    // Staged, unstaged and untracked.
    std::fs::write(dir.join("a.txt"), "staged\n").unwrap();
    git(dir, &["add", "a.txt"]);
    std::fs::write(dir.join("a.txt"), "on disk\n").unwrap();
    std::fs::write(dir.join("new.txt"), "fresh\n").unwrap();
    let v = repo
        .file_versions(&DiffSource::Staged, "a.txt", None)
        .unwrap();
    assert_eq!(
        (text(&v.old), text(&v.new)),
        (Some("one\n2\nthree\n"), Some("staged\n"))
    );
    let v = repo
        .file_versions(&DiffSource::Unstaged, "a.txt", None)
        .unwrap();
    assert_eq!(
        (text(&v.old), text(&v.new)),
        (Some("staged\n"), Some("on disk\n"))
    );
    let v = repo
        .file_versions(&DiffSource::Untracked, "new.txt", None)
        .unwrap();
    assert_eq!((text(&v.old), text(&v.new)), (None, Some("fresh\n")));
    // Deleted on disk but not staged: no new side.
    std::fs::remove_file(dir.join("new-name.md")).unwrap();
    let v = repo
        .file_versions(&DiffSource::Unstaged, "new-name.md", None)
        .unwrap();
    assert!(v.old.is_some() && v.new.is_none());

    // Paths and revisions can't escape or become options.
    assert!(repo
        .file_versions(&DiffSource::Unstaged, "../x", None)
        .is_err());
    assert!(repo.commit_details("--output=x").is_err());
}

#[test]
fn head_to_working_tree_and_last_change() {
    let s =
        Scratch(std::env::temp_dir().join(format!("debutuuru-last-change-{}", std::process::id())));
    let _ = std::fs::remove_dir_all(&s.0);
    std::fs::create_dir_all(&s.0).unwrap();
    let dir = &s.0;
    git(dir, &["init", "-q", "-b", "main"]);
    let repo = Repo::open(Location::local(dir.to_string_lossy())).unwrap();
    // No commits yet: nothing to show.
    std::fs::write(dir.join("a.txt"), "one\n").unwrap();
    assert_eq!(repo.last_change(None, "a.txt").unwrap(), None);

    git(dir, &["add", "."]);
    git(dir, &["commit", "-q", "-m", "add a"]);
    let first = git(dir, &["rev-parse", "HEAD"]);
    std::fs::write(dir.join("b.txt"), "other\n").unwrap();
    git(dir, &["add", "."]);
    git(dir, &["commit", "-q", "-m", "add b"]);
    std::fs::write(
        dir.join("old.md"),
        "a long enough text\nto be seen as a rename\nby git log --follow\n",
    )
    .unwrap();
    git(dir, &["add", "."]);
    git(dir, &["commit", "-q", "-m", "add old"]);
    git(dir, &["mv", "old.md", "new.md"]);
    git(dir, &["commit", "-q", "-m", "rename"]);
    let rename = git(dir, &["rev-parse", "HEAD"]);

    // a.txt last changed in the first commit, even from later revisions.
    let a = repo.last_change(None, "a.txt").unwrap().unwrap();
    assert_eq!(
        (a.hash.as_str(), a.subject.as_str(), a.author.as_str()),
        (first.as_str(), "add a", "t")
    );
    assert_eq!(a.orig_path, None);
    assert_eq!(
        repo.last_change(Some(&rename), "a.txt")
            .unwrap()
            .unwrap()
            .hash,
        first
    );
    // The rename commit, with the old name.
    let n = repo.last_change(None, "new.md").unwrap().unwrap();
    assert_eq!(
        (n.hash.as_str(), n.orig_path.as_deref()),
        (rename.as_str(), Some("old.md"))
    );
    assert_eq!(repo.last_change(None, "missing.txt").unwrap(), None);

    // HEAD → working tree takes staged and unstaged edits together.
    std::fs::write(dir.join("a.txt"), "one\ntwo\n").unwrap();
    git(dir, &["add", "a.txt"]);
    std::fs::write(dir.join("a.txt"), "one\ntwo\nthree\n").unwrap();
    let v = repo
        .file_versions(&DiffSource::Head, "a.txt", None)
        .unwrap();
    assert_eq!(text(&v.old), Some("one\n"));
    assert_eq!(
        text(&v.new).map(|t| t.replace("\r\n", "\n")),
        Some("one\ntwo\nthree\n".into())
    );
}
