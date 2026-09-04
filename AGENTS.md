# BLDesk — Agent & Developer Guide 🤖⚡

This guide documents essential commands, build instructions, and release protocols for AI agents and human contributors working on BLDesk.

---

## 🏗️ Tech Stack & Structure

- **Desktop Framework**: Electron 33 + Vite (`electron-vite`)
- **Frontend**: React 18, TypeScript, Tailwind CSS, Lucide Icons
- **State & Networking**: TanStack Query v5 with custom anti-spam and request deduplication client
- **Auto-Update**: `electron-updater` + GitHub Releases (`latest.yml`, `latest-mac.yml`, `latest-linux.yml`)
- **Mobile**: Capacitor 8 for Android builds

### Directory Map
- `src/main/`: Electron main process (`index.ts`, `updater.ts`, `safeStorage.ts`, `terminal.ts`)
- `src/preload/`: Context bridge exposing typed `bldeskApi` to the renderer (`index.ts`)
- `src/renderer/src/`: React renderer SPA
  - `components/layout/UpdateMenu.tsx`: Auto-update trigger and popover in the title bar
  - `components/layout/TitleBar.tsx`: Desktop custom window controls and profile switcher
  - `api/mobile-bridge.ts`: In-browser / Capacitor bridge fallback for `bldeskApi`
- `src/shared/`: Shared IPC types (`ipc-types.ts`) and SSH helpers (`ssh.ts`)
- `.github/workflows/`: CI/CD workflows (`release.yml`, `android.yml`)

---

## 🛠️ Development & Build Commands

### 1. Verification (Always run before committing)
```bash
# Typecheck both Node (main/preload) and Web (renderer) TypeScript projects,
# then run the mutation-guard check (see "Mutations, confirmation and History"):
npm run typecheck

# Full bundle build:
npm run build
```

### 2. Local Testing
```bash
# Run in dev mode with Hot Module Replacement (HMR):
npm run dev

# Rebuild and launch the isolated local flavor (no production data or updater):
npm run start
```

### 3. Local Packaging (Non-publishing)

These commands package the isolated **BLDesk Local Dev** identity, use separate
local app/session data, retain each platform's full artifact set, and always
pass `--publish never`. Production packaging remains the explicit release path.

```bash
# Package local unpacked directory build:
npm run build:unpack

# Package Windows NSIS installer & portable executable:
npm run build:win

# Package macOS DMG & zip (Universal: Apple Silicon + Intel):
npm run build:mac

# Package Linux AppImage & deb:
npm run build:linux

# Sync web assets to Android Capacitor:
npm run cap:sync
```

---

## 🛡️ Mutations, confirmation and History (read before adding any action)

Every change to a BinaryLane resource goes through **one** confirm dialog and
lands in the **History** tab. This is enforced by `scripts/check-mutation-guards.mjs`,
which runs inside `npm run typecheck` and fails CI. The rules, and what to do
instead:

1. **Never call `window.confirm()` / `confirm()` / `alert()` as a guard.** Use
   `const c = await useConfirm()({...})` from `src/renderer/src/context/ConfirmContext.tsx`.
2. **One dialog shell, no exceptions.** Every dialog is `<Modal>` from
   `src/renderer/src/components/ui/Modal.tsx` (title, icon, footer, size,
   `as="form"`, `busy`); the guard fails any `createPortal` outside that file.
   - A dialog that *changes* something is `useConfirm()`, which renders on the
     shell. Never a new confirmation component: extend `ConfirmRequest` — it
     has `summary`, `notes`, a `changes` table, a line `diff`, `typeToConfirm`,
     a `reason` picker and `extraAction`. Cancel Server and Remove DNS Hosting
     are the pattern for anything irreversible.
   - A read-only dialog (the traceroute viewer, the create-server form) is a
     `<Modal>` with its own body. Same look, same Escape / backdrop / close.
3. **Pick the severity honestly.** `normal` (blue), `destructive` (red button:
   power off, migrations, deletes that can be redone), `irreversible` (red +
   the user must type the target's name: rebuild, restore, delete disk / VPC /
   load balancer, cancel server, remove zone, disable firewall).
4. **Show what will change.** A `changes` table for field edits (rename, resize,
   plan, region, partner), a `diff` for whole-list writes (firewall rules —
   `diffLines(before.map(describeFirewallRule), after.map(...))`). Fetch the
   current state first if you don't have it; a diff of `[]` → new is a lie.
5. **Close the loop in History.** `confirm()` records the entry and returns
   `changeId`. Pass it to `track(action, label, name, changeId)` for anything
   that returns an action, or call `updateChange(changeId, { outcome, detail })`
   yourself for immediate DELETE/PUT results and for failures.
6. **Diagnostics (ping, uptime, is_running) do not confirm.** They change
   nothing. Don't add a dialog to them.
7. **Local-only changes** (tags, groups, profiles) confirm with `log: false`
   when destructive and don't write History — History is for BinaryLane.
8. **Don't add another `useServers()`.** Only `App.tsx` calls it; tabs receive
   `servers` as a prop. A second observer on the same key replaces the shared
   query's function, and one with a null client blanked every view.

The check reports the file and line and the fix. A genuine exception (a file
that must mutate without the dialog) is added to `MUTATION_EXCEPTIONS` in the
script **with a reason** — not by working around the check.

---

## 🚀 Release & Auto-Update Protocol

Auto-update relies on `electron-updater` querying GitHub Releases. Releases **must** be created using the following workflow so update manifests and checksum blockmaps are generated properly.

### Creating a Release

1. **Bump Version**: Ensure `package.json` and `package-lock.json` versions are bumped:
   ```bash
   npm version patch --no-git-tag-version    # or minor / major
   ```
2. **Commit & Tag**: The Git tag **must** match the version in `package.json` (prefixed with `v`):
   ```bash
   git commit -am "chore(release): v1.0.X"
   git tag v1.0.X
   ```
3. **Push to Remote**:
   ```bash
   git push origin main
   git push origin v1.0.X
   ```

### What Happens Automatically in GitHub Actions
1. `.github/workflows/release.yml` triggers on `v*` tag pushes.
2. Validates that the git tag version strictly matches `package.json`.
3. Runs `npm run typecheck` and `npm run build`.
4. Executes `npx electron-builder --publish always` across Windows, macOS, and Ubuntu runners.
5. Generates and uploads to the GitHub Release:
   - Installers: `.exe` (NSIS), `.dmg`, `.zip`, `.AppImage`, `.deb`
   - Manifests & Blockmaps: `latest.yml`, `latest-mac.yml`, `latest-linux.yml`, and `*.blockmap`
6. Deployed clients automatically detect the update, download deltas in the background, and prompt users to restart.

### Beta Channel Releases
For prereleases (e.g. `1.1.0-beta.1`):
```bash
npm version 1.1.0-beta.1 --no-git-tag-version
git commit -am "chore(release): v1.1.0-beta.1"
git tag v1.1.0-beta.1
git push origin main && git push origin v1.1.0-beta.1
```
This produces `beta.yml` manifests, targeting only clients that selected the **Beta** channel in their Update Settings.
