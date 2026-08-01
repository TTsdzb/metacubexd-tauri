# Tauri Android APK Support -- Design

Date: 2026-08-01
Status: Draft for review

## Goal

Make this Tauri fork build and release a signed Android APK for personal
side-loading, while preserving the existing Hosted Panel behavior and the cheap
upstream-merge shape of the fork.

The Android app remains a dashboard shell for a user-managed Mihomo Kernel. It
does not bundle, supervise, configure, or VPN-wrap a Kernel.

## Scope

In scope:

1. Generate and commit the Tauri Android project under
   `apps/tauri/src-tauri/gen/android`.
2. Add local package scripts for Android init, dev, and APK release builds.
3. Wire release-mode Android signing through a local/CI
   `gen/android/keystore.properties` file.
4. Extend `release-tauri.yml` so `tauri-v*` tags upload a signed universal APK
   to the same draft GitHub Release as the desktop installers.
5. Update `FORK.md` with the Android commands, secret names, and verification
   limits.

Out of scope:

1. Android App Bundles (`.aab`) and Google Play distribution.
2. Android VPN, TUN, System Proxy, profile management, or a bundled Control
   Agent.
3. iOS.
4. Reworking `packages/ui` for Android-specific behavior.

## Constraints

1. **`packages/ui` stays upstream-owned.** The existing responsive dashboard
   already supports mobile viewports. Android shell behavior continues to come
   from Tauri config and the injected shim.
2. **Signing material stays out of git.** The root `Keystore.jks` is local-only
   and must not be moved into a tracked path or committed. The generated
   `keystore.properties` file is also private.
3. **Generated-but-owned Android source is committed.** `tauri android init`
   creates a Gradle project under `gen/android`. That project is source for
   this fork once generated, unlike `gen/schemas`, `target/`, or `shim.js`.
4. **APK-only releases.** This fork is personal-use, so Play Store AAB output
   is unnecessary noise. Release builds should produce one universal signed APK
   unless a future need for split ABI artifacts appears.
5. **Desktop support must not regress.** Existing Linux, Windows, and macOS
   release jobs keep their behavior. Desktop-only Rust plugins remain behind
   `cfg(not(any(target_os = "android", target_os = "ios")))`.

## Decisions

