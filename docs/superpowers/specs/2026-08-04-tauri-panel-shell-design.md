# Tauri Panel Shell — Design

Date: 2026-08-04
Status: Approved (user, in conversation)

## Goal

Replace metacubexd's Electron Desktop App with a Tauri v2 app that ships only
the dashboard as a **Hosted Panel** (CONTEXT.md: the dashboard connected to a
user-managed Mihomo, without a Control Agent or Bundled Kernel), so the product
contains no kernel-management functionality. All cross-origin HTTP and
WebSocket traffic is performed by Rust through the official Tauri HTTP and
WebSocket plugins, removing CORS and mixed-content restrictions for backends
anywhere (LAN cores over plain `http://`, remote `https://` cores, loopback).

Targets: Linux (deb, rpm — **no AppImage**), macOS (app, dmg), Windows (msi,
nsis), Android (APK, per-ABI and universal). A tag-push CI workflow builds and
publishes all of them.

## Constraints

1. **Upstream merges stay cheap.** This fork tracks fast-moving upstream
   (`MetaCubeX/metacubexd`, currently in sync at 1.271.0). The only
   upstream-owned files edited are `pnpm-workspace.yaml`, the root
   `package.json`, `.gitignore`, `.github/workflows/unit-tests.yml`, and
   `.github/workflows/release.yml` (deleted). Everything else this fork adds is
   a new path.
2. **`packages/ui` stays byte-for-byte upstream.** All Tauri-specific behavior
   is injected from outside the Nuxt app, at document-start, via a local
   plugin's `js_init_script` (official API: `tauri::plugin::Builder::js_init_script`,
   docs.rs). The UI's existing `generate:desktop` script
   (`NUXT_APP_BASE_URL=./ MCXD_DISABLE_PWA=true nuxt generate`) is reused
   verbatim.
3. **No Control Agent surfaces in the product.** `apps/desktop`, `apps/server`
   leave the pnpm workspace globs (files stay on disk for merge cleanliness;
   the product never contains them). `packages/agent` remains under
   `packages/*` (zero glob churn; still typechecked/tested). Without a Control
   Agent reachable, the dashboard's own guards hide every kernel-management
   surface (`useControlInfo` probe 404s → `hasAgent=false`; every consumer
   already guards on presence — verified).
4. **No bridge, native window decorations.** `window.metacubexd` is never
   defined, so `useDesktop()` is false: no custom title bar, no
   desktop-endpoint seeding, no desktop-sync. The OS provides the title bar.
5. **Multi-platform reachability preserved.** The `src-tauri` scaffold keeps
   the canonical `lib.rs`/`main.rs` split, `#[cfg_attr(mobile,
tauri::mobile_entry_point)]`, and `[lib] crate-type = ["staticlib",
"cdylib", "rlib"]`. Desktop-only dependencies are `cfg`-gated, never
   deleted.

## Decisions

| Question                                             | Decision                                                                                 | Rationale                                                                                                                                   |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Redundant workspaces (`apps/desktop`, `apps/server`) | Keep files, narrow glob `apps/*` → `apps/tauri`                                          | Deleting files turns every upstream commit touching them into modify/delete conflicts                                                       |
| Transport injection                                  | Global `fetch`/`WebSocket` shim via plugin `js_init_script`, same-origin passthrough     | Covers all current and future call sites in `packages/ui` without editing it; runs in every webview (desktop and Android) at document-start |
| Window chrome                                        | Native decorations, no `window.metacubexd` bridge                                        | Zero shim complexity; app renders exactly like the hosted panel; most robust across Linux DEs                                               |
| `Authorization` header passthrough                   | `tauri-plugin-http` with `features = ["unsafe-headers"]`                                 | mihomo auth is a Bearer header; plugin docs state forbidden request headers are ignored by default                                          |
| Windows build of `generate:desktop`                  | `shellEmulator: true` in `pnpm-workspace.yaml`                                           | `NUXT_APP_BASE_URL=./ ...` is a POSIX inline env-var prefix; cmd.exe cannot parse it (pnpm 10.x official settings)                          |
| Bundle targets                                       | `["deb","rpm","msi","nsis","app","dmg"]`                                                 | Official `bundle.targets` list; AppImage deliberately absent                                                                                |
| Window state persistence                             | `tauri-plugin-window-state` (desktop-only, `cfg(desktop)` gated)                         | Official plugin; remembers size/position                                                                                                    |
| Android APKs                                         | `tauri android build --apk --split-per-abi`                                              | Per-ABI APKs (smaller downloads) plus universal APK (CLI reference)                                                                         |
| Release tag                                          | `tauri-v<TauriVersion>-<WebVersion>`, e.g. `tauri-v0.1.0-1.271.0`; CI matches `tauri-v*` | Either side can bump independently; tag carries both versions                                                                               |
| Fork CI                                              | Delete upstream `release.yml`, add `release-tauri.yml`; trim `unit-tests.yml`            | Upstream release job references removed packages; tag-push workflow per the official GitHub pipeline guide                                  |
| macOS signing                                        | Ad-hoc signing identity (no cert)                                                        | Official signing guide: avoids Gatekeeper "damaged" on Apple Silicon builds                                                                 |
| CSP                                                  | Leave `app.security.csp` at default (null)                                               | No CSP injection; the UI's inline `config.js` fallback script keeps working                                                                 |

