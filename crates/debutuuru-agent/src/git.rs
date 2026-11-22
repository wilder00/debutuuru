//! `git.*` methods. Repos are opened with plain local paths: the agent always
//! runs on the same OS as the repository (that's the point of the agent).

use crate::remote::{self, Ops, RemoteOp};
use crate::watch::{self, RepoWatch};
use crate::{askpass, handle_with, Events, Module};
use debutuuru_core::{Location, Repo};
use debutuuru_protocol::git::*;
use debutuuru_protocol::{ModuleInfo, RpcError};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

pub struct GitModule {
    /// Opening a repo costs several git calls; keep it per requested path.
    repos: Mutex<HashMap<String, Arc<Repo>>>,
    /// Active file watchers, keyed like `repos`. Dropping one stops it.
    watches: Mutex<HashMap<String, RepoWatch>>,
    ops: Ops,
    events: Events,
}

impl GitModule {
    pub fn new(events: Events) -> Self {
        Self {
            repos: Mutex::default(),
            watches: Mutex::default(),
            ops: Ops::default(),
            events,
        }
    }

    fn remote_op(
        &self,
        repo_key: &str,
        options: &RemoteOptions,
        args: Vec<String>,
    ) -> Result<OpOutcome, String> {
        let repo = self.repo(repo_key).map_err(|e| e.to_string())?;
        Ok(remote::run(
            RemoteOp {
                repo: &repo,
                repo_key,
                options,
                args,
            },
            &self.events,
            &self.ops,
        ))
    }

    fn fetch(&self, p: FetchParams) -> Result<OpOutcome, String> {
        let mut args = vec!["fetch".to_string(), "--progress".into(), "--prune".into()];
        match &p.remote {
            Some(r) => args.push(r.clone()),
            None => args.push("--all".into()),
        }
        let mut out = self.remote_op(&p.repo, &p.options, args)?;
        if out.ok {
            out.summary = match &p.remote {
                Some(r) => format!("Fetched {r}"),
                None => "Fetched all remotes".into(),
            };
            out.message = Some(OutcomeMessage::Fetched {
                remote: p.remote.clone(),
            });
        }
        Ok(out)
    }

    fn pull(&self, p: PullParams) -> Result<OpOutcome, String> {
        let repo = self.repo(&p.repo).map_err(|e| e.to_string())?;
        let Some(upstream) = repo.upstream().map_err(|e| e.to_string())? else {
            return Ok(OpOutcome {
                ok: false,
                summary: "This branch has no upstream to pull from. Push it first, or set one with `git branch -u`.".into(),
                hint: Some(FailureHint::NoRemote),
                log: String::new(),
                message: Some(OutcomeMessage::NoUpstream),
            });
        };
        let mut args = vec!["pull".to_string(), "--progress".into()];
        match p.mode {
            PullMode::Default => {}
            PullMode::FfOnly => args.push("--ff-only".into()),
            PullMode::Rebase => args.push("--rebase".into()),
            PullMode::Merge => args.push("--no-rebase".into()),
        }
        let mut out = self.remote_op(&p.repo, &p.options, args)?;
        if out.ok {
            let up_to_date = out.log.contains("Already up to date");
            out.summary = if up_to_date {
                "Already up to date".into()
            } else {
                format!("Pulled {upstream}")
            };
            out.message = Some(if up_to_date {
                OutcomeMessage::UpToDate
            } else {
                OutcomeMessage::Pulled { upstream }
            });
        }
        Ok(out)
    }

    fn push(&self, p: PushParams) -> Result<OpOutcome, String> {
        let repo = self.repo(&p.repo).map_err(|e| e.to_string())?;
        let branch = repo
            .head_branch()
            .map_err(|e| e.to_string())?
            .ok_or("HEAD is detached: check out a branch to push")?;
        let upstream = repo.upstream().map_err(|e| e.to_string())?;
        let mut args = vec!["push".to_string(), "--progress".into()];
        if p.force_with_lease {
            args.push("--force-with-lease".into());
        }
        // New branch: publish it to the obvious remote and track it.
        let target = match &upstream {
            Some(u) => u.clone(),
            None => {
                let remote = match default_remote(
                    &repo,
                    "no upstream: choose one with `git push -u <remote> HEAD`",
                )? {
                    Ok(r) => r,
                    Err(outcome) => return Ok(outcome),
                };
                args.extend(["-u".into(), remote.clone(), "HEAD".into()]);
                format!("{remote}/{branch}")
            }
        };
        let mut out = self.remote_op(&p.repo, &p.options, args)?;
        if out.ok {
            let nothing = out.log.contains("Everything up-to-date");
            out.summary = if nothing {
                "Nothing to push".into()
            } else {
                format!("Pushed {branch} → {target}")
            };
            out.message = Some(if nothing {
                OutcomeMessage::NothingToPush
            } else {
                OutcomeMessage::Pushed { branch, target }
            });
        }
        Ok(out)
    }

