// Hide the extra console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Desktop shell. The UI never talks to git directly: every request goes
//! through `rpc`, which picks the agent responsible for the repository
//! (local for host repos; WSL agents arrive in Phase 1) and forwards it.
//! The shell also owns app-level state: settings and personalization.

mod settings;

use debutuuru_agent::{Agent, Transport};
use debutuuru_core::location::resolve;
use debutuuru_core::Location;
use debutuuru_protocol::{ErrorCode, Hello, RpcError};
use serde::Serialize;
use serde_json::Value;
use settings::{LoadedSettings, Settings, Store};
use std::sync::{Arc, Mutex};
use tauri::Manager;
use ts_rs::TS;

struct Agents {
    local: Arc<Agent>,
}

impl Agents {
    /// Returns the agent for `loc` (Phase 0: host repos only).
    fn for_location(&self, loc: &Location) -> Result<Arc<dyn Transport>, RpcError> {
        match &loc.wsl_distro {
            None => Ok(self.local.clone()),
            Some(distro) => Err(RpcError::new(
                ErrorCode::Unsupported,
                format!(
                    "Repositories inside WSL ({distro}) aren't supported in this build yet \
                     (planned for Phase 1). Local repositories work."
                ),
            )),
        }
    }
}

struct SettingsState {
    store: Store,
    read_only: Mutex<bool>,
}

/// Generic entry point for every module: `rpc("git.status", {...})`.
/// `repo` is the path as the user sees it (`C:\…`, `/home/…`,
/// `\\wsl.localhost\Distro\…`); it is translated and injected into `params`.
#[tauri::command]
async fn rpc(
    agents: tauri::State<'_, Agents>,
    repo: String,
    method: String,
    params: Option<Value>,
) -> Result<Value, RpcError> {
    let loc = Location::parse(&repo);
    let agent = agents.for_location(&loc)?;
    let mut params = params.unwrap_or_else(|| Value::Object(Default::default()));
    params
        .as_object_mut()
        .ok_or_else(|| RpcError::new(ErrorCode::InvalidParams, "params must be an object"))?
        .insert("repo".into(), Value::String(loc.path));
    tauri::async_runtime::spawn_blocking(move || agent.call(&method, params))
        .await
        .map_err(|e| RpcError::new(ErrorCode::Transport, e.to_string()))?
}

/// Handshake info of the local agent (versions, available modules).
#[tauri::command]
fn hello(agents: tauri::State<'_, Agents>) -> Hello {
    agents.local.hello()
}

/// Repository passed on the command line (`debutuuru open <path>`), absolute.
#[tauri::command]
fn initial_path() -> Option<String> {
    let arg = std::env::args().skip(1).find(|a| !a.starts_with('-'))?;
    let loc = resolve(&arg);
    Some(loc.windows_unc().unwrap_or(loc.path))
}

#[tauri::command]
fn get_settings(state: tauri::State<'_, SettingsState>) -> LoadedSettings {
    let loaded = state.store.load();
    *state.read_only.lock().unwrap_or_else(|e| e.into_inner()) = loaded.read_only;
    loaded
}

#[tauri::command]
fn save_settings(
    state: tauri::State<'_, SettingsState>,
    settings: Settings,
) -> Result<LoadedSettings, String> {
    if *state.read_only.lock().unwrap_or_else(|e| e.into_inner()) {
        return Err("Settings come from a newer Debutuuru version and are read-only.".into());
    }
    let saved = state.store.save(settings).map_err(|e| e.to_string())?;
    Ok(LoadedSettings {
        background_path: state.store.background_path(&saved),
        settings: saved,
        read_only: false,
        notice: None,
    })
}

#[derive(Serialize, TS)]
#[ts(export)]
struct ImportedBackground {
    file: String,
    path: String,
}

/// Receives raw image bytes (no base64/JSON overhead) and stores a copy.
#[tauri::command]
fn import_background(
    state: tauri::State<'_, SettingsState>,
    request: tauri::ipc::Request<'_>,
) -> Result<ImportedBackground, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw image bytes".into());
    };
    let (file, path) = state.store.import_background(bytes)?;
    Ok(ImportedBackground { file, path })
}

fn main() {
    tauri::Builder::default()
        .manage(Agents {
            local: Arc::new(Agent::with_default_modules()),
        })
        .setup(|app| {
            let config = app.path().app_config_dir()?;
            let data = app.path().app_data_dir()?;
            app.manage(SettingsState {
                store: Store::new(&config, &data),
                read_only: Mutex::new(false),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            rpc,
            hello,
            initial_path,
            get_settings,
            save_settings,
            import_background
        ])
        .run(tauri::generate_context!())
        .expect("error while running Debutuuru");
}
