//! `debutuuru` command line.
//!
//! Works the same on Windows, Linux and inside WSL. `debutuuru .` (or
//! `debutuuru open [path]`) opens a repository in the desktop app, like
//! `code .`. Inside WSL it hands the repo to the Windows app as
//! `\\wsl.localhost\<distro>\...`; the app then talks to its agent in WSL.

use clap::{Parser, Subcommand};
use debutuuru_core::location::resolve;
use debutuuru_core::{Location, Repo};
use serde_json::to_string_pretty;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};

mod winpath;

#[derive(Parser)]
#[command(
    name = "debutuuru",
    version,
    about = "Developer tools: git client and more",
    args_conflicts_with_subcommands = true,
    after_help = "Examples:\n  debutuuru .            open the current repository in the app\n  debutuuru log -n 5     last 5 commits"
)]
struct Cli {
    /// Print machine-readable JSON instead of text.
    #[arg(long, global = true)]
    json: bool,
    #[command(subcommand)]
    command: Option<Cmd>,
    /// Repository to open in the desktop app (same as `open <PATH>`).
    path: Option<String>,
}

#[derive(Subcommand)]
enum Cmd {
    /// Open the desktop app on a repository (default: current directory).
    Open { path: Option<String> },
    /// Run the agent (started by the desktop app, e.g. inside WSL).
    Agent {
        /// Speak the protocol over stdin/stdout (the only transport for now).
        #[arg(long, required = true)]
        stdio: bool,
    },
    /// Show repository info (worktree detection, HEAD, WSL location).
    Info { path: Option<String> },
    /// Show working tree status.
    Status { path: Option<String> },
    /// Show the commit log.
    Log {
        path: Option<String>,
        #[arg(short = 'n', long, default_value_t = 20)]
        limit: usize,
    },
    /// List local and remote branches.
    Branches { path: Option<String> },
    /// List worktrees of the repository.
    Worktrees { path: Option<String> },
    /// Add or remove a folder (default: this binary's) in the user's PATH.
    /// Run by the Windows installer and uninstaller.
    #[command(hide = true)]
    WindowsPath {
        #[arg(value_parser = ["add", "remove"])]
        action: String,
        dir: Option<PathBuf>,
    },
}

fn main() -> ExitCode {
    // Started by git/ssh as GIT_ASKPASS/SSH_ASKPASS during a remote operation
    // of the agent: forward the prompt to the app and print the answer.
    let args: Vec<String> = std::env::args().collect();
    if debutuuru_agent::askpass::is_askpass_invocation(&args) {
        return ExitCode::from(debutuuru_agent::askpass::client_main(&args[1]) as u8);
    }
    let cli = Cli::parse();
    match run(cli) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> Result<(), String> {
    let json = cli.json;
    let Some(command) = cli.command else {
        // `debutuuru` alone opens the app; `debutuuru <path>` opens that repo.
        return open(cli.path);
    };
    match command {
        Cmd::Open { path } => open(Some(path.unwrap_or_else(|| ".".into()))),
        Cmd::WindowsPath { action, dir } => windows_path(action == "add", dir),
        Cmd::Agent { .. } => {
            // Inside WSL the agent is started without the user's rc files;
            // import ssh-agent/PATH/proxy settings from their login shell so
            // git and ssh behave exactly as in their terminal.
            #[cfg(unix)]
            if in_wsl() || std::env::var_os("DEBUTUURU_IMPORT_SHELL_ENV").is_some() {
                let imported = debutuuru_agent::shellenv::import_login_shell_env();
                if !imported.is_empty() {
                    eprintln!(
                        "debutuuru agent: imported {} from login shell",
                        imported.join(", ")
                    );
                }
            }
            debutuuru_agent::Agent::with_default_modules()
                .serve_stdio()
                .map_err(s)
        }
        Cmd::Info { path } => {
            let repo = repo(path)?;
            if json {
                println!("{}", to_string_pretty(&repo.info).map_err(s)?);
            } else {
                let i = &repo.info;
                println!("root:      {}", i.root);
                println!("git dir:   {}", i.git_dir);
                println!("common:    {}", i.common_dir);
                println!(
                    "branch:    {}",
                    i.head_branch.as_deref().unwrap_or("(detached)")
                );
                println!(
                    "worktree:  {}",
                    if i.is_linked_worktree {
                        "linked"
                    } else {
                        "main"
                    }
                );
                println!("bare:      {}", i.is_bare);
                if let Some(d) = &i.location.wsl_distro {
                    println!("wsl:       {d}");
                }
            }
            Ok(())
        }
        Cmd::Status { path } => {
            let st = repo(path)?.status().map_err(s)?;
            if json {
                println!("{}", to_string_pretty(&st).map_err(s)?);
            } else {
                println!(
                    "## {} (ahead {}, behind {})",
                    st.branch, st.ahead, st.behind
                );
                for f in &st.files {
                    println!("{}{} {}", f.index, f.worktree, f.path);
                }
            }
            Ok(())
        }
        Cmd::Log { path, limit } => {
            let log = repo(path)?.log(limit).map_err(s)?;
            if json {
                println!("{}", to_string_pretty(&log).map_err(s)?);
            } else {
                for e in log {
                    let refs = if e.commit.refs.is_empty() {
                        String::new()
                    } else {
                        format!(" ({})", e.commit.refs.join(", "))
                    };
                    println!(
                        "{} {}{} - {}",
                        &e.commit.hash[..8],
                        e.commit.subject,
                        refs,
                        e.commit.author
                    );
                }
            }
            Ok(())
        }
        Cmd::Branches { path } => {
            let list = repo(path)?.branches().map_err(s)?;
            if json {
                println!("{}", to_string_pretty(&list).map_err(s)?);
            } else {
                for b in list {
                    println!("{} {}", if b.is_head { "*" } else { " " }, b.name);
                }
            }
            Ok(())
        }
        Cmd::Worktrees { path } => {
            let list = repo(path)?.worktrees().map_err(s)?;
            if json {
                println!("{}", to_string_pretty(&list).map_err(s)?);
            } else {
                for w in list {
                    println!(
                        "{}  [{}]",
                        w.path,
                        w.branch.as_deref().unwrap_or("detached")
                    );
                }
            }
            Ok(())
        }
    }
}

fn s<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn repo(path: Option<String>) -> Result<Repo, String> {
    Repo::open(resolve(path.as_deref().unwrap_or("."))).map_err(s)
}

/// Opens the app, on `path` if given. If the app already runs, it receives
/// the path and opens it in a tab (single instance).
fn open(path: Option<String>) -> Result<(), String> {
    let exe = find_desktop().ok_or(
        "could not find the desktop app (`debutuuru-desktop`). Install it, or set DEBUTUURU_DESKTOP to its path.",
    )?;
    let windows_gui_from_wsl = in_wsl()
        && exe
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("exe"));

    let arg = path.map(|p| {
        let loc = resolve(&p);
        match std::env::var("WSL_DISTRO_NAME") {
            // The Windows app can't use a Linux path; give it the UNC form.
            Ok(distro) if windows_gui_from_wsl => {
                Location::from_inside_wsl(&distro, &loc.path).user_string()
            }
            _ => loc.user_string(),
        }
    });

    let mut cmd = Command::new(&exe);
    cmd.args(arg)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0000_0008 | 0x0800_0000); // DETACHED_PROCESS | CREATE_NO_WINDOW
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to start {}: {e}", exe.display()))?;

    // If the app is already running, this new process only forwards the path
    // to it and exits within milliseconds. Wait for that: when called from
    // WSL, returning immediately can tear the Windows process down before it
    // delivered the path. If it keeps running, it is the first instance:
    // leave it open and return.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    while std::time::Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(status)) if !status.success() => {
                return Err(format!("{} exited with {status}", exe.display()))
            }
            Ok(Some(_)) => return Ok(()),
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(50)),
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
}

