//! Credential prompts without a terminal.
//!
//! git and ssh only ask for something when they really need it: a key with a
//! passphrase, an unknown host key, an HTTPS password without a credential
//! helper. Passwordless SSH keys, ssh-agent and Git Credential Manager keep
//! working untouched and never reach this code.
//!
//! When they do ask, they run `$GIT_ASKPASS "<prompt>"` / `$SSH_ASKPASS
//! "<prompt>"`. We point both at our own binary (the agent or the desktop
//! app), which then runs [`client_main`]: it connects to the agent's loopback
//! [`Server`] (authenticated with a random token), the agent emits a
//! `git.prompt` event, the UI shows a dialog, and the answer travels back the
//! same way to git's stdout. Answers are never logged or stored.

use crate::Events;
use debutuuru_protocol::git::{PromptEvent, PromptKind, PROMPT};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::time::Duration;

/// `"<addr> <token> <op_id>"`, set in git's environment for remote operations.
pub const ENV: &str = "DEBUTUURU_ASKPASS";
const ANSWER_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Serialize, Deserialize)]
struct Ask {
    token: String,
    op_id: String,
    prompt: String,
}

#[derive(Serialize, Deserialize)]
struct Answer {
    answer: Option<String>,
}

/// Loopback endpoint inside the agent process. Started on first use.
pub struct Server {
    addr: String,
    token: String,
    /// op_id → repo (as the app named it), registered while an operation runs.
    ops: Mutex<HashMap<String, String>>,
    /// prompt id → waiting helper connection.
    waiting: Mutex<HashMap<String, mpsc::Sender<Option<String>>>>,
    /// Operations where the user declined a yes/no (host key) question.
    declined: Mutex<std::collections::HashSet<String>>,
    events: Events,
}

impl Server {
    pub fn start(events: Events) -> std::io::Result<Arc<Self>> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let server = Arc::new(Self {
            addr: listener.local_addr()?.to_string(),
            token: random_hex(16),
            ops: Mutex::default(),
            waiting: Mutex::default(),
            declined: Mutex::default(),
            events,
        });
        let s = server.clone();
        std::thread::spawn(move || {
            for conn in listener.incoming().flatten() {
                let s = s.clone();
                std::thread::spawn(move || s.handle(conn));
            }
        });
        Ok(server)
    }

    /// Environment to give git for operation `op_id` on `repo`.
    pub fn env_for(&self, op_id: &str, repo: &str) -> String {
        lock(&self.ops).insert(op_id.to_string(), repo.to_string());
        format!("{} {} {}", self.addr, self.token, op_id)
    }

    /// Ends an operation; returns true if the user declined a host key in it
    /// (ssh's own message often doesn't reach git's output).
    pub fn finish(&self, op_id: &str) -> bool {
        lock(&self.ops).remove(op_id);
        lock(&self.declined).remove(op_id)
    }

    /// Delivers the user's answer (or `None` = cancel) to the waiting helper.
    pub fn reply(&self, id: &str, answer: Option<String>) -> bool {
        match lock(&self.waiting).remove(id) {
            Some(tx) => tx.send(answer).is_ok(),
            None => false,
        }
    }

    fn handle(&self, conn: TcpStream) {
        let _ = conn.set_read_timeout(Some(Duration::from_secs(10)));
        let mut reader = BufReader::new(&conn);
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() {
            return;
        }
        let Ok(ask) = serde_json::from_str::<Ask>(&line) else {
            return;
        };
        // Constant-time-ish compare is unnecessary on loopback with a 128-bit
        // single-process token, but never accept a wrong one.
        if ask.token != self.token {
            return;
        }
        let Some(repo) = lock(&self.ops).get(&ask.op_id).cloned() else {
            return;
        };

        let id = random_hex(8);
        let kind = classify(&ask.prompt);
        let (tx, rx) = mpsc::channel();
        lock(&self.waiting).insert(id.clone(), tx);
        self.events.emit(
            PROMPT,
            PromptEvent {
                id: id.clone(),
                repo,
                op_id: ask.op_id.clone(),
                kind,
                prompt: ask.prompt,
            },
        );
        let answer = rx.recv_timeout(ANSWER_TIMEOUT).ok().flatten();
        lock(&self.waiting).remove(&id);
        if kind == PromptKind::Confirm && answer.as_deref() != Some("yes") {
            lock(&self.declined).insert(ask.op_id);
        }
        let mut w = &conn;
        let _ = writeln!(
            w,
            "{}",
            serde_json::to_string(&Answer { answer }).unwrap_or_default()
        );
    }
}

