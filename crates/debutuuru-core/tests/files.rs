//! File tree and file contents against the real git: working tree (with
//! .gitignore) and a past commit.

use debutuuru_core::files::EntryKind;
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
    let p = std::env::temp_dir().join(format!("debutuuru-files-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&p);
    std::fs::create_dir_all(&p).unwrap();
    p
}

fn names(entries: &[debutuuru_core::files::TreeEntry]) -> Vec<&str> {
    entries.iter().map(|e| e.name.as_str()).collect()
}

#[test]
fn tree_and_contents_on_disk_and_at_a_commit() {
    let dir = scratch();
    git(&dir, &["init", "-q", "-b", "main"]);
    std::fs::create_dir_all(dir.join("src/nested")).unwrap();
    std::fs::write(dir.join("src/main.rs"), "fn main() {}\n").unwrap();
    std::fs::write(dir.join("src/nested/deep.txt"), "deep\n").unwrap();
    std::fs::write(dir.join("README.md"), "# v1\n").unwrap();
    std::fs::write(dir.join(".gitignore"), "/target\n*.log\n").unwrap();
    std::fs::write(dir.join("logo.bin"), [0u8, 1, 2, 3]).unwrap();
    git(&dir, &["add", "."]);
    git(&dir, &["commit", "-q", "-m", "one"]);

    // Working tree changes after the commit.
    std::fs::write(dir.join("README.md"), "# v2\n").unwrap();
    std::fs::write(dir.join("new.txt"), "untracked\n").unwrap();
    std::fs::create_dir_all(dir.join("target/debug")).unwrap();
    std::fs::write(dir.join("target/debug/out"), "x").unwrap();
    std::fs::write(dir.join("build.log"), "log").unwrap();

    let repo = Repo::open(Location::local(dir.to_str().unwrap())).unwrap();

    // Root on disk: folders first, ignored hidden, .git never shown.
    let root = repo.tree(None, "", false).unwrap();
    assert_eq!(
        names(&root),
        ["src", ".gitignore", "logo.bin", "new.txt", "README.md"]
    );
    assert_eq!(root[0].kind, EntryKind::Dir);

    // Ignored entries appear on request, flagged.
    let all = repo.tree(None, "", true).unwrap();
    let target = all
        .iter()
        .find(|e| e.name == "target")
        .expect("target shown");
    assert!(target.ignored && target.kind == EntryKind::Dir);
    assert!(all.iter().find(|e| e.name == "build.log").unwrap().ignored);
    assert!(!all.iter().find(|e| e.name == "README.md").unwrap().ignored);

    // One level per call, with repo-relative paths.
    let src = repo.tree(None, "src", false).unwrap();
    assert_eq!(names(&src), ["nested", "main.rs"]);
    assert_eq!(src[1].path, "src/main.rs");

    // At the commit: no untracked/ignored files, old content.
    let at = repo.tree(Some("HEAD"), "", false).unwrap();
    assert_eq!(names(&at), ["src", ".gitignore", "logo.bin", "README.md"]);
    assert_eq!(
        names(&repo.tree(Some("HEAD"), "src/nested", false).unwrap()),
        ["deep.txt"]
    );
    assert_eq!(
        repo.read_file(Some("HEAD"), "README.md")
            .unwrap()
            .text
            .as_deref(),
        Some("# v1\n")
    );
    assert_eq!(
        repo.read_file(None, "README.md").unwrap().text.as_deref(),
        Some("# v2\n")
    );

    // Binary files are detected, never sent as text.
    for rev in [None, Some("HEAD")] {
        let bin = repo.read_file(rev, "logo.bin").unwrap();
        assert!(bin.binary && bin.text.is_none() && bin.size == 4, "{rev:?}");
    }

    // Nothing outside the repository, and no option injection through rev.
    assert!(repo.read_file(None, "../outside.txt").is_err());
    assert!(repo.tree(None, "src/../..", false).is_err());
    assert!(repo
        .read_file(Some("--output=/tmp/x"), "README.md")
        .is_err());
    assert!(repo.read_file(None, "src").is_err());

    // Which paths exist (imports and links), on disk and at the commit.
    let paths: Vec<String> = [
        "src/main.rs",
        "src/nested",
        "new.txt",
        "nope.rs",
        "../x",
        "",
    ]
    .map(String::from)
    .to_vec();
    assert_eq!(
        repo.stat_paths(None, &paths).unwrap(),
        [
            Some(EntryKind::File),
            Some(EntryKind::Dir),
            Some(EntryKind::File),
            None,
            None,
            None
        ]
    );
    assert_eq!(
        repo.stat_paths(Some("HEAD"), &paths).unwrap(),
        [
            Some(EntryKind::File),
            Some(EntryKind::Dir),
            None, // untracked: not in the commit
            None,
            None,
            None
        ]
    );
    assert!(repo.stat_paths(None, &vec![String::new(); 65]).is_err());

    // Raw bytes (images), from disk and from the commit.
    for rev in [None, Some("HEAD")] {
        let b = repo.read_bytes(rev, "logo.bin").unwrap();
        assert_eq!((b.size, b.base64.as_str()), (4, "AAECAw=="), "{rev:?}");
    }
    assert!(repo.read_bytes(None, "src").is_err());
    assert!(repo.read_bytes(None, "../outside.txt").is_err());

    let _ = std::fs::remove_dir_all(&dir);
}
