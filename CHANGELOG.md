# Changelog

All notable changes to the **BLDesk** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
 
## [1.0.62-beta.4] - 2026-09-24

- **Android: install this version by hand.** 1.0.62-beta.2 and beta.3 cannot find new releases (fixed below), so download `BLDesk-android.apk` from this release and open it. It is signed with the same key as beta.2 and beta.3, so it installs over them and keeps your account; no uninstall is needed. Updates after this one arrive in the app again.

### Fixed
- **Android update check** (#93): since 1.0.62-beta.2 the in-app update check failed with "Failed to fetch", because the Content Security Policy blocked the local proxy Android's HTTP layer routes requests through.
- **Android back button** (#93): back closed the app from any screen. It now steps back through the app: an open dialog, the command palette, the navigation drawer, a server's sub-tab, the server, then any tab back to Servers. On the Servers screen it sends the app to the background instead of closing it.

## [1.0.62-beta.3] - 2026-09-24

### Fixed
- **SSH to a server with no public address** (#87): with Default SSH address set to Public address, a VPC-only server failed with "No host given". BLDesk now names the server, says it has no public IPv4, and points to Remote Access → Connect to → Custom… (suggesting its private address over a VPN) or Server name.

### Changed
- **Releases are published last** (#88): each release is created as a draft, every installer and the Android APK are attached, and only then is it published. Pull requests are checked by a typecheck, guard and build workflow.
- **Build tooling** (#89, #91): vite 7, electron-vite 5 and @vitejs/plugin-react 5, and js-yaml 4.3.2, clearing the development-tool security alerts. Nothing shipped in the app changed.

Android installs updated to 1.0.62-beta.2 already use the new signing key and update in place.

## [1.0.62-beta.2] - 2026-09-24

A security release. Two things need action from Android users:

- **Android: uninstall, then install this APK.** The app is now signed with a new key, and Android will not update an app signed with a different one. Your token is removed with the old app; add it again after installing.
- **Android: rotate your API token if you ever ran a build older than 1.0.44.** Those builds kept the token in plain storage that Android could back up to the cloud. Create a new token in mPanel and delete the old one.

### Security
- **Main window locked to the app** (#77): it can no longer be navigated to another page, every privileged request checks that it comes from the app's own page, external links open only for http, https and mailto, web permission requests are denied, and a Content Security Policy limits scripts to the app and network requests to the services it uses. Release notes are rendered without raw HTML. The rescue console runs sandboxed in its own session and accepts only https.
- **Sandbox and web security on** (#80): the renderer now runs in Chromium's sandbox with same-origin rules enforced; the page can no longer read local files.
- **Token storage** (#79): on a system with no working keyring, BLDesk refuses to save a token unencrypted unless you explicitly choose to, and labels such profiles. A token that can no longer be decrypted asks to be re-entered. Android stores tokens only in Keystore-backed secure storage. Switching accounts clears the previous account's cached data, and History and settings files are private to your user.
- **Electron 44 and electron-builder 26** (#82): moves off an unsupported Electron release, and fixes an AppImage library-loading issue.
- **Hardened packaged binary** (#83): BLDesk's executable can no longer be used to run other JavaScript.
- **Android** (#85): new signing key kept out of the repository, HTTPS only with system certificate authorities, and no cloud backup or device transfer of app data. The in-app updater opens only BLDesk's own release downloads.
- **Help** (#81): text that looks like a token or key is never sent to the help service.
- **Release pipeline** (#78, #86): builds run with read-only tokens, actions are pinned to exact versions, and only a separate final step can publish, once every build has passed.

### Changed
- The token vault is now titled "API Token Vault".
- "Save server as template" warns that captured user data may contain secrets.
- In-app help: quoted dialog text is checked against the app at build time (#76).

## [1.0.61-beta.11] - 2026-09-23

### Changed
- **Server List Sorted by Name** (#71):
  - Servers still building stay at the top, and the rest are now listed by name instead of the API's order. Sorting is numeric-aware, so `web-2` comes before `web-10`.

### Fixed
- **Help Button Beside Page Actions** (#70):
  - On VPCs, DNS & Domains, SSH Keys, Load Balancers and History, the help `?` now sits next to the page's action button instead of drifting to the far edge of the header.
- **Templates on a Phone** (#67):
  - Below the large breakpoint the template library is capped in height and scrolls, so the selected template is reachable on the first screen. The header's buttons wrap instead of pushing the help `?` off the edge.
- **Cancel Reported as Failed After Succeeding** (#68):
  - A "not found" reply to a server cancellation means the server is already gone, so it is now recorded in History as completed rather than failed.
- **Archived Status Explained** (#69):
  - "Archived" keeps BinaryLane's own name and now has a tooltip explaining it: powered off due to cancellation or non-payment.
- **Network Map Zoom Help** (#66):
  - The map's help page explains that Cmd/Ctrl+scroll, the zoom buttons and pinch zoom the map, while Cmd/Ctrl+plus and minus zoom the whole app.
- **Android Release Build**:
  - The Android workflow now installs the SDK packages the build uses, after the obsolete `tools` package it requested by default stopped being served.

## [1.0.61-beta.10] - 2026-09-23

### Added
- **Every Address in Network & Addressing** (#64, #74):
  - The server overview now lists the primary public IPv4, every secondary public IPv4, every private address and IPv6, each with its own copy control. Previously only the first public address was shown, so a second IPv4 bought through Change Plan appeared nowhere else in the app.
  - One row per kind of address, with the label pluralised when a server holds more than one.

### Fixed
- **In-App Help Crash on Windows** (#65, #72):
  - Every `?` control crashed with "Cannot read properties of undefined (reading 'id')" in Windows builds, whose help pages are bundled with CRLF line endings.
  - The help outline and renderer now split lines through one helper and assign heading anchors as they go, so they can no longer disagree.
- **VPC-Only Servers Labelled as Public** (#74):
  - A server with no public address showed its private VPC address under "Public IPv4". It now appears under "Private IPv4", and the public row is shown only when a public address exists.
- **Screens Unusable on a Phone** (#63):
  - The disk images and SSH keys tables scroll sideways instead of clipping their actions, firewall rule cards wrap, and the Network tab's VPC row stacks on narrow screens.
  - The server header truncates long hostnames, drops the "Server:" label below the small breakpoint, and shortens "Launch SSH" to "SSH" on a phone. The desktop layout is unchanged.
  - Custom thin scrollbars now apply to mouse and trackpad devices only, giving touch screens their native overlay scrollbar back.
- **Credential Vault Permissions** (#73):
  - The token vault file is now written readable by its owner only (`0600`), and an existing vault is tightened on the next launch.

## [1.0.61-beta.9] - 2026-09-09

### Added
- **Network Map Touch Gestures** (#61):
  - Added pan and pinch-to-zoom touch gesture support to the interactive Network Map on mobile and touch devices.
  - One-finger touch pans across the canvas smoothly, and two-finger pinch zooms in and out (`[0.2, 3]` clamp range) anchored to the midpoint of the gesture.
  - Container utilizes `touch-action: none` to prevent the browser/WebView from capturing touch events for page scrolling.

### Fixed
- **Action Polling Resilience on Dropped Requests** (#59):
  - Action settlement poller (`pollActionToSettled`) now treats network transport drops (`TypeError: Failed to fetch`) the same as slow poll timeouts, retrying until the deadline instead of immediately failing the action as `lost`.
  - Fixes false-positive action failures on mobile devices when long-running actions (such as server resizes) encounter radio sleeps, network handovers, or device lock/unlock cycles.
- **Action Progress Toast Positioning on Mobile** (#60):
  - Repositioned the action progress toast on viewports below `md` breakpoint (`fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px)+0.75rem)]`) so it clears the mobile bottom navigation bar and gesture navigation inset, keeping the toast and close button fully visible and accessible.

## [1.0.61-beta.8] - 2026-09-07

### Added
- **Browse & Remember Custom SSH Key Files**:
  - Added a **Browse…** button in **Remote Access** directly beside *Key for this server* to select an existing private key from anywhere on disk with any filename.
  - No longer requires a neighbouring `.pub` file or standard `~/.ssh` directory structure.
  - Security & Privacy: BLDesk retains only the exact local file path string per server and profile. Private-key contents are never read, copied, imported, or transmitted, and passphrase storage is deliberately not attempted.
  - Full launcher integration: Selected keys are checked by metadata and supported seamlessly across all SSH launch buttons, terminal reopen, session key-learning, and parallel broadcast.
  - UI display: Shows the key filename in the selector and the complete path beneath it.

## [1.0.61-beta.7] - 2026-09-06

### Fixed
- **macOS In-Place Auto-Update Process Swap**:
  - Fixed an issue where the updater hung during the update swap when upgrading on macOS.
  - Root cause: `installMacUpdate` executed `unzip` synchronously on the main thread, freezing the UI and event loop, while calling `app.quit()` which was intercepted by tray window-close handlers (`event.preventDefault()`). The helper script sat in an unbounded wait loop for the old PID, and `before-quit` triggered duplicate concurrent extraction jobs.
  - Solution: Offloaded archive extraction directly to the detached helper script after process termination, added a re-entrancy installation guard (`macInstalling`), bounded the process wait loop with a force-kill fallback, and switched from `app.quit()` to `app.exit(0)` to prevent tray interception during an update restart.

## [1.0.61-beta.6] - 2026-09-06

### Fixed
- **Windows Embedded SSH Session Close** (fixes #55):
  - Fixed an issue on Windows where clicking the close button on an embedded SSH tab had no effect while SSH was attempting to connect, leaving the tab open until the connection timed out.
  - Root cause: `node-pty` on Windows throws `Signals not supported on windows.` when any signal argument is passed to `kill()`. The unhandled rejection prevented the renderer from closing the tab and caused Windows to leak background SSH processes on application exit.
  - Solution: `close()` now invokes a bare `process.kill()` with no arguments on Windows, directly terminating the ConPTY process. Other platforms (macOS, Linux) continue sending `SIGHUP`.
  - Updated test runner assertions in `scripts/test-terminal.cjs` to handle platform-specific termination signals.

## [1.0.61-beta.5] - 2026-09-06

### Added
- **Per-Server SSH Connect Address & Tailscale/VPN Support** (addresses #56):
  - Configurable per-server connection target under Remote Access: **Public address** (default), **Server name** (resolves Tailscale MagicDNS / local DNS short names), or **Custom…** (arbitrary hostname, Tailscale 100.x IP, FQDN, or `~/.ssh/config` Host alias). Resolves issue #56.
  - Per-profile default connect address setting (**Default SSH address**) in the Terminal header (Public address or Server name).
  - Unified SSH resolution (`openServerSsh`) across all entry points: Server List row button, Server Details header & Remote Access, Network Map, Command Palette, Context Menu, Tray menu, Deep Links (`bldesk://ssh/...`), Terminal tab reopen, and Broadcast panel.
  - Profile fallback logic ensures callers without explicit profile context resolve the active profile's preferences rather than ignoring overrides.
  - Broadcast panel execution preview displays the resolved target host per server and skips any server with an invalid or missing connect address with a clear `invalid connect address` reason.
  - Reachability badge tooltip clarifies *"Checks the public address"* when an override is active so users know ping checks the public IP even when SSH connects over a private tailnet.
  - System OpenSSH architecture: delegates hostname/alias resolution to the OS and system OpenSSH binary without embedding VPN credentials or altering local configuration.
  - Updated Help documentation (`server-remote-access.md`, `terminal.md`, `troubleshooting.md`) with setup guides for firewalled public SSH, Tailscale MagicDNS, WireGuard, and `~/.ssh/config` host aliases.

## [1.0.61-beta.4] - 2026-09-06

### Fixed
- **macOS Unsigned Auto-Update Engine**:
  - Bypassed Squirrel.Mac on macOS to allow unsigned application builds to auto-update without hitting `SQRLCodeSignatureErrorDomain` ("code object is not signed at all").
  - Direct universal zip download streaming with real-time transfer progress, in-place atomic application bundle swap on restart or quit via detached helper script, and automatic Gatekeeper quarantine (`xattr -cr`) clearance.
  - Added structural updater guard suite (`scripts/check-updater-guards.mjs`) to verify auto-update invariants on every build.
  - *Note for macOS users on beta.2/beta.3*: Install this build once manually (via DMG or Zip) to upgrade to the new self-updating engine; subsequent updates will install automatically.

## [1.0.61-beta.3] - 2026-09-06

### Added
- **Per-server SSH Key Associations**:
  - Per-profile, per-server local SSH key-path associations, editable in Remote Access and the server details header, with embedded-session learning after ten seconds live or a normal non-255 exit. No private-key contents are read or retained by BLDesk.
  - Connect-picker key-source labels (`associated`, `last used`, `ssh default`) and per-host broadcast key previews, including explicit skips for missing associated keys.

### Fixed
- **SSH Multi-Key Fleet Resolution**:
  - SSH entry points now resolve the server association, then the profile's last working key, then OpenSSH defaults instead of selecting the first discovered key. Broadcast resolves identities independently for each host.
  - Explicit SSH keys now include `IdentitiesOnly=yes` so unrelated agent identities do not crowd out the selected key; default-identity connections retain their existing OpenSSH behaviour.
- **Server Overview Formatting**:
  - Aligned Disk Storage card formatting with Memory card (used percentage large, with capacity and NVMe description beside it).

## [1.0.61-beta.2] - 2026-09-06

### Added
- **Desktop Embedded SSH**:
  - Interactive multi-session terminal tabs powered by `node-pty` and `xterm.js`, with per-session scrollback search (Ctrl+F), refit and native zoom tracking.
  - Non-interactive parallel SSH broadcast with real OpenSSH remote command execution, per-host exit status, and history logging without persisting sensitive remote output.
  - Process lifecycle management capped at 32 concurrent sessions with automatic cleanup on tab close and application quit.
  - Reopen previous sessions prompt after application restart.
  - Desktop-only safeguards: Android retains external SSH client intent handoff.
- **PTY Security & IPC Guards**:
  - Strict host, user, port, and key argument validation preventing shell injection; OpenSSH is invoked via argv array directly from PATH.
  - IPC restricted to main window and main frame; comprehensive typecheck guards (`scripts/check-pty-guards.mjs`).
- **Packaging & Electron 33 Native Build**:
  - Pinned `@electron/rebuild: 3.7.2` via npm overrides to guarantee ABI 130 compatibility across macOS, Linux, and Windows.
  - Package validation hook in `scripts/after-pack.cjs` that fails builds loud if any platform target is missing `pty.node` or platform spawn helpers.
  - Verified live SSH connectivity to real BinaryLane VPS instance (`scratchpad`).

## [1.0.61-beta.1] - 2026-09-05

### Fixed
- **Mobile in-app updater semver comparison**:
  - Implemented proper SemVer 2.0 comparison in the mobile bridge (`semverCompare`), resolving an issue where Android in-app updates ignored prerelease/beta increments (e.g. comparing `1.0.60-beta.7` vs `1.0.60-beta.3` as identical).
  - Version bump to 1.0.61-beta.1 ensures currently installed 1.0.60-beta.X devices trigger the update immediately.
- **Unpacked desktop updater feed**:
  - Ensured `app-update.yml` is generated across all platforms in `after-pack.cjs`, and configured static GitHub feed URL in `main/updater.ts` with graceful `check-failed` handling.

---

## [1.0.60-beta.7] - 2026-09-05

### Fixed
- **Ask BinaryLane Ordering & Search Relevance** (*PR #50 by @termau*):
  - Ask BinaryLane answer card now renders first once a question is submitted, keeping the answer above the fold.
  - Local help hits capped at 5 with a "Show all N topics" toggle.
  - Ignored conversational stop words (how, do, I, an, the, etc.) in `searchHelp` and dropped incidental body matches on multi-word queries.
  - Added IP address keywords to Server Network and Change Plan help pages.

---

## [1.0.60-beta.6] - 2026-09-05

### Added
- **Help & Ask BinaryLane** (*PR #48 by @termau*):
  - Bundled, searchable documentation for every tab, server sub-tab and palette verb; contextual question-mark links, worked examples and help deep links.
  - Ask BinaryLane answers and source articles from BinaryLane's published-article service directly in the search box, with suggestions, feedback and offline-safe local results. Questions use a fixed-origin, unauthenticated transport and contain only the visible search text.
  - Help coverage and internal-link guards run with `npm run typecheck` (`scripts/check-help-guards.mjs`).

### Fixed
- **Android offline detection**:
  - Android WebView now declares the read-only `ACCESS_NETWORK_STATE` permission, so offline help detects disconnected Wi-Fi/mobile data instead of attempting a request. Verified with the installed APK on an Android 36 ARM emulator, including native HTTP answers, suggestions, feedback, keyboard and rotation.

---

## [1.0.60-beta.5] - 2026-09-05

### Fixed
- **Desktop zoom shortcuts and scrollable navigation** (#18, *PR #47 by @termau*):
  - Enabled desktop zoom shortcuts (`Ctrl/Cmd` + plus/minus/equals, and `0` to reset), with an 80–150% bounded range (80%, 90%, 100%, 110%, 125%, 150%) shared by keyboard, View menu, and native `zoom-changed` events.
  - Allowed both desktop navigation columns (global navigation and server sub-nav) to scroll vertically when the window is short or zoomed in, keeping lower items reachable while maintaining the footer.
  - Added a lightweight UI source guard to `npm run typecheck` (`scripts/check-ui-guards.mjs`) verifying zoom ownership, shortcut configurations, and menu handler boundaries.

---

## [1.0.60-beta.4] - 2026-09-04

### Fixed
- **Change Plan transfer hand-over and narrow layout** (*PR #45 by @01ax*):
  - Changing base size now resolves transfer to the target plan's included transfer allowance (matching web panel behaviour), and displays the resulting allowance in the before → after review table as a Data row.
  - Backup retention selectors and option grids no longer overflow in narrow windows (`min-w-0`).
  - IP Addresses dropdown is constrained to `max-w-sm` instead of stretching across the screen.
  - Backups view inside a server's page is pinned to that server (`initialServerId`) rather than presenting a redundant server picker.
  - Standardised terminology across the UI and command palette: BinaryLane creates backups rather than snapshots (`snapshot` / `snap` remain silent palette aliases).
  - Dropped temporary AI-written unit tests and `vitest` devDependency.

---

## [1.0.60-beta.3] - 2026-09-04

### Fixed
- **Offsite backup frequency surcharge** (*PR #43 by @termau, absorbing PR #42 by @01ax*): The surcharge shipped in beta.2 took the largest rate among the enabled backup frequencies. The web panel, and the API's own description of `offsite_backup_frequency_cost`, apply the rate of the highest *frequency* enabled: daily, else weekly, else monthly. The two only agree while rates are published in that order, so this is invisible today and would have diverged from the panel the moment a rate shipped out of order. Tests now use out-of-order rates so the wrong rule cannot pass, and also pin that the offsite storage term counts raw selected backups without deducting plan inclusions, as the panel does. 46 tests.

---
 
## [1.0.60-beta.2] - 2026-09-04

### Fixed
- **Change Plan review follow-up** (*PR #40 by @01ax*): A required licence group (cPanel images ship no opt-out tier) now defaults to its cheapest real option and holds the submit until one is chosen, instead of the API rejecting the resize after confirmation. Billing counts backups against the plan's included counts, charges the offsite surcharge for the highest enabled frequency, and prices transfer above the allowance; none of these move a number on today's plans. The resize payload now carries `transfer`, clamped to the target plan's range, so a plan change no longer resets the allowance. The pre-action backup offers only genuinely free slots and, where none is free, asks for the exact backup to replace. Windows SAL copy points at support rather than the web panel. Adds `vitest` with 43 tests over `lib/licences.ts` and `lib/serverPricing.ts`, run by `npm run typecheck`.
- **Template dialogs and the sidebar** (*PR #41 by @termau*): The template editor, apply and paste dialogs had no body or footer padding, so fields sat flush against the panel edge; they now match the other dialogs. Every dialog starts below the title bar instead of over it. Leaving Server Details (for example via **Save server as template**) shifted the whole app 48px because the icon rail plus server sub-nav was wider than the plain sidebar; the sub-nav is now sized so both layouts are the same width, and the width transition is gone.

---
 
## [1.0.60-beta.1] - 2026-09-04

### Added
- **Change Plan: licences, reinstall, pre-action backup, and billing summary** (*PR #35 by @01ax and @termau*):
  - Change, add, or remove licences during plan resizing with OS compatibility validation.
  - Reinstall OS option directly within the Change Plan panel.
  - Optional pre-action backup slot selection.
  - Real-time billing calculation and changes summary before confirmation.

### Fixed
- **Template saves rejected on desktop** (#34, *PR #36 by @termau*): Saving any template through the Electron bridge failed with `Template YAML requires string fields "name" and "user_data"`, including **Save server as template** and **Save this form as a template instead**. The main-process store still validated the first-cut `name` + `user_data` shape while the app has written `kind: bldesk/server-template@1` documents with a `spec` block since full server templates landed; the validator now accepts the current schema (and still the old one), with the kind constant shared between main and renderer. The template editor also swallowed the rejection into the page banner behind the open dialog, so Save appeared to do nothing; store errors now show inside the dialog.
- **Templates page margins** (#33, *PR #38 by @termau*): Fixed layout margins so the Templates tab has the same padding as every other tab (`p-4 md:p-6`).

### Chore
- **Enforce LF line endings in repository via `.gitattributes`** (*PR #37 by @termau*): Repository-level line ending enforcement ensuring LF text storage, proper platform script endings (`.sh`/`gradlew` LF, `.bat`/`.cmd`/`.ps1`/`.nsh` CRLF), and binary asset protections.
- **Features roadmap update** (*PR #39 by @termau*): Scorecard and documentation update reflecting features shipped through v1.0.59.

---

## [1.0.59] - 2026-09-03

### Fixed
- **Fleet Heatmap rate floors** (*PR #32 by @termau*): On quiet fleets, rate colours previously reached red at low numbers (e.g. 5.8 KB/s) because intensities were purely relative to the fleet maximum. Added absolute floors (~40 Mbit/s for network in/out and 10 MB/s for disk read/write) so cells only colour when activity is notable. Tooltips now explain whether the cell is scaled against the floor or the fleet maximum, and the CPU tooltip formats as a clear percentage of 100 × vCPUs.

---

## [1.0.58] - 2026-09-03

### Added
- **Fleet Utilisation Heatmap** (FEATURES.md #9, *PR #31 by @Freewheelin*): a sortable live grid for CPU, RAM, disk, network and storage IO across every server. Capacity metrics use each server's provisioned resources, throughput rates use fleet-relative intensity, and stale, unavailable, building and inactive servers remain explicit. Active-server metrics refresh once per 5-minute sample period, timed to the period end, four requests at a time, and a sweep already in flight is not duplicated; selecting a row opens that server's Usage tab.

### Fixed
- **Frameless window had no edge on Linux** (*PR #26 by @termau*): Without the OS frame nothing drew a border or shadow, so the window was a flat rectangle against the desktop. A one-pixel inset border now stands in for the window manager's, Linux only, and disappears when maximised.

---

## [1.0.57] - 2026-09-03

### Changed
- **Server templates, first class** (FEATURES.md #8, replaces the cloud-init-only templates):
  - A template is a whole server: region, plan + options (memory, disk, IPv4 count, backups), image, VPC and SSH keys by name, firewall rules, local tags, and cloud-init with `{{variables}}` (`{{hostname}}` built in; secrets prompted per apply and never stored).
  - New **Templates** tab with a library, editor, file/paste import and single/bundle export (`bldesk/server-template@1` YAML). Existing cloud-init templates are read as-is and migrate on first save.
  - Seven starters shipped read-only: Ubuntu baseline, **CIS-hardened Ubuntu 24.04**, Docker host, WordPress, WireGuard bastion, k3s node, PostgreSQL 16 — real cloud-init, every firewall set ending in an explicit drop.
  - **New server from this**: variables prompt → create form prefilled (still the review) → after BinaryLane accepts, BLDesk waits for the build, applies the template's firewall rules (recorded in History) and tags the server.
  - **Save server as template** (server → Cloud-init tab) captures plan, image, region, VPC, firewall rules and user data; **Save this form as a template instead** on the create form.
  - Palette verb: `create <hostname> from <template>`.
- `CreateServerModal` gains an `initial` prefill prop and passes the new server's id to `onCreated`.

### Removed
- `CloudInitTemplates.tsx` and `lib/templates.ts` (superseded; the server list's Templates button now opens the tab).

---

## [1.0.56] - 2026-09-03

### Changed
- **Change Plan: full size options configuration** (*PR #29 by @01ax*):
  - Change Plan now sends the complete `ChangeSizeOptionsRequest` configuration rather than only `{size, memory, disk}`.
  - Pre-populates and manages `ipv4_addresses`, `ipv4_addresses_to_remove`, backup retention schedules (`daily_backups`, `weekly_backups`, `monthly_backups`), and `offsite_backups` directly from the server's current `selected_size_options`.
  - Enforces explicit address selection when decreasing IPv4 address counts, preventing accidental loss of arbitrary IP addresses.
  - Adds "Continue using <OS>" option directing to Rebuild for intentional OS changes.
  - Corrects address price fallback calculation (`+$2.00` per additional address) when current plan is retired.

---

## [1.0.55] - 2026-09-03

### Changed
- **One dialog shell.** The confirm dialog, the create-server form (and its add-key sub-dialog) and the traceroute viewer now render through a single `Modal` component: same backdrop, panel, header, close button, Escape and backdrop-click everywhere. The mutation guard's rule 2 is now "no `createPortal` outside the shell", so a new kind of dialog fails CI instead of needing a review discussion. Mutating dialogs still go through `useConfirm()`; read-only ones are a `Modal` with their own body.

---

## [1.0.54] - 2026-09-03

### Changed
- **Reachability UI Polish** (FEATURES.md #11, *PR #27 by @01ax*):
  - **Compact Status Pill**: Folded multi-line reachability explanation into a single neat status pill (`⚠ Port 22 unreachable  ?  ⟳`), keeping header height stable.
  - **Single-Blink "?" Indicator**: The `?` icon blinks once on new probe failures (keyed by probe sequence) without ongoing visual distraction.
  - **Accessible Hover Card**: Explanation, firewall link, and traceroute trigger now live in a card reachable via both hover and keyboard `focus-within`, with zero mouse-out dead zones.
  - **Traceroute Dialog**: Route output now renders inside a dedicated modal dialog with live tracing state, backdrop dismissal, and hop explanations.
  - **No-Flash Re-check**: Retains previous probe results on screen during manual refresh, spinning only the leading icon.

---

## [1.0.53] - 2026-09-03

### Fixed
- **Release notes rendered as raw HTML in update popover**: GitHub Releases API provides release descriptions as pre-rendered HTML (`body_html`). The update menu previously escaped this as plain text, exposing raw HTML tags (`<h2>`, `<p>`, `<a>`). Added `ReleaseNotesView` to safely parse and sanitize HTML / Markdown, render styled headings, lists, code pills, and links, and route clicked links to the default system browser via `openExternal`.

---

## [1.0.52] - 2026-09-03

### Added
- **Reachability Probes & Firewall Verdict** (FEATURES.md #11, *PR #25 by @01ax*):
  - Local latency and connectivity chip alongside the **Launch SSH** button on Server Details, qualifying whether port 22 is reachable directly from the user's current workstation.
  - Three distinct probe states: `connected` (with round-trip latency), `refused` (port closed / sshd not running on guest), and `timeout` (silently dropped by firewall).
  - **Firewall Verdict**: When a timeout occurs, analyzes the server's rules against BinaryLane's stateless first-match firewall semantics to diagnose whether the packet was `blocked` (naming the exact rule number and definition), had `no-matching-rule` (drop occurred on the guest OS or intermediate route), or `no-rules` (unfiltered by BinaryLane).
  - Source-scoping awareness: only universal (`0.0.0.0/0`) accept rules shadow subsequent drop rules.
  - Rate-limited reachability probe worker (`main/reachability.ts`) enforcing account IP allowlists and rolling 30 probes/min throttle.

### Fixed
- **Double Window Chrome**: Removed redundant OS title bar frames on Windows and Linux (app title bar now handles window drag, minimize, maximize/restore tracking, and close). On macOS, native traffic lights are preserved and overlaid with inset padding.

---

## [1.0.51] - 2026-09-03

### Fixed
- **AppImage startup crash on Ubuntu 24.04 resolved via launcher hook**: 1.0.49 tried to append `--no-sandbox` from Electron's `main/index.ts`, but Chromium spawns its zygote and validates the sandbox before any application JavaScript executes. We now use an electron-builder `afterPack` hook (`scripts/after-pack.cjs`) to install a wrapper launcher script (`bldesk`) that invokes `bldesk.bin` with `--no-sandbox` only when `$APPIMAGE` is set and unprivileged user namespaces are restricted. The `.deb` package's AppArmor profile was updated to attach to `bldesk.bin`.

---

## [1.0.50] - 2026-09-03

### Fixed
- **Create server History entries never left "Submitted"** (#23, reported by @01ax). The handler recorded the change and then discarded the id, so nothing ever wrote the outcome back. It now resolves to completed (with the new server's id) or failed. The mutation guard gained a rule for it: an id from `recordChange()` must reach `updateChange()` or `track()` and must not be `void`ed.

---

## [1.0.49] - 2026-09-03

### Fixed
- **AppImage aborted on Ubuntu 24.04** with "The SUID sandbox helper binary was found, but is not configured correctly". AppArmor there blocks unprivileged user namespaces, so Chromium falls back to a setuid helper that cannot be root-owned inside a FUSE mount. The `.deb` failed the same way for a different reason: electron-builder's post-install tests for user namespaces as root, where they always work, and so deliberately left the helper without its setuid bit. The `.deb` now installs an AppArmor profile granting `userns` to the binary (what Ubuntu documents and what Chrome's own package does), so Chromium's preferred sandbox works there and the setuid helper is never used; it only falls back to a setuid helper where the kernel restricts namespaces *and* AppArmor is absent. The AppImage, which cannot install a profile, now ships a launcher that checks that kernel setting and starts the real binary with `--no-sandbox` only in that case (1.0.49 tried to do this from inside the app, which is too late: Chromium sandboxes before any app code runs). The `.deb` is the recommended package on those releases. It also now depends on `libasound2`, without which the binary would not load on a machine that lacked ALSA.

---

## [1.0.48] - 2026-09-03

### Added
- **Cloud-Init Template Library** (FEATURES.md #8, *thanks @Freewheelin!*):
  - Device-wide YAML template library with local file storage under `<userData>/templates/` on desktop and encrypted fallback on Android.
  - Create, view, rename, delete, copy/paste, and reveal templates on disk.
  - Create-server integration: user data is enabled only for images that advertise `user-data` support; load and save templates directly within the deployment flow.
  - Server details Cloud-init subtab displaying the exact user data used at server initialisation (`GET /v2/servers/{id}/user_data`) with copy and save-as-template actions.
  - On-demand fleet user-data coverage inspection table.

### Changed
- **Server Sub-Nav Reorganisation** (*thanks @01ax!*):
  - Moved **Change Plan** and **Cancel Server** out of Settings into their own primary server sub-navigation tabs, matching mPanel layout. Both tabs are fully deep-linkable.
  - Passed custom confirmation metadata through to preserve the Change Plan before → after diff table.
- **Accurate Building Server Status** (*thanks @01ax!*):
  - Properly detects and maps `new` status to an amber "Building" indicator with an animated spinner, sorting newly provisioned servers to the top of the fleet list.
  - Fixed hardcoded "Online" network status literal on server cards to accurately reflect actual provisioning and power state.
  - Added `.pb-bottom-nav` padding utility to prevent mobile navigation bar from obscuring bottom page content.
- **Network Map VPC Grouping Polish**:
  - Grouped fleet by VPC across regional columns so multi-region VPC clusters stay cleanly contained in single boxes.
  - Added authoritative `useVpcMembers` query (`/v2/vpcs/{id}/members`) for precise membership resolution.

---

## [1.0.47] - 2026-09-03

### Added
- **Network Map** (FEATURES.md #10): a new tab that draws the account as a schematic, tiered the way traffic flows — the internet on a rail at the left, then load balancers, then VPCs, then the servers in them. VPC boxes come from the account's VPC list and their member lists (empty VPCs get a box too), with a region column inside each box, so a cluster that spans Brisbane and Sydney is one box with two columns rather than two boxes. The VPC a load balancer belongs to (or fronts) is drawn first. Every server carries an *exposure port*: the ports the world can reach, coloured by the firewall audit (red for SSH/RDP open to the internet, amber for no rules or shadowed rules). Click a node to draw its paths and open a detail panel (addresses, VPC, what's reachable, findings, Open / SSH); "Public paths" draws every internet edge at once. Search dims everything that doesn't match. Pan by dragging, zoom with ⌘/Ctrl + wheel, fit to window. Export as SVG or 2× PNG for a ticket or a doc. The layout is deterministic, so the same fleet always draws the same picture. `go map` in the palette.

---

## [1.0.46] - 2026-09-03

### Changed
- **One confirm dialog, everywhere.** Cancel Server and Remove DNS Hosting no longer have their own dialogs: both use the shared confirm, which gained a **reason picker** (select + detail, forwarded to BinaryLane and recorded) and an **in-dialog side action** ("Copy the zone file first"). Both are `irreversible`, so the target's name must be typed, and both now land in History with their outcome — Cancel Server previously left no entry at all.
- **Change Plan shows a before → after table** (plan, memory, storage, monthly cost ex-GST on both sides) instead of a sentence, and says the server restarts.
- **Guard rails for contributors and agents.** `npm run typecheck` now also runs `scripts/check-mutation-guards.mjs`, which fails CI on a native `confirm()`, a new bespoke confirmation dialog, or any API mutation call whose handler neither confirms nor records to History (per call, not per file; a genuine non-change carries `// history: n/a — reason`). The rules and the fixes are written up in `AGENTS.md` under "Mutations, confirmation and History".
- **Every create and attach now lands in History too.** The guard found ten silent mutations: take backup, add DNS record, add / import SSH key, create load balancer, add a backend, create VPC, attach a server to a VPC, attach / detach a backup drive. Each is recorded before it is submitted and settles to completed or failed.

---

## [1.0.45] - 2026-09-03

### Added
- **Change Plan (Resize) Tab** (*thanks @01ax!*):
  - Added dedicated Change Plan subtab under Server Details driving the `resize` action.
  - Shares pricing and availability calculations (`serverPricing.ts`) with create form, ensuring consistent licensing surcharges and exact mPanel storage ladders.
  - Gracefully displays current plan details even for retired plans (e.g. `a-3040`) with legacy notices.
  - Warns when shrinking memory or storage volumes.
- **Cancel Server Modal** (*thanks @01ax!*):
  - Added guarded `DELETE /v2/servers/{id}` cancellation flow with optional cancellation reason dropdown and free-text input.
  - Requires typing the exact server hostname to confirm irreversible deletion, displays current billing rate, and warns of attached backup removal.
- **Customer-Facing Advanced Features Filter** (*thanks @01ax!*):
  - Filters raw operator-level hypervisor flags (`local-rtc`, `uefi-boot`, etc.) to customer-facing switches with mPanel labels and descriptions.
  - Preserves hidden operator switches when saving (`mergeHiddenFeatures`).
- **Machine Type and VPC Name Display** (*thanks @01ax!*):
  - Formats QEMU machine types cleanly as `pc-i440fx-7.2` rather than raw API enum strings.
  - Displays human-readable VPC network names with network glyphs instead of internal IDs (`VPC #4213`).

---

## [1.0.44] - 2026-09-03

### Fixed
- **Android Mutation Transport Fix** (*thanks @01ax!*):
  - Fixed mobile bridge request extraction where `Request` objects were treated as empty options, causing mutations (power actions, reboots, DNS edits, backups) to be sent as silent `GET` requests instead of `POST`/`PUT`/`DELETE`.
  - Re-enabled deduplication guards on duplicate in-flight submissions.
- **Hardware-Backed Keystore Encryption on Android** (*thanks @01ax!*):
  - Migrated profile and token storage to `@aparajita/capacitor-secure-storage` using AES-GCM keys backed by the Android Keystore.
  - Automatically migrates existing cleartext SharedPreferences tokens and purges unencrypted legacy copies.
  - Set `allowBackup="false"` in Android manifest to prevent token exfiltration via cloud backups.
- **Mobile Safe-Area Insets on All Modals & Drawers** (*thanks @01ax!*):
  - Applied `.overlay-safe` and `.panel-safe` rules across all 16 modal dialogs and side drawers to prevent content overlapping Android status and gesture bars.
- **Mobile Create Server Form & Table Layout** (*thanks @01ax!*):
  - Constrained dialog sizing to `max-h-full` within safe-area boundaries, making the bottom submission buttons and cloud-init inputs fully reachable.
  - Optimized plan table with single-line rows, centred headers, and responsive column widths fitting 412px phone viewports without horizontal drag.
  - Sized distribution tiles and logos responsively for mobile screens.
  - Replaced hover tooltips on blocked plans with tap-friendly inline explanations.
  - Matched storage sizing steps to mPanel's exact dropdown ladder (5 GB to 60, 10 GB to 200, 100 GB to 2000).
- **Status Indicator Dot Deforming**:
  - Added `shrink-0` to circular status indicators across server rows and headers to prevent oval squishing beside wrapping text.
- **Region Filter Completeness**:
  - Pre-seeded region dropdown from `/v2/regions` so all available regions (including ADL, PER, SIN) appear even before servers exist in those locations.

---

## [1.0.43] - 2026-09-02

### Improved
- **Firewall Matrix Pinned Audit & Navigation**:
  - Pinned the **Audit** findings column sticky beside the server name (`left-[220px]`) so findings remain visible while scrolling through wide rule matrices.
  - Enhanced horizontal scrolling with always-visible scrollbar tracks and quick `◀` / `▶` navigation buttons.

---

## [1.0.42] - 2026-09-02

### Added
- **Fleet-wide firewall matrix** (FEATURES.md #2): a "Fleet matrix" view on the Firewall tab — servers down the side, rule signatures (protocol, ports, source) across the top, accept / drop / absent per cell, read from every server four at a time. An audit column flags SSH, RDP, VNC or Docker open to the world (red), database ports open to the world, servers with no rules at all, rules shadowed by a catch-all drop (amber), and sources that are not one of your servers (info). Flagged servers sort first; "Only flagged" narrows to them.
- **Copy ruleset to N servers** from the matrix, with one combined before → after diff per target in the confirm, servers that already match skipped, and one History entry per server written.
- **Server groups and tags**, kept locally per account since the API has none. Tag a server from its matrix row or from the palette (`tag add web wp-*`, `tag remove web #101`); a tag is a group, so `@web` works as a target anywhere the palette takes one (`restart @web`, `backup @db "nightly"`) and as a scope in the matrix. Saved groups can also be a pattern (`wp-web-*,wp-ha-lb`) that keeps matching new servers.
- **Clone firewall rules now shows a true before → after**: it reads the target's current rules first.

### Fixed
- **A failed server-list poll no longer blanks the app.** One transient API error on the 15-second refresh used to replace the server list with an empty one (empty sidebar, tray at 0, empty matrix) until the next poll succeeded. The last good list is kept and the poll retries.
- The Firewall tab now uses the app's server list rather than its own query with a different cache key, so it sees the cold-start cache and the inferred power state.

---

## [1.0.41] - 2026-09-02

### Added
- **Diff-based change review and a local change log** (FEATURES.md #5):
  - **One confirm dialog for every mutation**, replacing sixteen bare `window.confirm()` boxes. It names the target, says in a sentence what will happen, shows a before → after table or a line diff where there is one (firewall rule lists, DNS records, renames, disk sizes, region moves, rebuild images), and carries warnings in amber. Destructive actions get a red button; irreversible ones (rebuild, restore, delete disk, delete VPC, delete load balancer, disable firewall) make you type the target's name. Enter confirms, Esc cancels.
  - **Firewall edits now show the diff** — adding, deleting, reordering, importing and cloning rules all preview the exact rule list that will be written, since every one of them replaces the whole set.
  - **Diagnostics no longer ask "are you sure?"** — ping, uptime and is-running change nothing.
  - **History tab**: every change confirmed in BLDesk, per account, newest first, with what was confirmed and how it ended (submitted / completed / errored / failed / lost track) as reported by the action tracker. Filter by server, action or outcome; expand for the diff; clear from the same view. Stored on this machine under `<userData>/changelog/`, never sent anywhere. Palette commands are logged too and marked with a ⚡.

---

## [1.0.40] - 2026-09-02

### Added
- **Rebuilt Create Server Form to Match mPanel Flow** (*thanks @01ax!*):
  - Restructured into three numbered sections: Location & OS, Resources & Plan, and Settings & Deployment.
  - **Distribution Tiles & Version Hierarchy**: Interactive distro tiles with greyscale-to-color transitions and versions sorted newest-first with long-term releases ahead of variants.
  - **Full Pagination for Images & Sizes**: Replaced unpaged API endpoints with `fetchAllPages`, revealing all 27 OS distributions and all 21 compute plans.
  - **Accurate Licensed Image Pricing**: Integrated OS surcharges (Windows Server per-MB memory licensing caps and cPanel flat bases) into displayed monthly totals with GST breakdown.
  - **Live Availability & Capacity Reasons**: Surfaces exact plan availability and out-of-stock reasons per region rather than failing at submission.
  - **Expandable Settings View**: Configurable VPC networking, SSH keys (with MASTER key pre-selected and inline creation), extra IPv4 addresses, backup frequencies, and cloud-init scripts.
  - **Modal Portal Rendering**: Rendered create dialog through `createPortal` into `document.body` for pristine full-viewport backdrop dimming.

---

## [1.0.39] - 2026-09-02

### Added
- **Tray / menu bar that earns its spot** (FEATURES.md #3):
  - **Live fleet counts** in the tray tooltip and menu (running / off / other / actions in progress, prepaid credit); on macOS a `↻N` title appears beside the icon only while actions are running.
  - **Servers submenu** — every server with Open in BLDesk, Copy IP and SSH as root, straight from the tray.
  - **Things that need you, surfaced**: actions BinaryLane has paused on a question (including ones started from mPanel or another machine) and invoices whose payment failed get their own menu lines that open the right view, a notification when they appear, and on macOS a `!N` beside the icon until dealt with.
  - **Native notifications** when a server changes state, appears or disappears (diffed against the first live fetch, never the local cache), when a tracked action completes, fails or pauses for a question, and when prepaid credit drops below $20 AUD or a payment fails. Each category can be muted from the tray's Settings submenu.
  - **Keep running in tray when the window is closed** (on by default, with a one-time notice the first time it hides) and **Launch at login** (macOS/Windows), both toggled from the tray.
  - **Check for updates** from the tray on packaged builds.

- **Client-side power state** (bridges vps/vps #161, open since 2022): the API's `status` never turns `off`, so BLDesk now infers power state itself. A read-only sweep every two minutes reads each server's latest performance sample; a server whose latest five-minute bucket is more than 15 minutes old is shown as Stopped. Samples are produced host-side only while the VM runs, so this also catches `sudo poweroff` inside the guest, which nothing else can see. After a power action settles, one `is_running` diagnostic asks the hypervisor directly and the toast reports "Server is off" / "Server is running" — or calls out a shutdown the OS ignored. The status pill's tooltip says where its verdict came from and what the API claims.

### Fixed
- **Server details header went stale**: the view read status from the object clicked in the list, so a server shut down from its own page kept saying "Running" until re-opened. It now follows the live server list.
- **Palette no longer gates power verbs on `active`/`off`.** The API was observed leaving a server at `active` after a completed hard power-off, so `start` would have skipped a server that was really off. Only `new` and `archive` are skipped now; BinaryLane rejects genuine no-ops and the palette reports that per target.
- **"Shutdown completed" no longer implies the server is off.** BinaryLane completes a `shutdown` action when the ACPI signal is delivered, within seconds, whether or not the OS halts. The toast and notification now say "signal sent" and point at Power off if the server stays running; the "is now off" notification remains the real confirmation.

---

## [1.0.38] - 2026-09-02

### Added
- **Verb-first Command Palette** (FEATURES.md #4): `Cmd+K` now accepts commands, not just nouns.
  - **Fleet actions with glob targets**: `restart wp-*`, `shutdown jumpbox,db-1`, `start #12345`, `cycle 43.224`, `backup web "pre-upgrade"`. Targets accept a name or prefix, a glob (`*`/`?`), `#id`, an IPv4 or IPv4 prefix, or a comma-separated mix.
  - **Status-aware preview**: servers that can't take the action (already off / already running) are shown as skipped with the reason, and patterns that match nothing are called out, before anything is submitted.
  - **Review step**: every mutating command shows the exact target list and needs a second `Enter` to run; submissions go one at a time and each is handed to the background action tracker, so outcomes arrive as toasts.
  - **Navigation verbs**: `ssh <server|ip>`, `console <server>`, `open <server> [network|firewall|…]`, `link <server>` (copies a `bldesk://` link), `go dns`.
  - **DNS from the keyboard**: `dns add A foo.example.com 203.0.113.9` resolves the hosted zone by longest suffix; MX/SRV require a priority.
  - **Recent commands**, verb suggestions while typing, `Tab` to fill a server name, and `?` for the full list. The old fuzzy server/tab search still works when the query doesn't start with a verb.

---

## [1.0.37] - 2026-09-02

### Fixed
- **Windows NSIS Auto-Updater Relaunch Target** (*thanks @01ax!*):
  - Configured custom NSIS installer script (`nsis/installer.nsh`) overriding `$launchLink` to target `$INSTDIR\${APP_EXECUTABLE_FILENAME}` directly instead of the Start Menu shortcut link.
  - Fixes missing shortcut error dialogs upon restart after applying auto-updates on Windows 11.
- **Linux Package Maintainer Metadata**:
  - Updated `author` in `package.json` with an explicit email address (`support@binarylane.com.au`) to satisfy Debian package control metadata requirements and enable clean Linux `.deb` packaging.

---

## [1.0.36] - 2026-09-02

### Fixed
- **Mobile Responsive Layout & Safe Area Insets**:
  - **TitleBar Mobile Uncluttering**: Resolved header overlap and colliding badges on small screens by removing duplicate version pills, making brand titles responsive, and optimizing profile selector widths.
  - **Android Status Bar & Safe Areas**: Added viewport-fit support and safe-area top/bottom insets (`pt-[env(safe-area-inset-top)]` on titlebar, `pb-[env(safe-area-inset-bottom)]` on bottom nav) to prevent Android status bar clock/icons from overlapping the UI.
  - **Horizontal Table Scrolling**: Changed server list table container from `overflow-hidden` to `overflow-x-auto` to prevent column text clipping on mobile displays.

---

## [1.0.35] - 2026-09-02

### Added
- **Full Domain List Pagination & DNS Suite** (*thanks @01ax!*):
  - **Full Multi-Page Domain Paging**: Fetches all hosted DNS zones (supporting 144+ domains) with 25-per-page client controls and live search filtering.
  - **Zone Delegation Status**: Displays **Live** vs **Not in use** status indicators by verifying domain delegation against BinaryLane authoritative nameservers.
  - **Domain Context Menu**: Right-click actions to copy domain name, copy nameservers, copy BIND zone file, or launch mPanel.
  - **Guarded Zone Deletion Modal**: Deleting DNS hosting now requires typing the domain name, shows affected record counts, and includes a 1-click zone file backup button.

### Fixed
- **Profile Vault & Key Updating** (*thanks @01ax!*):
  - **Profile Key Replacement**: Added explicit "Update key" flow to replace tokens for existing profiles without creating duplicate entries.
  - **Refuse Duplicate Name Overwrites**: Refuses saving a new profile under an existing name to prevent accidental token overwrites.
  - **Auth Error Banner Reset**: Automatically dismisses stale 401 authentication failure banners when switching to a working profile.
  - **API Token Link**: Pointed token creation link to `/api-info` (fixing 404 from `/api-tokens`).

---

## [1.0.34] - 2026-09-02

### Fixed
- **Android In-Place APK Upgrade & Keystore Signing**:
  - Replaced dynamic debug signing with a permanent, consistent Android signing keystore (`bldesk.keystore`) across all release builds.
  - Fixes Android package signature mismatch (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`), enabling seamless in-place APK upgrades without requiring an uninstall or losing account tokens and profiles.

---

## [1.0.33] - 2026-09-02

### Added
- **Android In-App Update Detection & APK Downloading**:
  - Automatically checks GitHub Releases API for newer Android APK builds on launch and on demand.
  - Compares semantic versions against `currentVersion` (`v1.0.33`).
  - Displays prominent update pill in title bar and popover with one-click **"Download APK"** button that directly grabs `BLDesk-android.apk` from GitHub Releases.
  - Supports switching between **Stable** and **Beta** update channels on mobile.

---

## [1.0.32] - 2026-09-02

### Added
- **Truthful Async Server Action Tracking & Toast Engine** (*massive props to @Freewheelin!*):
  - **4-Tier Async Architecture**: Long hypervisor operations (`rebuild`, `change_region`, `resize_disk`, `take_backup`, `restore`) no longer falsely report "complete" at queue time; they now track in the background and confirm when finished.
  - **`ActionTrackerContext` & Floating Toast Host (`ActionToasts.tsx`)**: Zero-dependency floating toast stack reporting live step descriptions (e.g. *"Backup of SYSTEM: 38.5GB of 40.0 GB (310MB/s) - less than 1 min remaining"*), completion state, or failure reasons.
  - **Adaptive Polling Cadence**: Smart polling easing (3s for first 30s → 8s up to 2m → 15s thereafter) to prevent server request spam.
  - **Operator Interaction Handling (`user_interaction_required`)**: Properly detects when an action is paused waiting for user confirmation (e.g. `allow-unclean-power-off`) and surfaces `ActionInteractionPrompt.tsx` instead of timing out.
  - **Invoice Block Detection (`blocking_invoice_id`)**: Detects actions blocked by unpaid invoices and alerts the user immediately.
- **Fixed Diagnostics & Uptime Reporting** (*thanks @Freewheelin & @01ax!*):
  - Fixed ping and uptime diagnostics by reading `result_data` and `error_message` (replacing previous permanent "in-progress" display).
  - Clarified guest ping diagnostics vs real host node uptime.

### Fixed
- **Usage Charts Scaling & 24-Hour Paging** (*thanks @01ax!*):
  - Paginates `GET /v2/samplesets` to retrieve all 288 samples for the full 24-hour window rather than dropping the last 7 hours at the 200-sample limit.
  - Fixed mixed-unit axes on Activity Overview with independent series scaling (`scaleBy="series"` vs `scaleBy="unit"`).
  - Handles absent memory reporting agents (`memory_usage_bytes === 0`) by displaying a helpful information banner linking to setup documentation rather than asserting 0 GB usage.
- **Billing Details Links** (*thanks @01ax!*):
  - Pointed "Change billing details" buttons directly to `/billing/payment-details`.

---

## [1.0.31] - 2026-09-02

### Added
- **Account Details Tab** (*thanks @01ax!*):
  - Dedicated **Account Details** tab in the sidebar displaying account metadata (`GET /v2/account`):
    - Email address with verified/unverified status badge.
    - Account status, tax code, 2FA enabled status, and additional IPv4 limits.
    - Configured payment method indicators.
    - Direct web links for password changes, API token management, 2FA setup, and contact details.
- **Tabbed Billing & Invoices Suite** (*thanks @01ax!*):
  - Reorganized the Billing interface into 3 mPanel-style tabs:
    - **Invoices**: Full server-side pagination (`page` and `per_page`) with previous/next controls, fixing previous truncation where only 20 invoices were visible.
    - **Pending Charges**: Itemized breakdown of unbilled charges (`balance.charges[]`) with descriptions, dates, status, and running totals.
    - **Payment Details**: Configured payment method status, PayPal manual payment guidance, and update links.
  - **Unpaid Invoice Alert Banner**: Prominent banner displayed when payment failed invoices require attention.

### Fixed
- **Windows Portable / NSIS Artifact Collision** (*thanks @01ax!*):
  - Assigned explicit `artifactName` for the Windows `portable` target (`BLDesk-${version}-${os}-${arch}-portable.exe`) so it no longer overwrites the NSIS installer executable during multi-target packaging.
- **Honest Auto-Updater Reporting** (*thanks @01ax!*):
  - Introduced `check-failed` status (grey *"Couldn't check"* pill with error details in dropdown) for unreachable feeds or missing manifests, preventing false green *"Up to date"* indications when update checks fail.

---

## [1.0.30] - 2026-09-02

### Added
- **Deep Links (`bldesk://`) Protocol Handler**:
  - Registered `bldesk://` OS protocol handler across Windows (Registry), macOS (`CFBundleURLTypes`), and Linux (`.desktop`).
  - Direct deep linking grammar support:
    - `bldesk://server/<id>[/<subtab>]` — Jump straight to any server and sub-tab.
    - `bldesk://console/<id>` — Launch the rescue console window directly.
    - `bldesk://ssh/<id>` — Launch native SSH terminal connection.
    - `bldesk://tab/<name>` — Open top-level navigation tabs (`vpcs`, `firewall`, `dns`, `backups`, etc.).
    - `?account=<name or email>` — Switch profile automatically before navigating.
- **Server Row Context Menu**:
  - Right-click context menu on server rows with quick actions (Open, SSH, Copy IP, Copy `bldesk://` Link, Copy Console Link, Reboot, Shutdown, Power on).
- **Copy Link Buttons**:
  - Quick copy link icon on server rows and **Copy link** button in Server Details header.
- **Documentation**:
  - Added [`docs/DEEP_LINKS.md`](docs/DEEP_LINKS.md) detailing deep link architecture, routing lifecycle, and usage.

---

## [1.0.29] - 2026-09-02

### Fixed
- **ESM / CommonJS Interoperability**: Fixed `SyntaxError: Named export 'autoUpdater' not found` by adding dynamic getter resolution for `electron-updater` in Node.js ESM.
- **Auto-Updater 404 Resilience**: Gracefully handle missing GitHub Release manifests as "Up to date" check instead of throwing uncaught UI error dialogs.
- **Windows Tray Icon**: Added `.ico` fallback for Windows notification tray initialization to prevent platform crashes.
- **Window Display Robustness**: Added `did-finish-load` fallback event listener to guarantee main window visibility on startup.

### Added
- **Prominent Version Indicators**: Display running app version (`BLDesk v1.0.X`) in the top-left titlebar header, auto-update pill, and sidebar footer.

---

## [1.0.28] - 2026-09-02

### Added
- **Cross-Platform Auto-Updates (`electron-updater`)**:
  - In-app silent background update checks every 6 hours and on launch.
  - Multi-OS GitHub Release publishing (`latest.yml`, `latest-mac.yml`, `latest-linux.yml`, and blockmaps).
  - Title bar `UpdateMenu` with manual "Check now" button, channel selector, progress bar, and "Restart to update" pill.
  - Channel switching between **Stable** and **Beta** channels with persistent state in user configuration.
- **Developer Documentation**:
  - Added [`AGENTS.md`](AGENTS.md) and [`docs/AUTO_UPDATE.md`](docs/AUTO_UPDATE.md).

---

## [1.0.27] - 2026-09-01

### Added
- **Backup Downloads**:
  - Direct hypervisor disk image downloading and action tracking for backups.
  - Automatic rotation of oldest temporary backups.
- **OS Distribution Logos**:
  - Added official vector logos for AlmaLinux, Debian, Fedora, FreeBSD, KDE Neon, openSUSE, Rocky Linux, Ubuntu, Windows, and BYO.
- **Server Details Enhancements**:
  - Enhanced network, usage, settings, and metrics views.

---

## [1.0.26] - 2026-08-27

### Added
- **Terminal Launching**:
  - macOS Terminal.app and Linux emulator environment configurations.
  - Inline terminal launcher and command generation helper.
