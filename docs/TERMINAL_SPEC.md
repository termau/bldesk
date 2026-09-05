# Embedded terminal (FEATURES.md #1) — build spec

Status: **implemented in the uncommitted `feat/embedded-ssh` working tree and ready for upstream review, subject to the outstanding final smoke rerun recorded in [TERMINAL_VERIFICATION.md](TERMINAL_VERIFICATION.md)**. This was the build brief. Read `AGENTS.md` first: the scope section, "Mutations, confirmation and History", "Zoom and layout", and "User-facing text must be true". This is the one feature FEATURES.md calls "the strongest reason to keep BLDesk open all day", so it gets a planned effort, not a quick pass.

Implementation corrections found by source/runtime verification: broadcast commands are passed as OpenSSH remote-command arguments after the destination, not written as interactive keystrokes (which could feed a password prompt and cannot report command status). `node-pty@1.1.0` can fall back to winpty below Windows build 18309 even when ConPTY is requested, so BLDesk requires the stable Windows 10 1903 build 18362 or later. Apple documents the proposed unsigned-executable-memory entitlement as a writable/executable-memory exception with a security cost; it is not enabled without evidence that a future signed package needs it.

## What we are building

Real SSH sessions inside BLDesk. Today the Embedded Shell tab is an xterm box that only shows a banner and a "Launch Native SSH" button; every SSH entry point hands off to the OS terminal. After this:

