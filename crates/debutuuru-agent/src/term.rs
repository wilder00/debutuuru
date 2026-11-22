//! `term.*`: interactive terminals over a pseudo-terminal (portable-pty:
//! ConPTY on Windows, openpty on Unix). Each terminal has a reader thread
//! (output → `term.output` events) and a waiter thread (exit code). Programs
//! still running when the module is dropped (the app closes) are killed.

use crate::{handle_with, Events, Module};
use debutuuru_protocol::term::*;
use debutuuru_protocol::{ModuleInfo, RpcError};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

type Sessions = Arc<Mutex<HashMap<String, Session>>>;

pub struct TermModule {
    sessions: Sessions,
    next: AtomicU64,
    events: Events,
}

impl TermModule {
    pub fn new(events: Events) -> Self {
        Self {
            sessions: Arc::default(),
            next: AtomicU64::new(1),
            events,
        }
    }

    fn spawn(&self, p: SpawnParams) -> Result<Spawned, String> {
        let pair = native_pty_system()
            .openpty(size(p.cols, p.rows))
            .map_err(|e| format!("cannot open a terminal: {e}"))?;
        let mut cmd = CommandBuilder::new(&p.program);
        cmd.args(&p.args);
        cmd.cwd(start_dir(p.cwd.as_deref()));
        // What programs check to enable colors and features.
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "Debutuuru");
        cmd.env("TERM_PROGRAM_VERSION", debutuuru_core::VERSION);
        for (k, v) in &p.env {
            cmd.env(k, v);
        }
        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("cannot start {}: {e}", p.program))?;
        // The child holds the slave side; ours would keep the terminal open
        // after the program exits.
        drop(pair.slave);
        let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let id = format!("t{}", self.next.fetch_add(1, Ordering::Relaxed));
        lock(&self.sessions).insert(
            id.clone(),
            Session {
                master: pair.master,
                writer,
                killer: child.clone_killer(),
            },
        );

        // Waiter: when the program ends, close our side of the terminal so the
        // reader gets end-of-file (ConPTY doesn't close it by itself).
        let sessions = self.sessions.clone();
        let wid = id.clone();
        let waiter = std::thread::spawn(move || {
            let code = child.wait().ok().map(|s| s.exit_code());
            lock(&sessions).remove(&wid);
            code
        });

        // Reader: output until end-of-file, then the exit event.
        let events = self.events.clone();
        let rid = id.clone();
        std::thread::spawn(move || {
            pump(reader, |data| {
                events.emit(
                    OUTPUT,
                    OutputEvent {
                        id: rid.clone(),
                        data,
                    },
                )
            });
            let code = waiter.join().ok().flatten();
            events.emit(EXIT, ExitEvent { id: rid, code });
        });
        Ok(Spawned { id })
    }

    fn with<T>(
        &self,
        id: &str,
        f: impl FnOnce(&mut Session) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut sessions = lock(&self.sessions);
        let s = sessions
            .get_mut(id)
            .ok_or_else(|| format!("terminal {id} has ended"))?;
        f(s)
    }
}

impl Drop for TermModule {
    fn drop(&mut self) {
        for (_, mut s) in lock(&self.sessions).drain() {
            let _ = s.killer.kill();
        }
    }
}

impl Module for TermModule {
    fn info(&self) -> ModuleInfo {
        ModuleInfo {
            name: MODULE.into(),
            version: MODULE_VERSION,
        }
    }

    fn handle(&self, method: &str, params: Value) -> Option<Result<Value, RpcError>> {
        Some(match method {
            SPAWN => handle_with(params, |p: SpawnParams| self.spawn(p)),
            WRITE => handle_with(params, |p: WriteParams| {
                self.with(&p.id, |s| {
                    s.writer
                        .write_all(p.data.as_bytes())
                        .and_then(|_| s.writer.flush())
                        .map_err(|e| e.to_string())
                })
            }),
            RESIZE => handle_with(params, |p: ResizeParams| {
                self.with(&p.id, |s| {
                    s.master
                        .resize(size(p.cols, p.rows))
                        .map_err(|e| e.to_string())
                })
            }),
            KILL => handle_with(params, |p: TermId| self.with(&p.id, kill)),
            _ => return None,
        })
    }
}

/// portable-pty 0.9 on Windows reports a successful `TerminateProcess` as an
/// error with OS code 0 (its success check is inverted), so that "error"
/// means the program was ended.
fn kill(s: &mut Session) -> Result<(), String> {
    match s.killer.kill() {
        Err(e) if e.raw_os_error() != Some(0) => Err(e.to_string()),
        _ => Ok(()),
    }
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.max(1),
        cols: cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

/// `cwd` if it's an existing folder, else the user's home.
fn start_dir(cwd: Option<&str>) -> PathBuf {
    if let Some(dir) = cwd.map(Path::new).filter(|d| d.is_dir()) {
        return dir.to_path_buf();
    }
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"))
}

/// Reads until end-of-file (or an error: Unix reports EIO once the program
/// exits), handing out complete UTF-8 text.
fn pump(mut reader: Box<dyn Read + Send>, mut out: impl FnMut(String)) {
    let mut buf = [0u8; 16 * 1024];
    let mut pending = Vec::new();
    loop {
        match reader.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                pending.extend_from_slice(&buf[..n]);
                let text = take_utf8(&mut pending);
                if !text.is_empty() {
                    out(text);
                }
            }
        }
    }
    if !pending.is_empty() {
        out(String::from_utf8_lossy(&pending).into_owned());
    }
}

/// The decodable text at the start of `bytes`, leaving an incomplete trailing
/// character for the next read; invalid bytes become U+FFFD.
fn take_utf8(bytes: &mut Vec<u8>) -> String {
    let mut out = String::new();
    loop {
        match std::str::from_utf8(bytes) {
            Ok(s) => {
                out.push_str(s);
                bytes.clear();
                return out;
            }
            Err(e) => {
                let valid = e.valid_up_to();
                out.push_str(std::str::from_utf8(&bytes[..valid]).expect("valid prefix"));
                match e.error_len() {
                    // Incomplete character at the end: keep it for later.
                    None => {
                        bytes.drain(..valid);
                        return out;
                    }
                    Some(bad) => {
                        out.push('\u{FFFD}');
                        bytes.drain(..valid + bad);
                    }
                }
            }
        }
    }
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_split_between_reads() {
        // "é" is two bytes; the first read ends in the middle of it.
        let mut b = b"caf\xc3".to_vec();
        assert_eq!(take_utf8(&mut b), "caf");
        assert_eq!(b, b"\xc3");
        b.extend_from_slice(b"\xa9!");
        assert_eq!(take_utf8(&mut b), "é!");
        assert!(b.is_empty());
        // Invalid bytes don't stall the stream.
        let mut b = b"a\xffb".to_vec();
        assert_eq!(take_utf8(&mut b), "a\u{FFFD}b");
    }
}
