# Changelog

All notable changes are recorded here by release-plz from Conventional Commits.

## [Unreleased]

## [0.3.0](https://github.com/wilder00/debutuuru/compare/v0.2.0...v0.3.0) - 2026-11-23

### Added

- Ctrl+click a name in Files to go to its definition
- folder tab for loose files and file favorites
- choose how the changes panel lists files: list, path or tree

## [0.2.0](https://github.com/wilder00/debutuuru/compare/v0.1.2...v0.2.0) - 2026-11-23

### Added

- update a branch without switching to it, a log window and a UI dictionary
- select branches and delete them, knowing what it means first
- hide the side panels, and see a file's changes in Files
- open a folder of repositories as a group of tabs
- files and folders in Files show their own icons

### Fixed

- the app stops refreshing itself in a loop, and Markdown code blocks stop flickering
- terminals start in the open repository's folder with every profile
- an expanded staged or unstaged diff keeps the changed files beside it

### Other

- the app stays light while idle and refreshes less

## [0.1.2](https://github.com/wilder00/debutuuru/compare/v0.1.1...v0.1.2) - 2026-11-22

### Added

- see a commit's changes, and choose how diffs are shown
- the UI speaks English, Spanish, Japanese and Korean
- tags panel with details, create, push and delete
- quick open (Ctrl+P) and command palette (Ctrl+Shift+P)
- Ctrl+click an import to open the file, and rendered Markdown
- terminal panel with tabs, profiles and a terminal-only mode
- our own title bar on Windows, without the native one
- Circuit style, an electric blue-green look with circuit traces
- Gamer style with neon glow and RGB bars, and neon themes
- open folders and files with the system dialog, WSL browsing, drag and drop
- expand a diff or a commit's changes to the whole tab

### Fixed

- the background image shows evenly behind the side panels too
- menus stay open until a click outside or Esc
- checkboxes clearly show whether they're checked

### Other

- settings tests remove their temp folders when they end
- document merging main back after a release and drop stale settings

## [0.1.1](https://github.com/wilder00/debutuuru/compare/v0.1.0...v0.1.1) - 2026-11-21

### Added

- in-app updates from GitHub releases
- Windows installers put the debutuuru command on PATH
- browse the file tree and file contents, in the working tree or at any commit
- fetch, pull and push respecting the user's SSH setup
- WSL agents, live auto-refresh, single instance with repo tabs
- agent architecture, React UI and personalizable design system
- install the debutuuru command in WSL distros from Settings

### Fixed

- PATH helpers no longer fail the Linux build as dead code
- WSL launcher builds on Linux without an unused-mut error
- Pull and Push menus open above the commit graph
- result messages, git output and prompt text can be selected and copied

### Other

- give test repos a local git identity so CI runners without one pass
- initial prototype and architecture proposal
- updater public key for signed releases
- use pnpm instead of npm for the desktop UI
- release-plz counts UI-only commits through a debutuuru-ui marker package

## [0.1.0](https://github.com/wilder00/debutuuru/releases/tag/v0.1.0) - 2026-11-20

### Added

- fetch, pull and push respecting the user's SSH setup
- WSL agents, live auto-refresh, single instance with repo tabs
- agent architecture, React UI and personalizable design system

### Fixed

- result messages, git output and prompt text can be selected and copied

### Other

- give test repos a local git identity so CI runners without one pass
- initial prototype and architecture proposal