1. **Sessions in-app.** `ssh <server>` in the palette, the SSH button on a server, the context menu, the tray's "SSH as root", the `bldesk://ssh/<id>` deep link and the terminal tab's own connect bar all open a live session in a tab inside BLDesk. The OS-terminal handoff stays as an explicit alternative ("Open in native terminal"), never removed.
2. **Tabs.** One tab per session, named after the server, with a status dot (connecting / live / exited) and the exit code on close. Tabs survive switching to other BLDesk tabs. Optional split view is **not** in this pass.
3. **Broadcast.** Pick a target expression (`wp-*`, `@web`, a comma list — the palette's existing grammar), type one command, see per-host output in a grid, with a status pill per host. Parallel execution in this pass; serial is a follow-up.
4. **Scrollback search** (Ctrl/Cmd+F inside a session) and **reconnect after restart**: BLDesk remembers which servers had tabs open and offers to reopen them, one click, never automatically.

## Out of scope

- Anything other than `ssh`. No local shell, no arbitrary commands: the pty runs exactly the argv `sshArgv()` produces.
- Android. It has no pty and no ssh binary; the tab is hidden there and the existing `ssh://` handoff stays.
- Key management, agent forwarding, port forwarding, SFTP.
- Split panes, serial broadcast, session recording.

---

## Architecture

### Main process: `src/main/pty.ts`

`node-pty` runs in main only. One module owns every pty:

```ts
open(options: PtyOpenOptions): Promise<{ id: string }>
write(id, data: string): void
resize(id, cols, rows): void
close(id): void            // SIGHUP the child, dispose
list(): PtySessionInfo[]   // for the renderer to rehydrate after a reload
```

`PtyOpenOptions` = `TerminalLaunchOptions` (host, username, port, privateKeyPath) + `{ serverId?: number; serverName?: string; cols: number; rows: number }`. The handler:

- runs `validateSshTarget(options)` and rejects with its message on failure;
- resolves the `ssh` binary with the existing `findOnPath` in `main/terminal.ts` (export it), fails with "OpenSSH client not found" otherwise;
- spawns `pty.spawn(sshPath, sshArgv(options).slice(1), { name: 'xterm-256color', cols, rows, env })` — the argv array, never a string, never a shell. `env` is `process.env` plus `TERM`; strip nothing else;
- caps concurrent sessions at 32; refuses beyond that with a message;
- pushes output to the **main window only** via `webContents.send('pty:data', id, chunk)`, batched per animation frame (collect chunks, flush every 16 ms) so a `cat` of a large file does not flood IPC;
- on exit sends `pty:exit(id, exitCode, signal)` and disposes;
- on `app.before-quit` closes every session.

Every `pty:*` IPC handler checks `event.sender === mainWindow.webContents` (see how `requireMainRenderer` was done in PR #46 for the shape; that PR was rejected for scope, not for this idea).

Add `'main/pty.ts'` to `MUTATION_EXCEPTIONS` in the guard with the reason "spawns ssh only; argv from sshArgv, no shell". Extend `check-ui-guards.mjs` (or add `check-pty-guards.mjs`): the only file allowed to import `node-pty` is `src/main/pty.ts`, and that file must call `sshArgv(` and `validateSshTarget(` — an agent that "simplifies" to `pty.spawn('bash')` fails the build.

### Preload

```ts
pty: {
  open, write, resize, close, list,
  onData(cb: (id, chunk) => void): () => void,
  onExit(cb: (id, code, signal) => void): () => void
}
```

Typed in `ipc-types.ts`; mirrored in `mobile-bridge.ts` as `undefined` so the renderer feature-detects and hides the tab on Android (same pattern as `probeTcp`).

### Renderer

- `lib/terminalSessions.ts` (pure, no React): the session registry — `{ id, serverId?, serverName, host, username, status: 'connecting'|'live'|'exited', exitCode? }`, plus `rememberOpenSessions()` / `recallOpenSessions()` against localStorage (server id + name + host + username only, never keys or output), and a `broadcastTargets(expression, servers, tags, groups)` that reuses `matchServers` + `expandGroupRefs` from `commands.ts` / `serverGroups.ts`.
- `components/terminal/TerminalTab.tsx`: one xterm instance bound to one pty id. `FitAddon` on mount and on container resize (`ResizeObserver`, not only `window.resize`), `SearchAddon` (`xterm-addon-search`, matches the installed xterm 5.3 line) with a small find bar on Ctrl/Cmd+F, `WebLinksAddon` already present. `term.onData` → `pty.write`; `pty.onData` → `term.write`. On exit print a dimmed `[ssh exited with code N]` line and offer Reconnect / Close.
- `components/terminal/TerminalView.tsx` replaces `EmbeddedTerminal.tsx`: tab strip at the top (server name, status dot, close ×, "+" for the connect bar), the connect bar from today (user, host, key, plus a server picker that fills host from the selected server's primary IPv4), a **Broadcast** button, and "Open in native terminal" as the secondary action. Keep the current theme colours; the xterm background is the app's `#212529`.
- `components/terminal/BroadcastPanel.tsx`: target expression input with the palette's preview (eligible / skipped / unmatched, reuse `partitionByStatus`), a command input, Run. Opens one pty per target, writes `command + '\n'` to each, shows a grid of small xterm panes (2 columns, each 12 rows) with a status pill per host (running / exit 0 green / exit non-zero red). Closing the panel closes those sessions. **Broadcast goes through the shared confirm dialog** (`severity: 'destructive'`, target = the expression, `changes` = one row per host, `typeToConfirm` when more than five hosts) and records to History with the command text — a command fanned out to twenty servers is a mutation in every sense that matters, even though it never touches the BinaryLane API.

### Entry points

Replace each `launchSsh({...})` call with `openSsh({...})` from a new `lib/openSsh.ts`, which opens an in-app tab when `window.bldeskApi.pty` exists and falls back to `launchSsh` otherwise. Add a setting (localStorage, toggle in the terminal tab header) "Prefer native terminal" that flips the default. Palette: `ssh <server>` opens a tab; `ssh <server> --native` (or `nssh`) forces the OS terminal. The deep link `bldesk://ssh/<id>` follows the setting.

### Packaging (the part that bites)

- `node-pty@1.1.0` ships prebuilt binaries for **darwin-arm64, darwin-x64, win32-x64, win32-arm64 only**. The Linux leg of the release matrix (`ubuntu-latest`) compiles it from source: needs `python3`, `make`, `g++` (present on the runner). Verify the Linux build log shows node-pty compiling, not silently skipping.
- The module must be built for **Electron's** ABI, not Node's. `electron-builder` does this during packaging (the existing deb build log shows "executing @electron/rebuild"). For `npm run dev` / `electron .` add a `postinstall` of `electron-builder install-app-deps` so a fresh clone works.
- Add to `build`: `"asarUnpack": ["**/node_modules/node-pty/**"]`. The `.node` binary and the macOS `spawn-helper` cannot load from inside asar, and `spawn-helper` must keep its executable bit (check after packaging on macOS).
- macOS builds are unsigned today. Hardened runtime is not on, so a native module loads fine. When signing lands, `node-pty` needs the `com.apple.security.cs.allow-unsigned-executable-memory` entitlement — note it in `docs/AUTO_UPDATE.md` or wherever signing is documented, do not enable it now.
- Windows: node-pty uses ConPTY on Windows 10 1809+. Do not ship the winpty fallback path; if `spawn` throws, show "Windows 10 1809 or later is required for the embedded terminal" and fall back to native launch.
- Confirm the packaged app size delta and note it in the PR (node-pty is small; the concern is the unpacked directory, not bytes).

---

## Security notes

- The child is always `ssh` with an argv array. No shell, no string interpolation, nothing from a server name reaches argv (`normaliseSshHost` already rejects anything that is not a hostname or IP, so a leading `-` cannot become an ssh option).
- `privateKeyPath` is user-chosen from the local key list; keep the existing control-character check.
- Output from the server is untrusted terminal data. xterm handles escape sequences; do not pass it anywhere else (no History, no logging to disk).
- Host-key prompts appear in the session as they would in a terminal; the user answers them there. Do not add `StrictHostKeyChecking=no`.
- Broadcast is the only place a typed command goes to many hosts at once; that is why it confirms and records.

## Help and docs

- Rewrite `docs/help/terminal.md` from the new component, per the AGENTS rule: tabs, connect bar, broadcast with its exact confirm text, search shortcut, reconnect, native fallback, Android limitation. Add a worked example for broadcast quoting the dialog.
- `docs/help/palette.md`: `ssh` example now says it opens a tab; add the native form.
- `FEATURES.md` #1 status; `CHANGELOG.md` under Unreleased; `README.md` feature list and shortcuts table (Ctrl/Cmd+F in a session).
- `AGENTS.md`: one line under guards: "`src/main/pty.ts` is the only pty owner and only ever spawns `ssh` via `sshArgv`; the guard enforces it."

## Verification (per AGENTS.md)

- `npm run typecheck` including the new guard.
- Packaged builds, not just dev: `npm run build:mac` (or `:unpack`) on macOS and inspect `app.asar.unpacked/node_modules/node-pty` for the `.node` file and an executable `spawn-helper`; the Linux and Windows legs via the release workflow on a prerelease tag.
- Real Electron via Playwright with isolated user data: open a session to a disposable test server (a throwaway BinaryLane VPS, not production), type `uname -a`, assert the output arrives in the xterm buffer; resize the window and assert the pty received the new size (`stty size` on the remote); close the tab and assert the process is gone; broadcast `hostname` to two throwaway servers and assert two panes with exit 0 and a History entry.
- Key-based auth with a passphrase-less test key, and a password prompt path (ssh asks in-session).
- Scrollback search finds a string from earlier output.
- Quit BLDesk with two tabs open, relaunch, confirm the reopen offer lists both and nothing connects until clicked.
- Zoom sweep per AGENTS: 1024×680 and 1280×840 at 100% and 150%; the tab strip, connect bar and find bar stay reachable and the xterm refits.

## Deliverables

`src/main/pty.ts`, preload + `ipc-types` + mobile bridge stub, `lib/terminalSessions.ts`, `lib/openSsh.ts`, `components/terminal/{TerminalView,TerminalTab,BroadcastPanel}.tsx` (removing `EmbeddedTerminal.tsx`), entry-point rewiring, `package.json` deps (`node-pty`, `xterm-addon-search`), `asarUnpack` and `postinstall`, the guard, help pages, FEATURES/CHANGELOG/README/AGENTS. No version bump; the maintainer does that.
