# BLDesk Auto-Update — Change Summary & Implementation Steps

Auto-update for the Electron desktop builds via `electron-updater`, fed from GitHub Releases. A tag push builds Windows / macOS / Linux installers on GitHub Actions and publishes them, along with the update manifests, to a GitHub Release. Running clients check that release feed, download silently, and prompt to restart.

Most of the code is already written into the repo (see "Files changed" below). The remaining manual steps are listed under "Steps to implement".

---

## How it works

**Publishing**
`electron-builder --publish always` builds the per-OS artifacts and uploads them to a GitHub Release named after the tag. It also generates and uploads the update manifests: `latest.yml` (Windows), `latest-mac.yml`, `latest-linux.yml`, and their `beta-*.yml` equivalents when the version has a prerelease component.

**Channels**
Channel is derived from the semver in `package.json`:
- `1.0.28` → stable → `latest*.yml`
- `1.1.0-beta.1` → beta → `beta*.yml`, and the GitHub Release is marked as a prerelease

A client on the **beta** channel reads `beta*.yml` and will also take a stable release that is newer than its current version, so beta users are never stranded. A client on **stable** ignores prereleases entirely.

**Client**
`src/main/updater.ts` wraps `electron-updater`:
- Checks 15 s after launch and every 6 hours
- `autoDownload = true`, `autoInstallOnAppQuit = true`
- Native OS notification when a download completes
- Pushes a `UpdaterState` object to the renderer over IPC on every change
- Channel choice persisted to `<userData>/updater.json`
- Fully no-ops when `!app.isPackaged` (dev mode) — status shows "Dev build"

**UI**
`UpdateMenu.tsx` sits in the title bar next to the profile switcher. It shows `vX.Y.Z` with a dropdown containing status, progress bar, release notes, a Stable/Beta channel select, and "Check now". When an update is downloaded the control becomes a gold **Restart to update** pill.

**Later: self-hosting**
Switching from GitHub to the anycast network is a config change only: set `build.publish` in `package.json` to `{ "provider": "generic", "url": "https://updates.example/bldesk" }` and have the workflow copy the `release/` output (installers, `.blockmap`, and `*.yml`) to that directory. Nothing in `updater.ts` changes.

---

## Files changed

### New

| File | Purpose |
|---|---|
| `src/main/updater.ts` | `UpdaterManager` — wraps `electron-updater`, owns state, channel setting, IPC broadcast |
| `src/renderer/src/components/layout/UpdateMenu.tsx` | Title-bar version indicator, popover, `useUpdaterState()` hook |
| `src/renderer/src/app-version.d.ts` | Declares the build-time `__APP_VERSION__` global |

### Modified

| File | Change |
|---|---|
| `package.json` | Added `electron-updater` dependency; removed `@electron/packager` and the `pack:*` scripts; added `release` script; rewrote `build` block with GitHub `publish` provider, `artifactName`, `extraResources`, and per-OS targets (win: `nsis` + `portable`; mac: `dmg` + `zip` universal; linux: `AppImage` + `deb`) |
| `package-lock.json` | Regenerated: +9 packages (`electron-updater` tree), −57 (`@electron/packager` tree), no other version changes |
| `.github/workflows/release.yml` | **Replaced** (see step 1 — must be copied manually) |
| `electron.vite.config.ts` | Reads `version` from `package.json` and injects `__APP_VERSION__` into the renderer via `define` |
| `src/shared/ipc-types.ts` | Added `UpdateChannel`, `UpdaterStatus`, `UpdaterState` types and five new `IpcApi` methods |
| `src/preload/index.ts` | Exposes `getUpdaterState`, `checkForUpdates`, `installUpdate`, `setUpdateChannel`, `onUpdaterState` |
| `src/main/index.ts` | Imports `UpdaterManager`; registers `updater:*` IPC handlers; calls `UpdaterManager.init()` after `createTray()`; disposes on `before-quit` |
| `src/renderer/src/api/mobile-bridge.ts` | Stubs the five updater methods for Capacitor/Android (`supported: false`) |
| `src/renderer/src/components/layout/TitleBar.tsx` | Renders `<UpdateMenu />` (desktop breakpoint only) before the profile switcher |

### IPC surface

| Channel | Direction | Payload |
|---|---|---|
| `updater:getState` | invoke | → `UpdaterState` |
| `updater:check` | invoke | → `UpdaterState` |
| `updater:install` | invoke | quits and installs if status is `ready` |
| `updater:setChannel` | invoke | `'stable' \| 'beta'` → `UpdaterState` |
| `updater:state` | main → renderer | `UpdaterState` on every change |

```ts
interface UpdaterState {
  status: 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'error'
  currentVersion: string
  channel: 'stable' | 'beta'
  supported: boolean       // false in dev builds and on mobile
  availableVersion?: string
  releaseNotes?: string
  progress?: number        // 0–100 while downloading
  error?: string
  lastCheckedAt?: string
}
```

---

## Steps to implement

### 1. Replace the release workflow (manual — protected file)

Overwrite `.github/workflows/release.yml` with the following. The old workflow used `@electron/packager` + zip, which cannot produce the manifests `electron-updater` needs.