## Layout

```
apps/tauri/
  package.json              dev / build / android:* / test / typecheck scripts
  tsconfig.json
  vitest.config.ts          jsdom environment for the shim specs
  build-shim.mjs            esbuild: shim/entry.ts → src-tauri/shim.js (IIFE, no imports)
  shim/
    entry.ts                bundle entry; calls install()
    index.ts                install(target): patches globals in order
    origin.ts               the routing predicate: native vs plugin
    fetch.ts                cross-origin → @tauri-apps/plugin-http fetch
    websocket.ts            WebSocket-compatible adapter over the plugin
    __tests__/*.spec.ts     vitest; plugin modules mocked
  src-tauri/                generated by `tauri init`, kept whole
    Cargo.toml
    build.rs
    tauri.conf.json
    capabilities/default.json
    src/main.rs             thin binary entry → lib run()
    src/lib.rs              #[cfg_attr(mobile, tauri::mobile_entry_point)] run()
    src/shim.rs             local plugin carrying js_init_script
    icons/
    gen/android/            generated by `tauri android init`; build.gradle.kts
                            edited once per the official signing guide;
                            keystore.properties gitignored
```

Files edited outside `apps/tauri`:

- `pnpm-workspace.yaml` — globs `apps/*` → `apps/tauri`; catalog entries for
  `@tauri-apps/cli`, `@tauri-apps/plugin-http`, `@tauri-apps/plugin-websocket`,
  `esbuild`; `shellEmulator: true`.
- `package.json` (root) — remove `dev:server`/`dev:desktop`/`build:server`/
  `build:desktop`; repoint `build` → `build:tauri`; add
  `dev:tauri`/`build:tauri`/`dev:android`/`build:android`.
- `.gitignore` — Tauri artifacts: `apps/tauri/src-tauri/target`,
  `apps/tauri/src-tauri/shim.js`, `gen/schemas`, `gen/android/**/build`,
  `gen/android/local.properties`, `gen/android/keystore.properties`,
  `.gradle`, keystore files.
- `.github/workflows/unit-tests.yml` — drop the `@metacubexd/desktop` and
  `@metacubexd/server` test lines (unresolvable filters once excluded).
- `.github/workflows/release.yml` — deleted; replaced by
  `.github/workflows/release-tauri.yml`.

Everything else upstream-owned (`apps/desktop`, `apps/server`,
`packages/agent`, `packages/ui`, `release-please-config.json`, `Casks/`,
`docs/`, `CONTEXT.md`) is untouched.

## The transport shim

Built by esbuild into a single dependency-free IIFE at `src-tauri/shim.js`,
embedded with `include_str!` and registered through a small local Tauri
plugin's `js_init_script`. It runs in the main frame at document-start before
any page script, on every navigation/reload, in dev and production, and in
every webview including Android's. The Tauri plugin JS packages call
`window.__TAURI_INTERNALS__` lazily per request, so install order relative to
Tauri's own bootstrap does not matter.

### Routing rule

One rule governs both transports:

```
same-origin or relative URL  ->  captured native implementation
anything else                ->  the Tauri plugin
```

Same-origin covers Nuxt's internal requests, `config.js`, bundled fonts, and
Vite's HMR WebSocket in dev. Cross-origin covers the user's Mihomo backend
(`endpoint.url` / `endpointStore.wsEndpointURL`), the GitHub release-check API,
IP/geo endpoints, and latency probes. Non-`http(s)`/`ws(s)` schemes
(`blob:`, `data:`) always take the native path.

### fetch

