# Versioning and releases

Debutuuru uses **Semantic Versioning** for the whole product. The CLI, the core
library and the desktop app share one version, defined once in
`[workspace.package]` in the root `Cargo.toml`.

## Commit messages (Conventional Commits)

| Prefix | Effect (while < 1.0) | Effect (>= 1.0) |
| --- | --- | --- |
| `fix:` | patch (0.2.0 → 0.2.1) | patch |
| `feat:` | minor (0.2.1 → 0.3.0) | minor |
| `feat!:` / `BREAKING CHANGE:` | minor | major |
| `docs:`, `chore:`, `refactor:`, `test:`, `ci:` | no release | no release |

`feat:` bumps the minor version in 0.x too (`features_always_increment_minor`
in `release-plz.toml`). release-plz's default follows Cargo's 0.x rule, where
features only bump the patch because 0.x → 0.(x+1) is how crates signal a
breaking change to the crates that depend on them. Debutuuru publishes no
crates, and for an app a release with new features should read as one.
Releases up to 0.1.2 followed the default, so they bumped the patch even with
new features.

## Branches

| Branch | Workflows on push | Use |
| --- | --- | --- |
| `develop` | none | Day-to-day commits. Pushing here never runs CI or releases. |
| PR `develop` → `main` | CI (tests) | The gate before anything reaches `main`. |
| `main` | CI + Release PR | Only receives merges from `develop` (and the release PR). |
| tag `vX.Y.Z` | Release (installers) | Created by merging the release PR. |

The workflow triggers enforce this (`ci.yml`: push to `main` + pull requests;
`release-plz.yml`: push to `main`; `release.yml`: `v*` tags; `ship.yml`:
only run by hand). Merge
`develop` → `main` with a **merge commit** (not squash), so release-plz still
sees each Conventional Commit for the changelog.

## Flow

1. Commit on `develop`; when ready, run **Actions › Ship › Run workflow**
   (`ship.yml`). It opens the PR `develop` → `main` (or reuses the open one)
   with auto-merge on, so it merges with a merge commit once CI passes.
   Opening the PR by hand and pressing "Enable auto-merge" does the same.
2. `release-plz` opens/updates a **Release PR** that bumps the version and
   writes `CHANGELOG.md`, and turns on its auto-merge. Nothing is published
   to crates.io (`git_only`): the previous version comes from the `vX.Y.Z` git
   tags, and with no tag yet the current version is the initial release.
   Every merge of `develop` therefore becomes a release; to group several,
   turn off auto-merge on the Release PR and merge it later by hand.
3. Merging that PR creates the tag `vX.Y.Z` (`release_always = false`: pushes
   to `main` alone never tag).
4. The tag triggers `release.yml`. Releases are immutable once published
   (repo setting "Enable release immutability"), so it creates the release as
   a draft, every build uploads to it, and a last job checks that
   `latest.json` lists both platforms and publishes it. A failed build leaves
   the draft unpublished: re-run the failed jobs. It builds Windows (MSI/NSIS) and Linux
   (deb/AppImage/rpm) installers plus standalone `debutuuru` CLI binaries and
   attaches them to the GitHub Release, together with a `.sig` per installer
   and `latest.json` for the in-app updater.
5. Installed apps find the new version in
   `releases/latest/download/latest.json` (on start, or Settings › Updates),
   verify the signature with the public key built into them, and install the
   same bundle type they were installed with.
6. The release is merged back into `develop` (`release-plz.yml`, after
   tagging), so the next `develop` → `main` PR starts from the bumped version
   and `CHANGELOG.md` instead of conflicting with them. Pull it before
   committing again (`git pull` on `develop`). If that merge conflicts, the
   step fails; do it by hand:

   ```bash
   git switch develop && git pull
   git fetch origin && git merge origin/main
   git push origin develop
   ```

## One-time setup

- Create a fine-grained token (contents + pull requests: write) and store it as
  the repository secret `RELEASE_PLZ_TOKEN`. A token is needed because tags
  pushed and PRs opened with the default `GITHUB_TOKEN` don't trigger other
  workflows (the PR's CI would never run).
- Auto-merge: Settings › General › "Allow auto-merge" (and merge commits).
  A ruleset on `main`: require a pull request (0 approvals, merge method
  Merge only) and the status checks `test (ubuntu-latest)` and
  `test (windows-latest)`, without "require branches to be up to date".
  Without required checks auto-merge would not wait for CI.
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
