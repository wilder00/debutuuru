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

## Branches

| Branch | Workflows on push | Use |
| --- | --- | --- |
| `develop` | none | Day-to-day commits. Pushing here never runs CI or releases. |
| PR `develop` → `main` | CI (tests) | The gate before anything reaches `main`. |
| `main` | CI + Release PR | Only receives merges from `develop` (and the release PR). |
| tag `vX.Y.Z` | Release (installers) | Created by merging the release PR. |

The workflow triggers enforce this (`ci.yml`: push to `main` + pull requests;
`release-plz.yml`: push to `main`; `release.yml`: `v*` tags). Merge
`develop` → `main` with a **merge commit** (not squash), so release-plz still
sees each Conventional Commit for the changelog.

## Flow

1. Commit on `develop`; when ready, open a PR `develop` → `main` and merge it.
2. `release-plz` opens/updates a **Release PR** that bumps the version and
   writes `CHANGELOG.md`. Nothing is published to crates.io (`git_only`): the
   previous version comes from the `vX.Y.Z` git tags, and with no tag yet the
   current version is the initial release.
3. Merging that PR creates the tag `vX.Y.Z` (`release_always = false`: pushes
   to `main` alone never tag).
4. The tag triggers `release.yml`, which builds Windows (MSI/NSIS) and Linux
   (deb/AppImage/rpm) installers plus standalone `debutuuru` CLI binaries and
   attaches them to the GitHub Release, together with a `.sig` per installer
   and `latest.json` for the in-app updater.
5. Installed apps find the new version in
   `releases/latest/download/latest.json` (on start, or Settings › Updates),
   verify the signature with the public key built into them, and install the
   same bundle type they were installed with.

## One-time setup

- Create a fine-grained token (contents + pull requests: write) and store it as
  the repository secret `RELEASE_PLZ_TOKEN`. A token is needed because tags
  pushed with the default `GITHUB_TOKEN` don't trigger other workflows.
- Updater signing key: `pnpm --dir apps/desktop exec tauri signer generate -w ~/.tauri/debutuuru.key`
  (run by the maintainer, never by CI). Store the private key's content as
  `TAURI_SIGNING_PRIVATE_KEY` and its password as
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; the public key goes in
  `apps/desktop/src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). Keep a
  backup of the private key: without it, installed apps can't be updated
  anymore. Only release builds sign (`tauri.release.conf.json`), so local
  `tauri build` needs no key.
- The first release-plz run should be reviewed by hand: the lockstep workspace
  version is configured in `release-plz.toml`, and its behaviour with
  `version.workspace = true` should be confirmed on the first Release PR.
