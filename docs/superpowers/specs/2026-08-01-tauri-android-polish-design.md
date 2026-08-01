# Tauri Android Packaging Polish -- Design

Date: 2026-08-01
Updated: 2026-08-02
Status: Approved

## Goal

Correct the Android launcher icon and system-bar overlap, then add a smaller
arm64 APK without removing the existing universal APK.

The changes remain in the fork-owned Tauri and release surfaces. The upstream
dashboard UI is unchanged.

## Scope

In scope:

1. Replace the generated Android project's default launcher resources with the
   existing MetaCubeXD black hexagon icon set, then keep the adaptive foreground
   inside the Android safe zone.
2. Apply Android system-bar and display-cutout insets to the Tauri content root
   so controls are not obscured.
3. Add an explicit signed arm64 APK build alongside the signed universal APK.
4. Publish both APKs from `tauri-v*` GitHub Actions runs.
5. Update `FORK.md` with commands, artifact names, and behavior.

Out of scope:

1. Changes to `packages/ui` or CSS safe-area handling.
2. Removing edge-to-edge rendering or lowering `targetSdk` from 36.
3. Removing any architecture from the universal APK.
4. AAB or Google Play distribution.
5. Functional Android dashboard testing that requires a device and Mihomo
   endpoint.

## Root Causes

### Launcher Icon

`apps/tauri/src-tauri/icons/android` contains the correct icon set generated
from the desktop `icon.png`. The initialized Android project under
`gen/android/app/src/main/res` still contains its default launcher images and
default adaptive-icon drawables, so Android packages those instead.

After synchronizing those resources, physical-device testing found a second,
independent issue. The conventional launcher PNG uses reasonable internal
padding, but Android 26 and later selects the adaptive icon. Tauri's generated
adaptive foreground fills approximately 95--100% of its 108 dp layer, while
Android guarantees only the centered 66 dp safe zone and displays a 72 dp
masked viewport. The black hexagon therefore appears vertically edge-to-edge
after launcher masking.

### System-Bar Overlap

`MainActivity` calls `enableEdgeToEdge()` but does not consume window insets.
In addition, Android enforces edge-to-edge on Android 15 and later for apps
targeting SDK 35 or later. This app targets SDK 36, where opting out is no
longer a durable solution. The Tauri content therefore extends behind the
status and navigation bars without moving interactive content into the safe
area.

### APK Size

The 77 MB universal APK contains four Rust native libraries: arm64-v8a,
armeabi-v7a, x86, and x86_64. Each `libapp_lib.so` is roughly 15--20 MB. An APK
that contains only arm64-v8a removes the other three copies while preserving
the same application code and assets.

## Decisions

### Icon Synchronization

Use Tauri's `icon` command with the existing desktop `icon.png` source. Tauri
will update the generated Android project with the same conventional and
adaptive launcher resources already represented under `icons/android`.

Commit the generated Android resources. Do not introduce a second icon source
or hand-maintained vector approximation.

### Adaptive Icon Scale

Keep the conventional Android launcher PNGs and desktop icons unchanged. In
both `icons/android` and the generated Android project, wrap the existing
adaptive foreground bitmap in an inline inset drawable with 12 dp on all four
sides. The resulting foreground is 84/108 dp, or 77.8% of the generated size,
matching the physical-device comparison selected by the user.

Change the adaptive background from white to the icon's existing light gray
`#DADEDF`. The foreground bitmap already uses this color around the hexagon, so
the inset boundary blends into the adaptive background rather than producing a
white ring. The black hexagon, white strokes, and shadow remain untouched.

This is an Android resource composition change, not a bitmap rewrite. It keeps
the desktop `icon.png` as the single image source and avoids maintaining five
density-specific resizes. A future `tauri icon` regeneration may overwrite the
adaptive XML and background value, so the inset must be rechecked after icon
regeneration.

### Window Insets

Keep edge-to-edge enabled and attach a `WindowInsetsCompat` listener to the
Activity content root after `TauriActivity.onCreate`. Apply the combined
system-bar and display-cutout insets as root padding, then request initial inset
dispatch.

