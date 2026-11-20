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

pub mod client;
pub mod git;

use debutuuru_protocol::{
    decode, encode, ErrorCode, Hello, Message, ModuleInfo, Response, RpcError, HELLO,
    PROTOCOL_VERSION,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;
use std::io::{BufRead, Write};
use std::sync::Mutex;

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
}

impl Agent {
    pub fn new(modules: Vec<Box<dyn Module>>) -> Self {
        Self { modules }
    }

    pub fn with_default_modules() -> Self {
        Self::new(vec![Box::new(git::GitModule::default())])
    }

    pub fn hello(&self) -> Hello {
        Hello {
            protocol_version: PROTOCOL_VERSION,
            agent_version: debutuuru_core::VERSION.to_string(),
            os: std::env::consts::OS.to_string(),
            wsl_distro: std::env::var("WSL_DISTRO_NAME").ok(),
            modules: self.modules.iter().map(|m| m.info()).collect(),
        }
    }

    pub fn dispatch(&self, method: &str, params: Value) -> Result<Value, RpcError> {
        if method == HELLO {
            return to_value(self.hello());
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
    /// Requests run concurrently; responses may arrive out of order (matched by id).
    pub fn serve<R: BufRead, W: Write + Send>(&self, reader: R, writer: W) -> std::io::Result<()> {
        let writer = Mutex::new(writer);
        let send = |msg: Message| {
            let mut w = writer.lock().unwrap_or_else(|e| e.into_inner());
            // A broken pipe means the app went away; nothing useful to do.
            let _ = w.write_all(encode(&msg).as_bytes()).and_then(|_| w.flush());
        };
        std::thread::scope(|scope| -> std::io::Result<()> {
            for line in reader.lines() {
                let line = line?;
                if line.trim().is_empty() {
                    continue;
                }
                match decode(&line) {
                    Ok(Message::Request(req)) => {
                        let send = &send;
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
        let mut out = Vec::new();
        a.serve(input.as_bytes(), &mut out).unwrap();
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
}
