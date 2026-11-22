//! `term.*` methods: interactive terminals over a pseudo-terminal (ConPTY on
//! Windows, a Unix PTY elsewhere). The app spawns a program (a shell, or
//! `wsl.exe -d <distro>` for WSL), writes the user's keystrokes, and receives
//! the output as [`OUTPUT`] events until [`EXIT`].

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

pub const MODULE: &str = "term";
/// 1: spawn, write, resize, kill; output and exit events.
pub const MODULE_VERSION: u32 = 1;

/// [`SpawnParams`] → [`Spawned`]
pub const SPAWN: &str = "term.spawn";
/// [`WriteParams`] → `null`: input for the program (keys, pasted text).
pub const WRITE: &str = "term.write";
/// [`ResizeParams`] → `null`
pub const RESIZE: &str = "term.resize";
/// [`TermId`] → `null`: ends the program (and its terminal).
pub const KILL: &str = "term.kill";

/// Event: [`OutputEvent`], the program's output as text.
pub const OUTPUT: &str = "term.output";
/// Event: [`ExitEvent`], the program ended (no more output follows).
pub const EXIT: &str = "term.exit";

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SpawnParams {
    /// Program to run: a shell (`pwsh.exe`, `/bin/zsh`…) or `wsl.exe`.
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
    /// Starting folder; the user's home when missing or not a folder.
    #[serde(default)]
    #[ts(optional)]
    pub cwd: Option<String>,
    /// Extra environment variables (on top of the agent's own).
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Spawned {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TermId {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct WriteParams {
    pub id: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ResizeParams {
    pub id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct OutputEvent {
    pub id: String,
    /// UTF-8 text; a character split between two reads arrives whole in the
    /// second event.
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ExitEvent {
    pub id: String,
    /// Exit code, when the OS reports one.
    pub code: Option<u32>,
}
