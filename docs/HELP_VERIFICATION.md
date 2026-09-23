# Help verification

## Mobile overflow and the server header (9 September 2026, 1.0.61-beta.8)

Branch: `fix/mobile-overflow`. No new runtime dependencies. Responsive fixes
only: every change is either inside a scroll container that did not exist, or
gated on a breakpoint so the desktop renders as it did.

User-facing text this change touches, and the line that renders each:

| String | Rendered by | Result |
| --- | --- | --- |
| `Server:` | `ServerDetails.tsx` title row | Wording unchanged; now `hidden sm:inline`, so it reads exactly as before from `sm` up and is dropped only where the row must also fit a hostname and the power pill. |
| `All servers` | `ServerDetails.tsx`, `aria-label` and `title` on the back control | Replaces the visible word "Servers" below `md` only. The desktop sidebar keeps its own "All Servers" control, which is unchanged. |
| `SSH` / `Launch SSH` | `ServerDetails.tsx` action cluster | The same button. `SSH` below `sm`, `Launch SSH` from `sm` up; the terminal icon carries the meaning at the narrow end. |
| Help pages that mention the wording | grep of `docs/help/*.md` for "Server:" and "Launch SSH" | One hit: `server-remote-access.md` front matter, "Launch SSH or the out-of-band console without uploading private keys." That is the verb phrase, not a quotation of the button's label, and the button still reads `Launch SSH` at every width the desktop uses. No page mentions the `Server:` prefix. Nothing is falsified. |

Deliberately **not** in this change, having been split out as discretionary
desktop work: moving the reachability chip out of the action cluster, grouping
the reboot and shutdown buttons, and changing the meta row's gap. This diff
touches `ServerDetails.tsx` but not the chip's call site, so its position is
unchanged from `main`.

### Checks performed

- `npm run typecheck` and `npm run build`.
- The full `AGENTS.md` zoom matrix in real Electron, isolated `userData` and
  synthetic fixtures, 0 cloud writes attempted and no renderer errors: **53
  checks, all passing**, at 1024x680 and 1280x840, each at 80%, 125% and 150%.
  Zoom is applied by `sendInputEvent` with Control, so `src/main/zoom.ts`'s
  `before-input-event` handler is what is under test rather than a direct
  `setZoomFactor`.
  - CSS width equals window width over factor at every combination: 1280 / 819
    / 683 at 1024, and 1600 / 1024 / 853 at 1280.
  - Last navigation item (`Embedded SSH`, 15th of 15) reachable at every
    combination, with the sidebar's own scroller confirmed to scroll.
  - At 1024x680 / 150% the CSS width is 683, below the 768 breakpoint, so the
    desktop sidebar is hidden by design and navigation is the mobile drawer.
    Checked through the drawer there: 17 items, last one reachable.
  - Both dense tables reach their last column inside their own `overflow-x:
    auto` scroller, while the page itself never scrolls sideways. Disk images
    813px in a 450px box at the tightest combination; SSH keys 776px in 546px.
  - Dialog: the close control stays pinned in the header and the confirm
    (`Add Server`) is reachable by scrolling the body, at every combination.
- Range limits: reset returns to 100%, zoom in clamps at 150%, zoom out clamps
  at 80%.

- Physical device, Samsung SM-S948B (Galaxy S26 Ultra), Android 16 / API 36, 411 CSS px, over CDP. **The build was this branch on top of `main` and nothing else** - confirmed in the run by `typeof window.bldeskApi.probeTcp === 'undefined'` and by the reachability chip being absent from the server detail, neither of which would hold on a build that also carried the Android probe work. 17 checks, all passing:
  - No horizontal page scroll on the servers list, firewall, SSH keys, backups, or a server detail. The network map is not listed: this diff does not touch it.
  - Both dense tables reach their last column inside their own `overflow-x: auto` wrapper while the page itself stays put - SSH keys 718px of table in a 362px box, disk images 676px in 362px.
  - Server detail header: the configuration summary is one line with `white-space: nowrap`, `Server:` is hidden at this width, the hostname truncates, the title row does not overflow, and the back control measures 24px.
  - A probe of the scrollbar gutter returns 0px with `(pointer: coarse)` matching and `(pointer: fine)` not, so the platform's overlay bar is back and costs no layout width.

