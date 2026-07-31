# CI and Multi-platform Releases — Design

Date: 2026-07-31
Status: Approved

## Goal

Give the fork continuous verification and a way to publish installers for Linux,
Windows, and macOS from a tag — without inheriting upstream's distribution
channels or making upstream merges any harder.

Follows the Tauri shell, which is merged and smoke-tested
(`docs/superpowers/specs/2026-07-30-tauri-dashboard-design.md`).

## Constraints

1. **Upstream merges stay cheap.** Same constraint as the shell work. Nothing
   this design adds may write to a file upstream rewrites every release —
   specifically `CHANGELOG.md`, the root `package.json` version, or
   `packages/ui/package.json`.
2. **`packages/ui` stays byte-for-byte upstream.** Unchanged from the previous
   milestone.
3. **Artifacts are unsigned.** macOS notarization needs a paid Apple Developer
   account and Windows code signing needs a purchased certificate. Neither
   exists. Both are addable later without redesign — see "Deferred".

## Decisions

| Question                | Decision                                        | Rationale                                                                                                                                                                                  |
| ----------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| What CI produces        | Verification on every push; installers on a tag | Docker images, gh-pages, and the Homebrew cask are upstream's channels, publishing to namespaces this fork does not own.                                                                   |
| Release trigger         | Manual `tauri-v*` tag                           | release-please would write `CHANGELOG.md` and two `package.json` versions, all of which upstream rewrites every release — conflicts on every merge, forever.                               |
| Tag namespace           | `tauri-v*`, not `v*`                            | Upstream's tags arrive in the same repo via `git fetch upstream`. A shared namespace makes collisions and confusing `git describe` output possible.                                        |
| Version source of truth | The tag; CI overrides the build                 | Otherwise a `tauri-v0.1.0` tag would emit `MetaCubeXD_1.270.6_amd64.deb`, because `tauri.conf.json` carries the dashboard's version.                                                       |
| macOS target            | `universal-apple-darwin`                        | One `.dmg` for both Apple Silicon and Intel. Two arch-specific files would force a choice where the wrong pick fails confusingly.                                                          |
| Linux runner            | `ubuntu-22.04`, pinned                          | The runner's glibc sets the floor for which distros can run the artifacts. It also has binutils old enough that AppImage builds without `NO_STRIP`, so CI artifacts are properly stripped. |
| Inherited `release.yml` | Deleted                                         | Superseded, and 309 lines that publish to `ghcr.io/metacubex/*` and `d.metacubex.one` are a trap, not a resource.                                                                          |

## Workflows

### `verify.yml` — push to `main`, and pull requests

1. `pnpm install`
2. `pnpm typecheck` (all four workspace members)
3. `pnpm --filter @metacubexd/tauri test`, plus the agent and config-editor suites
4. **A Linux Tauri build.**

Step 4 is the one that earns its keep. The test suites never compile Rust, so
without it a broken `capabilities/default.json`, a bad `include_str!`, or a
Cargo dependency that stops resolving surfaces only when you cut a release.

### `release-tauri.yml` — `tauri-v*` tags

1. Derive the version from the tag: `tauri-v0.1.0` → `0.1.0`.
2. Run the same verification as `verify.yml` in a gate job. A tag that fails
   the suite must not publish.
3. Matrix-build with `tauri-apps/tauri-action`, which builds and uploads to a
   GitHub Release on this repo.

| Runner           | Bundles                     |
| ---------------- | --------------------------- |
| `ubuntu-22.04`   | `.deb`, `.rpm`, `.AppImage` |
| `windows-latest` | `.msi`, NSIS `.exe`         |
| `macos-latest`   | `.dmg`, `.app` (universal)  |

The release is created as a **draft** so release notes can be written before it
goes public.

## Versioning

The tag is authoritative. CI passes `--config '{"version":"<from tag>"}'` to
`tauri build`, so artifact filenames always match the tag that produced them.

