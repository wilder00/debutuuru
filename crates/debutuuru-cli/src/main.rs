//! `debutuuru` command line.
//!
//! Works the same on Windows, Linux and inside WSL. `debutuuru open [path]`
//! launches the desktop app on a repository; from inside WSL with only the
//! Windows app installed, it hands the repo over as `\\wsl.localhost\<distro>\...`.

use clap::{Parser, Subcommand};
use debutuuru_core::{Location, Repo};
use serde_json::to_string_pretty;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};

#[derive(Parser)]
#[command(
    name = "debutuuru",
    version,
    about = "Developer tools: git client and more"
)]
struct Cli {
    /// Print machine-readable JSON instead of text.
    #[arg(long, global = true)]
    json: bool,
    #[command(subcommand)]
    command: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Open the desktop app on a repository (default: current directory).
    Open { path: Option<String> },
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
}

fn main() -> ExitCode {
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
    match cli.command {
        Cmd::Open { path } => open(path),
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

/// Turns a user-supplied path into a [`Location`], absolute and without the
/// Windows `\\?\` verbatim prefix.
fn resolve(input: &str) -> Location {
    let direct = Location::parse(input);
    if direct.wsl_distro.is_some() {
        return direct;
    }
    let abs = std::fs::canonicalize(input).unwrap_or_else(|_| PathBuf::from(input));
    let text = abs.to_string_lossy().to_string();
    let text = if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else {
        text.strip_prefix(r"\\?\").map(String::from).unwrap_or(text)
    };
    Location::parse(&text)
}

fn open(path: Option<String>) -> Result<(), String> {
    let loc = resolve(path.as_deref().unwrap_or("."));
    let (exe, windows_gui_from_wsl) = find_desktop().ok_or(
        "could not find the desktop app (`debutuuru-desktop`). Install it, or set DEBUTUURU_DESKTOP to its path.",
    )?;

    let arg = if windows_gui_from_wsl {
        // The Windows GUI can't take a Linux path; give it the UNC form.
        let distro = std::env::var("WSL_DISTRO_NAME")
            .map_err(|_| "WSL_DISTRO_NAME is not set".to_string())?;
        Location::from_inside_wsl(&distro, &loc.path)
            .windows_unc()
            .unwrap_or(loc.path.clone())
    } else {
        loc.windows_unc().unwrap_or(loc.path.clone())
    };

    let mut cmd = Command::new(&exe);
    cmd.arg(&arg)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0000_0008 | 0x0800_0000); // DETACHED_PROCESS | CREATE_NO_WINDOW
    }
    cmd.spawn()
        .map_err(|e| format!("failed to start {}: {e}", exe.display()))?;
    Ok(())
}

/// Returns the desktop executable and whether it is the *Windows* GUI being
/// launched from inside WSL.
fn find_desktop() -> Option<(PathBuf, bool)> {
    if let Ok(p) = std::env::var("DEBUTUURU_DESKTOP") {
        return Some((PathBuf::from(p), false));
    }
    let name = if cfg!(windows) {
        "debutuuru-desktop.exe"
    } else {
        "debutuuru-desktop"
    };
    if let Ok(me) = std::env::current_exe() {
        if let Some(dir) = me.parent() {
            let cand = dir.join(name);
            if cand.is_file() {
                return Some((cand, false));
            }
        }
    }
    if on_path(name) {
        return Some((PathBuf::from(name), false));
    }
    // Inside WSL with only the Windows app installed: use Windows interop.
    if !cfg!(windows)
        && std::env::var_os("WSL_DISTRO_NAME").is_some()
        && on_path("debutuuru-desktop.exe")
    {
        return Some((PathBuf::from("debutuuru-desktop.exe"), true));
    }
    None
}

fn on_path(name: &str) -> bool {
    std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).any(|d| Path::new(&d).join(name).is_file()))
        .unwrap_or(false)
}