An earlier draft of this entry took its numbers from a build combining six
branches, which is how results reached the wrong diff elsewhere in this file.
They are re-measured here on this branch alone.

Noted while verifying, pre-existing and **not** changed here: the create-server
dialog's submit sits inside the Modal's scrolling body rather than its `footer`
slot, so at 1280x840 it starts 338px below the fold and is reached by scrolling.
Confirmed identical on `origin/main` with this branch stashed, so it is not a
regression from this work. Every other checked dialog behaviour matches the
`Modal` contract.

The harness is out of tree and is not an app dependency: a copy of
`scripts/showcase/launcher.cjs` with an env-driven probe stub and synthetic
`ssh_keys`, plus the check scripts. Playwright comes from
`BLDESK_PLAYWRIGHT_MODULE`.

## Browse existing SSH key files (7 September 2026, 1.0.61-beta.8)

Checked `help/keys.md`, `help/server-remote-access.md` and `help/terminal.md` against the Browse… button, Key file display and cancellation flow in `ServerDetails.tsx`; the main-process `vault:chooseSshKeyFile` / `vault:getLocalSshKeys` handlers; `existingKeyFiles` in `src/main/sshKeyFiles.ts`; and `availableSshKeys` in `lib/sshKeyAssociations.ts`. Selected files use stat metadata only, with no private-content read, copy or passphrase persistence. Existing automatic discovery still reads public `.pub` files only. Local filenames are not BinaryLane account public keys. All SSH consumers include persisted selected paths when checking availability, so an external file does not become missing merely because discovery cannot find it.

Cancellation preserves the association. The file browser has no extension restriction and does not validate cryptographic format; OpenSSH does that. Documentation names the required OpenSSH format and does not promise PuTTY-format support. See [key-file browser verification](SSH_KEY_FILE_VERIFICATION.md).

## SSH address follow-up (6 September 2026, 1.0.61-beta.5)

- `help/server-remote-access.md`: Connect to options, Custom SSH host input, inheritance, invalid-name fallback and address warning checked against `ServerDetails.tsx` and `lib/sshKeyAssociations.ts`. Public-probe tooltip checked against `ReachabilityBadge.tsx`; probing remains unchanged. `src/shared/ssh.ts` and the native/PTY launchers pass a hostname to system OpenSSH without renderer DNS resolution. The loopback test verifies an OpenSSH Host/HostName alias. VPN availability remains the user's responsibility; no automatic short-name extraction or VPN configuration is claimed.
- `help/terminal.md`: Default SSH address, separate Host/Key origin labels and reopen rules checked against `TerminalView.tsx`; Host column and invalid-connect-address skips against `BroadcastPanel.tsx` and `lib/terminalSessions.ts`. Existing confirmation quotes are unchanged. `sshArgv` still supplies root for server buttons and connect-bar user/port explicitly, so docs do not promise that an alias's User/Port overrides those arguments.
- `help/troubleshooting.md`: distinguishes intentionally firewalled public SSH from private-route availability; points to the implemented Connect to control rather than suggesting a firewall relaxation. Source: `useReachability(primaryV4, 22, ...)` in `ServerDetails.tsx` and the unchanged reachability implementation.

See [SSH host verification](SSH_HOST_VERIFICATION.md) for test evidence and the outstanding real-tailnet acceptance check.

## SSH key association follow-up (6 September 2026, unreleased)

