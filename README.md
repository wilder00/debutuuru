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
- **Folders of repositories**: open a folder that holds several repos or
  worktrees (say, one folder per ticket with a worktree of each project) and
  they open together as a group of tabs with the folder's name; collapse or
  close the group in one click, and reopen it from Recent. Same-named repos
  show their parent folder (`ssr-site · NED-2550`).
- **Files**: browse the file tree and read any file (syntax highlighting,
  search), as it is now with changes marked, or at any commit (double-click it
  in History). Ignored files are hidden unless you ask for them. **Changes**
  shows the open file's diff and says what it compares: your uncommitted
  edits against HEAD, or, when there are none, the last commit that changed
  the file against the one before.
- **Focus**: hide the left panel (Ctrl+B), the changes panel (Ctrl+Alt+B) or
  both, from the title bar or the palette.
- **Open anything**: Open folder or file (Ctrl+O) with the system dialog,
  Browse in WSL on Windows, drag and drop folders or files onto the window,
  and a list of recent repositories.
- **Quick open and commands**: Ctrl+P finds any file of the repo by a few
  letters of its name; Ctrl+Shift+P runs commands (fetch, pull, push, switch
  branch, change theme or language…), like in VS Code.
- **Code navigation**: Ctrl+click an import (TS/JS, CSS, Rust, Go, Python,
  C/C++, Markdown and HTML links) to open that file; Alt+← goes back.
- **Markdown**: READMEs and docs render like on GitHub (tables, task lists,
  alerts, math, Mermaid diagrams), with a switch to the source.
- **Diffs**: click a commit to see the files it changed and their diffs; the
  same viewer shows staged and unstaged changes. Unified, side by side or the
  whole file, with changed words highlighted, syntax colors, ignore
  whitespace and adjustable context.
- **Branches**: select several (Ctrl+click, Shift+click) and right-click to
  delete them. Before anything happens it tells you, per branch, whether
  work would be lost (commits that exist only there, with the command to
  bring the branch back), what isn't pushed, what can't be deleted (checked
  out here or in another worktree), and whether the copy on the remote goes
  too, which affects everyone.
- **Tags**: a Tags section lists them newest first; click one to see whether
  it's annotated or lightweight, signed, who tagged it, its message and its
  commit's changes. Create one on any commit (annotated or lightweight, and
  push it right away), push it, delete it locally or on the remote, or check
  it out.
- **Terminal**: Ctrl+` opens a terminal panel with tabs, or the whole window
  for just the terminal. Profiles for PowerShell, cmd, Git Bash and every WSL
  distro are found automatically, and you can add your own; tabs show the
  shell's icon and can be renamed (double-click). Colors follow the theme.
- **Updates**: the app tells you when a new version is out and installs it
  with one click (signed, verified before installing).
- **Languages**: English, Spanish, Japanese and Korean. It follows your
  system language, or pick one in Settings.
- **Yours**: dark themes generated from base + accent + contrast (WCAG-checked),
  Gamer (neon glow, RGB bars) and Circuit (electric blue-green gradient,
  carbon texture, circuit traces) styles with themes made for them,
  Warp-style background images, fonts and density (Ctrl+,). See
  [docs/DESIGN.md](docs/DESIGN.md).

Status: **Phase 2** is done. Local and WSL repos open in tabs with graph,
branches, worktrees, stage/commit/diff, auto-refresh, and fetch/pull/push.
Your SSH setup is used as-is: passwordless keys and ssh-agent just work, and
passphrases or unknown host keys are asked for in an in-app dialog. Keys that
live only in WSL can also be used for Windows repos (Settings › Git & SSH).
Phase 3 (installers, `debutuuru` on PATH, in-app updates) is in progress. See the roadmap in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

```bash
debutuuru .                                 # open this repo (Windows, Linux or WSL shell)
debutuuru '\\wsl.localhost\Ubuntu\home\me\app'
```

## Develop

Requirements: Rust stable, Node (version in `.node-version`; fnm/nvm read it),
pnpm (version pinned in `apps/desktop/package.json`; `corepack enable` picks it
up), git. Linux also needs `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev`.
Windows needs WebView2 (preinstalled on Windows 11).

```bash
cd apps/desktop && pnpm install && cd ../..
cargo test --workspace            # tests + regenerate TS bindings
cd apps/desktop && pnpm tauri dev
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