/// One server per agent process.
pub fn server(events: &Events) -> std::io::Result<Arc<Server>> {
    static SERVER: OnceLock<Arc<Server>> = OnceLock::new();
    if let Some(s) = SERVER.get() {
        return Ok(s.clone());
    }
    let s = Server::start(events.clone())?;
    Ok(SERVER.get_or_init(|| s).clone())
}

/// What kind of input a git/ssh prompt wants.
pub fn classify(prompt: &str) -> PromptKind {
    let p = prompt.to_ascii_lowercase();
    if p.contains("(yes/no") || p.contains("continue connecting") {
        PromptKind::Confirm
    } else if p.starts_with("username") {
        PromptKind::Text
    } else {
        // Passwords, passphrases, PINs, tokens and anything unknown: hide it.
        PromptKind::Secret
    }
}

/// True when this process was started by git/ssh as an askpass helper.
pub fn is_askpass_invocation(args: &[String]) -> bool {
    std::env::var_os(ENV).is_some() && args.len() == 2
}

/// Entry point of the helper: asks the agent, prints the answer for git/ssh.
/// Returns the process exit code (non-zero = cancelled/failed).
pub fn client_main(prompt: &str) -> i32 {
    match ask_agent(prompt) {
        Ok(Some(answer)) => {
            println!("{answer}");
            0
        }
        Ok(None) => 1,
        Err(e) => {
            eprintln!("debutuuru askpass: {e}");
            2
        }
    }
}

fn ask_agent(prompt: &str) -> Result<Option<String>, String> {
    let env = std::env::var(ENV).map_err(|_| format!("{ENV} not set"))?;
    let mut parts = env.splitn(3, ' ');
    let (Some(addr), Some(token), Some(op_id)) = (parts.next(), parts.next(), parts.next()) else {
        return Err(format!("malformed {ENV}"));
    };
    let addr = addr.parse().map_err(|e| format!("bad address: {e}"))?;
    let conn =
        TcpStream::connect_timeout(&addr, Duration::from_secs(5)).map_err(|e| e.to_string())?;
    let _ = conn.set_read_timeout(Some(ANSWER_TIMEOUT + Duration::from_secs(10)));
    let ask = Ask {
        token: token.into(),
        op_id: op_id.into(),
        prompt: prompt.into(),
    };
    let mut w = &conn;
    writeln!(
        w,
        "{}",
        serde_json::to_string(&ask).map_err(|e| e.to_string())?
    )
    .map_err(|e| e.to_string())?;
    let mut line = String::new();
    BufReader::new(&conn)
        .read_line(&mut line)
        .map_err(|e| e.to_string())?;
    let answer: Answer = serde_json::from_str(&line).map_err(|e| format!("bad answer: {e}"))?;
    Ok(answer.answer)
}

fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).expect("OS random generator");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_common_prompts() {
        assert_eq!(
            classify("Enter passphrase for key '/home/me/.ssh/id_ed25519': "),
            PromptKind::Secret
        );
        assert_eq!(
            classify("Username for 'https://github.com': "),
            PromptKind::Text
        );
        assert_eq!(
            classify("Password for 'https://me@github.com': "),
            PromptKind::Secret
        );
        assert_eq!(
            classify("Are you sure you want to continue connecting (yes/no/[fingerprint])? "),
            PromptKind::Confirm
        );
    }
}
