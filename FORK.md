# Fork notes

This fork replaces metacubexd's Electron Desktop App with a Tauri v2 shell that
runs the upstream dashboard against a **user-managed** Mihomo kernel — on this
machine, on the LAN, or anywhere reachable over HTTP(S)/WS(S). It does not
bundle, supervise, or configure a kernel: the app is a Hosted Panel, so every
Control Agent surface (profiles, kernel lifecycle, system proxy, TUN, WebDAV,
config editor) hides itself.

## What changed

- `apps/tauri` — new: the Tauri shell plus a transport shim that replaces
  `fetch` and `WebSocket` with native, CORS-free implementations for
  cross-origin traffic, delivered to every webview (desktop and Android) as a
  plugin `js_init_script`. `packages/ui` is byte-for-byte upstream.
- `pnpm-workspace.yaml`, `package.json`, `pnpm-lock.yaml`, `.gitignore` —
  `apps/desktop` and `apps/server` are excluded from the workspace. Their files
  are untouched on disk so upstream commits that edit them still merge cleanly.
- `.github/workflows/unit-tests.yml` — desktop/server test lines dropped.
- `.github/workflows/release.yml` — replaced by `release-tauri.yml` (tag-push
  publish).

## Commands

```bash
pnpm install
pnpm dev:tauri      # Nuxt dev + Tauri window, with HMR
pnpm build:tauri    # release bundles in apps/tauri/src-tauri/target/release/bundle
pnpm dev:android    # Android device/emulator dev build
pnpm build:android  # release APKs (universal + per-ABI), signed if keystore.properties exists
pnpm dev            # plain browser dev, no Tauri
```

`pnpm build:tauri`/`pnpm build:android` run `apps/tauri/build-shim.mjs` first,
which bundles `apps/tauri/shim/` into `apps/tauri/src-tauri/shim.js`. The
release build's frontend is the UI's own `generate:desktop` output
(`NUXT_APP_BASE_URL=./ MCXD_DISABLE_PWA=true nuxt generate`); on Windows the
pnpm `shellEmulator` setting makes that POSIX env-prefix syntax work under cmd.

## Release flow

Push a tag `tauri-v<TauriVersion>-<WebVersion>` (e.g. `tauri-v0.1.0-1.271.0`)
and the `release-tauri` workflow builds and publishes: deb + rpm (Linux x64 and
arm64), app + dmg (macOS x64 and arm64, ad-hoc signed), msi + nsis (Windows
x64), and signed APKs (universal + per-ABI). Linux builds ship **no AppImage**.

Android signing requires four repository secrets:

- `ANDROID_KEYSTORE_BASE64` — `base64 -i <keystore>.jks` of your upload keystore
- `ANDROID_KEYSTORE_PASSWORD` — store and key password
- `ANDROID_KEY_ALIAS` — the key alias
- `ANDROID_KEY_PASSWORD` — key password (if different, adjust
  `gen/android/app/build.gradle.kts` to read a separate `keyPassword`)

Local Android builds need `ANDROID_HOME` and `NDK_HOME` set (see the Tauri
prerequisites), plus the four `rustup` android targets. Without
`apps/tauri/src-tauri/gen/android/keystore.properties` the APKs are unsigned.

## Backend addresses

Enter the full URL including the scheme (`http://192.168.1.5:9090`). A bare
host is prefixed with the webview's own protocol by the dashboard
(`transformEndpointURL`) — an upstream behavior shared by every hosted panel.

## Linux NVIDIA/Wayland

On NVIDIA GPUs, WebKitGTK can fail to render (blank window, WebProcess spin)
under Wayland. The official workarounds (in order) are
`nvidia_drm.modeset=1` kernel param, `__NV_DISABLE_EXPLICIT_SYNC=1`,
`WEBKIT_DISABLE_DMABUF_RENDERER=1`, `WEBKIT_DISABLE_COMPOSITING_MODE=1` (see
the Tauri "Linux Graphics Issues" doc). The maintainer's machine needs
`__NV_DISABLE_EXPLICIT_SYNC=1` — set it per-launch or in the desktop entry;
per the official doc, do NOT ship it unconditionally in `main()` unless the
app is verified affected on the target hardware.

## Upstream merges

```bash
git remote add upstream https://github.com/MetaCubeX/metacubexd.git
git fetch upstream && git merge upstream/main
```

Expected conflict surface: `pnpm-workspace.yaml`, the root `package.json`
scripts, and `.github/workflows/*` if upstream touched them. Everything else
this fork adds is a new path. If upstream renames a bridge field or changes the
WebSocket message contract, the shim's unit tests are what catch it.