- `help/server-remote-access.md`: checked control names and manual/learned labels against `ServerDetails.tsx`; resolution and pruning against `lib/sshKeyAssociations.ts`; lifetime/exit conditions against `lib/terminalSessions.ts`.
- `help/terminal.md`: checked picker source labels and reopen behaviour against `TerminalView.tsx`, per-host preview/skips and confirmation wording against `BroadcastPanel.tsx`, entry-point resolution against `lib/openSsh.ts`, and conditional identity options against `src/shared/ssh.ts`.
- `help/keys.md`: checked discovery against `vault:getLocalSshKeys` in `src/main/index.ts`: reads `.pub` contents, tests private-path existence, does not read private-key contents. Connection selectors filter to entries with a private path. Association storage contains paths/source metadata, not private-key material.
- Corrected the previous statements that broadcast shares the connect-bar key and reopen always uses SSH defaults. Documented the ten-second rule as a heuristic, native non-learning, and the distinction between individual fallback and broadcast missing-key skips. `IdentitiesOnly=yes` excludes unrelated agent identities; it does not erase other configured `IdentityFile` entries.

See [SSH key verification](SSH_KEYS_VERIFICATION.md) for automated results and the outstanding packaged, real-server acceptance test. Earlier verification records below describe their original feature passes.

Implementation branch: `feat/help-and-ask-binarylane`. No version bump or new runtime dependencies.

## Content accuracy review (5 September 2026)

The initial runtime pass below verified rendering and interaction, not sentence-by-sentence factual accuracy. PR #48's review exposed that gap. This follow-up checks bundled BLDesk documentation against the UI handlers and shared helpers, and distinguishes controls offered by BLDesk from capabilities offered by BinaryLane's API and mPanel. It does not audit or change Ask BinaryLane's answer-generation controls.

### Sources checked for each page

Paths below are relative to `src/renderer/src/` unless another root is shown. This is a manual source audit, not a claim that the help guard proves prose correct. Quoted examples were checked against the originating handler and its helpers, including the palette's `POWER_VERBS` labels rather than the shared dialog's text.

The embedded-terminal additions were also checked against `src/main/pty.ts`,
`src/shared/ssh.ts`, the installed OpenSSH `ssh(1)` manual (remote command and
exit-status semantics), and the installed `node-pty@1.1.0` Windows backend
(ConPTY fallback threshold). Full runtime/package evidence is in
`docs/TERMINAL_VERIFICATION.md`.

