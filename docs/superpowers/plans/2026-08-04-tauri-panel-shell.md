# Tauri Panel Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace metacubexd's Electron Desktop App with a Tauri v2 shell that ships only the dashboard as a Hosted Panel (no Control Agent), with all cross-origin HTTP/WebSocket traffic performed by Rust through the official `tauri-plugin-http` / `tauri-plugin-websocket`, plus a tag-push CI workflow that builds and publishes Linux (deb/rpm, no AppImage), macOS (app/dmg), Windows (msi/nsis), and Android (APK) artifacts.

**Architecture:** A new `apps/tauri` pnpm workspace holds the Rust Tauri v2 shell and a TypeScript "shim" bundled by esbuild into one dependency-free IIFE. A local Tauri plugin injects that IIFE via `js_init_script` (official API, docs.rs `tauri::plugin::Builder::js_init_script`), so it runs at document-start in every webview (desktop and Android) and replaces `globalThis.fetch` and `globalThis.WebSocket` with plugin-backed implementations for cross-origin traffic only. The frontend is upstream's own `nuxt generate` output (`packages/ui/.output/public`), consumed in place via `frontendDist`. No `window.metacubexd` bridge: native window decorations, app renders as a Hosted Panel, and every Control Agent surface hides itself via the dashboard's existing `useControlInfo` guards.

**Tech Stack:** Tauri 2 (crate `2.11.x`), `tauri-plugin-http` (features `unsafe-headers`), `tauri-plugin-websocket`, `tauri-plugin-window-state` (desktop-only, `cfg(desktop)`), Rust 2021, TypeScript, esbuild 0.28, Vitest 4 (jsdom), pnpm 10 workspace with the single root catalog, Nuxt 4 CSR (untouched), GitHub Actions (`tauri-action@v1`).

**Spec:** `docs/superpowers/specs/2026-08-04-tauri-panel-shell-design.md`

## Global Constraints

- `packages/ui` stays **byte-for-byte upstream**. Not one line of it (including `nuxt.config.ts` and `packages/ui/package.json`) changes.
- `apps/desktop`, `apps/server`, `packages/agent`, `release-please-config.json`, `Casks/`, `CONTEXT.md` are untouched on disk. Only the pnpm workspace globs stop including `apps/desktop` and `apps/server`.
- Upstream-owned files edited (the entire conflict surface): `pnpm-workspace.yaml`, root `package.json`, `.gitignore`, `.github/workflows/unit-tests.yml`, `.github/workflows/release.yml` (deleted, replaced by `release-tauri.yml`).
- No `window.metacubexd` bridge anywhere. `useDesktop()` must stay false.
- Bundle targets: exactly `["deb", "rpm", "msi", "nsis", "app", "dmg"]` — **no AppImage**.
- Release tags: `tauri-v<TauriVersion>-<WebVersion>` (e.g. `tauri-v0.1.0-1.271.0`); CI triggers on `tauri-v*`.
- Android signing secrets in CI: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` (user's names, official Android signing guide pattern).
- All plugins and CLI versions are pinned through the root catalog (`catalog:`) for npm packages; Rust crate versions in `src-tauri/Cargo.toml`.
- Code style: Prettier (no semicolons, single quotes). Comments allowed (this codebase uses them).
- Verification before completion: `pnpm typecheck`, `pnpm lint`, shim vitest, `packages/ui` unit tests, `cargo check`/`clippy`, and the two builds (`build:tauri`, `build:android`).

---

### Task 1: Workspace scaffolding

**Files:**

- Modify: `pnpm-workspace.yaml` (globs line 3, add `shellEmulator`, catalog block)
- Modify: `package.json` (root, scripts)
- Modify: `.gitignore` (append Tauri ignores)
- Create: `apps/tauri/package.json`
- Create: `apps/tauri/tsconfig.json`
- Create: `apps/tauri/vitest.config.ts`
- Test: `pnpm install`, `pnpm ls -r --depth -1`, `pnpm -r typecheck`

**Interfaces:**

- Produces: workspace member `@metacubexd/tauri` with scripts `dev`, `build`, `android:init`, `android:dev`, `android:build`, `tauri`, `test`, `typecheck`.

- [ ] **Step 1: Narrow the workspace globs**

Replace line 3 of `pnpm-workspace.yaml` (`- 'apps/*'`) so only `apps/tauri` is a member; `apps/desktop` and `apps/server` files stay on disk but leave the workspace:

```yaml
packages:
  - 'packages/*'
  - 'apps/tauri'
```

- [ ] **Step 2: Add `shellEmulator` and the catalog entries**

Directly after the `packages:` block (before the `# Single default catalog:` comment), insert:

```yaml
# packages/ui's generate:desktop script (upstream-owned, so fixed here rather
# than there) is `NUXT_APP_BASE_URL=./ MCXD_DISABLE_PWA=true nuxt generate` — a
# POSIX inline env-var prefix that cmd.exe cannot parse. pnpm runs script
# commands through the shell emulator on Windows (pnpm.io settings,
# shellEmulator), without which the Windows release leg fails before Rust.
shellEmulator: true
```

In the `catalog:` block, insert the Tauri entries in alphabetical order. `@tauri-apps/api` is deliberately NOT added — the shim only uses the two plugin packages. Place `'@tauri-apps/cli': ^2.11.4` after `'@tanstack/vue-virtual'`, then `'@tauri-apps/plugin-http': ^2.5.9` and `'@tauri-apps/plugin-websocket': ^2.4.2` after it. Place `esbuild: ^0.28.1` between `electron-vite` and `eslint`:

```yaml
'@tauri-apps/cli': ^2.11.4
'@tauri-apps/plugin-http': ^2.5.9
'@tauri-apps/plugin-websocket': ^2.4.2
```

```yaml
esbuild: ^0.28.1
```

Do NOT remove the electron/electron-builder/electron-vite catalog entries — they become unused but removing them churns the lockfile and the merge surface for nothing.

- [ ] **Step 3: Rewrite the root scripts**

`package.json` (root) — `scripts` becomes:

```json
{
  "name": "metacubexd-monorepo",
  "version": "1.271.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.34.1",
  "scripts": {
    "dev": "pnpm dev:ui",
    "dev:ui": "pnpm --filter @metacubexd/ui dev",
    "dev:tauri": "pnpm --filter @metacubexd/tauri dev",
    "dev:android": "pnpm --filter @metacubexd/tauri android:dev",
    "build": "pnpm build:tauri",
    "build:ui": "pnpm --filter @metacubexd/ui generate",
    "build:tauri": "pnpm --filter @metacubexd/tauri build",
    "build:android": "pnpm --filter @metacubexd/tauri android:build",
    "generate": "pnpm build:ui && rm -rf .output && cp -r packages/ui/.output .output",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint",
    "prepare:husky": "husky",
    "prepare": "husky"
  },
  "devDependencies": {
    "husky": "catalog:",
    "commitlint": "catalog:",
    "@commitlint/config-conventional": "catalog:",
    "lint-staged": "catalog:"
  }
}
```

Deleted: `dev:server`, `dev:desktop`, `build:server`, `build:desktop`. `build` now means the Tauri build — this fork's product. `dev`, `dev:ui`, `build:ui`, `generate` are unchanged. `typecheck`/`lint` use `-r`, which auto-skips the removed workspaces (agent stays under `packages/*`).

