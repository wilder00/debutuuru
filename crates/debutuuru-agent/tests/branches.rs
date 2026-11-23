//! Deleting branches through the agent: what each deletion means (merged,
//! commits only on that branch, not pushed, checked out elsewhere), local
//! deletion with and without force, and deleting on a (local, bare) remote.

use debutuuru_agent::{Agent, Transport};
use debutuuru_core::branches::{BranchDeletion, DeleteResult};
use debutuuru_protocol::git::{OpOutcome, OutcomeMessage};
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

/// Scratch folder, removed when the test ends.
struct Scratch(PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn deletion_info_and_deleting_branches() {
    let s = Scratch(
        std::env::temp_dir().join(format!("debutuuru-agent-branches-{}", std::process::id())),
    );
    let _ = std::fs::remove_dir_all(&s.0);
    let (bare, work) = (s.0.join("remote.git"), s.0.join("work"));
    std::fs::create_dir_all(&work).unwrap();
    git(&s.0, &["init", "-q", "--bare", "remote.git"]);
    git(&work, &["init", "-q", "-b", "main"]);
    for (k, v) in [
        ("user.name", "Ana"),
        ("user.email", "ana@example.com"),
        ("commit.gpgsign", "false"),
    ] {
        git(&work, &["config", k, v]);
    }
    git(&work, &["remote", "add", "origin", &bare.to_string_lossy()]);
    git(&work, &["commit", "-q", "--allow-empty", "-m", "first"]);
    git(&work, &["push", "-q", "-u", "origin", "main"]);
    // merged: same commit as main. wip: 2 commits nobody else has.
    git(&work, &["branch", "merged"]);
    git(&work, &["switch", "-q", "-c", "wip"]);
    git(&work, &["commit", "-q", "--allow-empty", "-m", "wip 1"]);
    git(&work, &["commit", "-q", "--allow-empty", "-m", "wip 2"]);
    // pushed: on the remote, then one more local commit not pushed.
    git(&work, &["switch", "-q", "-c", "pushed", "main"]);
    git(&work, &["commit", "-q", "--allow-empty", "-m", "shared"]);
    git(&work, &["push", "-q", "-u", "origin", "pushed"]);
    git(
        &work,
        &["commit", "-q", "--allow-empty", "-m", "local only"],
    );
    git(&work, &["switch", "-q", "main"]);
    // elsewhere: checked out in a linked worktree.
    git(
        &work,
        &[
            "worktree",
            "add",
            "-q",
            "-b",
            "elsewhere",
            &s.0.join("wt").to_string_lossy(),
        ],
    );

    let agent = Agent::with_default_modules();
    let repo = work.to_string_lossy().to_string();
    let call =
        |m: &str, p: serde_json::Value| agent.call(m, p).unwrap_or_else(|e| panic!("{m}: {e:?}"));
    let names = [
        "main",
        "merged",
        "wip",
        "pushed",
        "elsewhere",
        "origin/pushed",
    ];
    let info: Vec<BranchDeletion> = serde_json::from_value(call(
        "git.branch_deletion_info",
        json!({ "repo": repo, "branches": names }),
    ))
    .unwrap();
    let get = |n: &str| info.iter().find(|b| b.name == n).unwrap();
    assert!(get("main").is_head);
    let merged = get("merged");
    assert!(merged.merged_into_head && merged.unique_commits == 0 && merged.worktree.is_none());
    let wip = get("wip");
    assert!(!wip.merged_into_head);
    assert_eq!((wip.unique_commits, wip.upstream.as_deref()), (2, None));
    let pushed = get("pushed");
    assert_eq!(
        (
            pushed.upstream.as_deref(),
            pushed.ahead,
            pushed.unique_commits
        ),
        (Some("origin/pushed"), 1, 1)
    );
    assert!(get("elsewhere")
        .worktree
        .as_deref()
        .is_some_and(|w| w.ends_with("wt")));
    let remote = get("origin/pushed");
    assert!(remote.is_remote);
    assert_eq!(
        (
            remote.remote.as_deref(),
            remote.remote_branch.as_deref(),
            remote.unique_commits
        ),
        (Some("origin"), Some("pushed"), 0)
    );

    // Without force git refuses the unmerged branch; the others still go.
    let res: Vec<DeleteResult> = serde_json::from_value(call(
        "git.delete_branches",
        json!({ "repo": repo, "branches": ["merged", "wip"] }),
    ))
    .unwrap();
    assert!(res[0].error.is_none());
    assert!(
        res[1]
            .error
            .as_deref()
            .is_some_and(|e| e.contains("not fully merged")),
        "{res:?}"
    );
    let res: Vec<DeleteResult> = serde_json::from_value(call(
        "git.delete_branches",
        json!({ "repo": repo, "branches": ["wip"], "force": true }),
    ))
    .unwrap();
    assert!(res[0].error.is_none());

    let out: OpOutcome = serde_json::from_value(call(
        "git.delete_remote_branches",
        json!({ "repo": repo, "op_id": "d", "remote": "origin", "branches": ["pushed"] }),
    ))
    .unwrap();
    assert!(out.ok, "{out:?}");
    assert!(matches!(
        out.message,
        Some(OutcomeMessage::RemoteBranchesDeleted { .. })
    ));
    assert_eq!(git(&bare, &["branch", "--format=%(refname:short)"]), "main");
    assert_eq!(
        git(&work, &["branch", "--format=%(refname:short)"])
            .lines()
            .collect::<Vec<_>>(),
        ["elsewhere", "main", "pushed"]
    );
}
