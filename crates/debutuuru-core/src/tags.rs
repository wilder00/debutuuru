//! Tags: list them with their details, create and delete them locally.
//! Pushing and deleting on a remote are remote operations (the agent runs
//! them with progress and credential prompts).

use crate::{Error, Repo, Result};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Tag {
    pub name: String,
    /// The commit it points to (peeled through the tag object).
    pub target: String,
    /// Annotated tags are objects with a tagger, date and message;
    /// lightweight tags are just a name for a commit.
    pub annotated: bool,
    pub tagger: Option<String>,
    pub email: Option<String>,
    /// Unix seconds: when it was tagged, or the commit's date for a
    /// lightweight tag.
    #[ts(type = "number")]
    pub time: i64,
    /// The tag's message (annotated only), without the signature.
    pub message: String,
    /// Carries a GPG/SSH signature (not verified here).
    pub signed: bool,
    /// Subject of the tagged commit.
    pub commit_subject: String,
}

const FIELDS: usize = 12;

impl Repo {
    /// Every tag, newest first.
    pub fn tags(&self) -> Result<Vec<Tag>> {
        const FMT: &str = "%(refname:short)%1f%(objecttype)%1f%(objectname)%1f%(*objectname)%1f%(taggername)%1f%(taggeremail)%1f%(taggerdate:unix)%1f%(creatordate:unix)%1f%(*subject)%1f%(subject)%1f%(contents:body)%1f%(contents:signature)%1e";
        let out = self.runner().git(&[
            "for-each-ref",
            "--sort=-creatordate",
            &format!("--format={FMT}"),
            "refs/tags",
        ])?;
        out.split('\u{1e}')
            .map(|r| r.trim_start_matches('\n'))
            .filter(|r| !r.is_empty())
            .map(parse_tag)
            .collect()
    }

    /// `message` = annotated tag (your git config decides about signing);
    /// `None` = lightweight.
    pub fn create_tag(&self, name: &str, rev: &str, message: Option<&str>) -> Result<()> {
        check_name(name)?;
        let mut args = vec!["tag"];
        if let Some(m) = message.filter(|m| !m.trim().is_empty()) {
            args.extend(["-a", "-m", m]);
        }
        args.extend(["--", name, rev]);
        self.runner().git(&args).map(|_| ())
    }

    pub fn delete_tag(&self, name: &str) -> Result<()> {
        check_name(name)?;
        self.runner().git(&["tag", "-d", "--", name]).map(|_| ())
    }
}

/// Names git would refuse, and ones that would read as options.
fn check_name(name: &str) -> Result<()> {
    if name.is_empty()
        || name.starts_with('-')
        || name.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err(Error::Git(format!("invalid tag name: {name:?}")));
    }
    Ok(())
}

fn parse_tag(record: &str) -> Result<Tag> {
    let f: Vec<&str> = record.split('\u{1f}').collect();
    if f.len() < FIELDS {
        return Err(Error::Parse(record.to_string()));
    }
    let annotated = f[1] == "tag";
    let time = if annotated && !f[6].is_empty() {
        f[6]
    } else {
        f[7]
    };
    let message = if annotated {
        let body = f[10].trim_end();
        if body.is_empty() {
            f[9].to_string()
        } else {
            format!("{}\n\n{body}", f[9])
        }
    } else {
        String::new()
    };
    Ok(Tag {
        name: f[0].to_string(),
        target: if annotated && !f[3].is_empty() {
            f[3]
        } else {
            f[2]
        }
        .to_string(),
        annotated,
        tagger: (annotated && !f[4].is_empty()).then(|| f[4].to_string()),
        email: (annotated && !f[5].is_empty())
            .then(|| f[5].trim_matches(|c| c == '<' || c == '>').to_string()),
        time: time.parse().unwrap_or(0),
        message,
        signed: !f[11].trim().is_empty(),
        commit_subject: if annotated { f[8] } else { f[9] }.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_annotated_and_lightweight() {
        let a = parse_tag("v1\u{1f}tag\u{1f}aaa\u{1f}ccc\u{1f}Ana\u{1f}<ana@x>\u{1f}100\u{1f}100\u{1f}fix: bug\u{1f}Release 1\u{1f}Notes\n\u{1f}\u{1f}").unwrap();
        assert!(a.annotated && !a.signed);
        assert_eq!(
            (a.target.as_str(), a.email.as_deref(), a.time),
            ("ccc", Some("ana@x"), 100)
        );
        assert_eq!(
            (a.message.as_str(), a.commit_subject.as_str()),
            ("Release 1\n\nNotes", "fix: bug")
        );
        let l = parse_tag(
            "v0\u{1f}commit\u{1f}bbb\u{1f}\u{1f}\u{1f}\u{1f}\u{1f}50\u{1f}\u{1f}first\u{1f}\u{1f}",
        )
        .unwrap();
        assert!(!l.annotated && l.tagger.is_none() && l.message.is_empty());
        assert_eq!(
            (l.target.as_str(), l.time, l.commit_subject.as_str()),
            ("bbb", 50, "first")
        );
        assert!(
            check_name("-x").is_err() && check_name("a b").is_err() && check_name("v1.2.0").is_ok()
        );
    }
}
