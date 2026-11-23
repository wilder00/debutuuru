//! The agent hosts Debutuuru's tool modules and answers protocol requests.
//!
//! The same [`Agent`] is used in two ways:
//! * **in-process** by the desktop app for repos on the host OS, and
//! * **out-of-process** as `debutuuru agent --stdio`, e.g. inside a WSL distro,
//!   reached through [`client::StdioClient`].
//!
//! Adding a tool = implementing [`Module`] and registering it in
//! [`Agent::with_default_modules`]. Its methods are namespaced (`git.status`,
//! `term.spawn`, …) and announced in the [`Hello`] handshake.

pub mod askpass;
pub mod client;
pub mod events;
pub mod git;
pub mod remote;
#[cfg(unix)]
pub mod shellenv;
pub mod term;
pub mod watch;

use debutuuru_protocol::{
    decode, encode, ErrorCode, Hello, Message, ModuleInfo, Response, RpcError, SetLoggingParams,
    HELLO, LOG_COMMAND, PROTOCOL_VERSION, SET_LOGGING,
};
pub use events::{EventSink, Events};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;
use std::io::{BufRead, Write};
use std::sync::{Arc, Mutex};

/// A tool module living inside the agent.
pub trait Module: Send + Sync {
    fn info(&self) -> ModuleInfo;
    /// Handles `method` if it belongs to this module; `None` otherwise.
    fn handle(&self, method: &str, params: Value) -> Option<Result<Value, RpcError>>;
}

/// Anything that can execute a request: the in-process [`Agent`] or a
/// [`client::StdioClient`] connected to an agent in another process.
pub trait Transport: Send + Sync {
    fn call(&self, method: &str, params: Value) -> Result<Value, RpcError>;
}

pub struct Agent {
    modules: Vec<Box<dyn Module>>,
    events: Events,
}

impl Agent {
    pub fn new(modules: Vec<Box<dyn Module>>, events: Events) -> Self {
        Self { modules, events }
    }

    pub fn with_default_modules() -> Self {
        let events = Events::default();
        Self::new(
            vec![
                Box::new(git::GitModule::new(events.clone())),
                Box::new(term::TermModule::new(events.clone())),
            ],
            events,
        )
    }

    /// Where module events go (the stdio server sets this to stdout).
    pub fn set_event_sink(&self, sink: EventSink) {
        self.events.set_sink(sink);
    }

    /// Starts or stops sending a [`LOG_COMMAND`] event per git command.
    pub fn set_logging(&self, enabled: bool) {
        let sink: Option<debutuuru_core::trace::Sink> = enabled.then(|| {
            let events = self.events.clone();
            Arc::new(move |c| events.emit(LOG_COMMAND, c)) as debutuuru_core::trace::Sink
        });
        debutuuru_core::trace::set_sink(sink);
    }

    pub fn hello(&self) -> Hello {
        Hello {
            protocol_version: PROTOCOL_VERSION,
            agent_version: debutuuru_core::VERSION.to_string(),
            os: std::env::consts::OS.to_string(),
            wsl_distro: std::env::var("WSL_DISTRO_NAME").ok(),
            modules: self.modules.iter().map(|m| m.info()).collect(),
            ssh_agent: std::env::var_os("SSH_AUTH_SOCK").is_some_and(|s| !s.is_empty()),
        }
    }

    pub fn dispatch(&self, method: &str, params: Value) -> Result<Value, RpcError> {
        if method == HELLO {
            return to_value(self.hello());
        }
        if method == SET_LOGGING {
            return handle_with(params, |p: SetLoggingParams| {
                self.set_logging(p.enabled);
                Ok::<_, String>(())
            });
        }
        for m in &self.modules {
            if let Some(result) = m.handle(method, params.clone()) {
                return result;
            }
        }
        Err(RpcError::new(
            ErrorCode::MethodNotFound,
            format!("unknown method `{method}`"),
        ))
    }