This places the entire Hosted Panel inside the interactive safe area on all
four edges. It deliberately excludes IME insets: keyboard resizing remains the
webview and platform's responsibility. Handling the insets in the native shell
also avoids an Android-only change to the upstream UI.

### APK Outputs

Retain the current command and output:

- `pnpm build:android` builds the signed universal APK.
- `app-universal-release.apk` remains the compatibility-first artifact.

Add a separate command:

- `pnpm build:android:arm64` invokes Tauri Android build with `--apk`,
  `--target aarch64`, and `--split-per-abi`.
- `app-arm64-release.apk` is the smaller artifact for normal modern Android
  phones and tablets.

The explicit second command keeps the existing local workflow stable and lets
developers request only the smaller package when desired. Both builds use the
same ignored `keystore.properties` file and signing key.

### GitHub Actions

The existing `build-android` job remains one job so signing setup, Gradle cache,
and Rust outputs are shared. It performs the universal build first and the
arm64 build second.

Artifact collection must copy the two expected release paths explicitly and
fail when either is absent. It must not collect every APK recursively, because
that can silently publish stale or unintended variants. The uploaded Actions
artifact may be renamed from `release-android-universal` to `release-android`
because it now contains both variants.

The dedicated `publish` job remains unchanged in shape. It waits for the
Android and desktop jobs and creates no Release when either Android variant
fails.

## Verification

Before implementation, use one-off assertions to demonstrate the current
failures:

1. Generated launcher images differ from `icons/android`.
2. `MainActivity` enables edge-to-edge without applying `WindowInsetsCompat`.
3. No arm64 release APK exists.
4. The adaptive icon directly references the nearly full-size foreground and
   uses a white background instead of a 12 dp inset over `#DADEDF`.

After implementation:

1. Run the Tauri unit tests and typecheck.
2. Build both signed APK variants with the local Android SDK/NDK.
3. Verify the universal APK contains arm64-v8a, armeabi-v7a, x86, and x86_64.
4. Verify the arm64 APK contains arm64-v8a and no other ABI.
5. Verify both APKs with `apksigner` and confirm the certificate digest matches.
6. Compare file sizes and report the measured reduction.
7. Parse the workflow YAML and run `actionlint` if available.
8. Confirm `Keystore.jks` and `keystore.properties` remain ignored and
   untracked.
9. Confirm both maintained adaptive-icon XML files use four 12 dp insets and
   both background resources use `#DADEDF`.

Physical-device testing on 2026-08-02 confirmed status-bar avoidance and basic
Hosted Panel behavior. It also selected the 77.8% adaptive foreground after a
comparison of the current, 88%, 78%, and 70% sizes. The rebuilt APK still needs
one focused launcher check to confirm the selected inset matches the real
device's mask. Rotation, display cutouts, and gesture versus three-button
navigation remain useful broader coverage.

## Risks

| Risk                                          | Mitigation                                                                                                                          |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Insets are applied twice by dashboard CSS     | The current UI does not apply Android system-bar safe areas; keep ownership in the native root only.                                |
| Padding is lost after configuration changes   | Install the listener during every Activity creation and let Android redispatch current insets.                                      |
| The second build overwrites the universal APK | Tauri's ABI flavor outputs use separate `universal/release` and `arm64/release` directories; assert both exact paths before upload. |
| arm64 is mistaken for the compatibility build | Keep universal in the Release and document arm64 as the smaller optional download.                                                  |
| Signing material leaks during build changes   | Reuse the current ignored properties and temporary CI keystore paths; verify neither file is tracked.                               |
| Tauri icon regeneration removes the inset     | Keep the mirrored adaptive XML assertions and rerun them whenever `tauri icon` regenerates mobile resources.                        |

## Sources

- Android edge-to-edge guidance:
  <https://developer.android.com/develop/ui/views/layout/edge-to-edge>
- Android Views inset guidance:
  <https://developer.android.com/develop/ui/views/layout/insets>
- Tauri Android architecture builds:
  <https://v2.tauri.app/distribute/google-play/>
- Tauri icon generation:
  <https://v2.tauri.app/develop/icons/>
- Android adaptive icon safe zone and inset guidance:
  <https://developer.android.com/develop/ui/compose/system/icon_design_adaptive>
