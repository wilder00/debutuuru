//! fetch / pull / push through the user's own git and ssh.
//!
//! Nothing about authentication is overridden: ssh keys (with or without a
//! passphrase), ssh-agent, `~/.ssh/config`, `core.sshCommand`, credential
//! helpers all behave exactly as in the user's terminal. We only add an
//! askpass bridge (see [`crate::askpass`]) for the moments git/ssh would have
//! asked on a terminal, and optionally an `ssh_command` override the user
//! chose (e.g. Windows repos using the SSH keys that live in WSL).

use crate::askpass::{self, Server};
use crate::Events;
use debutuuru_core::Repo;
use debutuuru_protocol::git::{
    FailureHint, OpOutcome, OutcomeMessage, ProgressEvent, RemoteOptions, PROGRESS,
};
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::process::{Child, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Running operations, for cancellation.
#[derive(Default)]
pub struct Ops {
    running: Mutex<HashMap<String, Arc<Mutex<Child>>>>,
    cancelled: Mutex<HashSet<String>>,
}

impl Ops {
    pub fn cancel(&self, op_id: &str) {
        lock(&self.cancelled).insert(op_id.to_string());
        if let Some(child) = lock(&self.running).get(op_id) {
            let _ = lock(child).kill();
        }
    }
}

pub struct RemoteOp<'a> {
    pub repo: &'a Repo,
    /// The repo as the app named it (echoed in events).
    pub repo_key: &'a str,
    pub options: &'a RemoteOptions,
    pub args: Vec<String>,
}

/// Runs a remote git command, streaming progress events. Never returns an
/// `Err` for git failures: they become an [`OpOutcome`] with a hint.
pub fn run(op: RemoteOp<'_>, events: &Events, ops: &Ops) -> OpOutcome {
    let askpass = match askpass::server(events) {
        Ok(s) => s,
        Err(e) => {
            return failed(
                format!("cannot start credential prompt bridge: {e}"),
                None,
                String::new(),
            )
        }
    };
    let op_id = op.options.op_id.clone();
    let args: Vec<&str> = op.args.iter().map(String::as_str).collect();
    let mut cmd = op.repo.runner().command(&args);
    configure_env(&mut cmd, &askpass, &op_id, op.repo_key, op.options);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return failed(format!("cannot run git: {e}"), None, String::new()),
    };
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let child = Arc::new(Mutex::new(child));
    lock(&ops.running).insert(op_id.clone(), child.clone());

    let out_thread = std::thread::spawn(move || {
        let mut s = String::new();
        if let Some(mut o) = stdout {
            let _ = o.read_to_string(&mut s);
        }
        s
    });
    let log = stream_progress(stderr, |text, percent| {
        events.emit(
            PROGRESS,
            ProgressEvent {
                repo: op.repo_key.to_string(),
                op_id: op_id.clone(),
                text,
                percent,
            },
        )
    });
    let stdout = out_thread.join().unwrap_or_default();
    let status = lock(&child).wait();

    lock(&ops.running).remove(&op_id);
    let declined_host_key = askpass.finish(&op_id);
    let cancelled = lock(&ops.cancelled).remove(&op_id);

    let full = format!("{stdout}{log}");
    if cancelled {
        return OpOutcome {
            message: Some(OutcomeMessage::Cancelled),
            ..failed("Cancelled".into(), Some(FailureHint::Cancelled), full)
        };
    }
    if declined_host_key && !matches!(status, Ok(s) if s.success()) {
        return OpOutcome {
            message: Some(OutcomeMessage::HostKeyDeclined),
            ..failed(
                "Connection stopped: the server's host key was not trusted".into(),
                Some(FailureHint::HostKey),
                full,
            )
        };
    }
    match status {
        Ok(s) if s.success() => OpOutcome {
            ok: true,
            summary: String::new(),
            hint: None,
            log: full,
            message: None,
        },
        _ => failed(first_error_line(&full), classify(&full), full),
    }
}

fn configure_env(
    cmd: &mut std::process::Command,
    askpass: &Server,
    op_id: &str,
    repo_key: &str,
    opts: &RemoteOptions,
) {
    let helper = std::env::var_os("DEBUTUURU_ASKPASS_EXE")
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::current_exe().ok());
    if let Some(helper) = helper {
        cmd.env("GIT_ASKPASS", &helper).env("SSH_ASKPASS", &helper);
        // OpenSSH ≥ 8.4: use askpass even without $DISPLAY. Older ssh simply
        // fails instead of prompting (no terminal), it never hangs.
        cmd.env("SSH_ASKPASS_REQUIRE", "force");
    }
    cmd.env(askpass::ENV, askpass.env_for(op_id, repo_key));
    // Stable English messages, so failures can be classified.
    cmd.env("LC_ALL", "C").env("LANGUAGE", "C");
    if let Some(ssh) = opts.ssh_command.as_deref().filter(|s| !s.trim().is_empty()) {
        cmd.env("GIT_SSH_COMMAND", ssh)
            .env("GIT_SSH_VARIANT", "ssh");
    }
}