| Page in `docs/help/` | Components and helpers checked |
| --- | --- |
| account | `components/account/AccountOverview.tsx` — read-only fields and mPanel links |
| backups | `components/backups/BackupManager.tsx` — slot selection, restore, attach, schedule |
| billing | `components/billing/BillingOverview.tsx`, `context/ActionTrackerContext.tsx` |
| confirm-and-history | `context/ConfirmContext.tsx`, `components/palette/CommandPalette.tsx`, `components/servers/CreateServerModal.tsx` |
| deep-links | `src/shared/deeplink.ts`, `lib/deeplinks.ts`, `src/main/deeplink.ts` |
| dns | `components/dns/DnsManager.tsx`, `components/palette/CommandPalette.tsx` |
| firewall | `components/firewall/FirewallManager.tsx`, `FirewallMatrix.tsx`, `lib/firewallMatrix.ts` |
| getting-started | `components/auth/AuthModal.tsx`, `src/main/safeStorage.ts`, `api/mobile-bridge.ts` |
| heatmap | `components/heatmap/FleetHeatmap.tsx`, `lib/heatmap.ts` |
| help | `components/help/HelpView.tsx` — client request triggers, not generated-answer content |
| history | `components/history/HistoryView.tsx`, `lib/changelog.ts`, `context/ActionTrackerContext.tsx` |
| keys | `components/keys/SshKeysManager.tsx`, server local-key selector |
| loadbalancers | `components/loadbalancers/LoadBalancerManager.tsx`; service sources below |
| map | `components/map/NetworkMap.tsx`, `lib/firewallMatrix.ts` |
| palette | `components/palette/CommandPalette.tsx`, `lib/commands.ts`; backup semantics below |
| server-backups | `components/servers/ServerDetails.tsx`, `components/backups/BackupManager.tsx` |
| server-cancel | `components/servers/ServerDetails.tsx` cancellation handler |
| server-change-plan | `components/servers/ChangePlanPanel.tsx`, `ServerDetails.tsx` resize handler |
| server-cloud-init | `components/servers/ServerDetails.tsx` Cloud-init panel and template capture |
| server-firewall | `components/servers/ServerDetails.tsx`, `components/firewall/FirewallManager.tsx` |
| server-network | `components/servers/ServerNetwork.tsx` Move handler, not VPC Manager's Detach handler |
| server-overview | `components/servers/ServerDetails.tsx`, `lib/actionLabels.ts` |
| server-recovery | `components/servers/ServerDetails.tsx`, `lib/actionLabels.ts` rescue fallback |
| server-remote-access | `components/servers/ServerDetails.tsx`, `lib/actionLabels.ts` |
| server-settings | `components/servers/ServerSettings.tsx`, `context/ConfirmContext.tsx` |
| server-usage | `components/servers/ServerUsage.tsx`, `api/queries.ts` |
| servers | `components/servers/ServerList.tsx`, `lib/powerState.ts`, `lib/actionLabels.ts` |
| shortcuts | `components/palette/CommandPalette.tsx`, `components/layout/Sidebar.tsx`, `BottomNav.tsx`, `src/main/zoom.ts` |
| templates | `components/templates/TemplatesView.tsx`, `components/servers/CreateServerModal.tsx`, `lib/templateJobs.ts`, `src/shared/templates.ts` |
| terminal | `components/terminal/TerminalView.tsx`, `TerminalTab.tsx`, `BroadcastPanel.tsx`, `lib/terminalSessions.ts`, `lib/openSsh.ts`, `src/main/pty.ts`, `src/shared/ssh.ts` |
| tray | `src/main/tray.ts` |
| troubleshooting | `components/servers/ReachabilityBadge.tsx`, `lib/powerState.ts`, `components/layout/UpdateMenu.tsx`, `scripts/after-pack.cjs`, client help transport |
| vpcs | `components/vpcs/VpcManager.tsx`, `components/servers/ServerNetwork.tsx` |

### Service facts and review reconciliation

- **Health checks are configurable.** `openapi.json` defines `HealthCheckRequest.path` and `.protocol` in create/update load-balancer requests. The local BinaryLane source checkout confirms mPanel's editable Path field in `product/website/PanelSite/ClientApp/src/pages/loadbalancer/components/Settings.tsx` and persistence in `product/website/WebApi/Services/LoadBalancerApiService.cs`. BLDesk's current component neither displays nor edits those settings. Its help now directs users to mPanel, without presenting this client limitation as an API limitation.
- **Backup replacement is conditional, not unconditional.** OpenAPI's `BackupReplacementStrategy.oldest` and BinaryLane's `ImageApiService.cs` agree: use a free slot first, otherwise the oldest unlocked, unattached backup of the requested type. The palette requests `temporary`; its help now warns about replacement explicitly.
- **History and running-action states differ.** History has five outcome labels. Interaction/invoice waits are real states in `ActionTrackerContext`, but are not extra History outcomes. The page now explains that the History entry remains Submitted during those waits.
- **Disk confirmation uses the disk label or ID.** “Target name” was ambiguous even though it did not explicitly say “server name”; the page now names the required value precisely.
- **Navigation changes at the width breakpoint.** `hidden md:flex` hides the sidebar below 768 CSS pixels, while `BottomNav` exposes More. A 1024-wide window at 150% crosses that breakpoint; 1280 at 150% does not.
- **Client help triggers already supported automatic requests.** The internal help page now gives the exact suggestion/answer thresholds and delays. No service prompts, answer filters or output controls were changed.
- **Templates are not durable jobs.** Tags are local and immediate; firewall work polls every ten seconds for up to fifteen minutes and is lost on renderer reload/quit. Missing names and unsupported user data do not block creation. The page now explains those limitations.

