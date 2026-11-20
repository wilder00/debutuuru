//! `git.*` methods. Repos are opened with plain local paths: the agent always
//! runs on the same OS as the repository (that's the point of the agent).

use crate::{handle_with, Module};
use debutuuru_core::{Location, Repo};
use debutuuru_protocol::git::*;
use debutuuru_protocol::{ModuleInfo, RpcError};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Default)]
pub struct GitModule {
    /// Opening a repo costs several git calls; keep it per requested path.
    repos: Mutex<HashMap<String, Arc<Repo>>>,
}

impl GitModule {
    fn repo(&self, path: &str) -> Result<Arc<Repo>, debutuuru_core::Error> {
        let mut cache = self.repos.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(r) = cache.get(path) {
            return Ok(r.clone());
        }
        let r = Arc::new(Repo::open(Location::local(path))?);
        cache.insert(path.to_string(), r.clone());
        Ok(r)
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
            _ => return None,
        })
    }
}
