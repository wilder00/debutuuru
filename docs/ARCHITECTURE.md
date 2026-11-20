# Debutuuru architecture

Status (2026-11-20): **Phases 0–2 done.** Next: Phase 3 (distribution).

Phase 2 (remotes), verified in the app with real SSH to GitHub:
- Fetch, pull (default / ff-only / rebase / merge) and push (publishing new
  branches with `-u`; force-with-lease behind a second click), with streamed
  progress, cancel, and failures classified into actionable advice.
- **SSH is never overridden by default.** Passwordless keys, ssh-agent,
  `~/.ssh/config`, `core.sshCommand` and credential managers work exactly as
  in the terminal. Verified: a WSL repo fetches with a passphrase-less key and
  no prompt at all.
- The WSL agent imports `SSH_AUTH_SOCK`, `PATH` and proxy variables from the
  user's login shell (`$SHELL -ilc`, 5 s timeout), because `wsl.exe -e` skips
  rc files where ssh-agents are usually started.
- Only when git/ssh really need input (a key passphrase, an unknown host key,
  an HTTPS password) do they call `GIT_ASKPASS`/`SSH_ASKPASS` (our own binary,
  `SSH_ASKPASS_REQUIRE=force`). The prompt goes over a token-authenticated
  loopback socket to the agent, then to an in-app dialog, and back. Answers
  are never logged or stored. Verified with a local HTTP server (credentials
  arrive intact, never in logs) and GitHub's real host-key prompt.
- Opt-in "Use WSL's SSH keys for Windows repositories" (`GIT_SSH_COMMAND=wsl.exe
  -e ssh`), for machines where keys live only in WSL. Verified fetching a
  Windows repo over SSH with the WSL key.
- git children get `stdin = null`, so nothing can read the agent's protocol pipe.

Phase 1, verified end to end on Windows 11 + Ubuntu (WSL2):
- The Linux agent is cross-built on Windows (`x86_64-unknown-linux-musl`,
  `rust-lld`, no C toolchain), deployed into the distro under a versioned,
  content-hashed name, and reached over one long-lived `wsl.exe` pipe.
- Agent file watchers (`notify`: inotify / ReadDirectoryChangesW) push
  `git.changed` events, so the UI refreshes by itself, also for WSL repos.
- A killed WSL agent is detected (`agent.disconnected`), restarted on the next
  call, and watchers are re-armed automatically.
- Single instance: `debutuuru <path>` hands the path to the running app,
  which opens it in a tab. Tabs persist in settings (`session`, an additive
  field with no schema bump).
- Inside WSL, `debutuuru .` works through a shim the app installs at
  `~/.local/bin/debutuuru`. It only replaces a file it wrote itself.

Known gaps: the native Linux desktop build hasn't been run yet (only built in
CI). On Windows, `debutuuru` gets onto PATH with the installer (Phase 3).
Watching repos under `/mnt/c` from WSL misses Windows-side edits (drvfs has
no inotify); open those as Windows paths instead.

## Goals

1. A GitKraken-class git client, then a home for other developer tools:
   terminals and task runner, GitHub/GitLab, containers and services, and
   more that we haven't picked yet.
2. Windows install that works on Windows repos **and** WSL repos at native speed.
   Linux install that works on Linux. Also usable from WSLg.
3. Opened from any terminal: `debutuuru .` in PowerShell, bash, or a WSL shell.
4. Versioned and safe to upgrade, since the app, the WSL agent, saved settings
   and the UI all evolve separately.

## Measured constraints (this machine, 2026-11-20)

| Fact | Consequence |
| --- | --- |
| `wsl.exe -e git` ≈ 170 ms per call vs ≈ 40 ms for native git | Never shell out per git call. Run an **agent inside WSL**. |
| Windows can't receive file-change events for `\\wsl.localhost` files | File watching must run inside WSL (the agent). |
| SSH keys live in WSL `~/.ssh`, no ssh-agent; Windows ssh-agent disabled; no credential helper | Use the user's own git/ssh setup; the app shows passphrase and password prompts (askpass). |
| WSLg available | The Linux build can also run inside WSL. |
| Ubuntu git 2.43, Windows git 2.51 | Check the git version at runtime and set a documented minimum. |
| Node v24 through fnm (not on PATH in plain shells) | Scripts and CI install or activate Node explicitly. |

## Components

```
┌──────────────────────── Desktop app (Tauri 2 + React/Vite/TS) ─────────────────────────┐
│ UI modules: git · terminal · tasks · forge (GitHub/GitLab) · containers · …             │
│        │ typed commands/events (TS types generated from Rust)                           │
│ Rust shell: windows/tabs, single instance, updater, askpass dialogs, settings           │
│        │ AgentClient (same API for both transports)                                     │
└────────┼───────────────────────────────────────────────┬────────────────────────────────┘
         │ in-process channel                            │ stdio (JSON-RPC, versioned)
   ┌─────▼──────┐                               ┌────────▼────────────────────────────┐
   │ Local agent│  host OS repos                │ WSL agent: `debutuuru agent --stdio`│
   └────────────┘                               │ started via one long-lived wsl.exe   │
                                                └─────────────────────────────────────┘
   Both agents = the same `debutuuru-agent` library: modules + native git + watcher + PTYs
```

