//! Remote operations through the real agent binary and the real git:
//! push/pull/fetch against a local bare repo, and the credential-prompt
//! bridge against a local HTTP server that demands a password.
//!
//! The agent is started with the user's global/system git config disabled,
//! so a credential manager on the machine can't interfere or pop up.

use debutuuru_agent::client::StdioClient;
use debutuuru_agent::Transport;
use debutuuru_protocol::git::{self, FailureHint, OpOutcome, PromptEvent, PromptKind};
use debutuuru_protocol::Event;
use serde_json::json;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

fn scratch(name: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!("debutuuru-remote-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&p);
    std::fs::create_dir_all(&p).unwrap();
    p
}

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .current_dir(dir)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .args([
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "-c",
            "commit.gpgsign=false",
            "-c",
            "init.defaultBranch=main",
        ])
        .args(args)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).into_owned()
}

/// Agent with isolated git config; returns the client and its event stream.
fn agent(home: &Path) -> (StdioClient, mpsc::Receiver<Event>) {
    let empty = home.join("empty.gitconfig");
    std::fs::write(&empty, "[user]\n\tname = t\n\temail = t@t\n").unwrap();
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_debutuuru"));
    cmd.args(["agent", "--stdio"])
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", &empty);
    let (tx, rx) = mpsc::channel();
    let tx = Mutex::new(tx);
    let client = StdioClient::spawn(
        cmd,
        Some(Arc::new(move |e| {
            let _ = tx.lock().unwrap().send(e);
        })),
    )
    .expect("agent starts");
    (client, rx)
}

fn outcome(v: serde_json::Value) -> OpOutcome {
    serde_json::from_value(v).unwrap()
}

#[test]
fn push_pull_fetch_against_bare_remote() {
    let base = scratch("bare");
    let remote = base.join("remote.git");
    let a = base.join("a");
    let b = base.join("b");
    std::fs::create_dir_all(&a).unwrap();
    git(&base, &["init", "-q", "--bare", remote.to_str().unwrap()]);
    git(&a, &["init", "-q"]);
    std::fs::write(a.join("f.txt"), "1\n").unwrap();
    git(&a, &["add", "."]);
    git(&a, &["commit", "-q", "-m", "one"]);
    git(&a, &["remote", "add", "origin", remote.to_str().unwrap()]);

    let (client, events) = agent(&base);
    let ra = a.to_str().unwrap();

    // New branch without upstream: published with -u.
    let o = outcome(
        client
            .call(git::PUSH, json!({ "repo": ra, "op_id": "p1" }))
            .unwrap(),
    );
    assert!(o.ok, "{o:?}");
    assert_eq!(o.summary, "Pushed main → origin/main");
    assert!(
        events.try_iter().any(|e| e.topic == git::PROGRESS),
        "progress events"
    );

    let o = outcome(
        client
            .call(git::PUSH, json!({ "repo": ra, "op_id": "p2" }))
            .unwrap(),
    );
    assert_eq!(o.summary, "Nothing to push");

    // Someone else pushes; our push is rejected, then pull brings it in.
    git(
        &base,
        &["clone", "-q", remote.to_str().unwrap(), b.to_str().unwrap()],
    );
    std::fs::write(b.join("g.txt"), "2\n").unwrap();
    git(&b, &["add", "."]);
    git(&b, &["commit", "-q", "-m", "two"]);
    git(&b, &["push", "-q"]);

    std::fs::write(a.join("h.txt"), "3\n").unwrap();
    git(&a, &["add", "."]);
    git(&a, &["commit", "-q", "-m", "three"]);
    let o = outcome(
        client
            .call(git::PUSH, json!({ "repo": ra, "op_id": "p3" }))
            .unwrap(),
    );
    assert!(!o.ok);
    assert_eq!(o.hint, Some(FailureHint::Rejected), "{o:?}");

    let o = outcome(
        client
            .call(git::FETCH, json!({ "repo": ra, "op_id": "f1" }))
            .unwrap(),
    );
    assert!(o.ok, "{o:?}");
    let o = outcome(
        client
            .call(
                git::PULL,
                json!({ "repo": ra, "op_id": "l1", "mode": "rebase" }),
            )
            .unwrap(),
    );
    assert!(o.ok, "{o:?}");
    assert_eq!(o.summary, "Pulled origin/main");
    let o = outcome(
        client
            .call(git::PUSH, json!({ "repo": ra, "op_id": "p4" }))
            .unwrap(),
    );
    assert!(o.ok, "{o:?}");

    let snap = client.call(git::SNAPSHOT, json!({ "repo": ra })).unwrap();
    assert_eq!(snap["upstream"], "origin/main");
    assert_eq!(snap["remotes"][0]["transport"], "file");

    drop(client);
    let _ = std::fs::remove_dir_all(&base);
}

