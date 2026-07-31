# CI and Multi-platform Releases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify every push compiles and passes tests, and publish Linux, Windows, and macOS installers from a `tauri-v*` tag.

**Architecture:** Two fork-owned workflows alongside upstream's. `verify-tauri.yml` covers what upstream's CI cannot — `typecheck` and an actual Rust build. `release-tauri.yml` gates on the test suites, then matrix-builds with `tauri-apps/tauri-action`, taking the version from the tag so artifact names always match it. Upstream's `release.yml` is deleted; `unit-tests.yml` is minimally corrected; `e2e.yml` is untouched.

**Tech Stack:** GitHub Actions, `tauri-apps/tauri-action@action-v1.0.0`, `Swatinem/rust-cache@v2`, `dtolnay/rust-toolchain`, `actionlint` 1.7.12 for local validation.

**Spec:** `docs/superpowers/specs/2026-07-31-ci-multiplatform-design.md`

---

## Conventions this plan relies on

- Action versions match what this repo already uses elsewhere: `actions/checkout@v7`,
  `pnpm/action-setup@v6`, `actions/setup-node@v7`. `pnpm/action-setup` takes no
  version input — it reads `packageManager` from the root `package.json`.
- **`shell: bash` is set on any step whose script must behave identically on all
  three runners.** Windows runners default to PowerShell, where quoting rules
  differ enough to break an otherwise-fine one-liner. This is why the version
  step works cross-platform.
- `actionlint` is not installed. Get it once:

  ```bash
  bash <(curl -sSL https://raw.githubusercontent.com/rhysd/actionlint/main/scripts/download-actionlint.bash)
  ```

  That drops `./actionlint` in the current directory. Verified working at 1.7.12,
  and the repo's existing workflows currently pass it clean, so any error it
  reports is from this work.

---

## File Structure

**Created:**

| Path                                  | Responsibility                                               |
| ------------------------------------- | ------------------------------------------------------------ |
| `.github/workflows/verify-tauri.yml`  | Typecheck + a Linux Rust build, on push and PRs              |
| `.github/workflows/release-tauri.yml` | Gate on tests, then matrix-build and publish a draft release |

**Modified:**

| Path                                   | Change                                              |
| -------------------------------------- | --------------------------------------------------- |
| `.github/workflows/unit-tests.yml`     | Drop two dead `--filter` lines, add the Tauri suite |
| `.github/workflows/stale.yml`          | Trigger narrowed to `workflow_dispatch`             |
| `release-please-config.json`           | Drop the `apps/desktop/package.json` entry          |
| `apps/tauri/src-tauri/tauri.conf.json` | Version `1.270.6` → `0.1.0`                         |
| `FORK.md`                              | Document the release procedure                      |

**Deleted:**

