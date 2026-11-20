//! Wire protocol between the desktop app and an agent.
//!
//! Framing: one JSON [`Message`] per line (newline-delimited JSON) over the
//! agent's stdin/stdout. The first request is always [`HELLO`]; the app refuses
//! to talk to an agent whose `protocol_version` differs from [`PROTOCOL_VERSION`]
//! and deploys a matching agent instead.
//!
//! Versioning rule: within one `PROTOCOL_VERSION`, changes must be additive
//! (new methods, new optional fields). Anything else bumps the version.
//! Modules carry their own version in [`ModuleInfo`] so the UI can hide
//! features an agent doesn't have.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

pub mod git;

pub const PROTOCOL_VERSION: u32 = 1;

/// First call on every connection. Returns [`Hello`].
pub const HELLO: &str = "hello";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Message {
    Request(Request),
    Response(Response),
    Event(Event),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Request {
    pub id: u64,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Response {
    pub id: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

/// Unsolicited notification from the agent (e.g. files changed). Phase 1.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub topic: String,
    pub payload: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RpcError {
    pub code: ErrorCode,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ErrorCode {
    MethodNotFound,
    InvalidParams,
    /// The operation itself failed (e.g. git returned an error).
    Failed,
    /// App and agent speak different protocol versions.
    Incompatible,
    /// The agent process died or the connection broke.
    Transport,
    /// Feature not available yet in this build.
    Unsupported,
}

impl RpcError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl std::fmt::Display for RpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for RpcError {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Hello {
    pub protocol_version: u32,
    /// Product version of the agent binary (SemVer).
    pub agent_version: String,
    /// `windows`, `linux`, … (`std::env::consts::OS`).
    pub os: String,
    /// Set when the agent runs inside WSL.
    pub wsl_distro: Option<String>,
    pub modules: Vec<ModuleInfo>,
    /// An ssh-agent socket is reachable (`SSH_AUTH_SOCK`), possibly imported
    /// from the user's login shell. Additive field: older agents omit it.
    #[serde(default)]
    pub ssh_agent: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ModuleInfo {
    /// Method namespace, e.g. `git` for `git.status`.
    pub name: String,
    /// Bumped when the module's methods change (additively).
    pub version: u32,
}

/// Serializes a message as one line (with trailing `\n`).
pub fn encode(msg: &Message) -> String {
    let mut s = serde_json::to_string(msg).expect("protocol messages always serialize");
    s.push('\n');
    s
}

/// Parses one line. Tolerates a UTF-8 BOM and `\r\n` (Windows shells add them).
pub fn decode(line: &str) -> Result<Message, serde_json::Error> {
    serde_json::from_str(line.trim_start_matches('\u{feff}').trim_end_matches('\r'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_tolerates_bom_and_crlf() {
        let line = "\u{feff}{\"kind\":\"request\",\"id\":1,\"method\":\"hello\"}\r";
        assert!(matches!(decode(line), Ok(Message::Request(_))));
    }

    #[test]
    fn request_roundtrip_is_one_line() {
        let msg = Message::Request(Request {
            id: 7,
            method: HELLO.into(),
            params: serde_json::json!({ "a": "multi\nline" }),
        });
        let line = encode(&msg);
        assert_eq!(
            line.matches('\n').count(),
            1,
            "newline inside a value must be escaped"
        );
        match decode(line.trim_end()).unwrap() {
            Message::Request(r) => assert_eq!((r.id, r.method.as_str()), (7, HELLO)),
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn error_response_shape() {
        let msg = Message::Response(Response {
            id: 1,
            result: None,
            error: Some(RpcError::new(ErrorCode::MethodNotFound, "nope")),
        });
        let v: Value = serde_json::from_str(encode(&msg).trim_end()).unwrap();
        assert_eq!(v["kind"], "response");
        assert_eq!(v["error"]["code"], "method_not_found");
        assert!(v.get("result").is_none());
    }
}
