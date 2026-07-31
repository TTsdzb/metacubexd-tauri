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

They also go through `apps/tauri/run-tauri.mjs` rather than calling the Tauri
CLI directly. See below.

### NVIDIA on Linux: the window dies at startup without this

On NVIDIA's proprietary driver under Wayland, a WebKitGTK window fails on
launch unless explicit sync is disabled:

```bash
__NV_DISABLE_EXPLICIT_SYNC=1
```

`run-tauri.mjs` sets it automatically on Linux, so `pnpm dev:tauri` and
`pnpm build:tauri` work on a fresh checkout with no shell setup. Only NVIDIA's
driver reads the variable, so it is inert on AMD, Intel, and every non-Linux
platform, and an already-exported value always wins if you need to override it.

Worth knowing if you go looking for a different fix: **Tauri does not force
X11.** Neither `tao`, `wry`, nor `tauri` sets `GDK_BACKEND` anywhere, so GTK
picks the backend itself and prefers Wayland whenever `WAYLAND_DISPLAY` is set.
"Switch to Wayland" is therefore not a remedy — a session that hits this bug is
already on Wayland, which is exactly why explicit sync is involved at all. The
opposite move is the real alternative: `GDK_BACKEND=x11` sidesteps explicit sync
entirely, at the cost of running through XWayland.

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
test` — 7 spec files, 95 tests. Those specs encode what the shim assumes about
the dashboard — the `window.metacubexd` bridge shape, `event.data` carrying JSON
text, the `-webkit-app-region` title bar — so they are what catches an upstream
change that breaks the shell.

## Platform support

Linux is what is built and smoke-tested today. `pnpm build:tauri` produces a
`.deb` and an `.rpm` (~7.8 MB each) with no special setup.

CI's Linux runner is pinned to `ubuntu-22.04` rather than `ubuntu-latest`, and
deliberately so: it sets the glibc floor for the resulting `.deb`/`.rpm`/
AppImage, and its binutils `strip` is old enough that the AppImage step builds
without the `NO_STRIP` workaround below. GitHub begins deprecating
`ubuntu-22.04` runners on 2026-09-17; migrating off it needs both of those
reasons re-checked against the newer image, not a blind version bump.

### AppImage needs `NO_STRIP=true` on a rolling-release host

```bash
NO_STRIP=true pnpm build:tauri
```

Without it the AppImage step fails and takes the whole build's exit code with
it:

```
ERROR: Strip call failed: .../strip: .../libzstd.so.1:
       unknown type [0x13] section `.relr.dyn'
failed to bundle project: `failed to run linuxdeploy`
```

`linuxdeploy` bundles an old binutils `strip` that does not understand the
`.relr.dyn` relocation sections current system libraries carry. `NO_STRIP` skips
that pass. Verified working here: it produces a runnable
`MetaCubeXD_<version>_amd64.AppImage`, where `<version>` is the Tauri shell's own
version (`apps/tauri/src-tauri/tauri.conf.json`, or the tag in CI) — the shell
is versioned independently of the dashboard now, so quoting a specific number
here would only go stale again.

Two things to know before reaching for it:

- **It costs size.** Skipping the strip pass leaves the bundled WebKitGTK
  libraries unstripped, which is most of why the AppImage lands at ~100 MB
  against the deb's 7.8 MB.
- **It keys on presence, not value.** `NO_STRIP=false` disables stripping just
  as `NO_STRIP=true` does — verified. There is no way to re-enable stripping
  from the environment once the variable is set, which is why it is left out of
  `run-tauri.mjs` rather than applied automatically. CI runners on older images
  do not need it and should not set it.

Leave `"targets": "all"` in `tauri.conf.json` alone — that setting is what will
give the Windows and macOS runners their bundles.

Two adjacent flags, since they are easy to confuse:

- `--bundles deb,rpm,appimage` picks which bundlers run. `--bundles appimage`
  retries just that one.
