//! Agents inside WSL distros (see docs/ARCHITECTURE.md › WSL).
//!
//! 1. The app ships a static Linux `debutuuru` binary (x86_64 musl).
//! 2. On first use of a distro it is copied to
//!    `~/.local/share/debutuuru/bin/debutuuru-<version>-<hash>`. The name
//!    changes with every build, so an upgrade never reuses a stale agent, and
//!    older copies are removed.
//! 3. A shim `~/.local/bin/debutuuru` is written (only if absent or ours) so
//!    `debutuuru .` works in WSL shells and opens this app.
//! 4. One long-lived `wsl.exe -d <distro> -e <agent> agent --stdio` per distro.

use debutuuru_agent::client::StdioClient;
use debutuuru_agent::EventSink;
use debutuuru_protocol::{ErrorCode, RpcError};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use ts_rs::TS;

/// Runs once per connection, inside the distro. Args: $1 Windows path of the
/// agent binary, $2 versioned file name, $3 Windows path of this app.
const DEPLOY: &str = r#"set -e
src=$(wslpath -u "$1"); name="$2"; desktop=$(wslpath -u "$3")
d="$HOME/.local/share/debutuuru"; mkdir -p "$d/bin"
f="$d/bin/$name"
if [ ! -x "$f" ]; then cp "$src" "$f.tmp.$$"; chmod 755 "$f.tmp.$$"; mv "$f.tmp.$$" "$f"; fi
for o in "$d"/bin/debutuuru-*; do [ "$o" = "$f" ] || rm -f "$o"; done
printf '%s\n' "$desktop" > "$d/desktop-path"
s="$HOME/.local/bin/debutuuru"; mkdir -p "$HOME/.local/bin"
if [ ! -e "$s" ] || grep -q 'debutuuru-shim' "$s" 2>/dev/null; then
  printf '#!/bin/sh\n# debutuuru-shim: managed by the Debutuuru desktop app\nexec "%s" "$@"\n' "$f" > "$s.tmp.$$"
  chmod 755 "$s.tmp.$$"; mv "$s.tmp.$$" "$s"
fi
printf '%s\n' "$f"
"#;

/// Starts the agent in `distro`, deploying it (and the `debutuuru` shim) first.
pub fn connect(
    distro: &str,
    agent_binary: &Path,
    on_event: EventSink,
) -> Result<StdioClient, RpcError> {
    let remote = deploy(distro, agent_binary)?;
    let mut cmd = wsl(distro);
    cmd.args(["-e", &remote, "agent", "--stdio"]);
    StdioClient::spawn(cmd, Some(on_event))
}

/// Copies the agent into `distro` and writes the `debutuuru` shim (only if
/// absent or ours). Returns the agent's path inside the distro.
pub fn deploy(distro: &str, agent_binary: &Path) -> Result<String, RpcError> {
    if !cfg!(windows) {
        return Err(RpcError::new(
            ErrorCode::Unsupported,
            "WSL repositories can only be opened from Windows",
        ));
    }
    let bytes = std::fs::read(agent_binary).map_err(|e| {
        RpcError::new(
            ErrorCode::Transport,
            format!("cannot read Linux agent {}: {e}", agent_binary.display()),
        )
    })?;
    let name = format!(
        "debutuuru-{}-{:08x}",
        debutuuru_core::VERSION,
        fnv1a(&bytes) as u32
    );
    let desktop = std::env::current_exe().unwrap_or_default();
    let out = run_sh(
        distro,
        DEPLOY,
        &[
            &agent_binary.to_string_lossy(),
            &name,
            &desktop.to_string_lossy(),
        ],
    )
    .map_err(|e| {
        RpcError::new(
            e.code,
            format!(
                "could not install the Debutuuru agent in WSL '{distro}': {}",
                e.message
            ),
        )
    })?;
    Ok(out.trim().to_string())
}

