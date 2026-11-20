//! `git.*` methods. Repos are opened with plain local paths: the agent always
//! runs on the same OS as the repository (that's the point of the agent).

use crate::watch::{self, RepoWatch};
use crate::{handle_with, Events, Module};
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
    events: Events,
}

impl GitModule {
    pub fn new(events: Events) -> Self {
        Self {
            repos: Mutex::default(),
            watches: Mutex::default(),
            events,
        }
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
                })
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
            WATCH => handle_with(params, |p: RepoParams| self.watch(p.repo)),
            UNWATCH => handle_with(params, |p: RepoParams| {
                self.unwatch(&p.repo);
                Ok::<_, String>(())
            }),
            _ => return None,
        })
    }
}
