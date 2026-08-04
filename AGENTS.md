# AGENTS.md

MetaCubeXD: Mihomo dashboard as a Nuxt CSR SPA, Electron desktop app, Nitro
server, and shared agent logic. Read `CONTEXT.md` (the project glossary, already
loaded) before writing prose or naming concepts — its ubiquitous language is
enforced across code and docs. `CONTRIBUTING.md` has the full process; this file
only holds what's easy to get wrong.

## Workspace layout

pnpm monorepo (pnpm 10.34.1, Node 24 via `.node-version`). Five packages:

- `packages/ui` — the Nuxt dashboard. CSR only (`ssr: false`, hash-mode
  router). Also produces the static panel and the desktop renderer.
- `packages/config-editor` — shared YAML config editing logic.
- `packages/agent` — mihomo lifecycle/profiles/TUN, shared by server and
  desktop. Consumed as **TS source** (exports point at `src/*.ts`), no build
  step.
- `apps/tauri` — the Tauri v2 desktop/Android shell: a Rust host
  (`src-tauri/`) plus a TypeScript transport shim (`shim/`) that routes all
  cross-origin `fetch`/`WebSocket` traffic through the official
  `tauri-plugin-http` / `tauri-plugin-websocket`. It consumes `packages/ui`'s
  `nuxt generate` output in place (`generate:desktop`, relative base URL, PWA
  disabled). No renderer build lives here.
- `apps/desktop`, `apps/server` — upstream files, present for merge
  cleanliness only; **excluded from the pnpm workspace**, not built, not
  tested.

## Commands

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

## Dependency and toolchain traps

- **`monaco-editor` is pinned to `0.52.2` — do not bump.** 0.53+ breaks
  monaco-yaml's worker bridge and bloats the bundle with unused workers
  (see the long comment in `pnpm-workspace.yaml`; dependabot ignores it).
- `vite` is overridden to `rolldown-vite@7.3.1` at the workspace root. Bump
  only as a reviewed change; never add a plain `vite` version pin.
- All deps are declared in the root `pnpm-workspace.yaml` `catalog:` and
  referenced as `"catalog:"` in packages. `overrides` live only at the root.
- Only commit `pnpm-lock.yaml` changes when dependency resolution actually
  changed.
- Nuxt sources are at the package root (`srcDir: '.'`); auto-imports, no
  `app/` dir.
- The Tauri npm packages and `esbuild` are pinned in the root catalog
  (`@tauri-apps/*`, `esbuild`); Rust crates are pinned in
  `apps/tauri/src-tauri/Cargo.toml`. `tauri-plugin-http` must keep the
  `unsafe-headers` feature (mihomo's `Authorization` header would be dropped
  otherwise). `shellEmulator: true` in `pnpm-workspace.yaml` is load-bearing
  for the Windows build.

## Conventions

- Commits: Conventional Commits, enforced by husky commitlint; lint-staged
  runs prettier + eslint. Release versions are synced across the root,
  `packages/ui`, and `apps/desktop` by release-please — don't bump versions
  manually.
- i18n: seven locale files in `packages/ui/i18n/locales` (`en`, `zh`, `ru`,
  `ja`, `ko`, `fr`, `fa`) must stay in sync when user-facing text changes.
- Never put tokens, subscription URLs, profile contents, or keys in
  fixtures, logs, or screenshots.
- Desktop changes touching Electron lifecycle, system proxy, TUN, helpers,
  kernel management, or packaging need real-platform smoke testing (see
  CONTRIBUTING.md); `apps/desktop/scripts/after-pack.cjs` flips Electron
  runtime fuses.