- [ ] **Step 4: Append `.gitignore` entries**

```gitignore
# Tauri
apps/tauri/src-tauri/target
# Regenerated by tauri-build on every compile.
apps/tauri/src-tauri/gen/schemas
# Generated by apps/tauri/build-shim.mjs on every dev/build run.
apps/tauri/src-tauri/shim.js
# Android local state and signing material.
apps/tauri/src-tauri/gen/android/.gradle
apps/tauri/src-tauri/gen/android/**/build
apps/tauri/src-tauri/gen/android/local.properties
apps/tauri/src-tauri/gen/android/keystore.properties
```

- [ ] **Step 5: Create `apps/tauri/package.json`**

```json
{
  "name": "@metacubexd/tauri",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "android:build": "node build-shim.mjs && tauri android build --apk --ci --split-per-abi",
    "android:dev": "node build-shim.mjs && tauri android dev",
    "android:init": "tauri android init --ci --skip-targets-install",
    "build": "node build-shim.mjs && tauri build",
    "dev": "node build-shim.mjs && tauri dev",
    "tauri": "tauri",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@tauri-apps/plugin-http": "catalog:",
    "@tauri-apps/plugin-websocket": "catalog:"
  },
  "devDependencies": {
    "@tauri-apps/cli": "catalog:",
    "@types/node": "catalog:",
    "esbuild": "catalog:",
    "jsdom": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

- [ ] **Step 6: Create `apps/tauri/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["node"]
  },
  "include": ["shim", "vitest.config.ts"]
}
```

- [ ] **Step 7: Create `apps/tauri/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['shim/__tests__/**/*.spec.ts'],
  },
})
```

- [ ] **Step 8: Install and verify the narrowed workspace**

Run: `pnpm install`
Expected: install succeeds; `@tauri-apps/*` and `esbuild` resolve from the catalog; `apps/desktop` and `apps/server` are no longer installed.

Run: `pnpm ls -r --depth -1`
Expected: exactly `@metacubexd/agent`, `@metacubexd/config-editor`, `@metacubexd/ui`, `@metacubexd/tauri` (plus the root).

Run: `pnpm -r typecheck`
Expected: PASS (agent, config-editor, ui, tauri — the tauri package only has `vitest.config.ts` and `shim/` which doesn't exist yet, so it trivially passes).

- [ ] **Step 9: Commit**

```bash
git add pnpm-workspace.yaml package.json .gitignore pnpm-lock.yaml apps/tauri/package.json apps/tauri/tsconfig.json apps/tauri/vitest.config.ts
git commit -m "chore(tauri): add Tauri workspace and narrow the workspace globs"
```

---

### Task 2: Tauri shell scaffold, Rust plugins, and configuration

**Files:**

- Create: `apps/tauri/src-tauri/**` (via `tauri init`; then edit `Cargo.toml`, `tauri.conf.json`, `src/lib.rs`, `src/main.rs`; create `src/shim.rs`; create placeholder `shim.js`)
- Create: `apps/tauri/src-tauri/icons/**` (via `tauri icon`)
- Modify: `apps/tauri/src-tauri/capabilities/default.json`
- Test: `cargo check`, `cargo clippy` in `apps/tauri/src-tauri`

**Interfaces:**

- Produces: `tauri::plugin::Builder::new("mcxd-shim").js_init_script(SHIM)` plugin `shim::init()`; `run()` in `lib.rs` registering `shim`, `tauri_plugin_http`, `tauri_plugin_websocket`, and (desktop-only) `tauri_plugin_window_state`. The shim's global replacements are delivered as the content of `src-tauri/shim.js` (placeholder until Task 6).

- [ ] **Step 1: Run `tauri init` in `apps/tauri`**

Run (from `apps/tauri`):

```bash
pnpm tauri init --ci \
  --app-name MetaCubeXD \
  --window-title MetaCubeXD \
  --frontend-dist ../../../packages/ui/.output/public \
  --dev-url http://localhost:3000 \
  --before-dev-command "pnpm --filter @metacubexd/ui dev" \
  --before-build-command "pnpm --filter @metacubexd/ui generate:desktop"
```

Expected: `apps/tauri/src-tauri/` created (Cargo.toml, build.rs, tauri.conf.json, capabilities/default.json, src/main.rs, src/lib.rs, icons/). This matches the official manual-setup flow (`tauri init` flags per the CLI reference).

- [ ] **Step 2: Add the plugin crates with `tauri add`**

Run (from `apps/tauri`):

```bash
pnpm tauri add http
pnpm tauri add websocket
```

Expected: crate deps `tauri-plugin-http` and `tauri-plugin-websocket` in `Cargo.toml`, npm guest packages in `apps/tauri/package.json`, and `"http:default"` / `"websocket:default"` entries in `capabilities/default.json`. Then remove the guest packages that we do not call from JS:

```bash
pnpm remove @tauri-apps/plugin-http @tauri-apps/plugin-websocket
pnpm add "@tauri-apps/plugin-http@catalog:" "@tauri-apps/plugin-websocket@catalog:"
```

(`tauri add` writes a version range; re-add via the catalog so versions come from `pnpm-workspace.yaml` as the repo requires. The Rust crates stay as `tauri add` wrote them.)

- [ ] **Step 3: Edit `Cargo.toml`**

Add the `unsafe-headers` feature to the http plugin (official plugin docs: forbidden request headers are ignored by default; mihomo auth needs the `Authorization` header) and add `tauri-plugin-window-state` under the desktop-only target section (never compiled for android/ios):

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-http = { version = "2", features = ["unsafe-headers"] }
tauri-plugin-websocket = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"

# Desktop-only plugin. Gated so `cargo build` for android never sees it.
[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]
tauri-plugin-window-state = "2"
```

Remove any `@tauri-apps/plugin-window-state` npm package and `window-state:default` permission that `tauri add` may have introduced — the plugin is used Rust-side only (auto-restore), never from JS.

- [ ] **Step 4: Write `src/lib.rs`**

Overwrite the generated file:

```rust
mod shim;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(shim::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_websocket::init());

    // Window geometry restore is desktop-only; on Android there is no window to
    // restore. Gated rather than removed so the Android target stays reachable.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 5: Write `src/main.rs`**

Overwrite the generated file (keeps the canonical thin-binary split):

```rust
// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    app_lib::run();
}
```

- [ ] **Step 6: Write `src/shim.rs`**

```rust
//! Delivers the JS transport shim to every webview.
//!
//! Registering the script on a plugin rather than on a window builder is
//! deliberate: a builder script only reaches windows constructed in Rust, which
//! would force programmatic window creation forever. A plugin script reaches
//! every webview — including the one Android creates — so the window stays
//! declared in tauri.conf.json.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

/// The transport shim, bundled by `apps/tauri/build-shim.mjs` (Task 6). Every
/// dev/build script regenerates it before cargo runs; the committed placeholder
/// (Task 6 replaces it for real) exists so `cargo check` works today.
const SHIM: &str = include_str!("../shim.js");

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("mcxd-shim").js_init_script(SHIM.to_string()).build()
}
```

- [ ] **Step 7: Create the placeholder `shim.js`**

```bash
printf '// placeholder — regenerated by apps/tauri/build-shim.mjs (Task 6)\n' > apps/tauri/src-tauri/shim.js
```

This file is gitignored; `include_str!` needs it to exist at compile time.

- [ ] **Step 8: Edit `tauri.conf.json`**

Overwrite with (bundle.targets per the official config reference; no `appimage`):

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "MetaCubeXD",
  "version": "0.1.0",
  "identifier": "io.github.ttsdzb.metacubexd",
  "build": {
    "beforeDevCommand": "pnpm --filter @metacubexd/ui dev",
    "devUrl": "http://localhost:3000",
    "beforeBuildCommand": "pnpm --filter @metacubexd/ui generate:desktop",
    "frontendDist": "../../../packages/ui/.output/public"
  },
  "app": {
    "windows": [
      {
        "title": "MetaCubeXD",
        "width": 1280,
        "height": 800,
        "minWidth": 720,
        "minHeight": 480,
        "resizable": true
      }
    ]
  },
  "bundle": {
    "active": true,
    "targets": ["deb", "rpm", "msi", "nsis", "app", "dmg"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

`app.security.csp` is left at its default (`null`): Tauri injects no CSP, so the UI's inline `config.js` fallback script keeps working. Window label defaults to `main` — the capabilities reference it.

- [ ] **Step 9: Generate the icon set**

Run (from `apps/tauri`):

```bash
pnpm tauri icon ../desktop/build/icon.png
```

`apps/desktop/build/icon.png` is a 1024×1024 PNG (verified), so `tauri icon` accepts it and regenerates the full `src-tauri/icons/` set with the brand icon. If it errors, stop and ask the user for a 1024×1024 source.

- [ ] **Step 10: Write `capabilities/default.json`**

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capability for the main window: HTTP and WebSocket to arbitrary user-entered backend URLs.",
  "windows": ["main"],
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

The HTTP scope is necessarily open: the user types arbitrary backend URLs, so no narrower allowlist can exist (same trust posture as a browser pointed at the same addresses, minus the CORS theater). `websocket:default` carries no pre-configured scope per the plugin docs.

- [ ] **Step 11: Verify the Rust build**

Run: `cargo check` in `apps/tauri/src-tauri`
Expected: PASS (first compile downloads crates; a few minutes).

Run: `cargo clippy -- -D warnings` in `apps/tauri/src-tauri`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add apps/tauri/package.json apps/tauri/pnpm-lock.yaml apps/tauri/src-tauri
git commit -m "build(tauri): scaffold the Tauri shell with plugin crates"
```

---

### Task 3: Shim — the origin routing predicate

**Files:**

- Create: `apps/tauri/shim/origin.ts`
- Test: `apps/tauri/shim/__tests__/origin.spec.ts`

**Interfaces:**

- Produces: `export function shouldUseNativeTransport(url: string, origin: string): boolean` — `true` = captured native implementation, `false` = Tauri plugin. Used by `fetch.ts` (Task 4) and `websocket.ts` (Task 5).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { shouldUseNativeTransport } from '../origin'

const ORIGIN = 'http://tauri.localhost'

describe('shouldUseNativeTransport', () => {
  it('keeps relative URLs on the native path', () => {
    expect(shouldUseNativeTransport('/_nuxt/entry.js', ORIGIN)).toBe(true)
    expect(shouldUseNativeTransport('config.js', ORIGIN)).toBe(true)
  })

  it('keeps same-origin absolute URLs on the native path', () => {
    expect(
      shouldUseNativeTransport('http://tauri.localhost/config.js', ORIGIN),
    ).toBe(true)
  })

  it('routes cross-origin HTTP URLs to the plugin', () => {
    expect(
      shouldUseNativeTransport('http://192.168.1.5:9090/proxies', ORIGIN),
    ).toBe(false)
    expect(
      shouldUseNativeTransport(
        'https://api.github.com/repos/x/y/releases',
        ORIGIN,
      ),
    ).toBe(false)
  })

  it('treats ws/wss with the same host and port as native (dev HMR)', () => {
    expect(shouldUseNativeTransport('ws://tauri.localhost/hmr', ORIGIN)).toBe(
      true,
    )
  })

  it('routes cross-origin WebSockets to the plugin', () => {
    expect(
      shouldUseNativeTransport(
        'ws://192.168.1.5:9090/connections?token=x',
        ORIGIN,
      ),
    ).toBe(false)
  })

  it('keeps blob: and data: URLs on the native path', () => {
    expect(
      shouldUseNativeTransport('blob:http://tauri.localhost/uuid', ORIGIN),
    ).toBe(true)
    expect(
      shouldUseNativeTransport('data:text/plain;base64,QQ==', ORIGIN),
    ).toBe(true)
  })

  it('falls back to native for malformed URLs', () => {
    expect(shouldUseNativeTransport('not a url', ORIGIN)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @metacubexd/tauri test`
Expected: FAIL — `../origin` resolves to nothing.

- [ ] **Step 3: Write the implementation**

```ts
// ws/wss are scheme-upgraded variants of http/https for origin purposes:
// Vite's HMR WebSocket in dev (http://localhost:3000 page, ws://localhost:3000
// socket) must stay on the native webview implementation.
const SCHEME_ALIASES: Record<string, string> = { ws: 'http', wss: 'https' }

function normalizedScheme(protocol: string): string {
  const scheme = protocol.replace(/:$/, '')
  return SCHEME_ALIASES[scheme] ?? scheme
}

/**
 * Decide whether a URL must go through the captured native transport or the
 * Tauri plugin transport. Same-origin and relative URLs use the native
 * implementation; anything else uses the plugins. blob:/data: and malformed
 * URLs always take the native path (native fetch owns the TypeError for the
 * latter).
 */
