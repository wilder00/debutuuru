//! Client side of the stdio transport: starts an agent process (e.g.
//! `wsl.exe -d Ubuntu -e …/debutuuru agent --stdio`), performs the handshake
//! and multiplexes concurrent calls over the single pipe.

use crate::{EventSink, Transport};
use debutuuru_protocol::{
    decode, encode, ErrorCode, Hello, Message, Request, Response, RpcError, HELLO, PROTOCOL_VERSION,
};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};

type Pending = Arc<Mutex<HashMap<u64, mpsc::Sender<Response>>>>;

/// Synthetic event emitted by the client when the agent process goes away.
pub const DISCONNECTED: &str = "agent.disconnected";

pub struct StdioClient {
    stdin: Mutex<ChildStdin>,
    child: Mutex<Child>,
    pending: Pending,
    next_id: AtomicU64,
    pub hello: Hello,
}

impl StdioClient {
    /// Spawns `cmd` (which must run `debutuuru agent --stdio`) and checks
    /// that it speaks our protocol version. Agent events go to `on_event`.
    pub fn spawn(mut cmd: Command, on_event: Option<EventSink>) -> Result<Self, RpcError> {
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = cmd
            .spawn()
            .map_err(|e| RpcError::new(ErrorCode::Transport, format!("cannot start agent: {e}")))?;
        let stdin = child.stdin.take().expect("piped");
        let stdout = child.stdout.take().expect("piped");

        let pending: Pending = Arc::default();
        let reader_pending = pending.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                match decode(&line) {
                    Ok(Message::Response(r)) => {
                        let tx = reader_pending
                            .lock()
                            .unwrap_or_else(|e| e.into_inner())
                            .remove(&r.id);
                        if let Some(tx) = tx {
                            let _ = tx.send(r);
                        }
                    }
                    Ok(Message::Event(ev)) => {
                        if let Some(sink) = &on_event {
                            sink(ev);
                        }
                    }
                    _ => {}
                }
            }
            // Agent gone: dropping the senders wakes every waiting caller.
            reader_pending
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clear();
            // Let the host react (reconnect, re-arm watchers).
            if let Some(sink) = &on_event {
                sink(debutuuru_protocol::Event {
                    topic: DISCONNECTED.into(),
                    payload: Value::Object(Default::default()),
                });
            }
        });

        let mut client = Self {
            stdin: Mutex::new(stdin),
            child: Mutex::new(child),
            pending,
            next_id: AtomicU64::new(1),
            hello: Hello {
                protocol_version: 0,
                agent_version: String::new(),
                os: String::new(),
                wsl_distro: None,
                modules: vec![],
            },
        };
        let hello: Hello = serde_json::from_value(client.call(HELLO, Value::Null)?)
            .map_err(|e| RpcError::new(ErrorCode::Incompatible, format!("bad hello: {e}")))?;
        if hello.protocol_version != PROTOCOL_VERSION {
            return Err(RpcError::new(
                ErrorCode::Incompatible,
                format!(
                    "agent {} speaks protocol {}, app needs {}",
                    hello.agent_version, hello.protocol_version, PROTOCOL_VERSION
                ),
            ));
        }
        client.hello = hello;
        Ok(client)
    }
}

impl Transport for StdioClient {
    fn call(&self, method: &str, params: Value) -> Result<Value, RpcError> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = mpsc::channel();
        self.pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id, tx);

        let line = encode(&Message::Request(Request {
            id,
            method: method.into(),
            params,
        }));
        let written = {
            let mut w = self.stdin.lock().unwrap_or_else(|e| e.into_inner());
            w.write_all(line.as_bytes()).and_then(|_| w.flush())
        };
        if let Err(e) = written {
            self.pending
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&id);
            return Err(RpcError::new(
                ErrorCode::Transport,
                format!("agent pipe closed: {e}"),
            ));
        }

        let resp = rx
            .recv()
            .map_err(|_| RpcError::new(ErrorCode::Transport, "agent exited"))?;
        match (resp.result, resp.error) {
            (_, Some(err)) => Err(err),
            (Some(v), None) => Ok(v),
            (None, None) => Ok(Value::Null),
        }
    }
}

impl StdioClient {
    /// False once the agent process has exited (the caller should reconnect).
    pub fn is_alive(&self) -> bool {
        let mut child = self.child.lock().unwrap_or_else(|e| e.into_inner());
        matches!(child.try_wait(), Ok(None))
    }
}

impl Drop for StdioClient {
    fn drop(&mut self) {
        let mut child = self.child.lock().unwrap_or_else(|e| e.into_inner());
        let _ = child.kill();
        let _ = child.wait();
    }
}