    /// Pushes a tag to the default remote (`origin`, or the only one), or
    /// deletes it there.
    fn push_tag(&self, p: PushTagParams) -> Result<OpOutcome, String> {
        let repo = self.repo(&p.repo).map_err(|e| e.to_string())?;
        let remote = match default_remote(&repo, "none is `origin`: use `git push <remote> <tag>`")?
        {
            Ok(r) => r,
            Err(outcome) => return Ok(outcome),
        };
        let mut args = vec!["push".to_string(), "--progress".into(), remote.clone()];
        if p.delete {
            args.push("--delete".into());
        }
        args.push(format!("refs/tags/{}", p.name));
        let mut out = self.remote_op(&p.repo, &p.options, args)?;
        if out.ok {
            let tag = p.name.clone();
            out.summary = if p.delete {
                format!("Deleted tag {tag} on {remote}")
            } else {
                format!("Pushed tag {tag} → {remote}")
            };
            out.message = Some(if p.delete {
                OutcomeMessage::TagDeletedOnRemote { tag, remote }
            } else {
                OutcomeMessage::TagPushed { tag, remote }
            });
        }
        Ok(out)
    }

    fn repo(&self, path: &str) -> Result<Arc<Repo>, debutuuru_core::Error> {
        let mut cache = self.repos.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(r) = cache.get(path) {
            return Ok(r.clone());
        }
        let r = Arc::new(Repo::open(Location::local(path))?);
        cache.insert(path.to_string(), r.clone());
        Ok(r)
    }

    fn watch(&self, repo: String) -> Result<(), String> {
        let mut watches = self.watches.lock().unwrap_or_else(|e| e.into_inner());
        if watches.contains_key(&repo) {
            return Ok(());
        }
        let info = self.repo(&repo).map_err(|e| e.to_string())?.info.clone();
        let events = self.events.clone();
        let key = repo.clone();
        let w = watch::watch(&info, move || {
            events.emit(CHANGED, ChangedEvent { repo: key.clone() })
        })
        .map_err(|e| format!("cannot watch {}: {e}", info.root))?;
        watches.insert(repo, w);
        Ok(())
    }

    fn unwatch(&self, repo: &str) {
        self.watches
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(repo);
    }
}

/// `origin`, or the only remote; otherwise the outcome that explains why not
/// (`several` finishes "Several remotes and …").
fn default_remote(repo: &Repo, several: &str) -> Result<Result<String, OpOutcome>, String> {
    let remotes = repo.remotes().map_err(|e| e.to_string())?;
    let remote = remotes
        .iter()
        .find(|r| r.name == "origin")
        .or(if remotes.len() == 1 {
            remotes.first()
        } else {
            None
        });
    Ok(match remote {
        Some(r) => Ok(r.name.clone()),
        None => Err(OpOutcome {
            ok: false,
            summary: if remotes.is_empty() {
                "This repository has no remote. Add one with `git remote add origin <url>`.".into()
            } else {
                format!("Several remotes and {several}.")
            },
            hint: Some(FailureHint::NoRemote),
            log: String::new(),
            message: Some(if remotes.is_empty() {
                OutcomeMessage::NoRemote
            } else {
                OutcomeMessage::SeveralRemotes
            }),
        }),
    })
}

impl Module for GitModule {
    fn info(&self) -> ModuleInfo {
        ModuleInfo {
            name: MODULE.into(),
            version: MODULE_VERSION,
        }
    }