The BinaryLane implementation was consulted read-only. No private implementation code is copied into bundled help. `docs/DEEP_LINKS.md` was also reconciled with the parser/router, including the full tab lists, account-free help routing and already-implemented palette/confirmation behaviour.

Validation for this documentation revision: rerun typecheck (including all three guards), production build, whitespace checks and focused assertions for the corrected palette label, backup strategy, network confirmation, disk label and load-balancer schema. The earlier desktop/Android screenshots are pre-copy-edit evidence of layout and interaction, not screenshots of the revised prose. No new native Android or live cloud workflow is required or claimed for these content-only changes.

## Architecture and content

- 33 bundled Markdown pages cover 15 top-level tabs, 11 server sub-tabs and all 16 palette verbs. Sources live in `docs/help`, loaded through the renderer's Vite `@help` raw-import alias. Nothing reads the filesystem at runtime.
- The local search and article-service search are separate sources in one view. The service does not index the bundled BLDesk docs; its answer appears below local results.
- Main-process IPC and the mobile bridge share the fixed `HELP_API_ORIGIN`, validators and 20-second timeout. There is no account client or token in this transport. Only visible search text is attached; feedback sends the returned answer ID as a number and a boolean.
- Markdown renders as escaped React nodes. Remote answers cannot launch local help actions, SSH deep links or arbitrary external domains. Local documentation can navigate through the existing deep-link parser.
- Opening help from a confirmation cancels that review. It never confirms the pending action.

## Checks performed

- `npm run typecheck`: both TypeScript projects, mutation guards, UI guards and help guards.
- `npm run build`: production main, preload and renderer bundles.
- Real Electron driven by Playwright, with isolated user data, fabricated account/server fixtures and cloud mutation requests rejected. No real cloud resources were modified.
- Sidebar and every top-level contextual question mark, `help firewall`, `??` and `bldesk://help/firewall#copy-a-ruleset` routing; confirmation-help cancellation; optional chip excludes a deliberately private custom image name. No nested action buttons or accidentally opened mutation dialogs in the contextual-link sweep.
- All 33 pages opened and their rendered content read in both light and dark themes. Representative screenshots visually inspected.
- 1024×680 and 1280×840 windows at 80%, 100%, 125% and 150% actual Electron zoom. Both index and article scroll independently, the search remains visible, and the document has no horizontal viewport overflow. At 1024×680/150%, the article retains approximately 285 CSS pixels of height. The initial stacked layout left only 66 pixels and was corrected before completion.
- Fixture answers: numbered steps, escaped HTML, blocked unsafe/deep links, four source rows, numeric feedback payload, disabled feedback after Thanks, suggestion keyboard selection, out-of-order answers, service errors and offline state with no request and intact local results.
- Live service: `how do I enable ipv6` returned an answer and four source articles; helpful feedback completed successfully through the real IPC/HTTP path. Only this generic query and its feedback were sent to the live service.
- Helper checks: empty Markdown headings terminate, duplicate heading IDs are stable, malformed percent-encoded links are rejected, palette aliases parse, unsafe article origins are rejected and invalid feedback IDs fail validation.

## Repeating the UI checks

Build first, then launch Electron through Playwright with a temporary `userData` path set before importing `out/main/index.js`. Supply fabricated vault responses and intercept BinaryLane cloud requests; reject all cloud writes. Test help-service fixtures separately, allowing only the fixed help origin through for the live question and feedback check.

Use Electron `webContents` zoom, not CSS scaling. Capture screenshots with `webContents.capturePage()`; browser screenshots can clip incorrectly at Electron zoom. Confirm that the last index item and the end of a long page are independently reachable while the search remains visible. Also try the named entry points above and verify the actual article heading, not merely that the Help tab opened.

The isolated scripts used for this pass live in `/private/tmp/bldesk-help.x4y9Gb` (`launcher.cjs`, `smoke.mjs`, `helpers.ts`); they are disposable verification harnesses, not app dependencies. The permanent source checks live in `scripts/check-help-guards.mjs` and run in CI through `npm run typecheck`.

