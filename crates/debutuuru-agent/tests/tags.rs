//! Tags through the agent: create one, see it in the snapshot, push it to a
//! (local, bare) remote, delete it there and locally.

use debutuuru_agent::{Agent, Transport};
use debutuuru_protocol::git::{OpOutcome, OutcomeMessage, Snapshot};
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
fn create_push_and_delete_a_tag() {
    let s =
        Scratch(std::env::temp_dir().join(format!("debutuuru-agent-tags-{}", std::process::id())));
    let _ = std::fs::remove_dir_all(&s.0);
    let (bare, work) = (s.0.join("remote.git"), s.0.join("work"));
    std::fs::create_dir_all(&work).unwrap();
    git(&s.0, &["init", "-q", "--bare", "remote.git"]);
    git(&work, &["init", "-q", "-b", "main"]);
    for (k, v) in [
        ("user.name", "Ana"),
        ("user.email", "ana@example.com"),
        ("commit.gpgsign", "false"),
        ("tag.gpgsign", "false"),
    ] {
        git(&work, &["config", k, v]);
    }
    git(&work, &["remote", "add", "origin", &bare.to_string_lossy()]);
    git(&work, &["commit", "-q", "--allow-empty", "-m", "first"]);

    let agent = Agent::with_default_modules();
    let repo = work.to_string_lossy().to_string();
    let call =
        |m: &str, p: serde_json::Value| agent.call(m, p).unwrap_or_else(|e| panic!("{m}: {e:?}"));
    call(
        "git.create_tag",
        json!({ "repo": repo, "name": "v1.0", "rev": "HEAD", "message": "First release" }),
    );

    let snap: Snapshot =
        serde_json::from_value(call("git.snapshot", json!({ "repo": repo }))).unwrap();
    assert_eq!(snap.tags.len(), 1);
    assert!(snap.tags[0].annotated);
    assert_eq!(snap.tags[0].message, "First release");

    let push = |delete: bool| -> OpOutcome {
        serde_json::from_value(call(
            "git.push_tag",
            json!({ "repo": repo, "op_id": "t", "name": "v1.0", "delete": delete }),
        ))
        .unwrap()
    };
    let out = push(false);
    assert!(out.ok, "{out:?}");
    assert_eq!(
        out.message,
        Some(OutcomeMessage::TagPushed {
            tag: "v1.0".into(),
            remote: "origin".into()
        })
    );
    assert_eq!(git(&bare, &["tag"]), "v1.0");

    let out = push(true);
    assert!(out.ok, "{out:?}");
    assert!(matches!(
        out.message,
        Some(OutcomeMessage::TagDeletedOnRemote { .. })
    ));
    assert_eq!(git(&bare, &["tag"]), "");

    call("git.delete_tag", json!({ "repo": repo, "name": "v1.0" }));
    assert_eq!(git(&work, &["tag"]), "");
}
