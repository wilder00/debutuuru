//! Updating a branch from its remote without checking it out: a local
//! branch fast-forwards (or says it diverged), a remote branch is fetched
//! alone, and the checked-out branch or one open in another worktree is left
//! to `pull`.

use debutuuru_agent::{Agent, Transport};
use debutuuru_protocol::git::{FailureHint, OpOutcome, OutcomeMessage};
use serde_json::json;
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

struct Scratch(PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn clone_as(s: &Path, bare: &Path, name: &str) -> PathBuf {
    git(s, &["clone", "-q", &bare.to_string_lossy(), name]);
    let dir = s.join(name);
    for (k, v) in [
        ("user.name", "Ana"),
        ("user.email", "ana@example.com"),
        ("commit.gpgsign", "false"),
    ] {
        git(&dir, &["config", k, v]);
    }
    dir
}

#[test]
fn updates_branches_without_checking_them_out() {
    let s = Scratch(std::env::temp_dir().join(format!("debutuuru-update-{}", std::process::id())));
    let _ = std::fs::remove_dir_all(&s.0);
    std::fs::create_dir_all(&s.0).unwrap();
    let bare = s.0.join("remote.git");
    git(&s.0, &["init", "-q", "--bare", "-b", "main", "remote.git"]);
    // "them" publishes main and feature; "me" clones and tracks feature.
    let them = clone_as(&s.0, &bare, "them");
    git(&them, &["commit", "-q", "--allow-empty", "-m", "first"]);
    git(
        &them,
        &[
            "push",
            "-q",
            "origin",
            "HEAD:main",
            "HEAD:refs/heads/feature",
        ],
    );
    let me = clone_as(&s.0, &bare, "me");
    git(&me, &["branch", "-q", "feature", "origin/feature"]);
    // They add a commit to feature; my local feature is now behind.
    git(&them, &["commit", "-q", "--allow-empty", "-m", "more"]);
    git(&them, &["push", "-q", "origin", "HEAD:refs/heads/feature"]);
    let new_tip = git(&them, &["rev-parse", "HEAD"]);

    let agent = Agent::with_default_modules();
    let repo = me.to_string_lossy().to_string();
    let update = |branch: &str| -> OpOutcome {
        serde_json::from_value(
            agent
                .call(
                    "git.update_branch",
                    json!({ "repo": repo, "op_id": "t", "branch": branch }),
                )
                .unwrap(),
        )
        .unwrap()
    };

    let out = update("feature");
    assert!(out.ok, "{}", out.summary);
    assert_eq!(
        out.message,
        Some(OutcomeMessage::BranchUpdated {
            branch: "feature".into(),
            from: "origin/feature".into()
        })
    );
    assert_eq!(git(&me, &["rev-parse", "feature"]), new_tip);
    assert_eq!(git(&me, &["rev-parse", "origin/feature"]), new_tip);
    // Still on main.
    assert_eq!(git(&me, &["branch", "--show-current"]), "main");

    let out = update("feature");
    assert_eq!(
        out.message,
        Some(OutcomeMessage::BranchUpToDate {
            branch: "feature".into()
        })
    );

    // A remote branch: fetched alone.
    git(&them, &["commit", "-q", "--allow-empty", "-m", "on main"]);
    git(&them, &["push", "-q", "origin", "HEAD:main"]);
    let out = update("origin/main");
    assert!(out.ok, "{}", out.summary);
    assert_eq!(
        git(&me, &["rev-parse", "origin/main"]),
        git(&them, &["rev-parse", "HEAD"])
    );

    // Diverged: a local commit plus a new remote one.
    git(&me, &["switch", "-q", "feature"]);
    git(&me, &["commit", "-q", "--allow-empty", "-m", "mine"]);
    git(&me, &["switch", "-q", "main"]);
    git(&them, &["commit", "-q", "--allow-empty", "-m", "theirs"]);
    git(&them, &["push", "-q", "origin", "HEAD:refs/heads/feature"]);
    let out = update("feature");
    assert!(!out.ok);
    assert_eq!(out.hint, Some(FailureHint::Diverged));
    assert!(matches!(
        out.message,
        Some(OutcomeMessage::BranchDiverged { .. })
    ));

    // Checked out here: that's what pull is for.
    assert!(agent
        .call(
            "git.update_branch",
            json!({ "repo": repo, "op_id": "t", "branch": "main" })
        )
        .is_err());
    // Checked out in another worktree.
    git(
        &me,
        &[
            "worktree",
            "add",
            "-q",
            &s.0.join("wt").to_string_lossy(),
            "feature",
        ],
    );
    let out = update("feature");
    assert!(matches!(
        out.message,
        Some(OutcomeMessage::BranchInWorktree { .. })
    ));
}