#[cfg(windows)]
fn windows_path(add: bool, dir: Option<PathBuf>) -> Result<(), String> {
    let dir = match dir {
        Some(d) => d,
        None => std::env::current_exe()
            .map_err(s)?
            .parent()
            .ok_or("no parent folder")?
            .to_path_buf(),
    };
    let dir = dir.to_string_lossy();
    let changed = winpath::update(add, &dir)?;
    let what = match (add, changed) {
        (true, true) => "added to",
        (true, false) => "already in",
        (false, true) => "removed from",
        (false, false) => "was not in",
    };
    println!("{dir} {what} your PATH");
    Ok(())
}

#[cfg(not(windows))]
fn windows_path(_add: bool, _dir: Option<PathBuf>) -> Result<(), String> {
    Err("windows-path only applies on Windows".into())
}

fn in_wsl() -> bool {
    !cfg!(windows) && std::env::var_os("WSL_DISTRO_NAME").is_some()
}

/// Finds the desktop executable: env override, the Windows app that installed
/// this agent (inside WSL), next to this binary, or on PATH.
fn find_desktop() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("DEBUTUURU_DESKTOP") {
        return Some(PathBuf::from(p));
    }
    if in_wsl() {
        // Written by the Windows app when it deploys its agent into this distro.
        let home = std::env::var_os("HOME").map(PathBuf::from)?;
        if let Ok(p) = std::fs::read_to_string(home.join(".local/share/debutuuru/desktop-path")) {
            let p = PathBuf::from(p.trim());
            if p.is_file() {
                return Some(p);
            }
        }
    }
    let name = if cfg!(windows) {
        "debutuuru-desktop.exe"
    } else {
        "debutuuru-desktop"
    };
    // Next to this binary, or one level up: the Windows installer puts the
    // CLI in `<app>\bin` so only it lands on PATH, not `uninstall.exe`.
    if let Ok(me) = std::env::current_exe() {
        for dir in me.ancestors().skip(1).take(2) {
            let cand = dir.join(name);
            if cand.is_file() {
                return Some(cand);
            }
        }
    }
    if on_path(name) {
        return Some(PathBuf::from(name));
    }
    // Inside WSL with the Windows app on the Windows PATH (interop).
    if in_wsl() && on_path("debutuuru-desktop.exe") {
        return Some(PathBuf::from("debutuuru-desktop.exe"));
    }
    None
}

fn on_path(name: &str) -> bool {
    std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).any(|d| Path::new(&d).join(name).is_file()))
        .unwrap_or(false)
}
