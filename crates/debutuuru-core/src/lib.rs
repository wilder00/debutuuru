//! Debutuuru core: everything that talks to git lives here so the CLI and
//! the desktop app behave identically (including on WSL).

pub mod branches;
pub mod changes;
pub mod discover;
pub mod error;
pub mod files;
pub mod graph;
pub mod location;
pub mod repo;
pub mod runner;
pub mod tags;
pub mod trace;

pub use error::{Error, Result};
pub use location::Location;
pub use repo::Repo;

/// Version of the whole Debutuuru product (shared across the workspace).
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
