# Tauri Android Packaging Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the MetaCubeXD launcher icon, keep Android content outside system-bar interaction areas, and publish a signed arm64 APK alongside the existing universal APK.

**Architecture:** Keep all platform behavior in the fork-owned Tauri Android shell. Synchronize launcher assets through Tauri's icon generator, apply AndroidX window insets to the Activity content root, and use a second supported Tauri CLI invocation for the arm64 flavor. The existing dedicated Android build job signs and validates both exact APK paths before the single publish job runs.

**Tech Stack:** Tauri CLI 2.11.4, Kotlin/AndroidX Activity and Core View APIs, Gradle Android product flavors, pnpm 10, GitHub Actions, Android `apksigner`.

## Global Constraints

- Preserve `app-universal-release.apk` with all four supported Android ABIs.
- Add `app-arm64-release.apk`; do not replace the universal APK.
- Keep `targetSdk = 36` and edge-to-edge rendering enabled; apply system-bar
  and display-cutout insets in the native shell.
- Do not modify `packages/ui` or add Android-specific CSS safe-area behavior.
- Do not add AAB or Google Play publishing.
- Do not commit `Keystore.jks` or `apps/tauri/src-tauri/gen/android/keystore.properties`.
- Build jobs upload Actions artifacts only; the dedicated `publish` job remains the sole GitHub Release writer.
- Use the existing desktop `apps/tauri/src-tauri/icons/icon.png` as the single icon source.

## File Map

- `apps/tauri/src-tauri/gen/android/app/src/main/res/`: generated Android launcher resources consumed by the APK.
- `apps/tauri/src-tauri/gen/android/app/src/main/java/io/github/ttsdzb/metacubexd/MainActivity.kt`: Android system-bar inset ownership.
- `apps/tauri/package.json`: package-level universal and arm64 Tauri CLI commands.
- `package.json`: root convenience commands.
- `.github/workflows/release-tauri.yml`: signed dual-APK build, exact artifact collection, and Actions artifact naming.
- `FORK.md`: maintained commands, outputs, release contents, and device-verification limitation.

---

### Task 1: Synchronize Android Launcher Resources

**Files:**

- Modify: `apps/tauri/src-tauri/gen/android/app/src/main/res/mipmap-*/ic_launcher*.png`
- Create: `apps/tauri/src-tauri/gen/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`
- Create: `apps/tauri/src-tauri/gen/android/app/src/main/res/values/ic_launcher_background.xml`
- Delete if removed by generator: `apps/tauri/src-tauri/gen/android/app/src/main/res/drawable/ic_launcher_background.xml`
- Delete if removed by generator: `apps/tauri/src-tauri/gen/android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml`

**Interfaces:**

- Consumes: `apps/tauri/src-tauri/icons/icon.png` as the canonical square RGBA source.
- Produces: conventional and adaptive launcher resources referenced by `@mipmap/ic_launcher`.

- [ ] **Step 1: Run the current-resource assertion and verify RED**

Run:

```bash
for density in mdpi hdpi xhdpi xxhdpi xxxhdpi; do
  for name in ic_launcher.png ic_launcher_foreground.png ic_launcher_round.png; do
    cmp \
      "apps/tauri/src-tauri/icons/android/mipmap-$density/$name" \
      "apps/tauri/src-tauri/gen/android/app/src/main/res/mipmap-$density/$name"
  done
done
```

Expected: FAIL on the first image because the generated project still contains
the default launcher.

- [ ] **Step 2: Regenerate platform icons from the canonical source**

Run:

```bash
node apps/tauri/run-tauri.mjs icon apps/tauri/src-tauri/icons/icon.png
```

Inspect `git status --short` and `git diff --stat`. Keep only icon outputs from
the official generator; no unrelated source or config file should change.

- [ ] **Step 3: Run launcher-resource assertions and verify GREEN**

Run the Step 1 loop again.

Expected: all 15 `cmp` invocations exit 0.

Run:

```bash
test -f apps/tauri/src-tauri/gen/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml
rg -n '@mipmap/ic_launcher_foreground|@color/ic_launcher_background' \
  apps/tauri/src-tauri/gen/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml
```

Expected: the adaptive icon exists and references the generated foreground and
background resources.

- [ ] **Step 4: Commit the launcher resources**

```bash
git add apps/tauri/src-tauri/icons apps/tauri/src-tauri/gen/android/app/src/main/res
git commit -m "fix(android): sync launcher icon"
```

### Task 2: Apply Android Safe-Area Insets

**Files:**

- Modify: `apps/tauri/src-tauri/gen/android/app/src/main/java/io/github/ttsdzb/metacubexd/MainActivity.kt:3-15`

**Interfaces:**