| Crate / app | Role |
| --- | --- |
| `debutuuru-core` | Shared types plus git operations through the system `git` (worktrees, graph, status…). No transport. |
| `debutuuru-protocol` | Request, response and event messages, `PROTOCOL_VERSION`, handshake. Serde types, with TS types generated from them. |
| `debutuuru-agent` | Serves the protocol. Hosts **modules** that register namespaced methods (`git.status`, `term.spawn`, `docker.ps`…). File watching (`notify`) and long tasks streaming progress. |
| `debutuuru` (CLI) | `open`, `agent --stdio`, `askpass`, inspection commands. Statically linked (musl) on Linux so one binary runs in any distro. |
| `apps/desktop` | Tauri shell and React UI. |

### Why one agent library everywhere

Local repos use the agent in-process, and WSL repos use the same code over
stdio. Every module (git, terminals, Docker…) runs **where the resources
are**: a WSL terminal or WSL Docker runs inside WSL, natively. Adding a tool
means adding a module, not a new transport.

### Modules (the "more things")

- Compile-time modules for now: a Rust module in the agent plus a React feature
  folder, registered behind a namespace and a capability flag.
- The handshake reports which modules and versions an agent supports, so the UI
  hides features an older agent lacks.
- Runtime/third-party plugins (WASM) are a later decision. The namespaced
  protocol keeps that door open.

## WSL

1. The Windows installer bundles the Linux `debutuuru` binary (x86_64 musl).
2. On first use of a distro, the app copies it to
   `~/.local/share/debutuuru/bin/debutuuru-<version>` inside the distro. The
   versioned path means upgrades never break a running agent.
3. It also installs a shim at `~/.local/bin/debutuuru`, so `debutuuru .` works
   from a WSL shell. The shim forwards to the Windows app with the
   `\\wsl.localhost\…` path, or to the Linux app if one is installed and
   WSLg is preferred. Settings › WSL command installs the same agent + shim
   without opening a repo, and shows whether a new terminal finds it (the
   user's `$SHELL -il`, run under `setsid` + `timeout -k`). If `~/.local/bin`
   isn't on PATH, an explicit "Add to PATH" button appends one marked line to
   `~/.zshrc`, `~/.bashrc` or `~/.profile`. Only running distros are checked
   automatically, so opening Settings never boots a distro.
4. The app runs one `wsl.exe -d <distro> -e …/debutuuru agent --stdio` per
   distro and reuses it for every repo in that distro.

## Terminal launch and single instance

- Windows installer: the `debutuuru` CLI goes on PATH (`debutuuru .`, `debutuuru open <path>`).
- Linux packages: `/usr/bin/debutuuru`.
- `tauri-plugin-single-instance`: a second launch hands its path to the running
  app, which opens it in a **new tab** instead of a new window.

## Git authentication

- Always uses the user's existing setup (ssh keys, ssh-agent, Git Credential
  Manager). The app never stores secrets.
- Remote operations run with `GIT_ASKPASS` / `SSH_ASKPASS` pointing to the
  agent's own executable (the desktop app for host repos, the agent binary in
  WSL), plus `SSH_ASKPASS_REQUIRE=force`. Started that way, the binary only
  forwards the prompt to the agent and prints the answer. This works the same
  inside WSL.
- Fetch, pull and push stream progress and can be cancelled.

## Versioning

| What | How |
| --- | --- |
| Product | One SemVer version for the workspace. Conventional Commits → release-plz Release PR → tag `vX.Y.Z` → installers. |
| App ↔ agent | `PROTOCOL_VERSION` in the handshake. On mismatch the app deploys its own matching agent build. Protocol changes are additive within a major version. |
| UI ↔ Rust | TS types generated from Rust (ts-rs/specta) and checked in CI, so drift fails the build. |
| Settings / workspaces | `schema_version` in every stored file, with ordered migrations and a backup before migrating. |
| Updates | `tauri-plugin-updater` with signed update manifests (signing key in CI secrets). |
| Windows trust | Code-sign the installer (needs a certificate, decided later). Without it, SmartScreen warns. |
| Git | Minimum supported version checked at startup, with a clear message. |

## UI

- React + Vite + TypeScript, one feature folder per module.
- Commit graph: paginated log from the agent, virtualized list
  (TanStack Virtual), graph rows drawn on canvas/SVG per visible row.
- Tabs for repos, which can mix Windows and WSL repos.

## Roadmap

| Phase | Delivers |
| --- | --- |
| 0. Foundation | Workspace restructure (protocol, agent), React/Vite app, generated TS types, CI with Node, CLAUDE.md. |
| 1. Git MVP | Open local and WSL repos through agents, virtualized graph, branches, worktrees, status/stage/commit/diff, auto-refresh, single instance + tabs, `debutuuru .` on Windows/Linux/WSL. |
| 2. Remotes | Fetch, pull and push with askpass dialogs, progress and cancel. |
| 3. Distribution | Installers bundling the Linux agent, updater, settings migrations, first public release. |
| 4. Modules | Terminals + task runner, GitHub/GitLab, containers and services, each as an agent module and a UI feature. |
