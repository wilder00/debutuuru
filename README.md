# Debutuuru

A desktop toolbox for developers, written in Rust (Tauri 2 + React). It starts
as a git client in the spirit of GitKraken and grows into terminals, a task
runner, GitHub/GitLab integration, containers and more.

- **Windows + WSL**: install on Windows and work on Windows repos *and* repos
  inside WSL at native speed. A small Debutuuru agent runs inside WSL, the same
  idea as VS Code's WSL server. *(WSL support lands in Phase 1.)*
- **Linux**: install natively, or run the Linux build inside WSL with WSLg.
- **Terminal-friendly**: `debutuuru open .` from PowerShell, bash or WSL.
- **Worktree-aware**: open a main repo or any linked worktree.
- **Yours**: dark themes generated from base + accent + contrast (WCAG-checked),
  Warp-style background images, fonts and density (Ctrl+,). See
  [docs/DESIGN.md](docs/DESIGN.md).

Status: **Phase 0 (foundation)** is done: agent architecture, protocol, React
UI, and a local git client (graph, branches, worktrees, stage/commit/diff).
See the roadmap in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

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