- `--no-bundle` skips bundling **entirely**. It does not produce an AppImage —
  it leaves the release binary at `apps/tauri/src-tauri/target/release/app`.
  Right flag for a runnable build without touching any bundler; wrong one if an
  AppImage is the goal.

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

## Releasing

CI is fork-owned. Upstream's `release.yml` was deleted — it published to
`ghcr.io/metacubex/*` and `d.metacubex.one`, neither of which this fork owns.

| Workflow            | Trigger        | Does                                            |
| ------------------- | -------------- | ----------------------------------------------- |
| `unit-tests.yml`    | push, PR       | Upstream's JS suites, plus the Tauri suite      |
| `e2e.yml`           | push           | Upstream's Playwright run against `packages/ui` |
| `verify-tauri.yml`  | push, PR       | `typecheck` and a real Rust build               |
| `release-tauri.yml` | `tauri-v*` tag | Builds and publishes installers                 |
| `stale.yml`         | manual only    | Upstream's issue bot; no longer on a cron       |

To cut a release:

```bash
# 1. Bump the local default (optional; CI takes the version from the tag)
#    apps/tauri/src-tauri/tauri.conf.json  ->  "version": "0.2.0"

# 2. Tag and push
git tag tauri-v0.2.0
git push origin tauri-v0.2.0
```

The workflow gates on the test suites, then builds on three runners and attaches
`.deb`/`.rpm`/`.AppImage`, `.msi`/`.exe`, and macOS's universal `.dmg` to a
**draft** GitHub Release — seven artifacts in total. `tauri-action` also
uploads the `.app` bundle itself as a tarball,
`MetaCubeXD_<version>_universal.app.tar.gz`, alongside the `.dmg`; that extra
file is expected, not a bug. Write the notes, then publish it.

A tag containing `-rc` is marked as a prerelease, so `tauri-v0.2.0-rc1` is the
way to exercise the pipeline without announcing anything.

Tauri's WiX bundler accepts only a numeric-only pre-release identifier, and
`-rc1` is not one, so `release-tauri.yml` sets `bundle.windows.wix.version` to
the tag's `major.minor.patch` prefix (`0.2.0`, not `0.2.0-rc1`) before building.
The `.msi` filename still carries the full tag. Skip that override and an `-rc`
tag fails the entire Windows leg.

**Versions are never written back into the repository.** The tag is the source
of truth, and CI patches `tauri.conf.json` in the runner only. That is
deliberate: release-please would have written `CHANGELOG.md` and two
`package.json` versions, every one of which upstream rewrites on its own
release schedule, and every one of which would then conflict on merge.

**Artifacts are unsigned.** macOS shows a Gatekeeper warning — right-click →
Open, or `xattr -d com.apple.quarantine /Applications/MetaCubeXD.app`. Windows
shows SmartScreen — More info → Run anyway. Adding signing later is
configuration on `tauri-action`, not a redesign.

**`pnpm-workspace.yaml` sets `shellEmulator: true`.** `packages/ui`'s
`generate:desktop` script uses a POSIX inline env-var prefix (`FOO=bar cmd`)
that `cmd.exe` cannot parse, and `tauri.conf.json` invokes that same script as
`beforeBuildCommand` on every platform, including the Windows runner. The
script is upstream-owned, so the fix belongs in the workspace config rather
than in `packages/ui`. Do not remove it.

### Stale references left in upstream-owned files

These are wrong for this fork but are **deliberately not edited**, because they
live in files upstream rewrites and touching them would buy a merge conflict for
no functional gain:

- `CONTRIBUTING.md` links to `.github/workflows/release.yml`, which this fork
  deleted, and still documents `pnpm dev:server` / `pnpm build:desktop` and lists
  `apps/server` / `apps/desktop` as workspace members.
- `.github/copilot-instructions.md` points at the same deleted workflow.
- `Casks/metacubexd.rb` installs `MetaCubeXD-mac-<arch>.dmg` from
  **upstream's** releases. It still resolves, so it silently installs upstream's
  Electron app rather than this fork's Tauri one. This fork's macOS artifact is
  `MetaCubeXD_<version>_universal.dmg`.
