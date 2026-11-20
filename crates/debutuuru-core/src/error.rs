use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("could not run `{program}`: {source}")]
    Spawn {
        program: String,
        #[source]
        source: std::io::Error,
    },
    #[error("git failed: {0}")]
    Git(String),
    #[error("not a git repository: {0}")]
    NotARepo(String),
    #[error("unexpected git output: {0}")]
    Parse(String),
}

pub type Result<T> = std::result::Result<T, Error>;

// Lets Tauri commands return `Result<T, Error>` directly.
impl Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}
