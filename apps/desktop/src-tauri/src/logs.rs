//! The log window: what the app asks the agents and every git command they
//! run, live. Nothing is recorded while the window is closed: opening it
//! turns logging on in every agent (and in WSL agents started later),
//! closing it turns logging off again. The window is a separate, non-modal
//! app window, so the main one keeps working while it is open.

use crate::agents::Agents;
use debutuuru_core::trace::CommandLog;
use serde::Serialize;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use ts_rs::TS;

/// Label of the log window.
pub const WINDOW: &str = "logs";
/// Event the log window receives, with a [`LogLine`] payload.
pub const ENTRY: &str = "log-entry";

#[derive(Clone, Serialize, TS)]
#[ts(export)]
pub struct LogLine {
    /// Unix milliseconds when it finished.
    #[ts(type = "number")]
    pub at: u64,
    /// Repository (or folder) in the form the UI uses.
    pub repo: String,
    #[ts(type = "number")]
    pub millis: u64,
    pub ok: bool,
    pub detail: LogDetail,
}

#[derive(Clone, Serialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum LogDetail {
    /// A request from the UI to an agent (`git.snapshot`, …).
    Request {
        method: String,
        error: Option<String>,
    },
    /// A git command an agent ran.
    Git {
        args: Vec<String>,
        exit_code: Option<i32>,
        output: String,
    },
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn send(app: &AppHandle, entry: LogLine) {
    let _ = app.emit_to(WINDOW, ENTRY, entry);
}

pub fn request(app: &AppHandle, repo: &str, method: &str, millis: u64, error: Option<String>) {
    send(
        app,
        LogLine {
            at: now_ms(),
            repo: repo.to_string(),
            millis,
            ok: error.is_none(),
            detail: LogDetail::Request {
                method: method.to_string(),
                error,
            },
        },
    );
}

/// `repo` already translated to the UI's form.
pub fn command(app: &AppHandle, c: CommandLog, repo: String) {
    send(
        app,
        LogLine {
            at: now_ms(),
            repo,
            millis: c.millis,
            ok: c.exit_code == Some(0),
            detail: LogDetail::Git {
                args: c.args,
                exit_code: c.exit_code,
                output: c.output,
            },
        },
    );
}

/// Extra tools that open in their own window, beside the main one: the log
/// window and the UI dictionary. The label is also the view the page renders.
pub const TOOL_WINDOWS: [&str; 2] = [WINDOW, "dictionary"];

/// Shows a tool window, creating it if needed. Opening the log window turns
/// logging on; closing it turns logging off.
pub fn open(app: &AppHandle, view: &str) -> tauri::Result<()> {
    let Some(label) = TOOL_WINDOWS.iter().find(|v| **v == view) else {
        return Err(tauri::Error::WindowNotFound);
    };
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.unminimize();
        return w.set_focus();
    }
    let title = if *label == WINDOW {
        "Debutuuru · Logs"
    } else {
        "Debutuuru · Dictionary"
    };
    let builder = WebviewWindowBuilder::new(app, *label, WebviewUrl::App("index.html".into()))
        .title(title)
        .inner_size(960.0, 560.0)
        .min_inner_size(520.0, 300.0)
        // The page renders this tool instead of the app.
        .initialization_script(format!("window.__DEBUTUURU_VIEW__ = '{label}';"));
    // Like the main window: Windows draws its own title bar.
    #[cfg(windows)]
    let builder = builder.decorations(false).shadow(true);
    let window = builder.build()?;
    if *label == WINDOW {
        let agents = app.state::<Arc<Agents>>().inner().clone();
        set_logging(&agents, true);
        window.on_window_event(move |e| {
            if matches!(e, WindowEvent::Destroyed) {
                set_logging(&agents, false);
            }
        });
    }
    Ok(())
}

/// Off the calling thread: WSL agents answer over a pipe.
fn set_logging(agents: &Arc<Agents>, on: bool) {
    let agents = agents.clone();
    std::thread::spawn(move || agents.set_logging(on));
}