| Question                         | Decision                                                                                            | Rationale                                                                                                                                                                                         |
| -------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Android artifact                 | Signed universal APK only                                                                           | Tauri supports APK output with `--apk`; without `--split-per-abi`, it creates a universal package. That is simplest for side-loading and avoids Play Store-only AAB ceremony.                     |
| Where signing config lives       | `apps/tauri/src-tauri/gen/android/keystore.properties`, gitignored                                  | This is the path Tauri's Android signing guide uses. It references the real keystore location rather than containing the keystore itself.                                                         |
| Keystore alias/password defaults | Alias `key0`, store password `123456`, key password `123456`                                        | The provided local keystore has a single `key0` entry. These values are documented as the user's local defaults, but CI still reads them from GitHub Secrets.                                     |
| CI secret names                  | `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | Clear, conventional names. They keep the binary keystore and passwords outside the repository.                                                                                                    |
| Root command surface             | Add Android convenience scripts at the root and in `apps/tauri`                                     | Existing fork commands are run from the repository root. Root scripts keep Android on the same path as `dev:tauri` and `build:tauri`.                                                             |
| Android build environment in CI  | Dedicated Android release job                                                                       | `tauri-action` is already used for desktop bundles, but Android needs SDK/NDK setup, Rust Android targets, signing file generation, and artifact upload paths that are clearer as a separate job. |

## Local Workflow

The first implementation step runs `tauri android init --ci` from
`apps/tauri`, through `run-tauri.mjs`. If the CLI wants to install Rust targets
that are already present, use `--skip-targets-install` and keep target
installation explicit in docs/CI.

Package scripts:

```json
{
  "android:init": "node run-tauri.mjs android init --ci --skip-targets-install",
  "android:dev": "node build-shim.mjs && node run-tauri.mjs android dev",
  "android:build": "node build-shim.mjs && node run-tauri.mjs android build --apk --ci"
}
```

Root scripts mirror the two daily commands:

```json
{
  "dev:android": "pnpm --filter @metacubexd/tauri android:dev",
  "build:android": "pnpm --filter @metacubexd/tauri android:build"
}
```

Local signing setup creates
`apps/tauri/src-tauri/gen/android/keystore.properties` with:

```properties
password=123456
keyAlias=key0
keyPassword=123456
storeFile=/absolute/path/to/Keystore.jks
```

The Tauri signing guide's Gradle snippet uses one password field for both store
and key passwords. This fork's Gradle config should read `keyPassword` when it
is present and fall back to `password` when it is omitted, so local setup stays
compatible with the guide while CI can keep the two secret names explicit.

## Android Project Changes

`tauri android init` creates most files. After generation, only make targeted
edits needed for this fork:

1. Configure `gen/android/app/build.gradle.kts` release signing by loading
   `rootProject.file("keystore.properties")`.
2. Keep the Android package identifier derived from
   `io.github.ttsdzb.metacubexd`.
3. Preserve generated Gradle wrapper files and Android resources.
4. Do not commit local SDK paths, signing files, build outputs, or generated
   schema files.

The shim already passes `isDesktop=false` on Android through Rust's
`cfg!(desktop)` prelude, so the existing UI hides the desktop title bar and
window controls. No UI changes are needed for this milestone.

## GitHub Actions

`release-tauri.yml` gains an `android` job that depends on `gate`, uses
`ubuntu-22.04`, and uploads to the draft release created by the desktop matrix.

The job flow:

1. Checkout, pnpm setup, Node setup, Rust stable setup with all four Android
   targets.
2. Install or expose Android SDK/NDK tooling on the runner.
3. Install pnpm dependencies.
4. Set `tauri.conf.json`'s version from the `tauri-v*` tag, matching the
   desktop release job.
5. Decode `ANDROID_KEYSTORE_BASE64` into `$RUNNER_TEMP/metacubexd-release.jks`.
6. Write `apps/tauri/src-tauri/gen/android/keystore.properties` from secrets.
7. Run `pnpm --filter @metacubexd/tauri android:build`.
8. Upload the generated `*.apk` files from
   `apps/tauri/src-tauri/gen/android/app/build/outputs/apk/**` to the same
   draft release.

The workflow does not upload AAB files. It also does not try to publish to
Google Play.

## Verification

Required before implementation is considered done:

1. `pnpm --filter @metacubexd/tauri test`
2. `pnpm --filter @metacubexd/tauri typecheck`
3. `pnpm --filter @metacubexd/tauri build:shim`
4. `cargo check --manifest-path apps/tauri/src-tauri/Cargo.toml`
5. `pnpm --filter @metacubexd/tauri android:build` if the local Android SDK/NDK
   is usable in the sandbox.
6. Workflow syntax validation with `actionlint` if available.

Current local expectation: this machine has Android SDK files under
`/home/liusq/Android/Sdk` and all four Rust Android targets installed, but
`ANDROID_HOME`/`NDK_HOME` are not exported and `adb` cannot start inside the
sandbox. APK build verification should be attempted after exporting SDK/NDK
paths; device/emulator `android dev` verification should be reported as
not-run unless the sandbox permits ADB.

## Risks

| Risk                                                                        | Mitigation                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gradle signing config fails when `keystore.properties` is absent            | Fail release builds loudly; document the local file and CI secrets. Debug builds do not need release signing.                                                                                                                                     |
| Android SDK/NDK versions drift on GitHub runners                            | Pin or explicitly install the SDK/NDK versions used by the generated project where possible, and keep the workflow self-contained.                                                                                                                |
| The generated Android project changes many files                            | Keep all generated Android files under `apps/tauri/src-tauri/gen/android`, which is fork-owned and isolated from upstream-owned UI code.                                                                                                          |
| Desktop release race creates duplicate draft releases before Android upload | Existing `FORK.md` already documents the rare desktop race. The Android job should upload to the tag's draft release after desktop action runs; if upload lookup is ambiguous, document manual cleanup rather than adding a complex release lock. |

## Sources

- Tauri Android signing guide:
  <https://v2.tauri.app/distribute/sign/android/>
- Tauri Android APK build guidance:
  <https://v2.tauri.app/distribute/google-play/>
