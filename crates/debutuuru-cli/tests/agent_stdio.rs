//! End to end: spawn the real `debutuuru agent --stdio` binary, handshake,
//! and drive a git repository through it, exactly as the desktop app does
//! with an agent inside WSL.

use debutuuru_agent::client::StdioClient;
use debutuuru_agent::Transport;
use debutuuru_protocol::{git, ErrorCode, PROTOCOL_VERSION};
use serde_json::json;
use std::process::Command;

fn git_in(dir: &std::path::Path, args: &[&str]) {
    let ok = Command::new("git")
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
        .status()
        .unwrap()
        .success();
    assert!(ok, "git {args:?}");
}

#[test]
fn agent_over_stdio() {
    let dir = std::env::temp_dir().join(format!("debutuuru-agent-e2e-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    git_in(&dir, &["init", "-q", "-b", "main"]);
    // The agent commits with the repo's own config: CI runners have no
    // global identity, and the user's signing setup must not apply here.
    git_in(&dir, &["config", "user.name", "t"]);
    git_in(&dir, &["config", "user.email", "t@t"]);
    git_in(&dir, &["config", "commit.gpgsign", "false"]);
    std::fs::write(dir.join("f.txt"), "x\n").unwrap();
    git_in(&dir, &["add", "."]);
    git_in(&dir, &["commit", "-q", "-m", "one"]);
    std::fs::write(dir.join("g.txt"), "y\n").unwrap();

    let mut cmd = Command::new(env!("CARGO_BIN_EXE_debutuuru"));
    cmd.args(["agent", "--stdio"]);
    let client = StdioClient::spawn(cmd, None).expect("handshake");
    assert_eq!(client.hello.protocol_version, PROTOCOL_VERSION);
    assert!(client.hello.modules.iter().any(|m| m.name == git::MODULE));

    let repo = dir.to_str().unwrap();

    // Concurrent calls over one pipe are matched by id.
    std::thread::scope(|s| {
        let a = s.spawn(|| client.call(git::SNAPSHOT, json!({ "repo": repo })));
        let b = s.spawn(|| client.call(git::LOG, json!({ "repo": repo, "limit": 10 })));
        let snap = a.join().unwrap().unwrap();
        let log = b.join().unwrap().unwrap();
        assert_eq!(snap["info"]["head_branch"], "main");
        assert_eq!(snap["status"]["files"][0]["path"], "g.txt");
        assert_eq!(log[0]["subject"], "one");
    });

    client
        .call(git::STAGE, json!({ "repo": repo, "paths": ["g.txt"] }))
        .unwrap();
    client
        .call(git::COMMIT, json!({ "repo": repo, "message": "two" }))
        .unwrap();
    let log = client
        .call(git::LOG, json!({ "repo": repo, "limit": 10 }))
        .unwrap();
    assert_eq!(log[0]["subject"], "two");

    // File browsing: working tree and a commit.
    let tree = client
        .call(git::TREE, json!({ "repo": repo, "path": "" }))
        .unwrap();
    let names: Vec<&str> = tree
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["f.txt", "g.txt"]);
    let at_first = client
        .call(git::TREE, json!({ "repo": repo, "rev": "HEAD~1" }))
        .unwrap();
    assert_eq!(at_first.as_array().unwrap().len(), 1);
    let file = client
        .call(git::READ_FILE, json!({ "repo": repo, "path": "g.txt" }))
        .unwrap();
    assert_eq!(file["text"], "y\n");
    assert_eq!(file["binary"], false);

    // A commit's changes, and both sides of one of its files.
    let details = client
        .call(git::COMMIT_DETAILS, json!({ "repo": repo, "rev": "HEAD" }))
        .unwrap();
    assert_eq!(details["subject"], "two");
    assert_eq!(details["files"][0]["path"], "g.txt");
    assert_eq!(details["files"][0]["status"], "A");
    let versions = client
        .call(
            git::FILE_VERSIONS,
            json!({ "repo": repo, "source": { "kind": "commit", "rev": "HEAD" }, "path": "g.txt" }),
        )
        .unwrap();
    assert!(versions["old"].is_null());
    assert_eq!(versions["new"]["text"], "y\n");

    let err = client.call("git.nope", json!({})).unwrap_err();
    assert_eq!(err.code, ErrorCode::MethodNotFound);

    drop(client);
    let _ = std::fs::remove_dir_all(&dir);
}