/// HTTP server that always answers 401 and records Authorization headers.
fn auth_server() -> (u16, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let s = seen.clone();
    std::thread::spawn(move || {
        for conn in listener.incoming().flatten() {
            let mut reader = BufReader::new(&conn);
            let mut line = String::new();
            while reader.read_line(&mut line).is_ok_and(|n| n > 0) && line != "\r\n" {
                if let Some(v) = line.strip_prefix("Authorization: ") {
                    s.lock().unwrap().push(v.trim().to_string());
                }
                line.clear();
            }
            let mut w = &conn;
            let _ = w.write_all(b"HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm=\"test\"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        }
    });
    (port, seen)
}

fn next_prompt(events: &mpsc::Receiver<Event>) -> PromptEvent {
    loop {
        let e = events
            .recv_timeout(Duration::from_secs(20))
            .expect("a prompt from git");
        if e.topic == git::PROMPT {
            return serde_json::from_value(e.payload).unwrap();
        }
    }
}

#[test]
fn credential_prompts_reach_the_app_and_answers_reach_git() {
    let base = scratch("askpass");
    let repo = base.join("r");
    std::fs::create_dir_all(&repo).unwrap();
    git(&repo, &["init", "-q"]);
    let (port, seen) = auth_server();
    git(
        &repo,
        &[
            "remote",
            "add",
            "origin",
            &format!("http://127.0.0.1:{port}/r.git"),
        ],
    );

    let (client, events) = agent(&base);
    let client = Arc::new(client);
    let rp = repo.to_str().unwrap().to_string();

    // Answer username + password like the UI dialog would.
    let c = client.clone();
    let r = rp.clone();
    let fetch =
        std::thread::spawn(move || c.call(git::FETCH, json!({ "repo": r, "op_id": "auth1" })));
    let user = next_prompt(&events);
    assert_eq!(user.kind, PromptKind::Text, "{user:?}");
    assert!(user.prompt.starts_with("Username for"), "{user:?}");
    assert_eq!(user.op_id, "auth1");
    client
        .call(
            git::PROMPT_REPLY,
            json!({ "repo": rp, "id": user.id, "answer": "alice" }),
        )
        .unwrap();
    let pass = next_prompt(&events);
    assert_eq!(pass.kind, PromptKind::Secret);
    client
        .call(
            git::PROMPT_REPLY,
            json!({ "repo": rp, "id": pass.id, "answer": "s3cret" }),
        )
        .unwrap();

    let o = outcome(fetch.join().unwrap().unwrap());
    assert!(!o.ok);
    assert_eq!(o.hint, Some(FailureHint::HttpsAuth), "{o:?}");
    assert!(
        !o.log.contains("s3cret"),
        "answers must never appear in logs"
    );
    // base64("alice:s3cret")
    assert!(
        seen.lock()
            .unwrap()
            .iter()
            .any(|h| h == "Basic YWxpY2U6czNjcmV0"),
        "{:?}",
        seen.lock().unwrap()
    );

    // Cancelling the dialog fails the operation cleanly (no hang).
    let c = client.clone();
    let r = rp.clone();
    let fetch =
        std::thread::spawn(move || c.call(git::FETCH, json!({ "repo": r, "op_id": "auth2" })));
    let user = next_prompt(&events);
    client
        .call(
            git::PROMPT_REPLY,
            json!({ "repo": rp, "id": user.id, "answer": null }),
        )
        .unwrap();
    let o = outcome(fetch.join().unwrap().unwrap());
    assert!(!o.ok, "{o:?}");

    drop(client);
    let _ = std::fs::remove_dir_all(&base);
}