/// Runs a POSIX `sh` script inside `distro` (`$1…` = `args`); its stdout.
fn run_sh(distro: &str, script: &str, args: &[&str]) -> Result<String, RpcError> {
    let out = wsl(distro)
        .args(["-e", "sh", "-c", script, "sh"])
        .args(args)
        .output()
        .map_err(|e| RpcError::new(ErrorCode::Transport, format!("cannot run wsl.exe: {e}")))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).replace('\0', "");
        return Err(RpcError::new(ErrorCode::Transport, err.trim().to_string()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Whether `debutuuru` works in a distro's terminals (Settings › WSL command).
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct WslCommandStatus {
    pub distro: String,
    /// `~/.local/bin/debutuuru` is the shim this app writes.
    pub installed: bool,
    /// Another file sits at `~/.local/bin/debutuuru`; it is never replaced.
    pub foreign: bool,
    /// The shim's path inside the distro.
    pub shim_path: String,
    /// What a new terminal runs for `debutuuru` (`command -v` in the user's
    /// login shell), if anything.
    pub resolves_to: Option<String>,
    /// A new terminal runs our shim.
    pub on_path: bool,
    /// The user's shell (`$SHELL`).
    pub shell: String,
    /// The startup file "Add to PATH" edits for that shell.
    pub rc_file: String,
}

/// Picks the shell's startup file; prints `key=value` lines. The login +
/// interactive shell sees the same PATH as a new terminal (rc files included).
/// `setsid`: without a controlling terminal an interactive shell can't try to
/// take one (it would be stopped by SIGTTIN, and `timeout` can't TERM a stopped
/// process); `-k 2` kills it if it still hangs.
const STATUS: &str = r#"s="$HOME/.local/bin/debutuuru"; st=missing
if [ -e "$s" ]; then if grep -q 'debutuuru-shim' "$s" 2>/dev/null; then st=installed; else st=foreign; fi; fi
sh_="${SHELL:-/bin/sh}"
case "$(basename "$sh_")" in zsh) rc="$HOME/.zshrc";; bash) rc="$HOME/.bashrc";; *) rc="$HOME/.profile";; esac
ss=; command -v setsid >/dev/null 2>&1 && ss=setsid
r=$(timeout -k 2 8 $ss "$sh_" -ilc 'printf "__DEBUTUURU__%s\n" "$(command -v debutuuru)"' </dev/null 2>/dev/null | sed -n 's/^.*__DEBUTUURU__//p' | tail -n 1)
printf 'state=%s\nshim=%s\nshell=%s\nresolves=%s\nrc=%s\n' "$st" "$s" "$sh_" "$r" "$rc"
"#;

/// Appends `~/.local/bin` to PATH in the shell's startup file, once (marker line).
const ADD_TO_PATH: &str = r#"set -e
sh_="${SHELL:-/bin/sh}"
case "$(basename "$sh_")" in zsh) rc="$HOME/.zshrc";; bash) rc="$HOME/.bashrc";; *) rc="$HOME/.profile";; esac
if ! grep -q 'debutuuru-path' "$rc" 2>/dev/null; then
  printf '\n# debutuuru-path: lets `debutuuru .` work (added by the Debutuuru app)\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$rc"
fi
"#;

pub fn command_status(distro: &str) -> Result<WslCommandStatus, RpcError> {
    Ok(parse_status(distro, &run_sh(distro, STATUS, &[])?))
}

/// Installs the agent and the `debutuuru` shim without starting the agent.
pub fn install_command(distro: &str, agent_binary: &Path) -> Result<WslCommandStatus, RpcError> {
    deploy(distro, agent_binary)?;
    command_status(distro)
}

pub fn add_to_path(distro: &str) -> Result<WslCommandStatus, RpcError> {
    run_sh(distro, ADD_TO_PATH, &[])?;
    command_status(distro)
}

fn parse_status(distro: &str, out: &str) -> WslCommandStatus {
    let get = |k: &str| {
        out.lines()
            .find_map(|l| l.strip_prefix(k)?.strip_prefix('='))
            .unwrap_or("")
            .trim()
            .to_string()
    };
    let state = get("state");
    let shim_path = get("shim");
    let resolves_to = Some(get("resolves")).filter(|r| !r.is_empty());
    WslCommandStatus {
        distro: distro.to_string(),
        installed: state == "installed",
        foreign: state == "foreign",
        on_path: state == "installed" && resolves_to.as_deref() == Some(shim_path.as_str()),
        shim_path,
        resolves_to,
        shell: get("shell"),
        rc_file: get("rc"),
    }
}