The checked-in versions become a local-build default only. `tauri.conf.json`
currently says `1.270.6` (the dashboard's version) while `Cargo.toml` says
`0.1.0`; both are set to `0.1.0`. The shell's version has no meaningful
relationship to the dashboard's, and `apps/tauri` is entirely fork-owned, so
changing it costs nothing at merge time.

Nothing in this design ever writes a version back into the repository. Bumping
is a manual edit when you decide to tag.

## Platform prerequisites

- **Linux**: `libwebkit2gtk-4.1-dev`, `librsvg2-dev`, `patchelf`,
  `build-essential` installed on the runner.
- **macOS**: both `aarch64-apple-darwin` and `x86_64-apple-darwin` Rust targets
  added before building universal.
- **Windows**: nothing beyond the default toolchain.

All three cache the Cargo registry and `target/` (`Swatinem/rust-cache`), keyed
per runner.

## The sequencing trap

`apps/tauri/src-tauri/shim.js` is gitignored and embedded with `include_str!`,
so a fresh clone cannot compile until it is generated. `tauri-action` invokes
`tauri build` directly rather than this repo's `pnpm build` script — and that
script is what runs the bundler.

**Every job that compiles Rust must run
`pnpm --filter @metacubexd/tauri build:shim` first.** Without it, all three
matrix legs fail identically at compile time with a missing-file error that
points at Rust rather than at the real cause.

This is the CI form of the trap that would have made `tauri init` silently
no-op during the shell work: a generated artifact that local scripts create
implicitly and CI does not.

## Inherited workflows

| File             | Disposition                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `release.yml`    | Deleted. Superseded by `release-tauri.yml`.                                                |
| `unit-tests.yml` | Fixed: drop the two `--filter` lines that silently no-op, add the Tauri suite.             |
| `e2e.yml`        | Untouched. It still tests `packages/ui` and should keep receiving upstream's improvements. |
| `stale.yml`      | Trigger narrowed to `workflow_dispatch`. It manages upstream's issue tracker.              |

`release-please-config.json` loses its `apps/desktop/package.json` entry.
release-please itself stays unrun, since `release.yml` was its only trigger.

Note `pnpm --filter` **exits 0 when nothing matches**, which is why the dead
lines in `unit-tests.yml` were silently passing rather than failing loudly.

## Verification

Workflows cannot be unit-tested, so verification is staged:

1. `actionlint` over the new files, to catch syntax and expression errors before
   pushing.
2. A `tauri-v0.0.1-rc1` tag as a live-fire test. All three legs must produce
   artifacts, and the tag must be deletable afterwards without leaving a
   published release behind — hence the draft release.
3. Downloading and launching at least the Linux artifact from that test release.

## Deferred

- **Android.** The scaffold keeps it reachable (`mobile_entry_point`, the
  `[lib]` crate types, the `icons/android` mipmaps). It needs its own signing
  keystore and an SDK/NDK setup on the runner, which is a separate milestone.
- **Code signing and notarization.** `tauri-action` accepts the certificates and
  Apple credentials as secrets, so adding them later is configuration rather
  than redesign. Until then, users see a Gatekeeper warning on macOS and a
  SmartScreen warning on Windows; the workarounds belong in `FORK.md`.
- **Docker images, gh-pages, the Homebrew cask.** Upstream's channels. Revisit
  only if this fork ever intends to distribute a hosted panel.

## Risks

| Risk                                                                         | Mitigation                                                                                                                                 |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| A matrix leg fails only on its own OS, discovered at release time            | The verify workflow builds Linux on every push; Windows and macOS are still first exercised at tag time. The RC tag is what de-risks this. |
| `tauri-action` version drift changing behavior                               | Pin it to a major version and note the pin in the workflow.                                                                                |
| Upstream adds a workflow that assumes the deleted `release.yml`              | Merge conflicts surface it. `FORK.md` records that CI is fork-owned.                                                                       |
| The universal macOS build failing for a Rust dependency without both targets | Surfaces on the first RC tag; the fallback is two arch-specific builds, which is a matrix edit rather than a redesign.                     |
