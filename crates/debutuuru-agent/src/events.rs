//! Agent → app notifications (e.g. "files changed"). Modules emit through
//! [`Events`]; whoever hosts the agent decides where they go: the stdio
//! server writes them to stdout, the desktop app forwards them to the UI.

use debutuuru_protocol::Event;
use serde::Serialize;
use std::sync::{Arc, RwLock};

pub type EventSink = Arc<dyn Fn(Event) + Send + Sync>;

#[derive(Clone, Default)]
pub struct Events(Arc<RwLock<Option<EventSink>>>);

impl Events {
    pub fn set_sink(&self, sink: EventSink) {
        *self.0.write().unwrap_or_else(|e| e.into_inner()) = Some(sink);
    }

    /// Drops the event if nobody listens yet.
    pub fn emit(&self, topic: &str, payload: impl Serialize) {
        let sink = self.0.read().unwrap_or_else(|e| e.into_inner()).clone();
        if let (Some(sink), Ok(payload)) = (sink, serde_json::to_value(payload)) {
            sink(Event {
                topic: topic.to_string(),
                payload,
            });
        }
    }
}