export function shouldUseNativeTransport(url: string, origin: string): boolean {
  try {
    const base = new URL(origin)
    const target = new URL(url, origin)
    if (target.protocol === 'blob:' || target.protocol === 'data:') return true
    return (
      normalizedScheme(target.protocol) === normalizedScheme(base.protocol) &&
      target.host === base.host
    )
  } catch {
    return true
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @metacubexd/tauri test`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/tauri/shim/origin.ts apps/tauri/shim/__tests__/origin.spec.ts
git commit -m "feat(tauri): add the native-vs-plugin origin predicate"
```

---

### Task 4: Shim — fetch adapter

**Files:**

- Create: `apps/tauri/shim/fetch.ts`
- Test: `apps/tauri/shim/__tests__/fetch.spec.ts`

**Interfaces:**

- Consumes: `shouldUseNativeTransport(url, origin)` from `shim/origin.ts` (Task 3).
- Produces: `export function createFetch(nativeFetch: typeof globalThis.fetch, origin: string): typeof globalThis.fetch` — the `fetch` replacement installed by `install()` (Task 6).

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { connectMock } = vi.hoisted(() => ({ connectMock: vi.fn() }))

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: (...args: unknown[]) => connectMock(...args),
}))

import { fetch as pluginFetch } from '@tauri-apps/plugin-http'
import { createFetch } from '../fetch'

const mockedPluginFetch = vi.mocked(pluginFetch)
const ORIGIN = 'http://tauri.localhost'

function makeFetch() {
  const nativeFetch = vi.fn(async () => new Response('native', { status: 200 }))
  return {
    nativeFetch,
    shimFetch: createFetch(nativeFetch as typeof fetch, ORIGIN),
  }
}

