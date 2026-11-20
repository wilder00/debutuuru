//! A `Location` says *where* a repository lives: on the host OS, or inside a
//! WSL distro (reached from Windows through `\\wsl.localhost\<distro>\...`).
//!
//! For WSL locations we never touch files through the slow UNC share: git is
//! executed inside the distro via `wsl.exe`, so the repo is handled by native
//! Linux git (correct permissions, line endings, speed).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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

#[cfg(test)]
mod tests {
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