```yaml
name: Build & Release Desktop

# Tag `vX.Y.Z` → stable release (latest.yml). Tag `vX.Y.Z-beta.N` → GitHub
# prerelease on the "beta" update channel (beta.yml). electron-builder derives
# the channel from the semver prerelease component of package.json "version",
# so the tag and the version field must agree.

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false

jobs:
  build:
    name: Build & Publish (${{ matrix.os }})
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [windows-latest, macos-latest, ubuntu-latest]

    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install Dependencies
        run: npm ci --legacy-peer-deps

      - name: Verify tag matches package.json version
        if: startsWith(github.ref, 'refs/tags/')
        shell: bash
        run: |
          PKG_VERSION=$(node -p "require('./package.json').version")
          TAG_VERSION="${GITHUB_REF_NAME#v}"
          if [ "$PKG_VERSION" != "$TAG_VERSION" ]; then
            echo "::error::package.json version ($PKG_VERSION) does not match tag ($TAG_VERSION)"
            exit 1
          fi

      - name: Typecheck
        run: npm run typecheck

      - name: Build Application Bundle
        run: npm run build

      # --- PUBLISH (tags) ---
      # electron-builder uploads installers, blockmaps and latest.yml / beta.yml
      # to a GitHub Release named after the tag, creating it if it doesn't exist.
      - name: Package & Publish to GitHub Release
        if: startsWith(github.ref, 'refs/tags/')
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # Unsigned builds: skip macOS code signing / notarisation until a
          # Developer ID certificate is configured.
          CSC_IDENTITY_AUTO_DISCOVERY: false
        run: npx electron-builder --publish always

      # --- PACKAGE ONLY (manual runs) ---
      - name: Package (no publish)
        if: "!startsWith(github.ref, 'refs/tags/')"
        env:
          CSC_IDENTITY_AUTO_DISCOVERY: false
        run: npx electron-builder --publish never

      - name: Upload Build Artifacts
        uses: actions/upload-artifact@v4
        with:
          name: BLDesk-${{ matrix.os }}
          if-no-files-found: ignore
          path: |
            release/*.exe
            release/*.dmg
            release/*.zip
            release/*.AppImage
            release/*.deb
            release/*.yml
            release/*.blockmap
```

`android.yml` is unchanged and still attaches the APK to the same release.

### 2. Refresh local dependencies

```bash
npm install --legacy-peer-deps
```

`package-lock.json` is already updated; this just syncs `node_modules`.

### 3. Sanity check locally

```bash
npm run typecheck
npm run dev            # title bar should show "v1.0.27 ▾" with a "Dev build" pill
npm run build:unpack   # packaged, unsigned dir build in release/
```

### 4. Commit and cut the first release

```bash
git add -A
git commit -m "Add auto-update via electron-updater and GitHub Releases"
npm version patch --no-git-tag-version   # → 1.0.28
git commit -am "v1.0.28"
git tag v1.0.28
git push && git push --tags
```

The workflow runs on all three OSes and creates the GitHub Release `v1.0.28`. Confirm the release assets include `latest.yml`, `latest-mac.yml`, `latest-linux.yml`, the installers, and `.blockmap` files.

### 5. Verify an update end to end

1. Install `v1.0.28` on a Windows or Linux machine from the release assets.
2. Bump to `1.0.29`, tag, push. Wait for the release.
3. Launch the installed `1.0.28`. Within ~15 s the title bar shows a spinner, then the gold **Restart to update** pill. Click it — the app restarts as `1.0.29`.

### 6. Verify the beta channel

1. Set `package.json` version to `1.1.0-beta.1`, tag `v1.1.0-beta.1`, push. The release is created as a prerelease with `beta*.yml`.
2. On an installed stable client: open the version dropdown → Channel → **Beta**. It re-checks immediately and picks up the beta.
3. Switch back to **Stable**: the client stays on the beta until a stable release with a higher version appears (no downgrades).

---

## Known limitations / follow-ups

**macOS updates require code signing.** Unsigned DMGs build, install and run, but Squirrel.Mac refuses to *apply* an update to an unsigned app, so macOS clients will see "ready" and then fail on restart until signing is in place. To enable:
1. Obtain an Apple Developer ID Application certificate; export as `.p12`.
2. Add repository secrets `CSC_LINK` (base64 of the `.p12`) and `CSC_KEY_PASSWORD`.
3. For notarisation add `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` and set `"mac": { "notarize": true }` in `package.json`.
4. Remove the `CSC_IDENTITY_AUTO_DISCOVERY: false` lines from the workflow.

The embedded terminal adds a native `pty.node` binary and executable
`spawn-helper`; a future signed/notarised build must verify that both nested
binaries are signed and load under hardened runtime. Do **not** add
[`com.apple.security.cs.allow-unsigned-executable-memory`](https://developer.apple.com/documentation/BundleResources/Entitlements/com.apple.security.cs.allow-unsigned-executable-memory) pre-emptively. Apple
documents it as permission to create writable/executable memory and warns that
it increases exposure to memory-safety vulnerabilities; node-pty has not shown
that need in the current unsigned build. Add an exception only if a signed
package demonstrates one is required.

**Windows SmartScreen.** Unsigned NSIS installers trigger SmartScreen warnings for users, but auto-update itself works (`verifyUpdateCodeSignature: false` is set). An OV/EV certificate later uses the same `CSC_LINK` / `CSC_KEY_PASSWORD` secrets on the Windows job.

**Linux `deb` installs don't auto-update.** Only `AppImage` supports in-place updates. Debian users get a notification and must reinstall manually — or drop the `deb` target if that's confusing.

**Portable Windows build doesn't auto-update** by design; it's kept for people who want a no-install exe.

**`xterm` deprecation.** The embedded terminal intentionally stays on the existing xterm 5.3-compatible package line, including `xterm-addon-search@0.13`. Migrate the terminal and all three add-ons together to the `@xterm/*` packages in a separate dependency PR; do not mix package generations.

**Repo-specific values.** `build.publish.owner` / `repo` in `package.json` are set to `termau/bldesk`. Change these if the repository moves.