- Consumes: the Tauri Activity content root at `android.R.id.content` and AndroidX `WindowInsetsCompat`.
- Produces: root padding equal to `systemBars() or displayCutout()` insets on every dispatch.

- [ ] **Step 1: Run a source contract and verify RED**

Run:

```bash
node -e '
  const fs = require("node:fs")
  const source = fs.readFileSync(
    "apps/tauri/src-tauri/gen/android/app/src/main/java/io/github/ttsdzb/metacubexd/MainActivity.kt",
    "utf8",
  )
  for (const token of [
    "WindowInsetsCompat.Type.systemBars()",
    "WindowInsetsCompat.Type.displayCutout()",
    "ViewCompat.setOnApplyWindowInsetsListener",
    "ViewCompat.requestApplyInsets",
  ]) {
    if (!source.includes(token)) throw new Error(`missing ${token}`)
  }
'
```

Expected: FAIL with `missing WindowInsetsCompat.Type.systemBars()`.

- [ ] **Step 2: Implement inset handling after Tauri Activity creation**

Replace `MainActivity.kt` with:

```kotlin
package io.github.ttsdzb.metacubexd

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, windowInsets ->
      val safeArea = windowInsets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
      )
      view.setPadding(safeArea.left, safeArea.top, safeArea.right, safeArea.bottom)
      windowInsets
    }
    ViewCompat.requestApplyInsets(content)
  }
}
```

- [ ] **Step 3: Verify the source contract and Kotlin compilation are GREEN**

Run the Step 1 Node assertion again.

Expected: exit 0.

Run:

```bash
ANDROID_HOME=/home/liusq/Android/Sdk \
ANDROID_SDK_ROOT=/home/liusq/Android/Sdk \
NDK_HOME=/home/liusq/Android/Sdk/ndk/29.0.13113456 \
apps/tauri/src-tauri/gen/android/gradlew \
  -p apps/tauri/src-tauri/gen/android \
  :app:compileUniversalDebugKotlin
```

Expected: `BUILD SUCCESSFUL` with no Kotlin errors.

- [ ] **Step 4: Commit the inset fix**

```bash
git add apps/tauri/src-tauri/gen/android/app/src/main/java/io/github/ttsdzb/metacubexd/MainActivity.kt
git commit -m "fix(android): respect system bar insets"
```

### Task 3: Build and Publish Both APK Variants

**Files:**

- Modify: `apps/tauri/package.json:6-15`
- Modify: `package.json:7-20`
- Modify: `.github/workflows/release-tauri.yml:273-290`

**Interfaces:**

- Consumes: existing signing properties and all four installed Rust Android targets.
- Produces: `app-universal-release.apk` and `app-arm64-release.apk` in separate Gradle flavor directories and one `release-android` Actions artifact containing both.

- [ ] **Step 1: Run packaging contracts and verify RED**

Run:

```bash
node -e '
  const root = require("./package.json")
  const tauri = require("./apps/tauri/package.json")
  if (root.scripts["build:android:arm64"] !== "pnpm --filter @metacubexd/tauri android:build:arm64") {
    throw new Error("missing root arm64 build command")
  }
  if (!tauri.scripts["android:build:arm64"]?.includes("--target aarch64 --split-per-abi")) {
    throw new Error("missing Tauri arm64 build command")
  }
'
```

Expected: FAIL with `missing root arm64 build command`.

Run:

```bash
test -f apps/tauri/src-tauri/gen/android/app/build/outputs/apk/arm64/release/app-arm64-release.apk
```

Expected: FAIL because no arm64 flavor APK has been built.

- [ ] **Step 2: Add explicit arm64 package commands**

Add to `apps/tauri/package.json`:

```json
"android:build:arm64": "node build-shim.mjs && node run-tauri.mjs android build --apk --target aarch64 --split-per-abi --ci"
```

Add to the root `package.json`:

```json
"build:android:arm64": "pnpm --filter @metacubexd/tauri android:build:arm64"
```

Keep the existing `android:build` and `build:android` values unchanged.

- [ ] **Step 3: Make Actions build and collect both exact outputs**

Keep the existing universal build step and add:

```yaml
- name: Build signed Android arm64 APK
  run: pnpm --filter @metacubexd/tauri android:build:arm64
```

Replace recursive APK collection with:

```bash
set -euo pipefail
mkdir -p release-artifacts

universal="apps/tauri/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk"
arm64="apps/tauri/src-tauri/gen/android/app/build/outputs/apk/arm64/release/app-arm64-release.apk"
test -f "$universal"
test -f "$arm64"
cp "$universal" "$arm64" release-artifacts/
ls -lh release-artifacts
```