fn wsl(distro: &str) -> Command {
    let mut cmd = wsl_plain();
    cmd.args(["-d", distro]);
    cmd
}

fn wsl_plain() -> Command {
    let mut cmd = Command::new("wsl.exe");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

/// Where the Linux agent binary is: env override, bundled resource, or (dev
/// builds) the workspace's cross-build output.
pub fn find_agent_binary(resource_dir: Option<PathBuf>) -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("DEBUTUURU_LINUX_AGENT") {
        return Some(PathBuf::from(p));
    }
    if let Some(p) = resource_dir.map(|d| d.join("agents").join("debutuuru-linux-x86_64")) {
        if p.is_file() {
            return Some(p);
        }
    }
    if cfg!(debug_assertions) {
        let target =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../target/x86_64-unknown-linux-musl");
        for profile in ["release", "debug"] {
            let p = target.join(profile).join("debutuuru");
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

/// Installed WSL distros (`wsl.exe -l -q`), without Docker's internal ones.
pub fn list_distros() -> Vec<String> {
    list(&["-l", "-q"])
}

/// Distros running right now: checking these doesn't boot anything.
pub fn list_running() -> Vec<String> {
    list(&["-l", "--running", "-q"])
}

fn list(args: &[&str]) -> Vec<String> {
    if !cfg!(windows) {
        return vec![];
    }
    let Ok(out) = wsl_plain().args(args).output().map_err(drop) else {
        return vec![];
    };
    parse_distros(&out.stdout)
}

/// `wsl.exe -l` prints UTF-16LE.
fn parse_distros(bytes: &[u8]) -> Vec<String> {
    let units: Vec<u16> = bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|&c| u16::from_le_bytes(c))
        .collect();
    String::from_utf16_lossy(&units)
        .lines()
        .map(|l| {
            l.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}' || c == '\0')
                .to_string()
        })
        .filter(|l| !l.is_empty() && !l.starts_with("docker-desktop"))
        .collect()
}

pub const BUILD_HINT: &str = "The Linux agent isn't built. Run: cargo build -p debutuuru --target x86_64-unknown-linux-musl --release";

/// Stable content hash (FNV-1a 64), so the deployed name changes with the build.
fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |h, b| {
        (h ^ u64::from(*b)).wrapping_mul(0x0100_0000_01b3)
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn parses_utf16_distro_list() {
        let text = "Ubuntu\r\ndocker-desktop\r\nDebian\r\n";
        let bytes: Vec<u8> = text.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
        assert_eq!(super::parse_distros(&bytes), vec!["Ubuntu", "Debian"]);
    }

    #[test]
    fn status_on_path_only_when_a_new_terminal_runs_our_shim() {
        let out = "state=installed\nshim=/home/u/.local/bin/debutuuru\nshell=/usr/bin/zsh\nresolves=/home/u/.local/bin/debutuuru\nrc=/home/u/.zshrc\n";
        let s = super::parse_status("Ubuntu", out);
        assert!(s.installed && s.on_path && !s.foreign);
        assert_eq!(s.rc_file, "/home/u/.zshrc");

        let not_on_path = out.replace("resolves=/home/u/.local/bin/debutuuru", "resolves=");
        let s = super::parse_status("Ubuntu", &not_on_path);
        assert!(s.installed && !s.on_path);
        assert_eq!(s.resolves_to, None);

        let linux_app = out.replace(
            "resolves=/home/u/.local/bin/debutuuru",
            "resolves=/usr/bin/debutuuru",
        );
        let s = super::parse_status("Ubuntu", &linux_app);
        assert!(!s.on_path);
        assert_eq!(s.resolves_to.as_deref(), Some("/usr/bin/debutuuru"));

        let s = super::parse_status("Ubuntu", &out.replace("state=installed", "state=foreign"));
        assert!(s.foreign && !s.installed && !s.on_path);
    }

    #[test]
    fn fnv_is_stable() {
        assert_eq!(super::fnv1a(b""), 0xcbf2_9ce4_8422_2325);
        assert_eq!(super::fnv1a(b"a"), 0xaf63_dc4c_8601_ec8c);
    }
}
