# Changelog

All notable changes are recorded here by release-plz from Conventional Commits.

## [Unreleased]

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