describe('createFetch', () => {
  beforeEach(() => {
    mockedPluginFetch.mockReset()
    mockedPluginFetch.mockResolvedValue(
      new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  })

  it('dispatches cross-origin requests to the plugin with the same arguments', async () => {
    const { nativeFetch, shimFetch } = makeFetch()
    const init = { method: 'GET', headers: { Authorization: 'Bearer s3cret' } }
    const res = await shimFetch('http://192.168.1.5:9090/version', init)
    expect(mockedPluginFetch).toHaveBeenCalledWith(
      'http://192.168.1.5:9090/version',
      init,
    )
    expect(await res.json()).toEqual({ ok: true })
    expect(nativeFetch).not.toHaveBeenCalled()
  })

  it('dispatches same-origin requests to the captured native fetch', async () => {
    const { nativeFetch, shimFetch } = makeFetch()
    await shimFetch('/config.js')
    expect(nativeFetch).toHaveBeenCalledWith('/config.js', undefined)
    expect(mockedPluginFetch).not.toHaveBeenCalled()
  })

  it('passes the abort signal through to the plugin', async () => {
    const { nativeFetch, shimFetch } = makeFetch()
    const controller = new AbortController()
    await shimFetch('https://api.github.com/x', { signal: controller.signal })
    expect(mockedPluginFetch).toHaveBeenCalledWith('https://api.github.com/x', {
      signal: controller.signal,
    })
    expect(nativeFetch).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @metacubexd/tauri test`
Expected: FAIL — `../fetch` missing.

- [ ] **Step 3: Write the implementation**

```ts
import { fetch as pluginFetch } from '@tauri-apps/plugin-http'
import { shouldUseNativeTransport } from './origin'

/**
 * fetch replacement: same-origin/relative traffic goes to the captured native
 * fetch; everything else is performed by Rust (reqwest) through the official
 * HTTP plugin — no CORS preflight, no mixed-content block, system proxy not
 * consulted (a LAN core must not loop back through the proxy it serves).
 *
 * `ky` (the dashboard's HTTP client) resolves `options.fetch ?? globalThis.fetch`
 * per request, so a patch installed before app boot is picked up by every
 * client created later.
 */
export function createFetch(
  nativeFetch: typeof globalThis.fetch,
  origin: string,
): typeof globalThis.fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    if (shouldUseNativeTransport(url, origin)) {
      return nativeFetch(input, init)
    }
    // The plugin accepts RequestInit & ClientOptions; both share the Web
    // fetch shape, so the call is compatible despite the narrower typing.
    return pluginFetch(input as string, init as RequestInit)
  }) as typeof globalThis.fetch
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @metacubexd/tauri test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/tauri/shim/fetch.ts apps/tauri/shim/__tests__/fetch.spec.ts
git commit -m "feat(tauri): route cross-origin fetch through the HTTP plugin"
```

---

### Task 5: Shim — WebSocket adapter

**Files:**

- Create: `apps/tauri/shim/websocket.ts`
- Test: `apps/tauri/shim/__tests__/websocket.spec.ts`

**Interfaces:**

- Consumes: `shouldUseNativeTransport(url, origin)` from `shim/origin.ts` (Task 3).
- Produces: `export function createWebSocket(NativeWebSocket: typeof globalThis.WebSocket, origin: string): typeof globalThis.WebSocket` — the `WebSocket` replacement installed by `install()` (Task 6). Same-origin constructions delegate to the native class (Vite HMR needs the full native surface); cross-origin constructions use the plugin adapter.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { connectMock } = vi.hoisted(() => ({ connectMock: vi.fn() }))

vi.mock('@tauri-apps/plugin-websocket', () => ({
  default: { connect: (...args: unknown[]) => connectMock(...args) },
}))

import { createWebSocket } from '../websocket'

const ORIGIN = 'http://tauri.localhost'

class MockSocket {
  listener: ((msg: unknown) => void) | null = null
  addListener = vi.fn((cb: (msg: unknown) => void) => {
    this.listener = cb
    return () => {
      this.listener = null
    }
  })
  send = vi.fn()
  disconnect = vi.fn()
}

function makeShim() {
  class NativeWebSocket {
    readonly url: string
    constructor(url: string) {
      this.url = url
    }
  }
  return {
    NativeWebSocket,
    Shim: createWebSocket(
      NativeWebSocket as unknown as typeof globalThis.WebSocket,
      ORIGIN,
    ),
  }
}

describe('createWebSocket', () => {
  let socket: MockSocket

  beforeEach(() => {
    socket = new MockSocket()
    connectMock.mockReset()
    connectMock.mockResolvedValue(socket)
  })

  it('delegates same-origin connections to the native WebSocket', () => {
    const { NativeWebSocket, Shim } = makeShim()
    const ws = new Shim('ws://tauri.localhost/hmr')
    expect(ws).toBeInstanceOf(NativeWebSocket)
    expect(connectMock).not.toHaveBeenCalled()
  })

  it('routes cross-origin connections to the plugin and reaches OPEN', async () => {
    const { Shim } = makeShim()
    const ws = new Shim('ws://192.168.1.5:9090/connections?token=x')
    expect(ws.readyState).toBe(0) // CONNECTING
    expect(connectMock).toHaveBeenCalledWith(
      'ws://192.168.1.5:9090/connections?token=x',
    )
    await vi.waitFor(() => expect(ws.readyState).toBe(1)) // OPEN
  })

  it('buffers send() until the connection is open, then flushes', async () => {
    const { Shim } = makeShim()
    const ws = new Shim('ws://192.168.1.5:9090/traffic')
    ws.send('buffered')
    await vi.waitFor(() => expect(ws.readyState).toBe(1))
    ws.send('live')
    expect(socket.send).toHaveBeenCalledWith('buffered')
    expect(socket.send).toHaveBeenCalledWith('live')
  })

  it('forwards Text messages to onmessage with string data', async () => {
    const { Shim } = makeShim()
    const ws = new Shim('ws://192.168.1.5:9090/connections')
    const onmessage = vi.fn()
    ws.onmessage = onmessage
    await vi.waitFor(() => expect(ws.readyState).toBe(1))
    socket.listener?.({ type: 'Text', data: '{"up":123}' })
    expect(onmessage).toHaveBeenCalledWith(
      expect.objectContaining({ data: '{"up":123}' }),
    )
  })

  it('ignores Ping and Pong frames', async () => {
    const { Shim } = makeShim()
    const ws = new Shim('ws://192.168.1.5:9090/connections')
    const onmessage = vi.fn()
    ws.onmessage = onmessage
    await vi.waitFor(() => expect(ws.readyState).toBe(1))
    socket.listener?.({ type: 'Ping', data: [1] })
    socket.listener?.({ type: 'Pong', data: [1] })
    expect(onmessage).not.toHaveBeenCalled()
  })

  it('turns a Close frame into onclose and CLOSED', async () => {
    const { Shim } = makeShim()
    const ws = new Shim('ws://192.168.1.5:9090/connections')
    const onclose = vi.fn()
    ws.onclose = onclose
    await vi.waitFor(() => expect(ws.readyState).toBe(1))
    socket.listener?.({ type: 'Close', data: { code: 1006, reason: 'gone' } })
    expect(onclose).toHaveBeenCalledWith(
      expect.objectContaining({ code: 1006, reason: 'gone' }),
    )
    expect(ws.readyState).toBe(3) // CLOSED
  })

  it('dispatches onerror then onclose when the connect fails', async () => {
    connectMock.mockRejectedValue(new Error('connection refused'))
    const { Shim } = makeShim()
    const ws = new Shim('ws://192.168.1.5:9090/connections')
    const onerror = vi.fn()
    const onclose = vi.fn()
    ws.onerror = onerror
    ws.onclose = onclose
    await vi.waitFor(() => expect(ws.readyState).toBe(3))
    expect(onerror).toHaveBeenCalled()
    expect(onclose).toHaveBeenCalled()
  })

  it('close() disconnects the plugin socket', async () => {
    const { Shim } = makeShim()
    const ws = new Shim('ws://192.168.1.5:9090/connections')
    await vi.waitFor(() => expect(ws.readyState).toBe(1))
    ws.close()
    expect(socket.disconnect).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @metacubexd/tauri test`
Expected: FAIL — `../websocket` missing.

- [ ] **Step 3: Write the implementation**

```ts
import WebSocketPlugin from '@tauri-apps/plugin-websocket'
import { shouldUseNativeTransport } from './origin'

type PluginMessage = {
  type: string
  data: unknown
}

/**
 * WebSocket replacement. Same-origin URLs (Vite HMR in dev) delegate to the
 * native class untouched. Cross-origin URLs (the mihomo backend's
 * connections/traffic/memory/logs sockets) are served by a WebSocket-compatible
 * adapter over the official WebSocket plugin, absorbing two impedance
 * mismatches:
 *
 * 1. Sync constructor, async connect: `new WebSocket(url)` returns immediately
 *    while `WebSocket.connect(url)` returns a promise. The adapter starts in
 *    CONNECTING, buffers send() calls, and dispatches handlers assigned after
 *    construction — which is what the dashboard's useWebSocket.ts does.
 * 2. Message envelope: the plugin delivers `{ type, data }` per frame. Text is
 *    forwarded as a MessageEvent with string data; Binary as a Blob; Ping/Pong
 *    dropped; Close becomes an onclose dispatch so the UI's reconnect-with-
 *    backoff keeps working. A failed connect dispatches onerror then onclose.
 */
export function createWebSocket(
  NativeWebSocket: typeof globalThis.WebSocket,
  origin: string,
): typeof globalThis.WebSocket {
  return class TauriWebSocket {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3

    readonly CONNECTING = 0
    readonly OPEN = 1
    readonly CLOSING = 2
    readonly CLOSED = 3

    readonly url: string
    binaryType: BinaryType = 'blob'

    onopen: ((ev: Event) => void) | null = null
    onmessage: ((ev: MessageEvent) => void) | null = null
    onerror: ((ev: Event) => void) | null = null
    onclose: ((ev: CloseEvent) => void) | null = null

    private readyStateValue = TauriWebSocket.CONNECTING
    private listeners = new Map<string, Set<(ev: Event) => void>>()
    private socket: WebSocketPlugin | null = null
    private buffered: string[] = []
    private userClosed = false

    constructor(url: string | URL, _protocols?: string | string[]) {
      this.url = url.toString()
      if (shouldUseNativeTransport(this.url, origin)) {
        // Returning another object from the constructor is legal JavaScript:
        // the call site receives a real native WebSocket with its full API.
        return new NativeWebSocket(
          this.url,
          _protocols,
        ) as unknown as TauriWebSocket
      }
      WebSocketPlugin.connect(this.url)
        .then((socket) => {
          this.socket = socket
          socket.addListener((msg) => this.handleMessage(msg))
          this.readyStateValue = TauriWebSocket.OPEN
          const event = new Event('open')
          this.dispatch('open', event)
          for (const pending of this.buffered) void socket.send(pending)
          this.buffered = []
        })
        .catch(() => {
          this.readyStateValue = TauriWebSocket.CLOSED
          this.dispatch('error', new Event('error'))
          this.dispatch(
            'close',
            new CloseEvent('close', { code: 1006, reason: '' }),
          )
        })
    }

    get readyState(): number {
      return this.readyStateValue
    }

    addEventListener(type: string, listener: (ev: Event) => void): void {
      const set = this.listeners.get(type) ?? new Set()
      set.add(listener)
      this.listeners.set(type, set)
    }

    removeEventListener(type: string, listener: (ev: Event) => void): void {
      this.listeners.get(type)?.delete(listener)
    }

    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
      if (this.readyStateValue === TauriWebSocket.OPEN && this.socket) {
        void this.socket.send(data as string)
      } else {
        this.buffered.push(data as string)
      }
    }

    close(): void {
      this.userClosed = true
      this.readyStateValue = TauriWebSocket.CLOSING
      if (this.socket) {
        void this.socket.disconnect()
        this.readyStateValue = TauriWebSocket.CLOSED
      }
    }

    private handleMessage(msg: PluginMessage): void {
      switch (msg.type) {
        case 'Text':
          this.dispatch(
            'message',
            new MessageEvent('message', { data: msg.data as string }),
          )
          break
        case 'Binary':
          this.dispatch(
            'message',
            new MessageEvent('message', {
              data: new Blob([new Uint8Array(msg.data as number[])]),
            }),
          )
          break
        case 'Close': {
          const frame = msg.data as { code?: number; reason?: string } | null
          this.readyStateValue = TauriWebSocket.CLOSED
          this.dispatch(
            'close',
            new CloseEvent('close', {
              code: frame?.code ?? 1000,
              reason: frame?.reason ?? '',
              wasClean: !this.userClosed,
            }),
          )
          break
        }
        default:
          // Ping/Pong and anything unknown: nothing the dashboard consumes.
          break
      }
    }

    private dispatch(type: string, event: Event): void {
      const handler =
        type === 'open'
          ? this.onopen
          : type === 'message'
            ? this.onmessage
            : type === 'error'
              ? this.onerror
              : this.onclose
      // The on* properties are typed with their own event interfaces; the
      // dispatch call site widens them to Event.
      if (typeof handler === 'function') (handler as (ev: Event) => void)(event)
      this.listeners.get(type)?.forEach((listener) => listener(event))
    }
  } as unknown as typeof globalThis.WebSocket
}
```

Note: `disconnect()` is not awaited in `close()` — the UI's `closeWs` first nulls `onclose` to suppress reconnect, and a fire-and-forget disconnect is what a sync `close()` semantics needs. `userClosed` marks deliberate closes so a later `Close` frame isn't confused with a server drop (the dashboard's reconnect logic keys off `onclose`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @metacubexd/tauri test`
Expected: PASS.

Run: `pnpm --filter @metacubexd/tauri typecheck`
Expected: PASS (the two casts in this file are the only `unknown` escapes; everything else is typed).

- [ ] **Step 5: Commit**

```bash
git add apps/tauri/shim/websocket.ts apps/tauri/shim/__tests__/websocket.spec.ts
git commit -m "feat(tauri): route cross-origin WebSockets through the WebSocket plugin"
```

---

### Task 6: Shim — install, entry, and the esbuild bundle

**Files:**

- Create: `apps/tauri/shim/index.ts`
- Create: `apps/tauri/shim/entry.ts`
- Create: `apps/tauri/build-shim.mjs`
- Test: `apps/tauri/shim/__tests__/index.spec.ts`
- Test: `apps/tauri/src-tauri/shim.js` — regenerate from the real bundle and re-verify `cargo check`

**Interfaces:**

- Consumes: `createFetch` (Task 4), `createWebSocket` (Task 5).
- Produces: `install(target: ShimTarget, origin?: string): void` (idempotent global patcher); `src-tauri/shim.js` (the IIFE that `shim.rs` embeds); script `build:shim`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest'
import { install } from '../index'

describe('install', () => {
  it('patches fetch and WebSocket, then is idempotent', () => {
    const originalFetch = vi.fn()
    const target = {
      fetch: originalFetch as unknown as typeof globalThis.fetch,
      WebSocket:
        class NativeWebSocket {} as unknown as typeof globalThis.WebSocket,
    }

    install(target, 'http://tauri.localhost')
    const patchedFetch = target.fetch
    const patchedWebSocket = target.WebSocket
    expect(patchedFetch).not.toBe(originalFetch)
    expect(patchedWebSocket).not.toBe(target.WebSocket)

    install(target, 'http://tauri.localhost')
    expect(target.fetch).toBe(patchedFetch)
    expect(target.WebSocket).toBe(patchedWebSocket)
  })

  it('routes a cross-origin fetch through the plugin-backed fetch', async () => {
    const target = {
      fetch: (async () => new Response('native')) as typeof globalThis.fetch,
      WebSocket:
        class NativeWebSocket {} as unknown as typeof globalThis.WebSocket,
    }
    install(target, 'http://tauri.localhost')
    const res = await target.fetch('http://127.0.0.1:9090/version')
    expect(res.status).toBe(200)
  })
})
```

The second test exercises the real `@tauri-apps/plugin-http` import (no mock), which will reject in the jsdom test environment because `window.__TAURI_INTERNALS__` is absent — so vitest will fail the test when it cannot reach the plugin. That makes the second test environment-dependent; drop it and keep only the idempotence test if the plugin rejects in jsdom:

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @metacubexd/tauri test`
Expected: FAIL — `../index` missing.

- [ ] **Step 3: Write `shim/index.ts`**

```ts
import { createFetch } from './fetch'
import { createWebSocket } from './websocket'

export interface ShimTarget {
  fetch: typeof globalThis.fetch
  WebSocket: typeof globalThis.WebSocket
}

const INSTALLED = Symbol('metacubexd-shim-installed')

/**
 * Patch a global object so the dashboard talks to the network through Tauri.
 * Runs as a webview initialization script, i.e. at document-start on every
 * page load, before any application code. Nothing here touches
 * window.__TAURI_INTERNALS__ — the plugin packages call it lazily, per
 * request — so install order relative to Tauri's own bootstrap does not
 * matter. Same-origin traffic keeps the captured native implementations.
 */
export function install(target: ShimTarget, origin?: string): void {
  if ((target as Record<symbol, unknown>)[INSTALLED]) return
  ;(target as Record<symbol, unknown>)[INSTALLED] = true

  const base = origin ?? globalThis.location.origin
  target.fetch = createFetch(target.fetch.bind(target), base)
  target.WebSocket = createWebSocket(target.WebSocket, base)
}
```

- [ ] **Step 4: Write `shim/entry.ts`**

```ts
import { install } from './index'

install(globalThis, globalThis.location?.origin ?? '')
```

- [ ] **Step 5: Write `build-shim.mjs`**

```js
import { build } from 'esbuild'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))

await build({
  entryPoints: [resolve(root, 'shim/entry.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  outfile: resolve(root, 'src-tauri/shim.js'),
  logLevel: 'info',
})
```

- [ ] **Step 6: Build the real shim and check the IIFE**

Run: `pnpm --filter @metacubexd/tauri exec node build-shim.mjs`
Expected: `apps/tauri/src-tauri/shim.js` written (a few KB; starts with `"use strict";` and ends with the entry call).

Run: `head -c 200 apps/tauri/src-tauri/shim.js`
Expected: no bare `import`/`export` statements (it is an IIFE, bundle-safe for `include_str!`).

- [ ] **Step 7: Re-verify Rust and the whole package**

Run: `cargo check` in `apps/tauri/src-tauri`
Expected: PASS with the real bundle.

Run: `pnpm --filter @metacubexd/tauri test` and `pnpm --filter @metacubexd/tauri typecheck`
Expected: PASS. If the second test in `index.spec.ts` fails on `__TAURI_INTERNALS__` in jsdom, delete that test (keep the idempotence test) — the real plugin IPC only exists inside a webview.

Run: `pnpm --filter @metacubexd/tauri exec prettier --write .`
Expected: formatting clean.

- [ ] **Step 8: Commit**

```bash
git add apps/tauri/shim/index.ts apps/tauri/shim/entry.ts apps/tauri/build-shim.mjs apps/tauri/shim/__tests__/index.spec.ts
git commit -m "feat(tauri): install the transport shim via plugin init script"
```

---

### Task 7: Regression, dev smoke, and the Linux release build

**Files:**

- Test: `packages/ui` unit tests (must be untouched-green), `pnpm typecheck`, `pnpm lint`
- Test: `pnpm dev:tauri` against a live mihomo (if one is running; otherwise the UI-level checks below)
- Test: `pnpm build:tauri` → deb + rpm bundles

**Interfaces:**

- Consumes: everything from Tasks 1–6.

- [ ] **Step 0: Fix the two parked minors from earlier reviews**

In `apps/tauri/src-tauri/Cargo.toml` replace the template placeholder metadata (the deb/rpm bundlers ship `description` as the package description and `authors` as the maintainer field):

```toml
[package]
name = "app"
version = "0.1.0"
description = "MetaCubeXD — dashboard for the Mihomo proxy kernel"
authors = ["TTsdzb <ttsdzb@outlook.com>"]
license = "MIT"
repository = "https://github.com/TTsdzb/metacubexd-tauri"
edition = "2021"
rust-version = "1.77.2"
```

In `apps/tauri/src-tauri/src/shim.rs`, reword the doc comment on the `SHIM` const (it says "the committed placeholder" — the file is gitignored and now contains the real bundle):

```rust
/// The transport shim, bundled by `apps/tauri/build-shim.mjs` on every
/// dev/build run (gitignored; the bundle embeds here via include_str!).
const SHIM: &str = include_str!("../shim.js");
```

- [ ] **Step 1: Run the UI regression suite**

Run: `pnpm --filter @metacubexd/ui test:unit`
Expected: PASS (unchanged upstream suite).

- [ ] **Step 2: Run the workspace checks**

Run: `pnpm -r typecheck`
Expected: PASS for agent, config-editor, tauri. `packages/ui` FAILS with `ERR_PACKAGE_PATH_NOT_EXPORTED` (vue-tsc 3.3.8 vs typescript 7.0.2) — pre-existing upstream breakage, verified before this branch existed; record it, do not fix it here.

Run: `pnpm lint`
Expected: eslint crashes repo-wide with "typescript-eslint does not support TS 7.0" — pre-existing upstream breakage (upstream CI never runs lint). Instead verify formatting: `pnpm exec prettier --check .` in `apps/tauri`, and confirm `git status` shows no formatting damage to `packages/ui`. Record both breakages; do not fix them here.

- [ ] **Step 3: Smoke the dev app**

Check whether a mihomo is reachable: `curl -s http://127.0.0.1:9090/version` (any 200 JSON means yes).

Run: `pnpm dev:tauri` (keep the process; it opens the window).
Expected, in the window:

- no custom title bar (native decorations);
- the connect form appears; add the backend `http://127.0.0.1:9090` (full URL with scheme) or the LAN core the user uses;
- proxies/rules/connections load; traffic + logs WebSockets stream; latency test returns numbers;
- no Profiles/Control/kernel UI anywhere (Hosted Panel mode).
  If no mihomo is available, verify panel mode instead: `pnpm dev:mock` equivalent is not needed — instead confirm the app renders and the Sidebar lacks `/profiles` and `/control`, then note the backend smoke for the user.

- [ ] **Step 4: Build the release bundles**

Run: `pnpm build:tauri` (several minutes: cargo release build + deb/rpm bundling).
Expected: `apps/tauri/src-tauri/target/release/bundle/deb/*.deb` and `.../rpm/*.rpm` exist; **no** `appimage/` directory.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(tauri): polish from the Linux smoke test"
```

(If nothing changed, skip this step.)

---

### Task 8: Android — init, signing config, local APK build

**Files:**

- Create: `apps/tauri/src-tauri/gen/android/**` (via `tauri android init`)
- Modify: `apps/tauri/src-tauri/gen/android/app/build.gradle.kts` (signing config per the official Android signing guide)
- Modify (if needed): `apps/tauri/src-tauri/gen/android/app/src/main/AndroidManifest.xml` (INTERNET permission)
- Test: `pnpm build:android` → universal + per-ABI APKs

**Interfaces:**

- Consumes: the workspace/scripts from Task 1 and the src-tauri from Task 2.
- Produces: committed `gen/android` project; `android:init`/`android:build` scripts that work on any machine with `ANDROID_HOME`/`NDK_HOME` set; CI job in Task 9 signs it via `keystore.properties`.

- [ ] **Step 1: Set the Android environment for this session**

```bash
export ANDROID_HOME=/opt/android-studio
export NDK_HOME=/opt/android-studio/ndk/$(ls /opt/android-studio/ndk | sort -V | tail -1)
java -version   # must be 17+; /usr/lib/jvm/default is fine
```

- [ ] **Step 2: Initialize the Android project**

Run (from `apps/tauri`):

```bash
pnpm tauri android init --ci --skip-targets-install
```

Expected: `apps/tauri/src-tauri/gen/android/` generated (gradle wrapper, `app/` module, `MainActivity.kt`, `AndroidManifest.xml`). Rust targets are already installed (`rustup target list --installed` shows all four android targets).

- [ ] **Step 3: Check the manifest for INTERNET**

Read `apps/tauri/src-tauri/gen/android/app/src/main/AndroidManifest.xml`. If `<uses-permission android:name="android.permission.INTERNET"/>` is absent, add it right after the opening `<manifest>` tag — reqwest performs all backend I/O from Rust, so Android's cleartext policy does not apply, but the socket permission is mandatory.

- [ ] **Step 4: Add the release signing config**

Per the official Android signing guide, edit `apps/tauri/src-tauri/gen/android/app/build.gradle.kts`:

1. Add at the top of the file: `import java.io.FileInputStream`
2. Before the `buildTypes` block, insert:

```kotlin
    signingConfigs {
        create("release") {
            val keystorePropertiesFile = rootProject.file("keystore.properties")
            val keystoreProperties = Properties()
            if (keystorePropertiesFile.exists()) {
                keystoreProperties.load(FileInputStream(keystorePropertiesFile))
            }

            keyAlias = keystoreProperties["keyAlias"] as String
            keyPassword = keystoreProperties["password"] as String
            storeFile = file(keystoreProperties["storeFile"] as String)
            storePassword = keystoreProperties["password"] as String
        }
    }
```

3. In `buildTypes`, set the release config to sign:

```kotlin
    buildTypes {
        getByName("release") {
            signingConfig = signingConfigs.getByName("release")
        }
    }
```

(Replace whatever the template's `buildTypes` block contains.) Without a `keystore.properties` file the block is skipped and builds stay unsigned — CI writes the file from secrets (Task 9).

- [ ] **Step 5: Build the APKs locally**

Run: `pnpm build:android` (first Gradle run downloads the toolchain; several minutes).
Expected: `apps/tauri/src-tauri/gen/android/app/build/outputs/apk/universal/release/*.apk` plus the per-ABI dirs (`arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64`).

- [ ] **Step 6: Commit**

```bash
git add apps/tauri/src-tauri/gen/android apps/tauri/src-tauri/Cargo.toml
git commit -m "build(tauri): add Android target with release signing config"
```

---

### Task 9: CI — release workflow on tag push

**Files:**

- Create: `.github/workflows/release-tauri.yml`
- Delete: `.github/workflows/release.yml`
- Modify: `.github/workflows/unit-tests.yml` (drop desktop/server test lines)

**Interfaces:**

- Consumes: scripts from Task 1 (`android:build`), tauri.conf.json from Task 2, signing config from Task 8.
- Produces: on tag push `tauri-v*`, a draft GitHub release `tauri-v<v>` carrying deb/rpm (Linux x64 + arm64), app/dmg (macOS x64 + arm64), msi/nsis (Windows x64), and signed APKs (universal + per-ABI).

- [ ] **Step 1: Trim `unit-tests.yml`**

In `.github/workflows/unit-tests.yml`, replace the `Run unit tests` step:

```yaml
- name: Run unit tests
  run: |
    pnpm --filter @metacubexd/agent test
    pnpm --filter @metacubexd/ui test:coverage
```

(`@metacubexd/desktop` and `@metacubexd/server` no longer resolve; agent and ui stay — agent is still a workspace member.)

- [ ] **Step 2: Delete the upstream release workflow**

```bash
git rm .github/workflows/release.yml
```

- [ ] **Step 3: Write `.github/workflows/release-tauri.yml`**

Follows the official GitHub pipeline guide (matrix, `tauri-action@v1`, `dtolnay/rust-toolchain`, `swatinem/rust-cache`) and the official Android signing guide's CI snippet (adapted to the fork's secret names):

```yaml
name: release-tauri

on:
  push:
    tags:
      - 'tauri-v*'

permissions:
  contents: write

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: false

jobs:
  publish-tauri:
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: macos-latest
            args: '--target aarch64-apple-darwin'
          - platform: macos-latest
            args: '--target x86_64-apple-darwin'
          - platform: ubuntu-22.04
            args: ''
          - platform: ubuntu-22.04-arm
            args: ''
          - platform: windows-latest
            args: ''
    runs-on: ${{ matrix.platform }}

    steps:
      - uses: actions/checkout@v7

      - name: install Linux system dependencies
        if: matrix.platform == 'ubuntu-22.04' || matrix.platform == 'ubuntu-22.04-arm'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf xdg-utils

      - uses: pnpm/action-setup@v6

      - uses: actions/setup-node@v7
        with:
          node-version: lts/*
          cache: pnpm

      - name: install Rust stable
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ (matrix.platform == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin') || '' }}

      - name: Rust cache
        uses: swatinem/rust-cache@v2
        with:
          workspaces: apps/tauri/src-tauri

      - name: install frontend dependencies
        run: pnpm install --frozen-lockfile

      - uses: tauri-apps/tauri-action@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # No Apple certificate: ad-hoc signing avoids Gatekeeper treating
          # unsigned Apple Silicon builds as damaged (official signing guide).
          APPLE_SIGNING_IDENTITY: ${{ matrix.platform == 'macos-latest' && '-' || '' }}
        with:
          projectPath: apps/tauri
          tagName: ${{ github.ref_name }}
          releaseName: ${{ github.ref_name }}
          releaseBody: 'See the assets to download this version and install.'
          releaseDraft: true
          prerelease: false
          args: ${{ matrix.args }}

  release-android:
    needs: publish-tauri
    runs-on: ubuntu-22.04

    steps:
      - uses: actions/checkout@v7

      - uses: pnpm/action-setup@v6

      - uses: actions/setup-node@v7
        with:
          node-version: lts/*
          cache: pnpm

      - name: install Rust stable with Android targets
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-linux-android,armv7-linux-androideabi,i686-linux-android,x86_64-linux-android

      - name: install Java
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '17'

      - name: install Android SDK
        uses: android-actions/setup-android@v3

      # Gradle auto-installs the NDK version pinned in
      # gen/android/app/build.gradle.kts once licenses are accepted (the
      # setup-android action accepts them).

      - name: install frontend dependencies
        run: pnpm install --frozen-lockfile

      - name: setup Android signing
        run: |
          cd apps/tauri/src-tauri/gen/android
          echo "keyAlias=${{ secrets.ANDROID_KEY_ALIAS }}" > keystore.properties
          echo "password=${{ secrets.ANDROID_KEY_PASSWORD }}" >> keystore.properties
          echo "storeFile=${{ runner.temp }}/keystore.jks" >> keystore.properties
          base64 -d <<< "${{ secrets.ANDROID_KEYSTORE_BASE64 }}" > "${{ runner.temp }}/keystore.jks"

      - name: build signed APKs
        run: pnpm --filter @metacubexd/tauri android:build

      - name: upload APKs to the release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ github.ref_name }}
          files: apps/tauri/src-tauri/gen/android/app/build/outputs/apk/**/*.apk
          draft: true
```

Notes:

- `needs: publish-tauri` sequences the Android job after the desktop jobs so the draft release exists before the APK upload (avoids the create/edit race).
- The tag's name is used verbatim (`github.ref_name`), so `tauri-v0.1.0-1.271.0`-style tags need no other wiring.
- `ubuntu-22.04-arm` is only available on public repositories; if this fork is private, delete that matrix row (the docs note it explicitly).

- [ ] **Step 4: Validate the workflow files**

Run: `python3 -c "import yaml,sys; [yaml.safe_load(open(f)) for f in ['.github/workflows/release-tauri.yml','.github/workflows/unit-tests.yml']]; print('yaml ok')"`
Expected: `yaml ok`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/
git commit -m "ci: publish Tauri bundles on tag push"
```

---

### Task 10: Fork documentation

**Files:**

- Create: `FORK.md`
- Modify: `AGENTS.md` (workspace layout, commands, checks — the file is fork-owned)

**Interfaces:**

- Consumes: the final command set and layout from Tasks 1–9.

- [ ] **Step 1: Write `FORK.md`**

````markdown
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
````

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

## Upstream merges

```bash
git remote add upstream https://github.com/MetaCubeX/metacubexd.git
git fetch upstream && git merge upstream/main
```

Expected conflict surface: `pnpm-workspace.yaml`, the root `package.json`
scripts, and `.github/workflows/*` if upstream touched them. Everything else
this fork adds is a new path. If upstream renames a bridge field or changes the
WebSocket message contract, the shim's unit tests are what catch it.

````

- [ ] **Step 2: Update `AGENTS.md`**

Replace the `apps/desktop` bullet in "Workspace layout" with:

```markdown
- `apps/tauri` — the Tauri v2 desktop/Android shell: a Rust host
  (`src-tauri/`) plus a TypeScript transport shim (`shim/`) that routes all
  cross-origin `fetch`/`WebSocket` traffic through the official
  `tauri-plugin-http` / `tauri-plugin-websocket`. It consumes `packages/ui`'s
  `nuxt generate` output in place (`generate:desktop`, relative base URL, PWA
  disabled). No renderer build lives here.
- `apps/desktop`, `apps/server` — upstream files, present for merge
  cleanliness only; **excluded from the pnpm workspace**, not built, not
  tested.
````

Replace the `Commands` and `Tests` blocks to match the new scripts:

```markdown
- Dev: `pnpm dev` (UI only), `pnpm dev:mock` (UI, no mihomo needed),
  `pnpm dev:tauri` (shim → nuxt dev → Tauri window), `pnpm dev:android`
  (Android device/emulator).
- Build: `pnpm build:ui` (runs `nuxt generate`), `pnpm build:tauri`
  (shim → `generate:desktop` → release bundles; deb/rpm/msi/nsis/app/dmg —
  **no AppImage**), `pnpm build:android` (APKs, universal + per-ABI).
  `pnpm generate` additionally copies the UI to root `.output`.
- Checks: `pnpm typecheck` then `pnpm lint`.
  **`pnpm lint` runs `eslint --fix` (write mode)** — inspect its changes
  before staging. Formatting is Prettier's job (eslint stylistic is off):
  no semicolons, single quotes.
- Tests (vitest everywhere): `pnpm --filter @metacubexd/ui test:unit`,
  `... test:e2e`, `pnpm --filter @metacubexd/tauri test` (shim, jsdom),
  `pnpm --filter @metacubexd/agent test`. UI e2e requires a **`build:mock`
  first** (CI does `build:mock` then `test:e2e`) plus
  `playwright install chromium`. E2e tests share one server and run
  sequentially. Agent smoke tests are manual (`packages/agent/MANUAL.md`).
- Rust: `cargo check` / `cargo clippy` in `apps/tauri/src-tauri` (Android
  builds need `ANDROID_HOME`/`NDK_HOME` + the four rustup android targets;
  see `FORK.md`).
- Releases: push a `tauri-v*` tag — CI builds and publishes all bundles.
```

Update the "Dependency and toolchain traps" section to add:

```markdown
- The Tauri npm packages and `esbuild` are pinned in the root catalog
  (`@tauri-apps/*`, `esbuild`); Rust crates are pinned in
  `apps/tauri/src-tauri/Cargo.toml`. `tauri-plugin-http` must keep the
  `unsafe-headers` feature (mihomo's `Authorization` header would be dropped
  otherwise). `shellEmulator: true` in `pnpm-workspace.yaml` is load-bearing
  for the Windows build.
```

- [ ] **Step 3: Commit**

```bash
git add FORK.md AGENTS.md
git commit -m "docs: document the Tauri fork layout and release flow"
```

---

## Self-review notes

- **Spec coverage:** every spec section maps to a task — layout (1–2), shim
  (3–6), config/capabilities (2), Android (8), CI (9), docs (10), merge
  strategy (10 + FORK.md), window-state (2), split-per-abi (1 + 8), tag naming
  (9 + FORK.md).
- **Known deferred item:** `pnpm dev:tauri` on Windows is CI-verified only;
  local Linux verification is Task 7.
- **Verification order matters:** Task 8 (Android) depends on Task 2's
  `tauri.conf.json`; the CI job (Task 9) depends on Task 8's signing config.
