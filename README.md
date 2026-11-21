# Debutuuru

A desktop toolbox for developers, written in Rust (Tauri 2 + React). It starts
as a git client in the spirit of GitKraken and grows into terminals, a task
runner, GitHub/GitLab integration, containers and more.

- **Windows + WSL**: install on Windows and work on Windows repos *and* repos
  inside WSL at native speed. A small Debutuuru agent runs inside WSL, the same
  idea as VS Code's WSL server. It is installed automatically the first time
  you open a WSL repo, along with a `debutuuru` command in that distro. To use
  `debutuuru .` in a WSL terminal before that, install the command from
  Settings › WSL command (it can also add `~/.local/bin` to your PATH).
- **Live**: the app refreshes itself when files, the index or branches change,
  including inside WSL.
- **Linux**: install natively, or run the Linux build inside WSL with WSLg.
- **Terminal-friendly**: `debutuuru .` from PowerShell, cmd, bash or WSL. The
  Windows installer puts the command on your PATH (open a new terminal after
  installing).
- **Worktree-aware**: open a main repo or any linked worktree.
- **Files**: browse the file tree and read any file (syntax highlighting,
  search), as it is now with changes marked, or at any commit (double-click it
  in History). Ignored files are hidden unless you ask for them.
- **Yours**: dark themes generated from base + accent + contrast (WCAG-checked),
  Warp-style background images, fonts and density (Ctrl+,). See
  [docs/DESIGN.md](docs/DESIGN.md).

Status: **Phase 2** is done. Local and WSL repos open in tabs with graph,
branches, worktrees, stage/commit/diff, auto-refresh, and fetch/pull/push.
Your SSH setup is used as-is: passwordless keys and ssh-agent just work, and
passphrases or unknown host keys are asked for in an in-app dialog. Keys that
live only in WSL can also be used for Windows repos (Settings › Git & SSH).
Next is Phase 3: installers and updates. See the roadmap in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

```bash
debutuuru .                                 # open this repo (Windows, Linux or WSL shell)
debutuuru '\\wsl.localhost\Ubuntu\home\me\app'
```

## Develop

Requirements: Rust stable, Node (version in `.node-version`; fnm/nvm read it),
git. Linux also needs `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev`.
Windows needs WebView2 (preinstalled on Windows 11).

```bash
cd apps/desktop && npm ci && cd ../..
cargo test --workspace            # tests + regenerate TS bindings
cd apps/desktop && npm run tauri dev
```

CLI:

```bash
cargo run -p debutuuru -- info .
cargo run -p debutuuru -- log . -n 20
cargo run -p debutuuru -- agent --stdio   # what the app starts inside WSL
```

## Docs

- [Architecture and roadmap](docs/ARCHITECTURE.md)
- [Versioning and releases](docs/VERSIONING.md)
- [Contributor / AI assistant notes](CLAUDE.md)

## License

MIT
