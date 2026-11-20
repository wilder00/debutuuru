# Debutuuru

A desktop developer tool written in Rust (Tauri): a Git client in the spirit of
GitKraken, designed to grow into a broader toolbox for developers.

- Commit graph, branches, diff, stage/commit
- **Worktree-aware**: open the main repo *or* any linked worktree (where `.git`
  is a file, not a folder); all worktrees of the repo are listed in the sidebar
- **WSL-aware**: install on Windows and open repos on Windows *or* inside WSL
  (`\\wsl.localhost\<distro>\...`). Git for WSL repos runs inside the distro via
  `wsl.exe`, so it uses native Linux git. Or install on Linux directly.
- **Terminal-friendly**: `debutuuru open [path]` from PowerShell, bash or WSL

## Layout

| Path | What |
| --- | --- |
| `crates/debutuuru-core` | git/worktree/WSL/graph logic (no UI) |
| `crates/debutuuru-cli` | the `debutuuru` command |
| `apps/desktop` | Tauri app (`src-tauri` = Rust, `ui` = static HTML/JS, no Node needed yet) |
| `docs/VERSIONING.md` | versioning + release flow |

## Develop

```bash
cargo test --workspace
cargo run -p debutuuru -- info .          # inspect a repo
cargo run -p debutuuru-desktop -- .       # run the app on a repo
```

Linux needs `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev`. Windows needs the
WebView2 runtime (preinstalled on Windows 11).

## CLI

```
debutuuru open [path]        launch the desktop app
debutuuru info|status|log|branches|worktrees [path] [--json]
```

From WSL with only the Windows app installed, `debutuuru open` hands the repo
to `debutuuru-desktop.exe` as a `\\wsl.localhost\...` path. Set
`DEBUTUURU_DESKTOP` to point at a specific app binary.

## Versioning

SemVer + Conventional Commits, automated with release-plz. See
[docs/VERSIONING.md](docs/VERSIONING.md).

## License

MIT