    fn handle(&self, method: &str, params: Value) -> Option<Result<Value, RpcError>> {
        Some(match method {
            SNAPSHOT => handle_with(params, |p: RepoParams| {
                let r = self.repo(&p.repo)?;
                let mut info = r.info.clone();
                info.head_branch = r.head_branch()?;
                Ok::<_, debutuuru_core::Error>(Snapshot {
                    info,
                    status: r.status()?,
                    branches: r.branches()?,
                    worktrees: r.worktrees()?,
                    remotes: r.remotes()?,
                    upstream: r.upstream()?,
                    tags: r.tags()?,
                })
            }),
            FETCH => handle_with(params, |p: FetchParams| self.fetch(p)),
            PULL => handle_with(params, |p: PullParams| self.pull(p)),
            PUSH => handle_with(params, |p: PushParams| self.push(p)),
            PUSH_TAG => handle_with(params, |p: PushTagParams| self.push_tag(p)),
            FIND_REPOS => handle_with(params, |p: RepoParams| {
                debutuuru_core::discover::find_repos(&p.repo)
            }),
            CREATE_TAG => handle_with(params, |p: CreateTagParams| {
                self.repo(&p.repo)?
                    .create_tag(&p.name, &p.rev, p.message.as_deref())
            }),
            DELETE_TAG => handle_with(params, |p: TagParams| {
                self.repo(&p.repo)?.delete_tag(&p.name)
            }),
            CANCEL => handle_with(params, |p: CancelParams| {
                self.ops.cancel(&p.op_id);
                Ok::<_, String>(())
            }),
            PROMPT_REPLY => handle_with(params, |p: PromptReply| {
                let server = askpass::server(&self.events).map_err(|e| e.to_string())?;
                server.reply(&p.id, p.answer);
                Ok::<_, String>(())
            }),
            LOG => handle_with(params, |p: LogParams| self.repo(&p.repo)?.log(p.limit)),
            STAGE => handle_with(params, |p: PathsParams| self.repo(&p.repo)?.stage(&p.paths)),
            UNSTAGE => handle_with(params, |p: PathsParams| {
                self.repo(&p.repo)?.unstage(&p.paths)
            }),
            COMMIT => handle_with(params, |p: CommitParams| {
                self.repo(&p.repo)?.commit(&p.message)
            }),
            CHECKOUT => handle_with(params, |p: CheckoutParams| {
                self.repo(&p.repo)?.checkout(&p.branch)
            }),
            DIFF => handle_with(params, |p: DiffParams| {
                self.repo(&p.repo)?.diff(&p.path, p.staged, p.untracked)
            }),
            TREE => handle_with(params, |p: TreeParams| {
                self.repo(&p.repo)?
                    .tree(p.rev.as_deref(), &p.path, p.show_ignored)
            }),
            READ_FILE => handle_with(params, |p: ReadFileParams| {
                self.repo(&p.repo)?.read_file(p.rev.as_deref(), &p.path)
            }),
            STAT_PATHS => handle_with(params, |p: StatPathsParams| {
                self.repo(&p.repo)?.stat_paths(p.rev.as_deref(), &p.paths)
            }),
            LIST_FILES => handle_with(params, |p: TreeParams| {
                self.repo(&p.repo)?.list_files(p.rev.as_deref())
            }),
            READ_BYTES => handle_with(params, |p: ReadFileParams| {
                self.repo(&p.repo)?.read_bytes(p.rev.as_deref(), &p.path)
            }),
            LAST_CHANGE => handle_with(params, |p: ReadFileParams| {
                self.repo(&p.repo)?.last_change(p.rev.as_deref(), &p.path)
            }),
            COMMIT_DETAILS => handle_with(params, |p: RevParams| {
                self.repo(&p.repo)?.commit_details(&p.rev)
            }),
            FILE_VERSIONS => handle_with(params, |p: FileVersionsParams| {
                self.repo(&p.repo)?
                    .file_versions(&p.source, &p.path, p.orig_path.as_deref())
            }),
            WATCH => handle_with(params, |p: RepoParams| self.watch(p.repo)),
            UNWATCH => handle_with(params, |p: RepoParams| {
                self.unwatch(&p.repo);
                Ok::<_, String>(())
            }),
            _ => return None,
        })
    }
}
