//! Text search with `git grep`: lines matching a few patterns, in the working
//! tree (tracked and untracked files, not ignored ones) or at a commit. Used to
//! find where a name is defined (Ctrl+click in Files) without a language
//! server.

use crate::files::check_rev;
use crate::{Error, Repo, Result};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Most patterns per search.
pub const MAX_GREP_PATTERNS: usize = 32;
/// Most matches returned (the rest are dropped).
pub const MAX_GREP_MATCHES: usize = 1000;
/// Longer matching lines are cut to this many characters.
const MAX_LINE_CHARS: usize = 300;

/// One matching line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GrepMatch {
    /// Repo-relative, `/`-separated.
    pub path: String,
    /// 1-based.
    pub line: u32,
    /// The line, cut at 300 characters.
    pub text: String,
}

impl Repo {
    /// Lines matching any of `patterns` (POSIX extended regexes), in files
    /// matching `pathspecs` (all files when empty), at most `max`. Binary files
    /// are skipped.
    pub fn grep(
        &self,
        rev: Option<&str>,
        patterns: &[String],
        pathspecs: &[String],
        max: usize,
    ) -> Result<Vec<GrepMatch>> {
        if patterns.is_empty() || patterns.len() > MAX_GREP_PATTERNS {
            return Err(Error::InvalidPath(format!(
                "between 1 and {MAX_GREP_PATTERNS} patterns per search"
            )));
        }
        let bad = |s: &String| s.contains(['\0', '\n']);
        if patterns.iter().any(bad) || pathspecs.iter().any(bad) {
            return Err(Error::InvalidPath("invalid pattern or pathspec".into()));
        }
        let mut args = vec!["grep", "-n", "-I", "-z", "--no-color", "--full-name", "-E"];
        if rev.is_none() {
            args.push("--untracked");
        }
        for p in patterns {
            args.extend(["-e", p.as_str()]);
        }
        let rev = rev.map(check_rev).transpose()?;
        args.extend(rev);
        args.push("--");
        args.extend(pathspecs.iter().map(String::as_str));

        let out = self.runner().output(&args)?;
        match out.status.code() {
            Some(0) => {}
            // No match.
            Some(1) => return Ok(Vec::new()),
            _ => {
                return Err(Error::Git(
                    String::from_utf8_lossy(&out.stderr).trim().to_string(),
                ))
            }
        }
        let prefix = rev.map(|r| format!("{r}:"));
        let stdout = String::from_utf8_lossy(&out.stdout);
        Ok(stdout
            .lines()
            .filter_map(|l| parse_line(l, prefix.as_deref()))
            .take(max.min(MAX_GREP_MATCHES))
            .collect())
    }
}

/// `path\0line\0text` (`-z`), with `rev:` before the path at a commit.
fn parse_line(l: &str, prefix: Option<&str>) -> Option<GrepMatch> {
    let mut parts = l.splitn(3, '\0');
    let path = parts.next()?;
    let path = prefix.and_then(|p| path.strip_prefix(p)).unwrap_or(path);
    let line = parts.next()?.parse().ok()?;
    let text: String = parts.next()?.chars().take(MAX_LINE_CHARS).collect();
    Some(GrepMatch {
        path: path.to_string(),
        line,
        text,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_grep_lines() {
        let m = parse_line("src/a.ts\x0012\x00export function foo() {", None).unwrap();
        assert_eq!((m.path.as_str(), m.line), ("src/a.ts", 12));
        assert_eq!(m.text, "export function foo() {");
        let m = parse_line("HEAD:src/a.ts\x003\x00x", Some("HEAD:")).unwrap();
        assert_eq!(m.path, "src/a.ts");
        assert!(parse_line("garbage", None).is_none());
    }
}