- `README.md`'s build badge queries upstream's `release.yml`, so it has never
  reflected this fork's CI status.
- `packages/ui/Dockerfile` and `apps/server/Dockerfile` are built by no workflow
  here.
- `release-please-config.json` still lists `packages/ui/package.json` under
  `extra-files`. It is inert — nothing triggers release-please — but it would
  write a version into a file upstream also rewrites. **Do not re-enable
  release-please** without revisiting the tag-driven model.

Also expect noise, not failure, from the codecov step in `unit-tests.yml`: this
fork likely has no `CODECOV_TOKEN`, and `verbose: true` makes that loud, but
`fail_ci_if_error: false` keeps the job green.

## Known limitations

### Closing the window orphans the Nuxt dev server

`tauri dev` starts `nuxt dev` as its `beforeDevCommand`, but closing the app
window does not stop it. The next `pnpm dev:tauri` then dies with:

```
ERROR  Another Nuxt dev is already running (PID …).
```

Stop the orphan and relaunch:

```bash
pkill -f "nuxt.mjs dev"
```

Ctrl-C in the terminal running `pnpm dev:tauri` tears both down properly; only
closing the window from its own title bar leaves the stray behind.

### Title-bar dragging depends on a Vue implementation detail

`packages/ui/components/TitleBar.vue` marks its strip `-webkit-app-region:
drag`, which is an Electron/Chromium property WebKitGTK does not implement, so
the shim has to emulate it. Reading that marker is more delicate than it looks,
and all three obvious routes fail in the real window:

- `getAttribute('style')` is `null` — Vue's compiler turns a static `style="…"`
  into a style _object_ prop and `setStyle` applies it through the CSSOM,
  never calling `setAttribute`;
- `style.getPropertyValue('-webkit-app-region')` and `getComputedStyle(...)`
  are both `''` — the engine drops the declaration as unrecognized.

What survives is an expando: `setStyle` asks `autoPrefix` for a supported
spelling, gets none, and falls back to `style['-webkit-app-region'] = 'drag'`,
which lands as an ordinary JS property on the declaration object. `shim/drag.ts`
reads all three sources, and that third one is the one that fires today.

The coupling to watch: **a Vue release that switched to `setProperty()` for
unsupported properties would break dragging silently.** The unit tests cannot
catch it — they exercise a DOM the test fixture builds, not one Vue rendered.
Re-check the title bar by hand after a major Vue upgrade.

Related: double-click-to-maximize is arbitrated between the shim and
`TitleBar.vue`'s own `@dblclick`. Whether the platform delivers a `dblclick`
after `startDragging()` differs — GTK does, the Windows modal move loop does
not — so the shim handles the maximize itself and swallows the following
`dblclick` in the capture phase. Without that, GTK toggled twice and the window
maximized and instantly restored.

### Edge resizing is emulated, and cannot use tao's built-in

`shim/resize.ts` implements edge and corner resizing in JavaScript. That looks
redundant — tao already does it for undecorated windows, with `hit_test` plus
`begin_resize_drag`, gated on `!is_decorated() && is_resizable() &&
!is_maximized()`, all of which hold here. **It is unreachable.** Those handlers
are connected to the `GtkWindow`, and GTK3 propagates button and motion events
_upward_ from the widget under the pointer, so the WebKitWebView filling the
window consumes them first. Every Tauri app with a full-bleed webview and
`decorations: false` has this; the window simply cannot be resized without a
JS-side implementation.

The mousedown listener is capture-phase so it beats `shim/drag.ts`: the top
border overlaps the title bar's drag strip, and at the very edge resizing must
win over moving.

Known trade-off: the 5px border sits over the outermost sliver of any
edge-flush scrollbar, so a press there starts a resize instead of a scroll.
Narrow `BORDER` if that becomes annoying.

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