| Path                            | Why                                                                                                               |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/release.yml` | Superseded. 309 lines publishing to `ghcr.io/metacubex/*` and `d.metacubex.one`, neither of which this fork owns. |

---

## Task 1: Retire and correct the inherited workflows

**Files:**

- Delete: `.github/workflows/release.yml`
- Modify: `.github/workflows/unit-tests.yml:40-46`
- Modify: `.github/workflows/stale.yml:3-5`
- Modify: `release-please-config.json:11-20`

- [ ] **Step 1: Delete upstream's release workflow**

```bash
git rm .github/workflows/release.yml
```

It builds Electron, pushes Docker images to `ghcr.io/metacubex/metacubexd`, and
deploys gh-pages to `d.metacubex.one`. Every one of those targets belongs to
upstream. `release-tauri.yml` replaces it in Task 4.

- [ ] **Step 2: Fix the unit test workflow**

In `.github/workflows/unit-tests.yml`, replace the `Run unit tests` step's
script with:

```yaml
- name: Run unit tests
  run: |
    pnpm --filter @metacubexd/agent test
    pnpm --filter @metacubexd/tauri test
    pnpm --filter @metacubexd/ui test:coverage
```

Two lines are removed: `@metacubexd/desktop` and `@metacubexd/server`. Those
packages left the workspace, and **`pnpm --filter` exits 0 when nothing
matches**, so they were passing while testing nothing.

Change nothing else in this file — not the triggers, not the coverage upload.
It is upstream's, and keeping it otherwise identical is what lets their
improvements keep merging.

- [ ] **Step 3: Stop the stale bot running on a schedule**

In `.github/workflows/stale.yml`, replace the `on:` block:

```yaml
on:
  workflow_dispatch:
```

It closes inactive issues and PRs on upstream's tracker. Left on its daily cron
it would act on this fork's issues with upstream's policy. Manual-only keeps the
file available without it doing anything unasked.

- [ ] **Step 4: Drop the dead release-please entry**

In `release-please-config.json`, remove this object from `extra-files`:

```json
{
  "type": "json",
  "path": "apps/desktop/package.json",
  "jsonpath": "$.version"
}
```

Leave the `packages/ui/package.json` entry. release-please will not run — its
only trigger was the workflow just deleted — but a config referencing a
non-workspace package is a trap for whoever revisits it.

Do **not** add `apps/tauri/package.json` here. Per the spec, this fork's
releases are tag-driven and never write a version back into the repository.

- [ ] **Step 5: Verify**

Run: `./actionlint .github/workflows/*.yml`

Expected: no output, exit 0.

Run: `node -e "JSON.parse(require('node:fs').readFileSync('release-please-config.json','utf8')); console.log('valid json')"`

Expected: `valid json`

Run: `grep -c "metacubexd/desktop\|metacubexd/server" .github/workflows/unit-tests.yml`

Expected: `0`

- [ ] **Step 6: Commit**

```bash
git add .github/workflows release-please-config.json
git commit -m "ci: retire upstream's release workflow and fix the test job

release.yml publishes to ghcr.io/metacubex and d.metacubex.one, neither
of which this fork owns, and builds an Electron app that is no longer in
the workspace.

unit-tests.yml filtered on two packages that left the workspace, and
pnpm --filter exits 0 when nothing matches, so those lines were passing
while testing nothing. It now runs the Tauri suite instead.

stale.yml applied upstream's issue policy on a daily cron; it is now
manual-only."
```

---

## Task 2: Give the shell its own version

**Files:**

- Modify: `apps/tauri/src-tauri/tauri.conf.json:4`
- Modify: `apps/tauri/package.json:3`

- [ ] **Step 1: Set the version in both fork-owned manifests**

In `apps/tauri/src-tauri/tauri.conf.json`, change `"version": "1.270.6"` to
`"version": "0.1.0"`.

In `apps/tauri/package.json`, make the same change. It carries `1.270.6` for the
same inherited reason, and leaving the two disagreeing is the kind of
incoherence someone later has to stop and puzzle out.

`1.270.6` is the _dashboard's_ version, inherited when the config was written.
The shell's version has no meaningful relationship to it — the shell is at its
first release while the dashboard is 1270 releases in. `Cargo.toml` already says
`0.1.0`, so this also makes the two agree.

`apps/tauri` is entirely fork-owned, so editing this costs nothing at merge time.

- [ ] **Step 2: Verify the build still resolves**

Run: `pnpm --filter @metacubexd/tauri build:shim && cargo check --manifest-path apps/tauri/src-tauri/Cargo.toml`

Expected: `Finished` with no errors.

Run: `node -e "const a=require('./apps/tauri/package.json'), b=require('./apps/tauri/src-tauri/tauri.conf.json'), c=require('./apps/tauri/src-tauri/Cargo.toml')?0:0; console.log('package.json', a.version, '| tauri.conf.json', b.version)"`

Expected: `package.json 0.1.0 | tauri.conf.json 0.1.0`

Note this does **not** touch `packages/ui/package.json`, whose `1.270.6` is the
dashboard's version and is what the UI reports as `appVersion`. Nothing reads
the shell's version, so these two changes have no user-visible effect beyond
artifact filenames.

- [ ] **Step 3: Commit**

```bash
git add apps/tauri/src-tauri/tauri.conf.json apps/tauri/package.json
git commit -m "chore(tauri): version the shell independently of the dashboard

tauri.conf.json carried 1.270.6, the dashboard's version, which would
have named the first release's artifacts after it. The shell is at its
first release; Cargo.toml already said 0.1.0."
```

---

## Task 3: The verification workflow

**Files:**

- Create: `.github/workflows/verify-tauri.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/verify-tauri.yml`:

```yaml
name: verify-tauri

on:
  push:
    branches:
      - main
    paths-ignore:
      - 'docs/**'
      - '**.md'
  pull_request:
    branches:
      - main
    paths-ignore:
      - 'docs/**'
      - '**.md'

permissions:
  contents: read

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    # Pinned, not `latest`. The runner's glibc sets the floor for which distros
    # can run what we build, and its older binutils is what lets AppImage build
    # without NO_STRIP.
    runs-on: ubuntu-22.04

    steps:
      - uses: actions/checkout@v7

      - uses: pnpm/action-setup@v6

      - uses: actions/setup-node@v7
        with:
          cache: pnpm
          node-version: lts/*

      - uses: dtolnay/rust-toolchain@stable

      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: apps/tauri/src-tauri

      - name: Install Linux build dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libwebkit2gtk-4.1-dev \
            librsvg2-dev \
            patchelf \
            build-essential

      - name: Install dependencies
        run: pnpm install

      # unit-tests.yml runs the JS suites; it never typechecks.
      - name: Typecheck
        run: pnpm typecheck

      # src-tauri embeds shim.js with include_str!, and shim.js is gitignored.
      # Nothing here runs the `build` npm script (which would generate it), so
      # generate it explicitly or cargo fails on a missing file.
      - name: Generate the transport shim
        run: pnpm --filter @metacubexd/tauri build:shim

      # --no-bundle: compiling is what catches a broken capability file, a bad
      # include_str!, or a dependency that stopped resolving. Producing
      # installers is the release workflow's job and would only add minutes here.
      - name: Build the Tauri app
        run: pnpm --filter @metacubexd/tauri exec tauri build --no-bundle
```

- [ ] **Step 2: Verify**

Run: `./actionlint .github/workflows/verify-tauri.yml`

Expected: no output, exit 0.

- [ ] **Step 3: Confirm the same commands work locally**

The workflow's own steps cannot run here, but the commands it invokes can.

Run: `pnpm typecheck`

Expected: four `Done` lines, exit 0.

Run: `pnpm --filter @metacubexd/tauri build:shim && pnpm --filter @metacubexd/tauri exec tauri build --no-bundle`

Expected: ends with `Built application at:` and a path under `target/release/`.
This takes a few minutes on a cold cache.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/verify-tauri.yml
git commit -m "ci: verify typecheck and a real Rust build on every push

No test suite anywhere compiles src-tauri, so a broken capability file,
a bad include_str!, or a dependency that stops resolving would surface
only when cutting a release. Scoped to what unit-tests.yml cannot cover
so the two never run the same thing twice."
```

---

## Task 4: The release workflow

**Files:**

- Create: `.github/workflows/release-tauri.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/release-tauri.yml`:

```yaml
name: release-tauri

on:
  push:
    tags:
      - 'tauri-v*'

permissions:
  contents: read

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: false

jobs:
  # A tag that fails the suite must not publish. This also derives the version
  # once, so all three matrix legs agree on it.
  gate:
    runs-on: ubuntu-22.04
    outputs:
      version: ${{ steps.version.outputs.version }}

    steps:
      - uses: actions/checkout@v7

      # tauri-v0.1.0 -> 0.1.0
      - name: Derive the version from the tag
        id: version
        shell: bash
        run: echo "version=${GITHUB_REF_NAME#tauri-v}" >> "$GITHUB_OUTPUT"

      - uses: pnpm/action-setup@v6

      - uses: actions/setup-node@v7
        with:
          cache: pnpm
          node-version: lts/*

      - name: Install dependencies
        run: pnpm install

      - name: Typecheck
        run: pnpm typecheck

      - name: Run unit tests
        run: |
          pnpm --filter @metacubexd/agent test
          pnpm --filter @metacubexd/tauri test
          pnpm --filter @metacubexd/ui test:unit

  release:
    needs: gate
    permissions:
      contents: write

    strategy:
      # One platform failing should not cancel the others — partial artifacts
      # on a draft release are more useful than none, and the failure is
      # easier to read in isolation.
      fail-fast: false
      matrix:
        include:
          - platform: ubuntu-22.04
            args: ''
            rustTargets: ''
          - platform: windows-latest
            args: ''
            rustTargets: ''
          # One .dmg covering Apple Silicon and Intel, so users never pick wrong.
          - platform: macos-latest
            args: '--target universal-apple-darwin'
            rustTargets: 'aarch64-apple-darwin,x86_64-apple-darwin'

    runs-on: ${{ matrix.platform }}

    steps:
      - uses: actions/checkout@v7

      - uses: pnpm/action-setup@v6

      - uses: actions/setup-node@v7
        with:
          cache: pnpm
          node-version: lts/*

      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.rustTargets }}

      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: apps/tauri/src-tauri
          key: ${{ matrix.platform }}

      - name: Install Linux build dependencies
        if: matrix.platform == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libwebkit2gtk-4.1-dev \
            librsvg2-dev \
            patchelf \
            build-essential

      - name: Install dependencies
        run: pnpm install

      # The tag is the source of truth for the version, so artifact filenames
      # always match the tag that produced them. Without this a tauri-v0.1.0
      # tag would emit MetaCubeXD_0.1.0... only by coincidence of the checked-in
      # value, and drift silently the moment the two disagree.
      #
      # shell: bash so this behaves identically on the Windows runner, which
      # otherwise defaults to PowerShell and its different quoting rules.
      - name: Set the bundle version from the tag
        shell: bash
        run: |
          node -e '
            const fs = require("node:fs")
            const path = "apps/tauri/src-tauri/tauri.conf.json"
            const config = JSON.parse(fs.readFileSync(path, "utf8"))
            config.version = process.argv[1]
            fs.writeFileSync(path, JSON.stringify(config, null, 2) + "\n")
          ' "${{ needs.gate.outputs.version }}"

      # tauri-action calls `tauri build` directly, not the package's `build`
      # script, so the gitignored shim.js that src-tauri embeds with
      # include_str! would be missing. All three legs would fail identically
      # with an error pointing at Rust rather than at the real cause.
      - name: Generate the transport shim
        run: pnpm --filter @metacubexd/tauri build:shim

      - uses: tauri-apps/tauri-action@action-v1.0.0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          projectPath: apps/tauri
          tagName: ${{ github.ref_name }}
          releaseName: MetaCubeXD ${{ needs.gate.outputs.version }}
          # Draft, so release notes can be written before anyone can download,
          # and so a failed live-fire tag leaves nothing published.
          releaseDraft: true
          prerelease: ${{ contains(github.ref_name, '-rc') }}
          # No updater is configured, so latest.json would be noise.
          uploadUpdaterJson: false
          args: ${{ matrix.args }}
```

- [ ] **Step 2: Verify**

Run: `./actionlint .github/workflows/release-tauri.yml`

Expected: no output, exit 0.

- [ ] **Step 3: Confirm the version step does what it claims**

The step is inline in YAML, so test the logic directly against a scratch copy
rather than trusting it by eye.

Run:

```bash
cp apps/tauri/src-tauri/tauri.conf.json /tmp/probe.json
node -e '
  const fs = require("node:fs")
  const path = "/tmp/probe.json"
  const config = JSON.parse(fs.readFileSync(path, "utf8"))
  config.version = process.argv[1]
  fs.writeFileSync(path, JSON.stringify(config, null, 2) + "\n")
' "9.9.9"
node -e "const c=require('/tmp/probe.json'); console.log('version:', c.version, '| identifier kept:', c.identifier, '| windows kept:', c.app.windows.length)"
rm /tmp/probe.json
```

Expected: `version: 9.9.9 | identifier kept: io.github.ttsdzb.metacubexd | windows kept: 1`

That confirms it rewrites the version and preserves the rest of the config.

- [ ] **Step 4: Confirm the tag-to-version transform**

Run: `GITHUB_REF_NAME=tauri-v0.1.0 bash -c 'echo "${GITHUB_REF_NAME#tauri-v}"'`

Expected: `0.1.0`

Run: `GITHUB_REF_NAME=tauri-v0.0.1-rc1 bash -c 'echo "${GITHUB_REF_NAME#tauri-v}"'`

Expected: `0.0.1-rc1`

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release-tauri.yml
git commit -m "ci: build and publish installers from a tauri-v* tag

Gates on typecheck and the test suites, then matrix-builds Linux,
Windows, and macOS with tauri-action. macOS builds universal so one dmg
covers both architectures.

The tag is authoritative for the version, so artifact filenames always
match it. The shim is generated explicitly because tauri-action calls
tauri build directly rather than the package script that would generate
it, and shim.js is gitignored."
```

---

## Task 5: Document the release procedure

**Files:**

- Modify: `FORK.md`

- [ ] **Step 1: Add a Releasing section**

Insert this section into `FORK.md`, immediately before `## Known limitations`:

````markdown
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
`.deb`/`.rpm`/`.AppImage`, `.msi`/`.exe`, and a universal `.dmg` to a **draft**
GitHub Release. Write the notes, then publish it.

A tag containing `-rc` is marked as a prerelease, so `tauri-v0.2.0-rc1` is the
way to exercise the pipeline without announcing anything.

**Versions are never written back into the repository.** The tag is the source
of truth, and CI patches `tauri.conf.json` in the runner only. That is
deliberate: release-please would have written `CHANGELOG.md` and two
`package.json` versions, every one of which upstream rewrites on its own
release schedule, and every one of which would then conflict on merge.

**Artifacts are unsigned.** macOS shows a Gatekeeper warning — right-click →
Open, or `xattr -d com.apple.quarantine /Applications/MetaCubeXD.app`. Windows
shows SmartScreen — More info → Run anyway. Adding signing later is
configuration on `tauri-action`, not a redesign.

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
````

- [ ] **Step 2: Verify**

Run: `grep -c "tauri-v" FORK.md`

Expected: a number of at least `4`.

- [ ] **Step 3: Commit**

```bash
git add FORK.md
git commit -m "docs: document the release procedure and CI layout"
```

---

## Task 6: Live-fire test

This is the only real verification a workflow can get, and it requires pushing
to GitHub. **Confirm with the repository owner before running it** — it pushes
commits and a tag to `origin`.

- [ ] **Step 1: Push the branch**

```bash
git push origin main
```

Watch `verify-tauri.yml` and `unit-tests.yml` on the Actions tab. Both must pass
before tagging. If `verify-tauri.yml` fails, fix it before continuing — a
release tag runs a superset of the same work.

- [ ] **Step 2: Push a release candidate tag**

```bash
git tag tauri-v0.0.1-rc1
git push origin tauri-v0.0.1-rc1
```

- [ ] **Step 3: Check all three legs**

Expected on the Actions tab: `gate` passes, then three `release` jobs. Each
takes roughly 10-20 minutes on a cold Rust cache.

Expected on the Releases page: a **draft** prerelease named
`MetaCubeXD 0.0.1-rc1` carrying, at minimum:

- `MetaCubeXD_0.0.1-rc1_amd64.deb`
- `MetaCubeXD-0.0.1-rc1-1.x86_64.rpm`
- `MetaCubeXD_0.0.1-rc1_amd64.AppImage`
- `MetaCubeXD_0.0.1-rc1_x64_en-US.msi`
- `MetaCubeXD_0.0.1-rc1_x64-setup.exe`
- `MetaCubeXD_0.0.1-rc1_universal.dmg`

Confirm the filenames carry `0.0.1-rc1` and not `0.1.0` — that is the check that
the version-from-tag step actually ran.

- [ ] **Step 4: Smoke-test one artifact**

Download the `.AppImage`, make it executable, and run it:

```bash
chmod +x ~/Downloads/MetaCubeXD_0.0.1-rc1_amd64.AppImage
~/Downloads/MetaCubeXD_0.0.1-rc1_amd64.AppImage
```

Expected: the window opens and connects to a backend, exactly as the locally
built app does. This is the first artifact ever built by CI rather than on the
dev machine, so it is worth actually launching.

Note it will need `__NV_DISABLE_EXPLICIT_SYNC=1` on NVIDIA hardware, because
nothing wraps a downloaded AppImage the way `run-tauri.mjs` wraps local runs.

- [ ] **Step 5: Clean up**

Delete the draft release from the Releases page, then the tag:

```bash
git push origin :refs/tags/tauri-v0.0.1-rc1
git tag -d tauri-v0.0.1-rc1
```

- [ ] **Step 6: Record the result**

If any leg failed, fix it and repeat with `-rc2`. Do not leave a known-broken
release workflow on `main` — the whole point is that it works when you need it.

---

## Done when

- `actionlint .github/workflows/*.yml` is clean.
- `verify-tauri.yml` and `unit-tests.yml` pass on `main`.
- A `tauri-v*` tag produces a draft release with all six artifacts, named for
  the tag.
- The AppImage from that release launches and connects to a Mihomo backend.
- `git diff upstream/main...HEAD -- packages/` is still empty.
