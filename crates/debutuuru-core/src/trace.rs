//! Optional record of every git command this process runs, for the app's
//! log window. Off by default: while no sink is set, running a command only
//! costs one atomic load. The agent sets a sink when the app asks for logs
//! (a log window is open) and removes it when the window closes.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use std::time::Instant;
use ts_rs::TS;

/// One finished git command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CommandLog {
    /// Folder it ran in (named `repo` so the app can translate WSL paths).
    pub repo: String,
    /// Arguments after `git`.
    pub args: Vec<String>,
    #[ts(type = "number")]
    pub millis: u64,
    /// Exit code; `None` if git could not start or was killed.
    pub exit_code: Option<i32>,
    /// What git wrote to stderr (progress, warnings, errors), shortened.
    /// Never contains answers to credential prompts: those go through askpass.
    pub output: String,
}

pub type Sink = Arc<dyn Fn(CommandLog) + Send + Sync>;

static ON: AtomicBool = AtomicBool::new(false);
static SINK: RwLock<Option<Sink>> = RwLock::new(None);

/// Most output kept per command; logs are for reading, not archiving.
const MAX_OUTPUT: usize = 8 * 1024;

/// Starts (`Some`) or stops (`None`) recording.
pub fn set_sink(sink: Option<Sink>) {
    let on = sink.is_some();
    *SINK.write().unwrap_or_else(|e| e.into_inner()) = sink;
    ON.store(on, Ordering::Release);
}

pub fn enabled() -> bool {
    ON.load(Ordering::Acquire)
}

/// When recording, the time a command starts; pass it to [`record`].
pub fn start() -> Option<Instant> {
    enabled().then(Instant::now)
}

pub fn record(
    started: Option<Instant>,
    repo: &str,
    args: &[&str],
    exit_code: Option<i32>,
    output: &str,
) {
    let Some(started) = started else { return };
    let sink = SINK.read().unwrap_or_else(|e| e.into_inner()).clone();
    if let Some(sink) = sink {
        sink(CommandLog {
            repo: repo.to_string(),
            args: args.iter().map(|a| a.to_string()).collect(),
            millis: started.elapsed().as_millis() as u64,
            exit_code,
            output: shorten(output.trim_end()),
        });
    }
}

fn shorten(s: &str) -> String {
    if s.len() <= MAX_OUTPUT {
        return s.to_string();
    }
    let mut end = MAX_OUTPUT;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n… ({} more bytes)", &s[..end], s.len() - end)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shortens_on_char_boundaries() {
        let long = "é".repeat(MAX_OUTPUT);
        let s = shorten(&long);
        assert!(s.len() < long.len());
        assert!(s.contains("more bytes"));
        assert_eq!(shorten("short"), "short");
    }
}
