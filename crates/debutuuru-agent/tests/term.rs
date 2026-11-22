//! Terminals over a real pseudo-terminal (ConPTY on Windows, a PTY on Unix):
//! output, typing into an interactive shell, resizing, exit codes and kill.

use debutuuru_agent::{Agent, Transport};
use debutuuru_protocol::term::{ExitEvent, OutputEvent, EXIT, OUTPUT};
use serde_json::{json, Value};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

enum Ev {
    Out(String, String),
    Exit(String, Option<u32>),
}

fn agent() -> (Agent, mpsc::Receiver<Ev>) {
    let agent = Agent::with_default_modules();
    let (tx, rx) = mpsc::channel();
    let tx = std::sync::Mutex::new(tx);
    agent.set_event_sink(Arc::new(move |ev| {
        let tx = tx.lock().unwrap();
        if ev.topic == OUTPUT {
            let o: OutputEvent = serde_json::from_value(ev.payload).unwrap();
            let _ = tx.send(Ev::Out(o.id, o.data));
        } else if ev.topic == EXIT {
            let e: ExitEvent = serde_json::from_value(ev.payload).unwrap();
            let _ = tx.send(Ev::Exit(e.id, e.code));
        }
    }));
    (agent, rx)
}

/// Output of terminal `id` until `done` says so (or the timeout).
fn read_until(
    agent: &Agent,
    rx: &mpsc::Receiver<Ev>,
    id: &str,
    mut done: impl FnMut(&str, Option<Option<u32>>) -> bool,
) -> (String, Option<Option<u32>>) {
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut out = String::new();
    let mut exit = None;
    while Instant::now() < deadline {
        match rx.recv_timeout(Duration::from_millis(200)) {
            Ok(Ev::Out(i, d)) if i == id => {
                // ConPTY asks where the cursor is (DSR) and waits for the
                // answer; xterm.js answers it in the app, so answer it here.
                if d.contains("[6n") {
                    let _ = agent.call("term.write", json!({ "id": id, "data": "[1;1R" }));
                }
                out.push_str(&d)
            }
            Ok(Ev::Exit(i, c)) if i == id => exit = Some(c),
            _ => {}
        }
        if done(&out, exit) {
            break;
        }
    }
    (out, exit)
}

fn spawn(agent: &Agent, program: &str, args: &[&str]) -> String {
    let r = agent
        .call(
            "term.spawn",
            json!({ "program": program, "args": args, "cols": 100, "rows": 30 }),
        )
        .expect("spawn");
    r["id"].as_str().unwrap().to_string()
}

#[test]
fn runs_a_command_and_reports_its_exit_code() {
    let (agent, rx) = agent();
    let id = if cfg!(windows) {
        spawn(&agent, "cmd.exe", &["/d", "/c", "echo hello-term"])
    } else {
        spawn(&agent, "sh", &["-c", "echo hello-term"])
    };
    let (out, exit) = read_until(&agent, &rx, &id, |_, e| e.is_some());
    assert!(out.contains("hello-term"), "{out:?}");
    assert_eq!(exit, Some(Some(0)));
}

#[test]
fn interactive_shell_input_resize_and_exit() {
    let (agent, rx) = agent();
    let (id, nl) = if cfg!(windows) {
        (spawn(&agent, "cmd.exe", &["/d", "/q"]), "\r")
    } else {
        (spawn(&agent, "sh", &[]), "\n")
    };
    agent
        .call(
            "term.write",
            json!({ "id": id, "data": format!("echo typed-{}{nl}", 40 + 2) }),
        )
        .unwrap();
    let (out, _) = read_until(&agent, &rx, &id, |o, _| o.contains("typed-42"));
    assert!(out.contains("typed-42"), "{out:?}");
    agent
        .call("term.resize", json!({ "id": id, "cols": 120, "rows": 40 }))
        .unwrap();
    agent
        .call(
            "term.write",
            json!({ "id": id, "data": format!("exit 7{nl}") }),
        )
        .unwrap();
    let (_, exit) = read_until(&agent, &rx, &id, |_, e| e.is_some());
    assert_eq!(exit, Some(Some(7)));
    // Ended terminals refuse input instead of hanging.
    assert!(agent
        .call("term.write", json!({ "id": id, "data": "x" }))
        .is_err());
}

#[test]
fn kill_ends_a_running_program() {
    let (agent, rx) = agent();
    let id = if cfg!(windows) {
        spawn(&agent, "cmd.exe", &["/d", "/c", "ping -n 30 127.0.0.1"])
    } else {
        spawn(&agent, "sh", &["-c", "sleep 30"])
    };
    std::thread::sleep(Duration::from_millis(500));
    let started = Instant::now();
    agent.call("term.kill", json!({ "id": id })).unwrap();
    let (_, exit) = read_until(&agent, &rx, &id, |_, e| e.is_some());
    assert!(exit.is_some(), "no exit event after kill");
    assert!(started.elapsed() < Duration::from_secs(10));
    let _: Value = json!(null);
}
