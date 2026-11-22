//! Terminal profiles found on this machine: on Windows PowerShell 7, Windows
//! PowerShell, Command Prompt, Git Bash and one per WSL distro (run through
//! `wsl.exe -d`, like Windows Terminal); on Linux the user's `$SHELL` and the
//! other shells listed in /etc/shells. The user's own profiles live in the
//! settings (`terminal.profiles`).

use crate::settings::TerminalProfile;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub fn detect() -> Vec<TerminalProfile> {
    let mut out = Vec::new();
    #[cfg(windows)]
    detect_windows(&mut out);
    #[cfg(not(windows))]
    detect_unix(&mut out);
    out
}

fn profile(id: &str, name: &str, program: &Path, args: &[&str]) -> TerminalProfile {
    TerminalProfile {
        id: format!("auto:{id}"),
        name: name.to_string(),
        program: program.to_string_lossy().into_owned(),
        args: args.iter().map(|a| a.to_string()).collect(),
        cwd: None,
        env: BTreeMap::new(),
        wsl_distro: None,
        icon: None,
    }
}

/// First `name` found in PATH.
#[cfg_attr(not(windows), allow(dead_code))]
fn in_path(name: &str) -> Option<PathBuf> {
    std::env::split_paths(&std::env::var_os("PATH")?)
        .map(|d| d.join(name))
        .find(|p| p.is_file())
}

#[cfg(windows)]
fn detect_windows(out: &mut Vec<TerminalProfile>) {
    let env_path =
        |var: &str, rest: &str| std::env::var_os(var).map(|v| PathBuf::from(v).join(rest));
    let pwsh = in_path("pwsh.exe")
        .or_else(|| env_path("ProgramFiles", r"PowerShell\7\pwsh.exe").filter(|p| p.is_file()));
    if let Some(p) = pwsh {
        out.push(profile("pwsh", "PowerShell 7", &p, &["-NoLogo"]));
    }
    if let Some(p) = env_path(
        "SystemRoot",
        r"System32\WindowsPowerShell\v1.0\powershell.exe",
    )
    .filter(|p| p.is_file())
    {
        out.push(profile(
            "powershell",
            "Windows PowerShell",
            &p,
            &["-NoLogo"],
        ));
    }
    let cmd = std::env::var_os("ComSpec")
        .map(PathBuf::from)
        .filter(|p| p.is_file());
    if let Some(p) = cmd.or_else(|| env_path("SystemRoot", r"System32\cmd.exe")) {
        out.push(profile("cmd", "Command Prompt", &p, &[]));
    }
    // Git for Windows: `<git>\cmd\git.exe` → `<git>\bin\bash.exe`.
    let git_bash = in_path("git.exe")
        .and_then(|g| Some(g.parent()?.parent()?.join(r"bin\bash.exe")))
        .filter(|p| p.is_file())
        .or_else(|| env_path("ProgramFiles", r"Git\bin\bash.exe").filter(|p| p.is_file()));
    if let Some(p) = git_bash {
        out.push(profile("git-bash", "Git Bash", &p, &["--login", "-i"]));
    }
    for distro in crate::wsl::list_distros() {
        if distro.to_ascii_lowercase().starts_with("docker-desktop") {
            continue;
        }
        let mut p = profile(
            &format!("wsl:{distro}"),
            &distro,
            Path::new("wsl.exe"),
            &["-d", &distro],
        );
        p.wsl_distro = Some(distro);
        out.push(p);
    }
}

#[cfg(not(windows))]
fn detect_unix(out: &mut Vec<TerminalProfile>) {
    let mut shells: Vec<PathBuf> = Vec::new();
    if let Some(s) = std::env::var_os("SHELL")
        .map(PathBuf::from)
        .filter(|p| p.is_file())
    {
        shells.push(s);
    }
    let listed = std::fs::read_to_string("/etc/shells").unwrap_or_default();
    for line in listed.lines().map(str::trim).filter(|l| l.starts_with('/')) {
        let p = PathBuf::from(line);
        let name = p
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let usable = matches!(
            name.as_str(),
            "bash" | "zsh" | "fish" | "nu" | "pwsh" | "elvish" | "xonsh"
        );
        let seen = shells.iter().any(|s| s.file_name() == p.file_name());
        if usable && !seen && p.is_file() {
            shells.push(p);
        }
    }
    for s in shells {
        let name = s
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        out.push(profile(&name, &name, &s, &[]));
    }
}