    /// Serves newline-delimited JSON requests until `reader` closes.
    /// Requests run concurrently; responses may arrive out of order (matched by
    /// id). Module events are written to the same stream.
    pub fn serve<R: BufRead, W: Write + Send + 'static>(
        &self,
        reader: R,
        writer: W,
    ) -> std::io::Result<()> {
        let writer = Arc::new(Mutex::new(writer));
        let write = {
            let writer = writer.clone();
            move |msg: Message| {
                let mut w = writer.lock().unwrap_or_else(|e| e.into_inner());
                // A broken pipe means the app went away; nothing useful to do.
                let _ = w.write_all(encode(&msg).as_bytes()).and_then(|_| w.flush());
            }
        };
        let event_write = write.clone();
        self.set_event_sink(Arc::new(move |ev| event_write(Message::Event(ev))));
        let send = &write;
        std::thread::scope(|scope| -> std::io::Result<()> {
            for line in reader.lines() {
                let line = line?;
                if line.trim().is_empty() {
                    continue;
                }
                match decode(&line) {
                    Ok(Message::Request(req)) => {
                        scope.spawn(move || {
                            let res = self.dispatch(&req.method, req.params);
                            send(Message::Response(response(req.id, res)));
                        });
                    }
                    Ok(_) => {} // agents ignore responses/events from the app
                    Err(e) => eprintln!("debutuuru agent: bad message: {e}"),
                }
            }
            Ok(())
        })
    }

    pub fn serve_stdio(&self) -> std::io::Result<()> {
        self.serve(std::io::stdin().lock(), std::io::stdout())
    }
}

impl Transport for Agent {
    fn call(&self, method: &str, params: Value) -> Result<Value, RpcError> {
        self.dispatch(method, params)
    }
}

fn response(id: u64, res: Result<Value, RpcError>) -> Response {
    match res {
        Ok(v) => Response {
            id,
            result: Some(v),
            error: None,
        },
        Err(e) => Response {
            id,
            result: None,
            error: Some(e),
        },
    }
}

/// Deserializes params, runs `f`, serializes the result, mapping errors to [`RpcError`].
pub fn handle_with<P, R, E>(
    params: Value,
    f: impl FnOnce(P) -> Result<R, E>,
) -> Result<Value, RpcError>
where
    P: DeserializeOwned,
    R: Serialize,
    E: std::fmt::Display,
{
    let p: P = serde_json::from_value(params)
        .map_err(|e| RpcError::new(ErrorCode::InvalidParams, e.to_string()))?;
    let r = f(p).map_err(|e| RpcError::new(ErrorCode::Failed, e.to_string()))?;
    to_value(r)
}