`globalThis.fetch` is replaced. Cross-origin requests are performed by
`@tauri-apps/plugin-http`'s `fetch` (reqwest): no CORS preflight, no
mixed-content block, system proxy not consulted (a LAN core must not loop back
through the proxy it serves). The captured native fetch handles same-origin
traffic. This covers every HTTP call site in `packages/ui` without naming any:
the three `ky.create()` clients (`useApi.ts` `useRequest`/`useGithubAPI`,
`useControlApi.ts`), the static `ky.get()` calls, and the raw `fetch()` latency
probe in `useLatencyTest.ts`. `ky` resolves `options.fetch ?? globalThis.fetch`
per request, so a patch installed before app boot is picked up by clients
created later. `mode: 'no-cors'` in the latency probe is meaningless to
reqwest and the request simply succeeds — the measurement gets more accurate.

`Authorization: Bearer <secret>` must survive: `unsafe-headers` is enabled on
the crate (see Decisions).

### WebSocket

`globalThis.WebSocket` is replaced by an adapter class over
`@tauri-apps/plugin-websocket`. `packages/ui` uses exactly two constructor
sites (`useWebSocket.ts:74`, `useWebSocket.ts:256`) and touches only
`onmessage`, `onerror`, `onclose`, and `close()`.

Two impedance mismatches to absorb:

1. **Sync constructor, async connect.** `new WebSocket(url)` returns
   immediately; `WebSocket.connect(url)` returns a promise. The adapter starts
   in `CONNECTING`, buffers `send()` calls, and dispatches handlers assigned
   after construction — which is what the call sites do.
2. **Message envelope.** The plugin delivers
   `{ type: 'Text' | 'Binary' | 'Close' | 'Ping' | 'Pong', data }`. The adapter
   forwards `Text` as `{ data: string }` to `onmessage`, decodes `Binary`,
   drops `Ping`/`Pong`, and turns `Close` into an `onclose` dispatch so the
   UI's existing reconnect-with-backoff logic keeps working. A failed connect
   dispatches `onerror` then `onclose`.

`readyState` and the `CONNECTING`/`OPEN`/`CLOSING`/`CLOSED` constants are
mirrored. The mihomo secret travels as `?token=` in the URL (the UI's
`wsEndpointURL`), passed through verbatim.

### EventSource

The only EventSource site (`stores/kernel.ts:51`) is gated on
`hasFeature('logs-sse')`, never true in panel mode. No shim.

## Tauri configuration

`tauri.conf.json`:

- `productName: "MetaCubeXD"`, `identifier: io.github.ttsdzb.metacubexd`,
  version `0.1.0` (independent of the web side's version; the release tag
  carries both, see CI).
- `build.beforeDevCommand: pnpm --filter @metacubexd/ui dev`,
  `devUrl: http://localhost:3000`,
  `beforeBuildCommand: pnpm --filter @metacubexd/ui generate:desktop`,
  `frontendDist: ../../../packages/ui/.output/public`.
- Window: 1280×800, min 720×480, resizable, native decorations (default).
- `bundle.targets: ["deb","rpm","msi","nsis","app","dmg"]` — no AppImage.
  Per-platform bundlers pick their own from the list.
- CSP left at the default (null): no CSP injection, inline scripts work.
- Icons generated by `tauri icon` from `apps/desktop/build/icon.png` (reused
  brand asset; source must be ≥1024px — verify, else ask the user).

`capabilities/default.json` (window label `main`):

```json
{
  "permissions": [
    "core:default",
    {
      "identifier": "http:default",
      "allow": [{ "url": "http://*" }, { "url": "https://*" }]
    },
    "websocket:default"
  ]
}
```

The HTTP scope is necessarily open: the user types arbitrary backend URLs.
Requests originate from reqwest, which does not apply the system proxy by
default — that is the behavior we want.

Rust plugins: `tauri-plugin-http` (features `unsafe-headers`),
`tauri-plugin-websocket`, `tauri-plugin-window-state` (desktop-only,
`cfg(desktop)`).

## Android

- `tauri android init` generates `gen/android/` (committed). The
  `build.gradle.kts` release signing config is edited once per the official
  signing guide; `keystore.properties` is gitignored.
- `android:build` runs `tauri android build --apk --ci --split-per-abi`
  (universal + per-ABI APKs).
- If the generated `AndroidManifest.xml` lacks the `INTERNET` permission, add
  it (reqwest sockets need it; Android's cleartext policy does not apply to
  Rust-side reqwest).
- Local verification on this machine: SDK at `/opt/android-studio`, Java
  present, all four rustup android targets installed; the session sets
  `ANDROID_HOME`/`NDK_HOME`.

## CI — `.github/workflows/release-tauri.yml`