/// Reads git's stderr: `\r`-separated progress updates become events
/// (throttled); `\n`-terminated lines are kept for the log.
fn stream_progress(stderr: Option<impl Read>, mut emit: impl FnMut(String, Option<u8>)) -> String {
    let Some(mut stderr) = stderr else {
        return String::new();
    };
    let mut log = String::new();
    let mut seg = Vec::new();
    let mut last_emit = Instant::now() - Duration::from_secs(1);
    let mut last_pct = None;
    let mut byte = [0u8; 4096];
    loop {
        let n = match stderr.read(&mut byte) {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        for &b in &byte[..n] {
            if b != b'\r' && b != b'\n' {
                seg.push(b);
                continue;
            }
            let text = String::from_utf8_lossy(&seg).trim().to_string();
            seg.clear();
            if text.is_empty() {
                continue;
            }
            let pct = percent(&text);
            if b == b'\n' {
                log.push_str(&text);
                log.push('\n');
            }
            if last_emit.elapsed() > Duration::from_millis(120) || pct != last_pct || b == b'\n' {
                emit(text, pct);
                last_emit = Instant::now();
                last_pct = pct;
            }
        }
    }
    if !seg.is_empty() {
        log.push_str(String::from_utf8_lossy(&seg).trim());
        log.push('\n');
    }
    log
}

fn percent(line: &str) -> Option<u8> {
    let i = line.find('%')?;
    let digits: String = line[..i]
        .chars()
        .rev()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    digits.chars().rev().collect::<String>().parse().ok()
}

pub fn classify(log: &str) -> Option<FailureHint> {
    let has = |s: &str| log.contains(s);
    Some(
        if has("Permission denied (publickey") || has("sign_and_send_pubkey") {
            FailureHint::SshAuth
        } else if has("Host key verification failed")
            || has("REMOTE HOST IDENTIFICATION HAS CHANGED")
        {
            FailureHint::HostKey
        } else if has("Authentication failed for")
            || has("could not read Username")
            || has("could not read Password")
            || has("terminal prompts disabled")
        {
            FailureHint::HttpsAuth
        } else if has("[rejected]") || has("failed to push some refs") {
            FailureHint::Rejected
        } else if has("divergent branches") || has("Not possible to fast-forward") {
            FailureHint::Diverged
        } else if has("would be overwritten by merge")
            || has("Please commit your changes or stash them")
            || has("You have unstaged changes")
        {
            FailureHint::LocalChanges
        } else if has("CONFLICT") {
            FailureHint::Conflict
        } else if has("Could not resolve host")
            || has("Connection timed out")
            || has("Connection refused")
            || has("Network is unreachable")
            || has("unable to access")
        {
            FailureHint::Network
        } else if has("does not appear to be a git repository")
            || has("No configured push destination")
            || has("There is no tracking information")
            || has("has no upstream branch")
        {
            FailureHint::NoRemote
        } else if has("Could not read from remote repository") {
            // ssh failed before git could say more: almost always the key or host key.
            FailureHint::SshAuth
        } else {
            return None;
        },
    )
}

fn first_error_line(log: &str) -> String {
    log.lines()
        .map(str::trim)
        .find(|l| {
            l.starts_with("fatal:")
                || l.starts_with("error:")
                || l.starts_with("! [")
                || l.starts_with("ERROR:")
                || l.contains("Permission denied")
        })
        .or_else(|| log.lines().map(str::trim).rfind(|l| !l.is_empty()))
        .unwrap_or("git failed")
        .trim_start_matches("fatal: ")
        .trim_start_matches("error: ")
        .to_string()
}

fn failed(summary: String, hint: Option<FailureHint>, log: String) -> OpOutcome {
    OpOutcome {
        ok: false,
        summary,
        hint,
        log,
        message: None,
    }
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_and_log_are_split() {
        let input =
            b"Counting objects:  50% (1/2)\rCounting objects: 100% (2/2), done.\nTo /tmp/r.git\n"
                .as_slice();
        let mut events = Vec::new();
        let log = stream_progress(Some(input), |t, p| events.push((t, p)));
        assert_eq!(log, "Counting objects: 100% (2/2), done.\nTo /tmp/r.git\n");
        assert_eq!(
            events[0],
            ("Counting objects:  50% (1/2)".to_string(), Some(50))
        );
        assert!(events.iter().any(|(_, p)| *p == Some(100)));
    }

    #[test]
    fn classifies_failures() {
        assert_eq!(classify("git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository."), Some(FailureHint::SshAuth));
        assert_eq!(
            classify(
                " ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs"
            ),
            Some(FailureHint::Rejected)
        );
        assert_eq!(
            classify(
                "hint: You have divergent branches and need to specify how to reconcile them."
            ),
            Some(FailureHint::Diverged)
        );
        assert_eq!(
            classify("ssh: Could not resolve host: github.com"),
            Some(FailureHint::Network)
        );
        assert_eq!(
            first_error_line("hint: x\nfatal: Not possible to fast-forward, aborting.\n"),
            "Not possible to fast-forward, aborting."
        );
    }
}