fn to_value<T: Serialize>(v: T) -> Result<Value, RpcError> {
    serde_json::to_value(v).map_err(|e| RpcError::new(ErrorCode::Failed, e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn hello_lists_git_module() {
        let a = Agent::with_default_modules();
        let h = a.hello();
        assert_eq!(h.protocol_version, PROTOCOL_VERSION);
        assert!(h.modules.iter().any(|m| m.name == "git"));
    }

    #[test]
    fn unknown_method_and_bad_params() {
        let a = Agent::with_default_modules();
        assert_eq!(
            a.dispatch("nope.x", json!({})).unwrap_err().code,
            ErrorCode::MethodNotFound
        );
        assert_eq!(
            a.dispatch("git.snapshot", json!({ "wrong": 1 }))
                .unwrap_err()
                .code,
            ErrorCode::InvalidParams
        );
    }

    #[test]
    fn serve_answers_each_request_by_id() {
        let a = Agent::with_default_modules();
        let input = concat!(
            r#"{"kind":"request","id":1,"method":"hello"}"#,
            "\n",
            r#"{"kind":"request","id":2,"method":"nope"}"#,
            "\n",
        );
        let out = Arc::new(Mutex::new(Vec::new()));
        a.serve(input.as_bytes(), SharedBuf(out.clone())).unwrap();
        let out = out.lock().unwrap().clone();
        let mut ids: Vec<(u64, bool)> = String::from_utf8(out)
            .unwrap()
            .lines()
            .map(|l| match decode(l).unwrap() {
                Message::Response(r) => (r.id, r.error.is_none()),
                m => panic!("unexpected {m:?}"),
            })
            .collect();
        ids.sort();
        assert_eq!(ids, vec![(1, true), (2, false)]);
    }

    /// `serve` needs a `'static` writer; this one lets the test read it back.
    struct SharedBuf(Arc<Mutex<Vec<u8>>>);
    impl Write for SharedBuf {
        fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().write(b)
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn logging_reports_git_commands_only_while_on() {
        let dir = std::env::temp_dir().join(format!("debutuuru-log-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert!(std::process::Command::new("git")
            .current_dir(&dir)
            .args(["init", "-q"])
            .status()
            .unwrap()
            .success());
        let a = Agent::with_default_modules();
        let (tx, rx) = std::sync::mpsc::channel();
        a.set_event_sink(Arc::new(move |ev| {
            if ev.topic == LOG_COMMAND {
                let _ = tx.send(ev.payload);
            }
        }));
        let repo = dir.to_string_lossy().to_string();
        a.dispatch(SET_LOGGING, json!({ "enabled": true })).unwrap();
        a.dispatch("git.snapshot", json!({ "repo": repo })).unwrap();
        let first = rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("a logged command");
        assert!(first["args"].as_array().is_some_and(|a| !a.is_empty()));
        a.dispatch(SET_LOGGING, json!({ "enabled": false }))
            .unwrap();
        while rx.try_recv().is_ok() {}
        a.dispatch("git.snapshot", json!({ "repo": repo })).unwrap();
        // Other tests may log in this process while it was on; after turning
        // it off nothing more arrives from this agent.
        assert!(rx.try_recv().is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Refreshing runs `git status`, which creates and deletes
    /// `.git/index.lock`; on Windows that also reports `.git` itself as
    /// modified. That must not count as a change, or the app refreshes forever.
    #[test]
    fn git_status_alone_is_not_a_change() {
        let dir = std::env::temp_dir().join(format!("debutuuru-watch-loop-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let git = |args: &[&str]| {
            assert!(std::process::Command::new("git")
                .current_dir(&dir)
                .args(args)
                .status()
                .unwrap()
                .success())
        };
        git(&["init", "-q"]);
        std::fs::write(dir.join("a.txt"), "x").unwrap();
        git(&["add", "a.txt"]);
        // Right after `add` the index is "racily clean" and the next status
        // rewrites it (a real change). Settle it before watching.
        std::thread::sleep(std::time::Duration::from_millis(1100));
        git(&["update-index", "--really-refresh", "-q"]);
        git(&["status", "--porcelain"]);

        let a = Agent::with_default_modules();
        let (tx, rx) = std::sync::mpsc::channel();
        a.set_event_sink(Arc::new(move |ev| {
            if ev.topic == "git.changed" {
                let _ = tx.send(());
            }
        }));
        let repo = dir.to_string_lossy().to_string();
        a.dispatch("git.watch", json!({ "repo": repo })).unwrap();
        // Let the setup's own events pass.
        while rx
            .recv_timeout(std::time::Duration::from_millis(800))
            .is_ok()
        {}
        for _ in 0..3 {
            git(&["status", "--porcelain"]);
        }
        assert!(
            rx.recv_timeout(std::time::Duration::from_millis(1500))
                .is_err(),
            "git status was reported as a change"
        );
        a.dispatch("git.unwatch", json!({ "repo": repo })).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn watch_emits_change_events() {
        let dir = std::env::temp_dir().join(format!("debutuuru-watch-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let ok = std::process::Command::new("git")
            .current_dir(&dir)
            .args(["init", "-q"])
            .status()
            .unwrap()
            .success();
        assert!(ok);

        let a = Agent::with_default_modules();
        let (tx, rx) = std::sync::mpsc::channel();
        a.set_event_sink(Arc::new(move |ev| {
            let _ = tx.send(ev);
        }));
        let repo = dir.to_string_lossy().to_string();
        a.dispatch("git.watch", json!({ "repo": repo })).unwrap();
        std::fs::write(dir.join("new.txt"), "x").unwrap();

        let ev = rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("change event");
        assert_eq!(ev.topic, "git.changed");
        assert_eq!(ev.payload["repo"], repo);

        a.dispatch("git.unwatch", json!({ "repo": repo })).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }
}