Triggered by tag push `tauri-v*`. Follows the official GitHub pipeline guide
(`tauri-action@v1`, `dtolnay/rust-toolchain@stable`,
`swatinem/rust-cache@v2` with `workspaces: apps/tauri/src-tauri`,
`projectPath: apps/tauri`, `tagName: ${{ github.ref_name }}`, draft release).
`permissions: contents: write` (the default GITHUB_TOKEN is read-only and
tauri-action will fail with "Resource not accessible").

Matrix (common architectures):

- `macos-latest` → `--target aarch64-apple-darwin` (app + dmg, arm64)
- `macos-13` → `--target x86_64-apple-darwin` (app + dmg, x64)
- `ubuntu-22.04` → deb + rpm, x64
- `ubuntu-22.04-arm` → deb + rpm, arm64 (public repos only)
- `windows-latest` → msi + nsis, x64

macOS jobs sign ad-hoc (no certificate) per the official signing guide.

A separate Android job (ubuntu runner): `actions/setup-java` (temurin 17),
Android SDK + NDK, the four rustup android targets, writes
`gen/android/keystore.properties` from secrets
`ANDROID_KEYSTORE_BASE64` / `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_ALIAS` /
`ANDROID_KEY_PASSWORD` (official signing guide snippet), runs
`android:build`, and uploads the APKs to the same draft release (sequenced
after the tauri-action jobs to avoid the create/edit race).

Tag convention: `tauri-v0.1.0-1.271.0` — Tauri app version, then the web
(dashboard) version, so a bump on either side can be released independently.

## Commands

```bash
pnpm install
pnpm dev:tauri        # shim → nuxt dev + tauri dev (HMR in-window)
pnpm build:tauri      # shim → generate:desktop → release bundles in
                      # apps/tauri/src-tauri/target/release/bundle
pnpm dev:android      # Android emulator/device dev build
pnpm build:android    # signed release APKs (universal + per-ABI)
pnpm test             # apps/tauri vitest (shim)
```

## Testing

**Unit (`apps/tauri`, vitest + jsdom, plugin modules mocked):**

- the origin predicate: relative, same-origin absolute, cross-origin,
  `blob:`/`data:`, malformed URLs;
- `fetch` dispatch: native vs plugin per the predicate, method/headers/body
  passthrough, abort signal;
- the WebSocket adapter: buffering before open, `readyState` transitions,
  envelope unwrapping per type, `Close` → `onclose`, `close()` before connect
  resolves, failed connect → `onerror` + `onclose`;
- idempotence of `install()`.

**`packages/ui` suites** must stay green (run before and after the change):
`pnpm --filter @metacubexd/ui test:unit`.

**Manual smoke against a real Mihomo:**

- `pnpm dev:tauri`, add a backend over `http://` on the LAN — proxies, rules,
  connections load;
- traffic/log WebSockets stream and reconnect after a backend restart;
- latency test returns numbers;
- no kernel/profile/agent UI is present anywhere.

**Builds on this machine:** `pnpm build:tauri` (deb + rpm) and
`pnpm build:android` (APKs). `cargo check`/`cargo clippy` in `src-tauri`.
Windows remains CI-verified only (shellEmulator behavior — flagged).

## Upstream merges

```bash
git remote add upstream https://github.com/MetaCubeX/metacubexd.git
git fetch upstream && git merge upstream/main
```

Expected conflict surface: `pnpm-workspace.yaml`, the root `package.json`
scripts, and `.github/workflows/*` if upstream touched them. Everything else
this fork adds is a new path.

## Risks

| Risk                                                                                          | Mitigation                                                                       |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Plugin fetch Response differs from the browser API (ky relies on status/ok/text/json/headers) | Shim unit tests + real-mihomo smoke                                              |
| WebSocket envelope/readyState contract drift                                                  | Unwrap in one adapter function with unit tests                                   |
| `http://*` scope may not match arbitrary ports                                                | Verify against the plugin scope docs at implementation; widen pattern if needed  |
| Windows build (cmd + shellEmulator) unverifiable locally                                      | Flagged; first CI Windows run confirms; fix lands in a follow-up commit          |
| `tauri icon` source size                                                                      | Verify `apps/desktop/build/icon.png` is ≥1024px; else ask the user for a source  |
| Upstream adds a transport the shim does not cover                                             | Panel mode never reaches EventSource; same patch pattern extends to anything new |
| An upstream change makes `packages/ui` require a Control Agent                                | Would surface in the smoke test; pin or patch deliberately then                  |
