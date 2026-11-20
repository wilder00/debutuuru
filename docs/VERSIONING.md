# Versioning and releases

Debutuuru uses **Semantic Versioning** for the whole product. The CLI, the core
library and the desktop app share one version, defined once in
`[workspace.package]` in the root `Cargo.toml`.

## Commit messages (Conventional Commits)

| Prefix | Effect (while < 1.0) | Effect (>= 1.0) |
| --- | --- | --- |
| `fix:` | patch | patch |
| `feat:` | patch | minor |
| `feat!:` / `BREAKING CHANGE:` | minor | major |
| `docs:`, `chore:`, `refactor:`, `test:`, `ci:` | no release | no release |

## Flow

1. Merge work into `main` using Conventional Commit messages.
2. `release-plz` opens/updates a **Release PR** that bumps the version and
   writes `CHANGELOG.md`.
3. Merging that PR creates the tag `vX.Y.Z`.
4. The tag triggers `release.yml`, which builds Windows (MSI/NSIS) and Linux
   (deb/AppImage/rpm) installers plus standalone `debutuuru` CLI binaries and
   attaches them to the GitHub Release.

## One-time setup

- Create a fine-grained token (contents + pull requests: write) and store it as
  the repository secret `RELEASE_PLZ_TOKEN`. A token is needed because tags
  pushed with the default `GITHUB_TOKEN` don't trigger other workflows.
- The first release-plz run should be reviewed by hand: the lockstep workspace
  version is configured in `release-plz.toml`, and its behaviour with
  `version.workspace = true` should be confirmed on the first Release PR.