Rename the Actions artifact from `release-android-universal` to
`release-android`. Keep `path: release-artifacts/*.apk`,
`if-no-files-found: error`, and `retention-days: 5`.

- [ ] **Step 4: Verify package and workflow contracts are GREEN**

Run the Step 1 package script assertion again.

Expected: exit 0.

Run:

```bash
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/release-tauri.yml", aliases: true)'
rg -n 'android:build:arm64|app-universal-release.apk|app-arm64-release.apk|name: release-android$' \
  .github/workflows/release-tauri.yml
```

Expected: YAML parses and all four workflow contracts are present.

- [ ] **Step 5: Build both signed APKs**

Run:

```bash
ANDROID_HOME=/home/liusq/Android/Sdk \
ANDROID_SDK_ROOT=/home/liusq/Android/Sdk \
NDK_HOME=/home/liusq/Android/Sdk/ndk/29.0.13113456 \
pnpm build:android
```

Then run:

```bash
ANDROID_HOME=/home/liusq/Android/Sdk \
ANDROID_SDK_ROOT=/home/liusq/Android/Sdk \
NDK_HOME=/home/liusq/Android/Sdk/ndk/29.0.13113456 \
pnpm build:android:arm64
```

Expected: both commands exit 0 and both exact APK paths exist.

- [ ] **Step 6: Verify ABI contents, signatures, and size reduction**

Run:

```bash
universal=apps/tauri/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
arm64=apps/tauri/src-tauri/gen/android/app/build/outputs/apk/arm64/release/app-arm64-release.apk

unzip -Z1 "$universal" | rg '^lib/[^/]+/libapp_lib\.so$'
unzip -Z1 "$arm64" | rg '^lib/[^/]+/libapp_lib\.so$'
/home/liusq/Android/Sdk/build-tools/36.1.0/apksigner verify --print-certs "$universal"
/home/liusq/Android/Sdk/build-tools/36.1.0/apksigner verify --print-certs "$arm64"
ls -lh "$universal" "$arm64"
```

Expected: universal lists four ABIs; arm64 lists only
`lib/arm64-v8a/libapp_lib.so`; both certificate SHA-256 digests are identical;
arm64 is smaller than universal.

- [ ] **Step 7: Commit packaging and workflow changes**

```bash
git add package.json apps/tauri/package.json .github/workflows/release-tauri.yml
git commit -m "build(android): add arm64 APK"
```

### Task 4: Document and Regress-Test the Android Release

**Files:**

- Modify: `FORK.md:188-225`
- Modify: `FORK.md:273-286`

**Interfaces:**

- Consumes: the final command names and APK paths from Task 3.
- Produces: authoritative fork-maintenance instructions for local builds and draft releases.

- [ ] **Step 1: Update local Android build documentation**

Document these commands and outputs in `FORK.md`:

```text
pnpm build:android
apps/tauri/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk

pnpm build:android:arm64
apps/tauri/src-tauri/gen/android/app/build/outputs/apk/arm64/release/app-arm64-release.apk
```

State that universal is the compatibility-first package and arm64 is the
smaller package for modern devices. Preserve all signing-file warnings.

- [ ] **Step 2: Update release artifact documentation**

Change the draft release count from ten to eleven files and list both Android
APK names. Add a short limitation stating that launcher masking and system-bar
insets still require later device verification across rotation, cutouts,
gesture navigation, and three-button navigation.

- [ ] **Step 3: Run focused and repository checks**

Run:

```bash
pnpm --filter @metacubexd/tauri test
pnpm --filter @metacubexd/tauri typecheck
pnpm --filter @metacubexd/tauri build:shim
cargo check --manifest-path apps/tauri/src-tauri/Cargo.toml
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/release-tauri.yml", aliases: true)'
git diff --check
```

Expected: all commands exit 0. If `actionlint` is available, also run:

```bash
actionlint .github/workflows/release-tauri.yml
```

- [ ] **Step 4: Verify signing material remains private**

Run:

```bash
git check-ignore -v Keystore.jks apps/tauri/src-tauri/gen/android/keystore.properties
test -z "$(git ls-files -- Keystore.jks apps/tauri/src-tauri/gen/android/keystore.properties)"
```

Expected: both files have ignore rules and neither path is tracked.

- [ ] **Step 5: Commit documentation**

```bash
git add FORK.md
git commit -m "docs: describe Android APK variants"
```

- [ ] **Step 6: Review the complete branch**

Run:

```bash
git status --short --branch
git log --oneline --decorate origin/codex/tauri-android-apk..HEAD
git diff --stat origin/codex/tauri-android-apk...HEAD
```

Expected: clean worktree; commits are limited to the design, launcher, inset,
packaging/workflow, and documentation changes described by this plan.
