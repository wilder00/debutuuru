//! A `Location` says *where* a repository lives: on the host OS, or inside a
//! WSL distro (reached from Windows through `\\wsl.localhost\<distro>\...`).
//!
//! The desktop app uses it to route a request: `wsl_distro: None` goes to the
//! local agent, `Some(distro)` goes to the agent running inside that distro,
//! which receives `path` (a Linux path) and runs native git there.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Location {
    /// `Some("Ubuntu")` when the repo lives inside that WSL distro.
    pub wsl_distro: Option<String>,
    /// Path as seen by the environment that runs git (Linux path for WSL).
    pub path: String,
}

impl Location {
    pub fn local(path: impl Into<String>) -> Self {
        Self {
            wsl_distro: None,
            path: path.into(),
        }
    }

    /// Parses user input. Understands `\\wsl$\Distro\home\me\repo`,
    /// `\\wsl.localhost\Distro\...` (and forward-slash variants); anything
    /// else is a plain local path.
    pub fn parse(input: &str) -> Self {
        let s = input.trim();
        let norm = s.replace('\\', "/");
        let lower = norm.to_ascii_lowercase();
        for prefix in ["//wsl$/", "//wsl.localhost/"] {
            if lower.starts_with(prefix) {
                let rest = &norm[prefix.len()..];
                let (distro, tail) = match rest.split_once('/') {
                    Some((d, t)) => (d, t),
                    None => (rest, ""),
                };
                return Self {
                    wsl_distro: Some(distro.to_string()),
                    path: format!("/{}", tail.trim_end_matches('/')),
                };
            }
        }
        Self::local(s)
    }

    /// The Windows UNC form of a WSL location (what a Windows GUI can open).
    pub fn windows_unc(&self) -> Option<String> {
        let d = self.wsl_distro.as_ref()?;
        let tail = if self.path == "/" {
            String::new()
        } else {
            self.path.replace('/', "\\")
        };
        Some(format!(r"\\wsl.localhost\{d}{tail}"))
    }

    /// Location of a Linux path when the current process runs *inside* WSL,
    /// so the CLI can hand it to the Windows GUI.
    pub fn from_inside_wsl(distro: &str, linux_path: &str) -> Self {
        Self {
            wsl_distro: Some(distro.to_string()),
            path: linux_path.to_string(),
        }
    }
}

impl Location {
    /// The form shown to and typed by the user on the app's OS: the UNC path
    /// for WSL locations, the plain path otherwise.
    pub fn user_string(&self) -> String {
        self.windows_unc().unwrap_or_else(|| self.path.clone())
    }
}

/// Like [`resolve`], but relative input is taken relative to `cwd` (e.g. the
/// working directory of a second app instance that forwarded its arguments).
pub fn resolve_in(input: &str, cwd: &std::path::Path) -> Location {
    let p = std::path::Path::new(input);
    if Location::parse(input).wsl_distro.is_some() || p.is_absolute() || input.starts_with(r"\\") {
        resolve(input)
    } else {
        resolve(&cwd.join(p).to_string_lossy())
    }
}

/// Turns user input (possibly relative) into a [`Location`]: absolute, without
/// the Windows `\\?\` verbatim prefix, WSL UNC paths recognised.
pub fn resolve(input: &str) -> Location {
    let direct = Location::parse(input);
    if direct.wsl_distro.is_some() {
        return direct;
    }
    let abs = std::fs::canonicalize(input).unwrap_or_else(|_| std::path::PathBuf::from(input));
    let text = abs.to_string_lossy().to_string();
    let text = if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else {
        text.strip_prefix(r"\\?\").map(String::from).unwrap_or(text)
    };
    Location::parse(&text)
}

#[cfg(test)]
mod tests {
    #[test]
    fn resolve_makes_relative_paths_absolute() {
        let l = resolve(".");
        assert!(l.wsl_distro.is_none());
        assert!(std::path::Path::new(&l.path).is_absolute());
        assert!(!l.path.starts_with(r"\\?\"));
    }

    use super::*;

    #[test]
    fn plain_local_path() {
        let l = Location::parse(r"C:\Users\me\repo");
        assert_eq!(l, Location::local(r"C:\Users\me\repo"));
    }

    #[test]
    fn wsl_dollar_unc() {
        let l = Location::parse(r"\\wsl$\Ubuntu\home\me\repo");
        assert_eq!(l.wsl_distro.as_deref(), Some("Ubuntu"));
        assert_eq!(l.path, "/home/me/repo");
    }

    #[test]
    fn wsl_localhost_unc_roundtrip() {
        let l = Location::parse(r"\\wsl.localhost\Ubuntu-22.04\home\me\repo\");
        assert_eq!(l.wsl_distro.as_deref(), Some("Ubuntu-22.04"));
        assert_eq!(l.path, "/home/me/repo");
        assert_eq!(
            l.windows_unc().unwrap(),
            r"\\wsl.localhost\Ubuntu-22.04\home\me\repo"
        );
    }

    #[test]
    fn distro_root() {
        let l = Location::parse(r"\\wsl$\Debian");
        assert_eq!(l.path, "/");
        assert_eq!(l.windows_unc().unwrap(), r"\\wsl.localhost\Debian");
    }
}
