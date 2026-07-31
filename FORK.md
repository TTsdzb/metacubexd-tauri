# Fork notes

This fork replaces metacubexd's Electron desktop app with a Tauri shell that
runs the upstream dashboard against a **user-managed** Mihomo kernel — on this
machine or another host on the LAN. It does not bundle, supervise, or configure
a kernel.

## What changed

- `apps/tauri` — new: the Tauri v2 shell plus a transport shim that replaces
  `fetch` and `WebSocket` with native, CORS-free implementations for
  cross-origin traffic. A local Tauri plugin injects it via `js_init_script`,
  so `packages/ui` needs no changes.
- `pnpm-workspace.yaml`, `package.json`, `pnpm-lock.yaml`, `.gitignore` —
  `apps/desktop` and `apps/server` are excluded from the workspace. Their files
  are untouched on disk so upstream commits that edit them still merge cleanly.
  The root scripts that filtered on them are gone, and every dependency version
  now comes from the single `catalog:` in `pnpm-workspace.yaml`.
- `CLAUDE.md` — describes the narrowed workspace.
- `packages/ui`, `packages/agent`, `packages/config-editor` — unmodified.

With no Control Agent reachable, the dashboard runs in hosted-panel mode: every
kernel-management surface hides itself. That is the intended behavior here.

## Commands

```bash
pnpm install
pnpm dev:tauri    # Nuxt dev + Tauri window, with HMR
pnpm build:tauri  # release bundle in apps/tauri/src-tauri/target/release/bundle
pnpm dev          # plain browser dev, no Tauri
```

Both Tauri scripts run `node apps/tauri/build-shim.mjs` first, which bundles
`apps/tauri/shim/` into `apps/tauri/src-tauri/shim.js`. The release build's
frontend comes from `tauri.conf.json`'s `beforeBuildCommand`, which invokes the
UI's own `generate:desktop` script (relative base URL, PWA disabled) rather than
plain `nuxt generate`.

## Merging upstream

```bash
git remote add upstream https://github.com/MetaCubeX/metacubexd.git   # once
git fetch upstream
git merge upstream/main
```

Conflicts should be confined to `pnpm-workspace.yaml`, `package.json`,
`pnpm-lock.yaml`, `.gitignore`, and `CLAUDE.md`. Everything this fork adds lives
in new paths. Regenerate the lockfile with pnpm rather than resolving it by
hand.

After a merge that touched `packages/ui`, run `pnpm --filter @metacubexd/tauri
test` — 6 spec files, 74 tests. Those specs encode what the shim assumes about
the dashboard — the `window.metacubexd` bridge shape, `event.data` carrying JSON
text, the `-webkit-app-region` title bar — so they are what catches an upstream
change that breaks the shell.

## Platform support

Linux is what is built and smoke-tested today: `pnpm build:tauri` produces a
`.deb` and an `.rpm`. The AppImage target is configured but may not build on a
rolling-release host — `linuxdeploy` ships an old `strip` that rejects the
`.relr.dyn` sections in current system libraries and exits non-zero. That is a
toolchain limitation, not a config one; use
`pnpm --filter @metacubexd/tauri exec tauri build --bundles deb` locally and
leave `"targets": "all"` alone, since that setting is what will give the Windows
and macOS runners their bundles.

The scaffold deliberately keeps every other Tauri target reachable, roughly in
this planned order:

1. GitHub Actions release workflow;
2. Windows and macOS bundles (`"targets": "all"` already covers them);
3. **Android** — `tauri android init`, then `tauri android dev`.

Nothing under `src-tauri/` should be deleted for being unused on Linux. The
`lib.rs`/`main.rs` split, `#[cfg_attr(mobile, tauri::mobile_entry_point)]`, the
`[lib] crate-type` list (`staticlib` for iOS, `cdylib` for Android), the
`icons/android` mipmaps, and the `cfg`-gated `tauri-plugin-window-state` all
exist for those milestones. Desktop-only additions belong behind
`#[cfg(desktop)]`.

The title bar is already handled: the bridge's `isDesktop` comes from Rust's
`cfg!(desktop)`, so an Android build reports false and `useDesktop()` renders
neither the desktop title bar nor its window controls.

Also not done: tray icon, launch-at-login (both desktop-only).

## Known limitations

### WebSocket connections leak on reload

Reloading the window orphans its four Clash API sockets on the Rust side.
`tauri-plugin-websocket` removes a connection from its `ConnectionManager` only
on a clean `Ok(Message::Close(_))`, and its read loop discards the channel-send
error, so when the document tears down the JS adapters die while the Rust
connections keep reading from Mihomo. `useWebSocket.ts` relies on
`onScopeDispose`, which does not fire on document teardown.

Each reload strands four connections, one of which pulls the full connection
table every second. Harmless in a short session, accumulating over a long one —
and most visible under `tauri dev`, where HMR reloads constantly. Fixing it
needs a registry of live adapters in `shim/websocket.ts` plus a `pagehide` hook
in `install()`; the open question is whether the resulting async IPC even
completes during teardown, so the fix may be best-effort rather than complete.
Deliberately deferred, not overlooked.

### A latent window-state hazard: never set `"visible": false`

`tauri-plugin-window-state` persists `visible: false` whenever the app is quit
while the window is minimized or hidden — `NSWindow.isVisible` returns false for
both on macOS — and `restore_state` never calls `show()` when the saved state
says hidden. The result is an app that starts with no window at all.

This is inert today: the window is created visible from `tauri.conf.json` and
nothing in `lib.rs` calls `hide()`. It matters because the obvious fix for the
launch geometry jump (the window paints at its configured size before the plugin
restores the saved geometry) is to declare `"visible": false` in the window
config and show it after restore. **Do not add that flag without also adding an
unconditional `show()` after `restore_state`**, or a single quit-while-minimized
makes the app unlaunchable until its state file is deleted.

### `src-tauri/shim.js` is generated and gitignored

`shim.rs` embeds the bundled shim with `include_str!("../shim.js")`, but that
file is generated by `build-shim.mjs` and is gitignored. A fresh clone therefore
cannot run `cargo build` or `cargo check` directly inside `apps/tauri/src-tauri/`
— it fails at macro expansion with a missing-file error. Run

```bash
pnpm --filter @metacubexd/tauri build:shim
```

first. The `dev` and `build` package scripts already do this, so only direct
`cargo` invocations and any future CI job that calls `cargo` need to care.
