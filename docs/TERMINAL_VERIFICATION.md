# Embedded terminal verification

Checked 6 September 2026 against `docs/TERMINAL_SPEC.md`. Tests use generated
keys, a temporary app-data directory, documentation-range IPs and an in-process
loopback SSH protocol fixture. They do not read the BLDesk vault, SSH config,
agent or known-hosts files, contact a BinaryLane server, or persist remote
output.

## Source and behaviour checks

- `src/main/pty.ts`, `src/shared/ssh.ts`: the only child is the `ssh` executable
  resolved from PATH; its arguments are an array from `sshArgv`, not a local
  shell string. Host/user/port/key/size/remote-command inputs are bounded and
  validated. Every PTY IPC operation is restricted to the main window and its
  main frame. The owner caps processes at 32, batches output at 16 ms into
  maximum 64 KiB messages, resizes, sends exits and SIGHUPs all children on
  quit. `scripts/check-pty-guards.mjs` enforces ownership, spawn arguments,
  ConPTY request and sender checks during typecheck.
- Broadcast uses OpenSSH's remote-command argument, not keystrokes injected
  into an interactive session. The installed macOS `ssh(1)` manual confirms
  that a command produces a non-interactive session and that SSH returns the
  remote command's status, or 255 for an SSH error. This keeps a command from
  being consumed by a host-key/password prompt and supplies real per-host exit
  status.
- Inspection of `node-pty@1.1.0` found that `useConpty: true` still falls back
  to winpty below Windows build 18309. BLDesk refuses Windows builds below the
  stable Windows 10 1903 build 18362, so the prohibited winpty path cannot run.
- `src/renderer/src/components/terminal/TerminalView.tsx`, `TerminalTab.tsx`,
  `BroadcastPanel.tsx` and `lib/terminalSessions.ts` were checked against the
  bundled terminal, palette, remote-access, overview, key, shortcut, confirm
  and History help pages. Dialog title, summary, notes and action label in the
  worked example are copied from the handler.

## Automated results

- `npm run test:terminal`: PASS — argv/validation, palette native syntax,
  group/tag/glob targets, persistence whitelist, IPC ownership, batching,
  exit ordering, resize, cap and cleanup.
- `npm run typecheck`: PASS — Node/web TypeScript plus mutation, UI, help and
  PTY guards.
- `npm run build`: PASS — production main/preload/renderer bundles.
- `scripts/terminal-smoke.mjs`: PASS in real Electron 33 on macOS arm64 with
  actual `/usr/bin/ssh` and `node-pty`: passphrase-less key authentication,
  in-session password prompt, `uname -a`, resize reflected by `stty size`, tab
  survival across views, process cleanup, scrollback search, explicit native
  action (stubbed so it cannot open the user's Terminal), two-host parallel
  `hostname` broadcast, two exit-0 panes, originating-profile History with no
  remote output, and a two-tab restart offer with no automatic connection.
- Native Electron zoom/layout: PASS at 1024×680 and 1280×840 at 80%, 100%,
  125% and 150%. The terminal remained visible/refitted and the remote PTY saw
  distinct row/column sizes. Screenshots remain in the temporary test folder,
  not product documentation.
- `npm run build:unpack -- --mac --arm64`: PASS. The packaged app contains an
  unpacked executable `spawn-helper` and Electron-ABI `pty.node`. The added
  unpacked node-pty tree is 3.4 MiB; the app directory increased from 275,540
  KiB to 279,192 KiB (3,652 KiB). The after-pack hook now fails packaging if
  the required platform binary/helper is absent or non-executable.
- `scripts/packaged-pty-runtime.cjs`: PASS under the packaged app's Electron
  executable in Node mode; the unpacked native module loaded with Electron's
  ABI and its helper spawned `/usr/bin/ssh -V` successfully.
- Package override `@electron/rebuild: 3.7.2` in `package.json`:
  `electron-builder@25.1.8` transitively bundles `@electron/rebuild@3.6.1`,
  which predates Electron 33 and fails or produces ABI mismatches when compiling
  `node-pty@1.1.0` native modules (Node 20.18 / ABI 130). Pinning `3.7.2` forces
  the builder to compile `pty.node` and `spawn-helper` against Electron 33 headers
  across all matrix targets. Do not remove this override until `electron-builder`
  updates its internal rebuild dependency.
- Packaged app real server session: PASS on macOS arm64. Opened an interactive
  session to BinaryLane's `scratchpad` VPS (`43.224.183.192`, Ubuntu 24.04.4 LTS)
  directly from the packaged `BLDesk.app` using local identity `~/.ssh/binarylane_key`.
  The unpacked native module loaded, spawned `/usr/bin/ssh`, rendered MOTD and
  prompt in xterm, ran `uname -a` (`Linux scratchpad 6.8.0-138-generic ... x86_64`),
  and closed cleanly on `exit` with status 0.

## Platform boundary

macOS arm64 is tested locally. Windows x64/arm64, macOS x64/universal and Linux
native packaging/runtime remain release-matrix checks. No tag, version bump or
release was created. The existing release workflow will rebuild node-pty during
`npm ci`/packaging, and the new after-pack check will fail a platform leg rather
than silently ship without its native binary. Linux additionally requires its
binary under `build/Release`, proving source compilation rather than a skipped
optional dependency.

## Handoff status

The implementation is an uncommitted working tree on `feat/embedded-ssh`; it
has not been pushed and no pull request has been opened.

Review pass, 6 September 2026: the full Electron smoke (`scripts/terminal-smoke.mjs`)
was rerun on the final tree and passed, after `npm run typecheck` (all four
guards), `npm run test:terminal` and `npm run build`. Three fixes were applied
during review: broadcast panes no longer take keyboard focus as they mount
(keystrokes during a password prompt could land on the wrong host); on Android,
`go terminal` / `bldesk://tab/terminal` shows a desktop-only notice instead of an
empty pane; FEATURES.md no longer lists the terminal as future work.

A real session against BinaryLane server `scratchpad` (`43.224.183.192`) was
verified in the packaged app. Windows and Linux legs are checked when the
release workflow runs; the after-pack hook fails loudly if any leg ships without
its native binary.
