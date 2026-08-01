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
pnpm dev:android  # Android device/emulator dev build
pnpm build:android # signed release APK
pnpm dev          # plain browser dev, no Tauri
```

The desktop and Android Tauri dev/build scripts run
`node apps/tauri/build-shim.mjs` first, which bundles `apps/tauri/shim/` into
`apps/tauri/src-tauri/shim.js`. The release build's frontend comes from
`tauri.conf.json`'s `beforeBuildCommand`, which invokes the UI's own
`generate:desktop` script (relative base URL, PWA disabled) rather than plain
`nuxt generate`.

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

Ordinary content conflicts should be confined to files this fork edited in
place: `pnpm-workspace.yaml`, `package.json`, `pnpm-lock.yaml`, `.gitignore`,
`CLAUDE.md`, `.github/workflows/unit-tests.yml`, `.github/workflows/stale.yml`,
and `release-please-config.json`. Regenerate the lockfile with pnpm rather than
resolving it by hand.

This fork also **deleted** `.github/workflows/release.yml`. If upstream has
since touched that file, the merge reports a **modify/delete** conflict rather
than an ordinary content conflict: git pauses with the file staged for
deletion instead of showing conflict markers, and `git status` lists it as
`deleted by us`. Resolve it by keeping the deletion (`git rm
.github/workflows/release.yml` if the merge re-adds upstream's copy) — this
fork's CI is its own (`verify-tauri.yml` and `release-tauri.yml`, see
[Releasing](#releasing) below), and `release.yml` published to
`ghcr.io/metacubex/*` and `d.metacubex.one`, neither of which this fork owns.

Everything else this fork adds — `apps/tauri`,
`.github/workflows/verify-tauri.yml`, `.github/workflows/release-tauri.yml` —
lives at paths upstream does not have, so merging cannot conflict there.

After a merge that touched `packages/ui`, run `pnpm --filter @metacubexd/tauri
test` — 7 spec files, 95 tests. Those specs encode what the shim assumes about
the dashboard — the `window.metacubexd` bridge shape, `event.data` carrying JSON
text, the `-webkit-app-region` title bar — so they are what catches an upstream
change that breaks the shell.

## Platform support

CI now builds the three desktop platforms plus a signed Android APK on every
tagged release (see [Releasing](#releasing)); Linux desktop is what has been
smoke-tested by hand so far. `pnpm build:tauri` produces a `.deb` and an `.rpm`
(~7.8 MB each) with no special setup.

CI's Linux runner is pinned to `ubuntu-22.04` rather than `ubuntu-latest`, and
deliberately so: it sets the glibc floor for the resulting `.deb`/`.rpm`. GitHub
begins deprecating `ubuntu-22.04` runners on 2026-09-17; migrating off it means
re-checking that floor against the newer image, not a blind version bump.

### No AppImage, deliberately

`bundle.targets` lists `deb`, `rpm`, `msi`, `nsis`, `app`, and `dmg` — not
`appimage`, and not `all`.

An AppImage bundles GTK and WebKitGTK inside itself but still uses the _host's_
GL/EGL driver, and that split breaks on NVIDIA. Measured here, on the same
machine, same commit:

| Artifact                                 | Result                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `.deb` / plain binary (system WebKit)    | works                                                                                |
| AppImage built in CI (ubuntu-22.04 libs) | renders, but freezes on focusing a text input; degraded performance                  |
| AppImage built locally (host libs)       | blank white window, `Failed to create GBM buffer of size 1280x800: Invalid argument` |

Bundling _newer_ libraries made it worse, so this is not a stale-library problem
that a newer runner would fix. `WEBKIT_DISABLE_DMABUF_RENDERER=1` and
`WEBKIT_DISABLE_COMPOSITING_MODE=1` both failed to help.

The deeper reason to drop it is that an AppImage reintroduces exactly what this
fork left Electron to avoid. Tauri is worth having because it uses the system
webview; an AppImage carries its own, at 82-100 MB against the deb's 7.8 MB. A
bundled-webview artifact that is also broken on common hardware is not a trade
worth making.

Consequences, all good ones:

- `pnpm build:tauri` needs no environment variables. The `NO_STRIP=true`
  workaround existed only because `linuxdeploy` ships a binutils `strip` too old
  for the `.relr.dyn` sections in current system libraries — no AppImage, no
  `linuxdeploy`, no workaround.
- Linux users on distros without `.deb`/`.rpm` are covered by the plain binary
  instead — see below.

### Plain binaries ship alongside the installers

`release-tauri.yml` calls the Tauri CLI through this fork's `run-tauri.mjs`
wrapper and then copies the unpackaged executables itself: `app_linux_x64`,
`app_windows_x64.exe`, and `app_darwin_universal`. The workflow names the files
explicitly so the three do not collide.

The Linux one is the point — it is what replaces the AppImage for distros with
no `.deb`/`.rpm`, and it is self-contained apart from the system WebKitGTK the
`.deb` would have depended on anyway.

The other two come along because the workflow already has the raw binaries at
the end of each build, and both are worse than the installers next to them:

- **Windows.** It runs only if the WebView2 runtime is already present —
  preinstalled on Windows 11, usually but not always on Windows 10. The NSIS
  and MSI installers bootstrap WebView2 when it is missing; a bare `.exe`
  cannot. It also has no Start Menu entry and no uninstaller.
- **macOS.** A raw Mach-O has no `Info.plist` and no bundle identity, so the
  icon, menu bar, and window activation all misbehave, and Gatekeeper treats a
  loose binary worse than a `.app`. The `.app.tar.gz` is already the portable
  macOS form.

Neither is harmful — nobody reaches for a raw Mach-O with a `.dmg` beside it —
but if they ever become clutter, delete only the Windows and macOS copies before
upload rather than dropping the Linux binary too.

Two adjacent CLI flags, since they are easy to confuse:

- `--bundles deb,rpm` picks which of the configured bundlers run.
- `--no-bundle` skips bundling **entirely**, leaving just the release binary at
  `apps/tauri/src-tauri/target/release/app`. That is what `verify-tauri.yml`
  uses, since compiling is the point there and packaging is not.

The scaffold deliberately keeps every Tauri target reachable. Of the three
milestones originally planned here, all are now done:

1. ~~GitHub Actions release workflow~~ — done; see [Releasing](#releasing).
2. ~~Windows and macOS bundles~~ — done; `release-tauri.yml` builds all three
   platforms on every tag push.
3. ~~Android~~ — done; `pnpm dev:android` runs a device/emulator build, while
   `pnpm build:android` and `pnpm build:android:arm64` emit signed release APKs.

Nothing under `src-tauri/` should be deleted for being unused on Linux. The
`lib.rs`/`main.rs` split, `#[cfg_attr(mobile, tauri::mobile_entry_point)]`, the
`[lib] crate-type` list (`staticlib` for iOS, `cdylib` for Android), the
`icons/android` mipmaps, and the `cfg`-gated `tauri-plugin-window-state` all
exist for those milestones. Desktop-only additions belong behind
`#[cfg(desktop)]`.

The title bar is already handled: the bridge's `isDesktop` comes from Rust's
`cfg!(desktop)`, so an Android build reports false and `useDesktop()` renders
neither the desktop title bar nor its window controls.

### Android APK

This fork intentionally ships Android as a personal APK, not an AAB/Google Play
track. Build the compatibility-first universal package with:

```text
pnpm build:android
apps/tauri/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

For modern arm64 devices, the smaller optional package is:

```text
pnpm build:android:arm64
apps/tauri/src-tauri/gen/android/app/build/outputs/apk/arm64/release/app-arm64-release.apk
```

Local release builds require the gitignored signing properties file that Tauri
expects:

```properties
# apps/tauri/src-tauri/gen/android/keystore.properties
password=123456
keyAlias=key0
keyPassword=123456
storeFile=/absolute/path/to/Keystore.jks
```

`Keystore.jks` and `keystore.properties` are signing material. Both are
gitignored; keep them private and never stage them. The checked-in Gradle config
fails a release build early if `keystore.properties` is missing, and signs
`release` when the file exists.

CI reconstructs that same file from repository secrets:

```text
ANDROID_KEYSTORE_BASE64
ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_ALIAS
ANDROID_KEY_PASSWORD
```

For the current fork key, `ANDROID_KEY_ALIAS=key0` and both passwords are
`123456`. On Linux, generate `ANDROID_KEYSTORE_BASE64` with
`base64 -w0 Keystore.jks`.

Also not done: tray icon, launch-at-login (both desktop-only).

## Releasing

CI is fork-owned. Upstream's `release.yml` was deleted — it published to
`ghcr.io/metacubex/*` and `d.metacubex.one`, neither of which this fork owns.

| Workflow                   | Trigger          | Does                                                                    |
| -------------------------- | ---------------- | ----------------------------------------------------------------------- |
| `unit-tests.yml`           | push, PR¹        | Upstream's JS suites, plus the Tauri suite                              |
| `e2e.yml`                  | push, PR¹        | Upstream's Playwright run against `packages/ui`                         |
| `verify-tauri.yml`         | push, PR¹        | `typecheck` and a real Rust build                                       |
| `release-tauri.yml`        | `tauri-v*` tag   | Builds desktop artifacts and Android APKs, then creates a draft release |
| `publish-stable-tauri.yml` | release workflow | Publishes successful stable-tag drafts; leaves RC drafts unpublished    |
| `stale.yml`                | manual only      | Upstream's issue bot; no longer on a cron                               |

¹ "push" here means pushes to `main` only, not every branch — each of the
three carries `branches: [main]` plus `paths-ignore: ['docs/**', '**.md']`, so
a feature-branch push runs nothing, and neither does a docs-only change on
`main` or in a PR. (This commit, being a `docs:`-only change to `FORK.md`,
triggers none of them.)

To cut a release:

```bash
# 1. Bump the local default (optional; CI takes the version from the tag)
#    apps/tauri/src-tauri/tauri.conf.json  ->  "version": "0.2.0"

# 2. Tag and push
git tag tauri-v0.2.0
git push origin tauri-v0.2.0
```

The workflow gates on `pnpm typecheck` and the test suites, then runs dedicated
`build-desktop` and `build-android` jobs. Those jobs upload short-lived Actions
artifacts, and a single `publish` job downloads the complete set and creates or
updates a **draft** GitHub Release. After that workflow succeeds,
`publish-stable-tauri.yml` publishes drafts for stable tags. Tags with a suffix,
including release candidates, remain unpublished drafts.

The draft currently carries eleven files: Linux `.deb`/`.rpm` plus
`app_linux_x64`, Windows `.msi`/NSIS `.exe` plus `app_windows_x64.exe`, macOS
universal `.dmg` plus `MetaCubeXD_<version>_universal.app.tar.gz` and
`app_darwin_universal`, and Android `app-universal-release.apk` (the
compatibility-first package) plus `app-arm64-release.apk` (the smaller optional
package for modern devices). The macOS `.app.tar.gz` is expected, not a bug.
Stable tags are published automatically with the generated notes; edit them on
GitHub when a more detailed release description is useful.

Android launcher masking and status/navigation-bar insets still need physical
device verification across rotation, display cutouts, gesture navigation, and
three-button navigation.

There is no auto-updater configured — `apps/tauri` has no updater plugin and
`release-tauri.yml` does not upload `latest.json`. Nothing consumes the macOS
`.app.tar.gz` today; it is currently just an extra download.

**A failed build leg is expected sometimes, not a broken release.**
`release-tauri.yml` sets `fail-fast: false` so the other builds can still finish
and upload their temporary Actions artifacts, but the `publish` job waits for
every required build. If any required build fails, no draft release is created.
To retry a release candidate: delete the tag both locally
(`git tag -d tauri-v0.2.0-rc1`) and on the remote
(`git push origin :tauri-v0.2.0-rc1`), fix the problem, and push a new tag —
`rc1` → `rc2`, or drop `-rc` once it is clean.

The old draft-release race is gone. Earlier versions used `tauri-action` inside
the desktop matrix, which let multiple jobs race to create a draft for the same
tag. Now only the `publish` job has `contents: write` and only that job calls
`gh release create`. If a draft already exists for the tag, it uploads the
current artifacts with `gh release upload --clobber`.

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

**Desktop artifacts are unsigned.** macOS shows a Gatekeeper warning —
right-click → Open, or
`xattr -d com.apple.quarantine /Applications/MetaCubeXD.app`. Windows shows
SmartScreen — More info → Run anyway. Android release APKs are signed with the
configured keystore described under [Android APK](#android-apk). Adding desktop
signing later is a bundler/secret configuration task, not a release topology
redesign.

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

`release-please-config.json` is a partial exception, not a member of the list
above: this milestone already edited it once (commit `9c0b1cab` removed the
`apps/desktop/package.json` entry when `release.yml` was deleted, which is why
it is one of the paths called out in [Merging upstream](#merging-upstream)).
What it still lists, `packages/ui/package.json` under `extra-files`, is left
in place deliberately: nothing triggers release-please today, so the entry is
inert, but removing it fully belongs with revisiting the tag-driven model
above, not with this milestone's CI cleanup. **Do not re-enable
release-please** without doing that revisit.

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

### WebSocket connections leak on reload — measured, and not fixable from JS

Reloading the window orphans its four Clash API sockets on the Rust side.
`tauri-plugin-websocket` removes a connection from its `ConnectionManager` only
on a clean `Ok(Message::Close(_))`, and `useWebSocket.ts` relies on
`onScopeDispose`, which does not fire on document teardown — so the JS adapters
die with the page while the Rust connections keep reading from Mihomo.

Measured, rather than assumed. Counting established sockets to the backend
(`ss -tnp | grep :9090 | grep -c "pid=<app>"`) across three reloads:

```
4 → 8 → 12 → 16
```

They never come back down. One of the four pulls the full connection table
every second.

**A JS-side fix was attempted and does not work.** Do not repeat it:

1. A registry of live adapters in `shim/websocket.ts` plus a `closeAll()` called
   from a `pagehide` handler in `install()`. The handler genuinely runs — a
   `localStorage` probe written from inside it recorded `live before=4,
after=0` — so all four sockets are closed on the JS side. The socket count
   still went `4 → 8 → 12 → 16`.
2. The reason: Tauri's IPC rides a custom-protocol `fetch`
   (`tauri/scripts/ipc-protocol.js`, used on every platform except Android), and
   a non-`keepalive` fetch is abortable when the document is destroyed. The
   `plugin:websocket|send` carrying the close frame never leaves the webview.
3. Adding `keepalive: true` to those requests during teardown — possible because
   the shim owns `globalThis.fetch` and IPC passes through it — changed nothing.
   Same `4 → 8 → 12 → 16`. WebKitGTK either does not honor it or it does not
   apply here.

What is left, neither cheap:

- Give the shim its own Rust WebSocket plugin that owns connection lifecycle, so
  teardown can be handled in `on_navigation` where no IPC is needed. The
  upstream plugin's `ConnectionManager` is a private struct, so its state cannot
  be reached from our plugin.
- Fix it upstream, so the plugin retires a connection when its channel receiver
  is gone rather than only on a received close frame.

Note this is not the only leak of its kind: an abnormal close — a kernel
restart, the common case — also leaves a `ConnectionManager` entry behind,
because there is no close frame to retire it. That one strands connections
without any reload at all.

Practical impact is mostly at development time, where reloads are frequent.
A packaged app that is opened and left running does not reload.

### Seen once: an abort inside `Rc` on a tokio worker

One dev session died with:

```
thread 'tokio-rt-worker' panicked at library/alloc/src/rc.rs:
unsafe precondition(s) violated: hint::assert_unchecked must never be
called when the condition is false
thread caused non-unwinding panic. aborting.
```

It happened with no user interaction, has not recurred across many subsequent
runs, and no backtrace was captured. `Rc` is not `Send`, and glib/GTK objects
use exactly that kind of non-atomic refcount, so the shape suggests a GTK object
touched off the main thread somewhere in Tauri, wry, or a plugin — long-standing
UB that recent rustc versions detect rather than cause. The check is compiled in
only under `debug_assertions`, so a release build would not abort on it.

Not diagnosed. If it recurs, run with `RUST_BACKTRACE=full` and capture the
stack before doing anything else.

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
