// Hide the extra console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Desktop shell. The UI never talks to git directly: every request goes
//! through `rpc`, which picks the agent responsible for the repository (the
//! in-process agent for host repos, an agent inside WSL for WSL repos) and
//! forwards it. The shell also owns app-level state: settings, the single
//! running instance, and opening repos passed from terminals.

mod agents;
mod logs;
mod settings;
mod terminal;
mod wsl;

use agents::Agents;
use debutuuru_core::location::{resolve, resolve_in};
use debutuuru_core::Location;
use debutuuru_protocol::{ErrorCode, Hello, RpcError};
use serde::Serialize;
use serde_json::Value;
use settings::{LoadedSettings, Settings, Store};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use ts_rs::TS;

/// Event sent when another `debutuuru` invocation asks this instance to open a repo.
const OPEN_REPO: &str = "open-repo";

struct SettingsState {
    store: Store,
    read_only: Mutex<bool>,
}

fn blocking_err(e: impl std::fmt::Display) -> RpcError {
    RpcError::new(ErrorCode::Transport, e.to_string())
}

/// Generic entry point for every module: `rpc("git.status", {...})`.
/// `repo` is the path as the user sees it (`C:\…`, `/home/…`,
/// `\\wsl.localhost\Distro\…`); it is translated and injected into `params`.
#[tauri::command]
async fn rpc(
    agents: tauri::State<'_, Arc<Agents>>,
    repo: String,
    method: String,
    params: Option<Value>,
) -> Result<Value, RpcError> {
    let agents = agents.inner().clone();
    let loc = Location::parse(&repo);
    let params = params.unwrap_or_else(|| Value::Object(Default::default()));
    let started = agents.logging().then(std::time::Instant::now);
    let (method_name, log_agents) = (method.clone(), agents.clone());
    let result = tauri::async_runtime::spawn_blocking(move || agents.call(&loc, &method, params))
        .await
        .map_err(blocking_err)?;
    if let Some(started) = started {
        log_agents.log_request(
            &repo,
            &method_name,
            started.elapsed().as_millis() as u64,
            result.as_ref().err().map(|e| e.message.clone()),
        );
    }
    result
}

/// Opens a tool window (`logs`, `dictionary`) or brings it forward. Async:
/// on Windows, creating a window from a synchronous command can deadlock.
#[tauri::command]
async fn open_tool_window(app: tauri::AppHandle, view: String) -> Result<(), String> {
    logs::open(&app, &view).map_err(|e| e.to_string())
}

/// Handshake of the agent serving `repo` (local agent when `repo` is empty).
#[tauri::command]
async fn agent_hello(
    agents: tauri::State<'_, Arc<Agents>>,
    repo: String,
) -> Result<Hello, RpcError> {
    let agents = agents.inner().clone();
    tauri::async_runtime::spawn_blocking(move || agents.hello(&Location::parse(&repo)))
        .await
        .map_err(blocking_err)?
}

/// Canonical form of a user-typed path, used as the tab key: absolute local
/// path, or `\\wsl.localhost\Distro\…` for WSL.
#[tauri::command]
fn resolve_path(input: String) -> String {
    resolve(input.trim()).user_string()
}

/// Repository passed on the command line (`debutuuru open <path>`), canonical.
#[tauri::command]
fn initial_path() -> Option<String> {
    repo_arg(
        std::env::args().skip(1),
        &std::env::current_dir().unwrap_or_default(),
    )
}

fn repo_arg(args: impl Iterator<Item = String>, cwd: &std::path::Path) -> Option<String> {
    let arg = args.into_iter().find(|a| !a.starts_with('-'))?;
    Some(resolve_in(&arg, cwd).user_string())
}

/// WSL distros for the "use WSL's SSH keys" setting.
#[tauri::command]
async fn wsl_distros() -> Vec<String> {
    tauri::async_runtime::spawn_blocking(wsl::list_distros)
        .await
        .unwrap_or_default()
}

/// Distros running now (their command status can be checked without booting one).
#[tauri::command]
async fn wsl_running() -> Vec<String> {
    tauri::async_runtime::spawn_blocking(wsl::list_running)
        .await
        .unwrap_or_default()
}