## Screenshots and limits

The original help screenshots used fabricated account data and a generic public-article answer. `help-light.png` and `help-dark.png` have since been refreshed with the Atlas dummy fleet; see [current screenshot provenance](SHOWCASE.md). `help-150.png` and `ask-binarylane.png` remain from the original verification run. Their displayed Electron runtime version comes from the isolated launcher, not a release version bump.

Packaged Windows/Linux deep-link registration and native platform menu behaviour were not rerun for this feature; the shared parser and Electron renderer routing were tested on macOS. No destructive workflow was executed against a live account. Android emulator verification is recorded below; physical-device and older-Android testing remain outside this pass.

## Android native smoke test

Installed the actual debug APK on an isolated Pixel 7-profile ARM64 emulator, Android 36, using Emulator 37.1.11 and Java 21. Playwright attached to the installed Capacitor WebView at `https://localhost/`; the runtime reported `platform: android` and `isNativePlatform(): true`. No profile or API token was added.

- APK build: `npx cap sync android`, then `./gradlew assembleDebug --no-daemon --console=plain` with the Android SDK and Java 21 configured. Build passed; existing Gradle deprecation/SDK XML-version warnings were non-fatal.
- Drawer → Help navigation and all 33 pages in both themes passed.
- Actual native `CapacitorHttp` calls were observed without replacing their implementation: live IPv6 answer, four source articles, suggestions and successful numeric-ID feedback. Requests used the pinned public help origin with no Authorization header.
- Portrait viewport 412×839: search visible, index scrollable, article approximately 451 CSS pixels high, no page-level horizontal overflow.
- Native Android keyboard opened with ADB input: viewport 412×527, search visible and approximately 139 pixels of independently scrollable article remained. This was not a simulated browser viewport.
- Landscape viewport 863×360: independent index/article scrolling, approximately 247 pixels of article height, no page-level horizontal overflow.
- Disabled both emulator Wi-Fi and mobile data, verified `navigator.onLine === false`, submitted a local-matching search and observed the offline message with intact local hits and zero native HTTP calls. Connectivity and portrait rotation were restored afterwards.

The first offline test exposed a real packaging omission: without `android.permission.ACCESS_NETWORK_STATE`, WebView kept reporting online. Adding this normal, read-only permission fixed detection in the rebuilt APK. The help guard now checks that it remains declared. Chromium documents the permission requirement in its [network notifier implementation](https://chromium.googlesource.com/chromium/src/net/+/refs/heads/main/android/java/src/org/chromium/net/NetworkChangeNotifier.java).

Android screenshots are `docs/screenshots/android-help-light.png`, `android-help-dark.png`, `android-help-keyboard.png`, `android-ask-live.png` and `android-help-offline.png`. They contain an empty account vault and generic help text only. The landscape screenshot caught Android's rotation animation and was excluded from the documentation; the landscape bounds/scroll assertions passed. The disposable harness and native-call report are in `/private/tmp/bldesk-android.F1nb3h`.

### Local emulator setup retained

The SDK is installed at `/Users/adam/Library/Android/sdk`, the AVD is named `bldesk-help-api36`, and Java 21 is at `/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`. The SDK, AVD and Gradle cache occupy roughly 9 GB; no shell profile or global Java configuration was changed. To rebuild, supply `JAVA_HOME` and `ANDROID_HOME` for the Gradle command. To restart this emulator:

```sh
/Users/adam/Library/Android/sdk/emulator/emulator -avd bldesk-help-api36 -no-snapshot -no-boot-anim -gpu swiftshader -memory 2048 -no-audio
```

Use the SDK's `platform-tools/adb -s emulator-5554` for this emulator rather than an unqualified command that might select a physical device. The APK is under `android/app/build/outputs/apk/debug/app-debug.apk`; this is a local debug build, not a published release.
