# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

metacubexd is the official dashboard and managed runtime for the Mihomo proxy
kernel. Keep changes inside the owning workspace and preserve the boundary
between Mihomo's Clash API and metacubexd's Control API.

## Read first

- [CONTEXT.md](CONTEXT.md) — the project's ubiquitous language. Use these terms
  (Kernel, Proxy Node, Profile, Active Config, Control Agent…) in code, comments,
  and commits; the file also lists the wordings to avoid.
- [packages/ui/PRODUCT.md](packages/ui/PRODUCT.md) — product and users.
- [packages/ui/DESIGN.md](packages/ui/DESIGN.md) — UI design system.
- [packages/agent/MANUAL.md](packages/agent/MANUAL.md) — real-kernel smoke tests
  deliberately kept outside CI.
- [CONTRIBUTING.md](CONTRIBUTING.md) — desktop smoke-test matrix per platform.

## Workspace map

pnpm 10 workspace (Node 24, corepack). All dependency versions come from the
single `catalog:` in `pnpm-workspace.yaml` — add versions there, not in package
manifests.

| Workspace                 | Responsibility                                                                                                                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/ui`             | Nuxt 4 / Vue 3 dashboard shared by every runtime form                                                                                                                                                                            |
| `packages/agent`          | Framework-neutral Control API (h3 router), profile store, kernel supervisor, scheduler, shared types                                                                                                                             |
| `packages/config-editor`  | Pure YAML config document model: parse, diagnostics, `ConfigPatchV1`; used by both agent and UI                                                                                                                                  |
| `apps/tauri`              | Tauri v2 shell for this fork's desktop bundles and personal Android APK; the only `apps/*` directory in the workspace                                                                                                            |
| `apps/server` (excluded)  | Nitro all-in-one server that serves the UI and mounts the agent router. Not a workspace member — files stay on disk untouched so upstream merges stay clean, but nothing installs or builds it                                   |
| `apps/desktop` (excluded) | Electron shell, loopback control server, OS integration, privileged TUN helper, bundled-kernel packaging. Not a workspace member — files stay on disk untouched so upstream merges stay clean, but nothing installs or builds it |

Do not move host-specific behavior into `packages/ui`. Reusable lifecycle,
profile, and Control API behavior belongs in `packages/agent`; Docker/Nitro
wiring in `apps/server`; Electron/OS wiring in `apps/desktop`.

## Commands

Run from the repository root unless noted.

> `apps/server` and `apps/desktop` are excluded from the pnpm workspace (see
> Workspace map above) but their files remain on disk. `apps/server/Dockerfile`
> still references those workspaces and will fail confusingly if invoked.
> CI is now fork-owned: upstream's `release.yml` was deleted, and this
> milestone adds `verify-tauri.yml` and `release-tauri.yml` in its place.

```bash
pnpm install
pnpm dev            # alias for dev:ui — Nuxt panel only, connect to an existing Mihomo
pnpm dev:tauri      # build the shim, then run the Tauri dev shell (Nuxt HMR + Rust)
pnpm dev:android    # build the shim, then run the Android device/emulator dev shell
pnpm build:ui       # nuxt generate -> packages/ui/.output/public
pnpm build:tauri    # build the shim, then `tauri build`
pnpm build:android  # build the shim, then emit a signed Android release APK
pnpm build          # alias for build:tauri
pnpm typecheck      # pnpm -r typecheck
pnpm lint           # pnpm -r lint; currently UI only, and it runs eslint --fix
```

The Electron desktop installer flow (renderer generation/copy, kernel
staging, and `electron-builder`) belongs to the excluded `apps/desktop` app
and is not built by this fork.

### Tests

```bash
pnpm --filter @metacubexd/ui test:unit          # vitest, excludes e2e/
pnpm --filter @metacubexd/ui test:e2e           # needs: pnpm --filter @metacubexd/ui exec playwright install chromium
pnpm --filter @metacubexd/agent test
pnpm --filter @metacubexd/config-editor test
pnpm --filter @metacubexd/tauri test
```

Single test file or single case:

```bash
pnpm --filter @metacubexd/ui exec vitest run stores/__tests__/proxies.spec.ts
pnpm --filter @metacubexd/agent exec vitest run src/supervisor.test.ts -t 'auto-restarts'
```

Test layout: UI unit specs sit beside their area in `**/__tests__/**/*.spec.ts`
and browser-flow specs in `packages/ui/e2e/`; agent and config-editor tests are
co-located as `src/**/*.test.ts`; server tests under `apps/server/**/__tests__/`;
desktop tests under `apps/desktop/src/**/__tests__/`. The UI vitest pool is
`forks` with `maxWorkers: 1` because specs share a server.

Add regression coverage in the workspace that owns the behavior. Agent tests use
injected process/filesystem/fetch/timer seams instead of a real kernel — preserve
those dependency-injection seams when editing. Desktop tests must never perform
real elevation or OS changes.

## Architecture

### Runtime forms

One UI bundle serves three arrangements (see CONTEXT.md for the canonical names):

1. **Hosted panel** — static UI talking directly to a user-managed Mihomo. No
   Control Agent, so agent-only features stay hidden.
2. **Desktop app** — Electron serves the bundled UI from a loopback control
   server and supervises a bundled Mihomo. The preload bridge injects per-launch
   Control and Clash endpoints.
3. **All-in-one server** — Nitro serves the UI and `/api/control` on the control
   port and supervises the bundled Mihomo in the same container.

Default server ports: `8080` UI + Control API, `9090` Clash API, `7890` mixed
proxy. Desktop picks free loopback ports at startup — never hard-code them in UI
code.

### The two APIs

- **Clash API** — Mihomo's `external-controller` HTTP/WebSocket surface: proxies,
  groups, traffic, connections, rules, configs, version, Clash logs. UI access via
  `packages/ui/composables/useApi.ts`, `useWebSocket.ts`, and `stores/endpoint.ts`.
- **Control API** — metacubexd's `/api/control/**` surface: kernel lifecycle and
  subprocess logs, profiles, runtime config, subscriptions, kernel/Geo assets,
  WebDAV backup, System Proxy, TUN. UI access via `useControlApi.ts`.

Never route Clash API traffic through the Control API. In server mode the UI
talks directly to the published Clash API port because Nitro does not proxy the
required WebSocket streams. Clash WebSocket logs and the agent's kernel-process
SSE logs are different streams — do not conflate them.

### Endpoint and capability discovery

`resolveControlConfig()` in `useControlApi.ts` resolves the Control API base in
priority order: the Electron preload bridge (`window.metacubexd.control`), then
same-origin `/api/control` with a token optionally injected into `config.js` by
the server. `useControlInfo()` then probes `GET /api/control/info` exactly once
per page load (module-level singleton) and exposes `hasFeature(...)`. Every
agent-only UI surface must gate on a `ControlFeature` from
`packages/ui/types/control.ts` (`profiles`, `logs-sse`, `kernel-control`,
`system-proxy`, `kernel-version`, `geo-assets`, `webdav-backup`,
`runtime-config`, `config-sections`, `visual-config-editor`, `tun`) so the hosted
panel degrades cleanly. A failed probe means hosted-panel mode, not an error.

### Agent internals

`createControlRouter()` (`packages/agent/src/http.ts`) builds one h3 app whose
routes are absolute (`/api/control/...`). Optional deps on `ControlRouterDeps`
(`systemProxy`, `kernelManager`, `tunController`, `profileEditor`) are exactly
what the host advertises as capabilities — a host omits a dep and the feature
disappears from `/info` and the UI. Hosts mount that same router: `apps/server`
forwards through `routes/api/control/[...].ts` behind the token middleware in
`apps/server/middleware/auth.ts` (fails closed when `CONTROL_TOKEN` is unset;
SSE authenticates via `?token=` since `EventSource` cannot set headers), and the
desktop mounts it on a loopback-only server in `src/main/control-server.ts` that
also serves the renderer from the same origin.

Profile composition: a base Profile (local or remote) is composed with enabled
merge overlays and then script transforms into the Active Config, which the
supervisor writes to `activeConfigPath` and spawns Mihomo with via `-f`. The
supervisor serializes lifecycle operations behind a mutex, forces the Clash API
listener where it polls, and auto-restarts with backoff on unexpected exit.
Route profile and kernel state changes through the agent/controller — never
mutate them from a view.

## UI conventions

- Nuxt 4, Vue 3, strict TypeScript, CSR-only (`ssr: false`), hash routing.
- Pinia owns shared client state; persistent state uses VueUse `useLocalStorage`.
- TanStack Vue Query owns server state. Keep query keys stable and invalidate
  affected data after mutations.
- `ky` v2 is the HTTP client — this version uses `prefix`, not `prefixUrl`.
- Tailwind CSS v4 + daisyUI v5. Use semantic daisyUI roles and DESIGN.md rather
  than hard-coded theme colors.
- Vue, Nuxt, VueUse, and the project's `composables/`, `stores/`, `utils/`,
  `constants/`, `types/`, and `components/` are auto-imported per
  `packages/ui/nuxt.config.ts`.
- Use `<script setup lang="ts">`, explicit props/emits types, computed for
  derived state, watchers only for side effects.
- Zod, `tailwind-merge`, `tailwind-variants`, and `@tanstack/vue-table` are NOT
  dependencies here. Tables and conditional classes use project components and
  plain Vue/Tailwind patterns.

### Internationalization

All user-facing text goes through `useI18n()`. Adding a key means adding it to
all seven JSON files in `packages/ui/i18n/locales/` (`en`, `fa`, `fr`, `ja`,
`ko`, `ru`, `zh`), keeping valid JSON. Do not create TypeScript locale modules.

## Editing rules

- Keep Control API route changes and the UI contract (`packages/ui/types/control.ts`)
  synchronized.
- `pnpm lint` runs ESLint with `--fix`; inspect the resulting changes and do not
  run it casually across unrelated work.
- Do not hand-edit generated output: `.nuxt/`, `.nitro/`, `.output/`,
  `packages/ui/.output/`, `apps/server/.output/`, `apps/desktop/out/`,
  `apps/desktop/renderer/`, `apps/desktop/dist/`.
- Do not hand-edit downloaded kernel artifacts in `apps/desktop/resources/`
  (`mihomo`, `mihomo.exe`, `wintun.dll`, `.mihomo-target`). The tracked
  `default-config.yaml` is source and may be edited intentionally.
- Do not edit `CHANGELOG.md` — release-please owns it. Do not hand-edit
  `pnpm-lock.yaml`; regenerate it through pnpm.
- Never put tokens, subscription URLs, profile contents, or other credentials in
  fixtures, logs, screenshots, or tests.
- Commits follow Conventional Commits with a workspace scope, e.g.
  `fix(desktop): quote Windows proxy paths` (commitlint + husky enforce this).