/// Whether `debutuuru .` works in `distro`'s terminals.
#[tauri::command]
async fn wsl_command_status(distro: String) -> Result<wsl::WslCommandStatus, RpcError> {
    tauri::async_runtime::spawn_blocking(move || wsl::command_status(&distro))
        .await
        .map_err(blocking_err)?
}

/// Installs the `debutuuru` command in `distro` (agent + shim), without opening a repo.
#[tauri::command]
async fn wsl_install_command(
    agents: tauri::State<'_, Arc<Agents>>,
    distro: String,
) -> Result<wsl::WslCommandStatus, RpcError> {
    let agents = agents.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        wsl::install_command(&distro, agents.linux_agent()?)
    })
    .await
    .map_err(blocking_err)?
}

/// Adds `~/.local/bin` to PATH in the user's shell startup file (user-initiated).
#[tauri::command]
async fn wsl_add_to_path(distro: String) -> Result<wsl::WslCommandStatus, RpcError> {
    tauri::async_runtime::spawn_blocking(move || wsl::add_to_path(&distro))
        .await
        .map_err(blocking_err)?
}

/// Terminal profiles found on this machine (shells, WSL distros).
#[tauri::command]
async fn term_profiles() -> Vec<settings::TerminalProfile> {
    tauri::async_runtime::spawn_blocking(terminal::detect)
        .await
        .unwrap_or_default()
}

/// Whether a dropped path is a folder or a file (WSL paths such as
/// `\\wsl.localhost\Ubuntu\…` work too); `None` if it doesn't exist.
#[tauri::command]
fn path_kind(path: String) -> Option<&'static str> {
    let meta = std::fs::metadata(path).ok()?;
    Some(if meta.is_dir() { "dir" } else { "file" })
}

/// Home folder inside a WSL distro, for "Browse in WSL…" (user-initiated).
#[tauri::command]
async fn wsl_home(distro: String) -> Result<String, RpcError> {
    tauri::async_runtime::spawn_blocking(move || wsl::home(&distro))
        .await
        .map_err(blocking_err)?
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
    // The in-process agent points git/ssh at this executable for credential
    // prompts. In that role we must not start a window (or the single-instance
    // check): forward the prompt to the running app and exit.
    let args: Vec<String> = std::env::args().collect();
    if debutuuru_agent::askpass::is_askpass_invocation(&args) {
        std::process::exit(debutuuru_agent::askpass::client_main(&args[1]));
    }

    tauri::Builder::default()
        // Must be first: a second launch (`debutuuru .` while the app runs)
        // forwards its path here instead of opening another window.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            #[cfg(debug_assertions)]
            eprintln!("[single-instance] argv={argv:?} cwd={cwd}");
            if let Some(repo) = repo_arg(argv.into_iter().skip(1), std::path::Path::new(&cwd)) {
                let _ = app.emit(OPEN_REPO, repo);
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        // Updates: checked and installed from the UI (signed, from GitHub
        // releases); `process` relaunches the app afterwards on Linux.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let config = app.path().app_config_dir()?;
            let data = app.path().app_data_dir()?;
            app.manage(SettingsState {
                store: Store::new(&config, &data),
                read_only: Mutex::new(false),
            });
            let linux_agent = wsl::find_agent_binary(app.path().resource_dir().ok());
            app.manage(Arc::new(Agents::new(app.handle().clone(), linux_agent)));
            // Tool windows belong to the main one: they close with it, so the
            // app doesn't keep running with only the logs or dictionary open.
            if let Some(main) = app.get_webview_window("main") {
                let handle = app.handle().clone();
                main.on_window_event(move |e| {
                    if matches!(e, tauri::WindowEvent::Destroyed) {
                        for label in logs::TOOL_WINDOWS {
                            if let Some(w) = handle.get_webview_window(label) {
                                let _ = w.destroy();
                            }
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            rpc,
            open_tool_window,
            agent_hello,
            resolve_path,
            initial_path,
            wsl_distros,
            wsl_running,
            wsl_command_status,
            wsl_install_command,
            wsl_add_to_path,
            wsl_home,
            path_kind,
            term_profiles,
            get_settings,
            save_settings,
            import_background
        ])
        .run(tauri::generate_context!())
        .expect("error while running Debutuuru");
}
