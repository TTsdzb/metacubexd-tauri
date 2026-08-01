# AGENTS.md

This repository is a fork of `MetaCubeX/metacubexd`. The fork keeps the
dashboard panel and ships it through Tauri. It deliberately avoids the Electron
desktop app and the Nitro/server distribution channels, while keeping those
upstream-owned files on disk so upstream merges stay cheap.

## Read First

- `FORK.md` is the authoritative fork-maintenance note: Tauri behavior, merge
  routine, release process, and known limitations.
- `CONTEXT.md` defines project language. Use terms such as Hosted Panel, Clash
  API, Control API, Kernel, Profile, Proxy Node, and TUN consistently.
- `packages/ui/PRODUCT.md` and `packages/ui/DESIGN.md` describe product and UI
  expectations for dashboard work.
- `docs/superpowers/specs/` and `docs/superpowers/plans/` preserve prior design
  decisions. Treat them as historical design context; verify against the current
  tree before applying a step literally.
- `CLAUDE.md` is useful background but may contain stale references after this
  fork's Tauri and CI work. Prefer this file plus `FORK.md` for Codex tasks.

## Current Workspace

`pnpm-workspace.yaml` includes only:

- `packages/ui` - Nuxt 4 / Vue 3 dashboard.
- `packages/agent` - framework-neutral Control API and managed-kernel logic.
  It remains a workspace package because `packages/*` is still included, even
  though this Tauri fork does not ship a bundled Control Agent.
- `packages/config-editor` - YAML config document model used by UI/agent code.
- `apps/tauri` - fork-owned Tauri v2 shell and injected transport/window shim
  for desktop bundles and the personal Android APK.

`apps/desktop` and `apps/server` are intentionally still present on disk but are
not workspace members. Do not wire new work to them unless the user explicitly
asks to revisit the old Electron/server forms.

## Common Commands

Run commands from the repository root.

```bash
pnpm install
pnpm dev                 # UI only; browser talks to an existing Mihomo
pnpm dev:tauri           # Nuxt dev server + Tauri window
pnpm dev:android         # Android device/emulator dev shell
pnpm build:ui            # Nuxt static output
pnpm build:tauri         # Tauri release build
pnpm build:android       # signed Android release APK
pnpm build               # alias for build:tauri
pnpm typecheck           # all workspace packages
pnpm lint                # all workspace packages; runs eslint --fix in UI
```

Focused verification:

```bash
pnpm --filter @metacubexd/ui test:unit
pnpm --filter @metacubexd/ui test:e2e
pnpm --filter @metacubexd/agent test
pnpm --filter @metacubexd/config-editor test
pnpm --filter @metacubexd/tauri test
pnpm --filter @metacubexd/tauri build:shim
pnpm build:android
cargo check --manifest-path apps/tauri/src-tauri/Cargo.toml
```

`apps/tauri/src-tauri/shim.js` is generated and gitignored. Any direct Rust
compile/check that touches `shim.rs` needs
`pnpm --filter @metacubexd/tauri build:shim` first.

## Fork Architecture

The Tauri shell serves the upstream dashboard against a user-managed Mihomo
kernel. It does not bundle, supervise, or configure a kernel.

`apps/tauri/shim/` is bundled into a dependency-free IIFE and injected by a local
Tauri plugin through `js_init_script`, before app code runs. The shim:

- routes same-origin or relative `fetch`/`WebSocket` traffic through the native
  webview implementation, preserving Nuxt assets, `config.js`, and dev HMR;
- routes cross-origin HTTP/WebSocket traffic through Tauri plugins so the panel
  can talk to LAN/loopback Mihomo APIs without browser CORS or mixed-content
  restrictions;
- publishes `window.metacubexd.window` enough for the existing title bar and
  window controls;
- emulates title-bar dragging and edge resizing for the frameless Tauri window.

The bridge intentionally omits managed-runtime fields such as `control`,
`endpoint`, `settings`, and `hotkeys`. With no Control Agent available, UI
surfaces that require those capabilities should hide as Hosted Panel behavior.

## Editing Rules

- Keep changes scoped to the package that owns the behavior.
- Prefer leaving upstream-owned files untouched, especially `packages/ui`, unless
  the requested change genuinely belongs there.
- Do not delete `apps/desktop`, `apps/server`, or generated-looking Tauri
  scaffold pieces just because they are not active in the Linux desktop path.
  The fork keeps upstream files for merge hygiene and keeps Tauri mobile-ready
  pieces for Android support and future iOS work.
- Do not hand-edit generated output: `.nuxt/`, `.nitro/`, `.output/`,
  `packages/ui/.output/`, `apps/tauri/src-tauri/shim.js`, or
  `apps/tauri/src-tauri/target/`.
- Do not hand-edit `pnpm-lock.yaml`; regenerate it with pnpm.
- Do not edit `CHANGELOG.md`; release-please/upstream owns it.
- Add dependency versions only to the root `catalog:` in `pnpm-workspace.yaml`
  and reference them with `catalog:` from package manifests.
- All user-facing UI text goes through i18n locale JSON files. Add keys to every
  bundled locale.
- `pnpm lint` can rewrite files via `eslint --fix`; inspect its changes before
  reporting completion.

## Tauri-Specific Cautions

- `apps/tauri/run-tauri.mjs` wraps the Tauri CLI and sets
  `__NV_DISABLE_EXPLICIT_SYNC=1` on Linux unless already set. Keep using the
  package scripts instead of calling the CLI directly for normal dev/build.
- `pnpm-workspace.yaml` sets `shellEmulator: true` so Windows can run the UI's
  POSIX-style `generate:desktop` env prefix from Tauri's `beforeBuildCommand`.
  Do not remove it casually.
- `bundle.targets` intentionally excludes AppImage. Linux releases use `.deb`,
  `.rpm`, and plain binaries.
- Keep `lib.rs`/`main.rs`, `#[cfg_attr(mobile, tauri::mobile_entry_point)]`,
  `[lib] crate-type`, generated icon sets, and desktop `cfg` gates intact.
  They preserve Android and future iOS reachability.
- Keep Android signing material private. `Keystore.jks` and
  `apps/tauri/src-tauri/gen/android/keystore.properties` must not be committed.
- Title-bar dragging depends on shim logic reading Vue-applied
  `-webkit-app-region` state. Re-check manually after major Vue/WebKit/Tauri
  upgrades.
- WebSocket connections can leak on reload because the upstream Tauri websocket
  plugin only retires clean close frames. See `FORK.md` before attempting a
  teardown fix.

## CI And Releases

CI is fork-owned:

- `unit-tests.yml` runs JS suites, including the Tauri shim tests.
- `e2e.yml` remains the upstream UI Playwright workflow.
- `verify-tauri.yml` typechecks and compiles a Linux Tauri build.
- `release-tauri.yml` builds desktop artifacts and signed Android APKs from
  `tauri-v*` tags, then a dedicated publish job creates the draft GitHub Release.
- `publish-stable-tauri.yml` publishes that draft after a successful stable-tag
  run. Tags with a suffix, such as `-rc1`, remain drafts.
- `stale.yml` is manual-only.

Upstream `.github/workflows/release.yml` was deleted because it published to
upstream-owned Docker and web channels. If an upstream merge reports a
modify/delete conflict for that workflow, keep the deletion unless the release
strategy is being redesigned.
