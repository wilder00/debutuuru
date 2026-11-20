use crate::{Error, Location, Result};
use std::process::{Command, Output, Stdio};

/// Runs git for a [`Location`], either directly or through `wsl.exe`.
#[derive(Debug, Clone)]
pub struct GitRunner {
    pub location: Location,
}

impl GitRunner {
    pub fn new(location: Location) -> Self {
        Self { location }
    }

    /// A ready-to-run git command. Callers may add env/pipes (remote
    /// operations stream progress and set up credential prompts).
    pub fn command(&self, args: &[&str]) -> Command {
        let mut cmd;
        match &self.location.wsl_distro {
            Some(distro) => {
                cmd = Command::new("wsl.exe");
                cmd.args(["-d", distro, "--cd", &self.location.path, "-e", "git"]);
            }
            None => {
                cmd = Command::new("git");
                cmd.current_dir(&self.location.path);
            }
        }
        // Never hang waiting for credentials on a terminal that isn't there.
        cmd.env("GIT_TERMINAL_PROMPT", "0");
        // Never let git (or ssh, hooks…) read our stdin: in `agent --stdio`
        // that is the protocol pipe.
        cmd.stdin(Stdio::null());
        cmd.args(args);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        cmd
    }

    /// Runs git and returns raw output (any exit status).
    pub fn output(&self, args: &[&str]) -> Result<Output> {
        self.command(args).output().map_err(|source| Error::Spawn {
            program: if self.location.wsl_distro.is_some() {
                "wsl.exe"
            } else {
                "git"
            }
            .into(),
            source,
        })
    }

    /// Runs git; non-zero exit becomes `Error::Git(stderr)`.
    pub fn git(&self, args: &[&str]) -> Result<String> {
        let out = self.output(args)?;
        if out.status.success() {
            Ok(String::from_utf8_lossy(&out.stdout).into_owned())
        } else {
            let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            Err(Error::Git(if err.is_empty() {
                String::from_utf8_lossy(&out.stdout).trim().to_string()
            } else {
                err
            }))
        }
    }
}
