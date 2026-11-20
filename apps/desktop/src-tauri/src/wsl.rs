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
use std::path::{Path, PathBuf};
use std::process::Command;

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

pub fn connect(
    distro: &str,
    agent_binary: &Path,
    on_event: EventSink,
) -> Result<StdioClient, RpcError> {
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

    let out = wsl(distro)
        .args(["-e", "sh", "-c", DEPLOY, "sh"])
        .arg(agent_binary)
        .arg(&name)
        .arg(&desktop)
        .output()
        .map_err(|e| RpcError::new(ErrorCode::Transport, format!("cannot run wsl.exe: {e}")))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).replace('\0', "");
        return Err(RpcError::new(
            ErrorCode::Transport,
            format!(
                "could not install the Debutuuru agent in WSL '{distro}': {}",
                err.trim()
            ),
        ));
    }
    let remote = String::from_utf8_lossy(&out.stdout).trim().to_string();

    let mut cmd = wsl(distro);
    cmd.args(["-e", &remote, "agent", "--stdio"]);
    StdioClient::spawn(cmd, Some(on_event))
}

fn wsl(distro: &str) -> Command {
    let mut cmd = Command::new("wsl.exe");
    cmd.args(["-d", distro]);
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
    fn fnv_is_stable() {
        assert_eq!(super::fnv1a(b""), 0xcbf2_9ce4_8422_2325);
        assert_eq!(super::fnv1a(b"a"), 0xaf63_dc4c_8601_ec8c);
    }
}
