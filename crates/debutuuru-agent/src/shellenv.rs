//! Imports a few variables from the user's login shell.
//!
//! `wsl.exe -e <agent>` starts the agent without running `.zshrc`/`.bashrc`,
//! so things users set up there (most importantly an ssh-agent's
//! `SSH_AUTH_SOCK`, or `PATH` additions for credential helpers) would be
//! missing and git/ssh would behave differently than in their terminal. Like
//! VS Code's remote server, we ask the login shell once at startup.

use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const MARKER: &str = "__DEBUTUURU_ENV_START__";
const TIMEOUT: Duration = Duration::from_secs(5);

/// Variables that affect how git/ssh authenticate and reach the network.
const ALLOW: &[&str] = &[
    "PATH",
    "SSH_AUTH_SOCK",
    "SSH_AGENT_PID",
    "GIT_SSH",
    "GIT_SSH_COMMAND",
    "GNUPGHOME",
    "GPG_AGENT_INFO",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "XDG_RUNTIME_DIR",
];

/// Runs `$SHELL -ilc` and copies allow-listed variables into this process.
/// Returns the names that were imported. Must run before threads start.
pub fn import_login_shell_env() -> Vec<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    let script = format!("printf '\\n{MARKER}\\n'; env -0");
    let Ok(mut child) = Command::new(&shell)
        .args(["-ilc", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return vec![];
    };

    // Read in a thread so a hanging rc file can't block us past the timeout.
    let mut stdout = child.stdout.take().expect("piped");
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        buf
    });
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if start.elapsed() < TIMEOUT => std::thread::sleep(Duration::from_millis(25)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return vec![];
            }
        }
    }
    let out = reader.join().unwrap_or_default();
    apply(&parse(&out))
}

fn parse(out: &[u8]) -> Vec<(String, String)> {
    let text = String::from_utf8_lossy(out);
    let Some((_, env)) = text.split_once(&format!("\n{MARKER}\n")) else {
        return vec![];
    };
    env.split('\0')
        .filter_map(|kv| kv.split_once('='))
        .filter(|(k, v)| ALLOW.contains(k) && !v.is_empty())
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

fn apply(vars: &[(String, String)]) -> Vec<String> {
    let mut imported = Vec::new();
    for (k, v) in vars {
        if std::env::var(k).ok().as_deref() != Some(v.as_str()) {
            std::env::set_var(k, v);
            imported.push(k.clone());
        }
    }
    imported
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_only_after_marker_and_allowlist() {
        let out = format!(
            "welcome banner from .zshrc\nSSH_AUTH_SOCK=fake\n{MARKER}\nSSH_AUTH_SOCK=/tmp/agent.1\0SECRET_TOKEN=x\0PATH=/usr/bin\0EMPTY=\0"
        );
        let vars = parse(out.as_bytes());
        assert_eq!(
            vars,
            vec![
                ("SSH_AUTH_SOCK".to_string(), "/tmp/agent.1".to_string()),
                ("PATH".to_string(), "/usr/bin".to_string())
            ]
        );
    }
}
