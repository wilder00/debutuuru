//! Which agent serves which repository: the in-process agent for host repos,
//! one `StdioClient` per WSL distro (started on demand, restarted if it died).
//! Agent events are forwarded to the UI as `agent-event`, with the repo path
//! translated back to the form the UI uses.

use crate::wsl;
use debutuuru_agent::client::StdioClient;
use debutuuru_agent::{Agent, EventSink, Transport};
use debutuuru_core::Location;
use debutuuru_protocol::{ErrorCode, Event, Hello, RpcError};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use ts_rs::TS;

pub const EVENT: &str = "agent-event";

/// What the UI receives for every agent event.
#[derive(Clone, Serialize, TS)]
#[ts(export)]
pub struct AgentEvent {
    pub topic: String,
    /// Module-specific payload; `repo` fields are already in UI form.
    #[ts(type = "unknown")]
    pub payload: Value,
}

pub struct Agents {
    app: AppHandle,
    local: Arc<Agent>,
    wsl: Mutex<HashMap<String, Arc<StdioClient>>>,
    linux_agent: Option<PathBuf>,
}

impl Agents {
    pub fn new(app: AppHandle, linux_agent: Option<PathBuf>) -> Self {
        let local = Arc::new(Agent::with_default_modules());
        local.set_event_sink(forwarder(app.clone(), None));
        Self {
            app,
            local,
            wsl: Mutex::default(),
            linux_agent,
        }
    }

    /// The bundled Linux agent (also the `debutuuru` command inside WSL).
    pub fn linux_agent(&self) -> Result<&std::path::Path, RpcError> {
        self.linux_agent
            .as_deref()
            .ok_or_else(|| RpcError::new(ErrorCode::Unsupported, wsl::BUILD_HINT))
    }

    /// The agent for `loc`, connecting to (or reviving) a WSL agent if needed.
    /// Blocking: call from a worker thread.
    pub fn get(&self, loc: &Location) -> Result<Arc<dyn Transport>, RpcError> {
        let Some(distro) = &loc.wsl_distro else {
            return Ok(self.local.clone());
        };
        Ok(self.wsl_client(distro)?)
    }

    fn wsl_client(&self, distro: &str) -> Result<Arc<StdioClient>, RpcError> {
        // Holding the lock while connecting makes concurrent first calls share one agent.
        let mut clients = self.wsl.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(c) = clients.get(distro) {
            if c.is_alive() {
                return Ok(c.clone());
            }
            clients.remove(distro);
        }
        let binary = self.linux_agent()?;
        let client = Arc::new(wsl::connect(
            distro,
            binary,
            forwarder(self.app.clone(), Some(distro.to_string())),
        )?);
        clients.insert(distro.to_string(), client.clone());
        Ok(client)
    }

    /// Calls `method` for the repo at `loc`, retrying once on a fresh
    /// connection if the WSL agent had died.
    pub fn call(&self, loc: &Location, method: &str, mut params: Value) -> Result<Value, RpcError> {
        params
            .as_object_mut()
            .ok_or_else(|| RpcError::new(ErrorCode::InvalidParams, "params must be an object"))?
            .insert("repo".into(), Value::String(loc.path.clone()));
        let first = self.get(loc)?.call(method, params.clone());
        match (&first, &loc.wsl_distro) {
            (Err(e), Some(distro)) if e.code == ErrorCode::Transport => {
                self.wsl
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(distro);
                self.get(loc)?.call(method, params)
            }
            _ => first,
        }
    }

    pub fn hello(&self, loc: &Location) -> Result<Hello, RpcError> {
        match &loc.wsl_distro {
            None => Ok(self.local.hello()),
            Some(d) => Ok(self.wsl_client(d)?.hello.clone()),
        }
    }
}

/// Sends agent events to the UI, rewriting `payload.repo` from the agent's
/// path (e.g. `/home/me/app`) to the UI's (`\\wsl.localhost\Ubuntu\home\me\app`).
fn forwarder(app: AppHandle, distro: Option<String>) -> EventSink {
    Arc::new(move |ev: Event| {
        let mut payload = ev.payload;
        if let (Some(d), Some(Value::String(repo))) = (&distro, payload.get_mut("repo")) {
            *repo = Location::from_inside_wsl(d, repo).user_string();
        }
        // Connection-level events say which distro they are about.
        if let (Some(d), true, Some(obj)) = (
            &distro,
            ev.topic.starts_with("agent."),
            payload.as_object_mut(),
        ) {
            obj.insert("distro".into(), Value::String(d.clone()));
        }
        let _ = app.emit(
            EVENT,
            AgentEvent {
                topic: ev.topic,
                payload,
            },
        );
    })
}
