# Help verification

## Android TCP reachability (9 September 2026, 1.0.61-beta.8)

Branch: `feat/android-reachability-probe`. No new runtime dependencies. Ten help
pages mention reachability; all ten were read against the code that renders the
claim, not only the pages this change touches. The help guard's coverage pass is
not part of this claim - it proves the pages exist, not that they are true.

| Sentence | Checked against | Result |
| --- | --- | --- |
| `servers.md` - "The reachability badge checks a port from your device." | `useReachability` in `ReachabilityBadge.tsx` (`supported` is `typeof api.probeTcp === 'function'`), now satisfied on Android by `api/mobile-bridge.ts` and `NetProbePlugin.java` | **Was false on Android.** The badge never rendered there, because the Capacitor bridge had no `probeTcp`, so nothing checked any port. True on that platform for the first time. |
| `troubleshooting.md` - "The badge tests port 22 at the public address from your device, not your custom SSH destination or connect-bar port." | same, plus the `error === 'other'` arm of the failure pill | **Was capable of being false.** A shell without the plugin rejected the call, which became `error: 'other'` and rendered `Port 22 unreachable` - a tested-and-failed claim for a probe that never ran. `probeTcp` is now attached only under `Capacitor.isPluginAvailable('NetProbe')`, so the badge is absent rather than wrong, and `other` renders `Port <n> not checked` in grey. The second half holds on Android vacuously: the Connect to control is gated on `window.bldeskApi?.pty` in `ServerDetails.tsx` and the bridge sets `pty: undefined`, so there is no override to confuse it with. |
| `server-remote-access.md` - the overridden chip's tooltip wording | the `title` on the chip wrapper in `ReachabilityBadge.tsx` | Quoted string matches the template literal exactly. This change adds a `title` to the failure pill for `other` only, and **appends** the override note rather than replacing it, so the quoted sentence stays true where both apply. Unreachable on Android, where `sshHost` is never set. |
| `firewall.md` - "Use the badge and troubleshooting steps to separate local routing, external rules, guest rules and the SSH service." | as above | Wording unchanged and now actionable on Android, where it previously pointed at a badge that did not render. |
| `server-overview.md` - "A failed reachability probe is a reason to investigate, not proof that the VM is off." | `ServerDetails.tsx` header, `ReachabilityBadge.tsx` | Unchanged and still true. Strengthened: a probe that never ran is now `not checked` rather than counted as a failure. |
| `map.md` - "The map has no reachability-test control." | `components/map/NetworkMap.tsx` | Still true. This change adds no control to the map. |
| `server-firewall.md` - "A successful write does not prove SSH is reachable." | `FirewallManager.tsx` | Unaffected. |
| `heatmap.md`, `server-usage.md` - links to `troubleshooting` and `servers#power-is-not-reachability` | those pages' own claims | Make no claim about the probe itself. Unaffected. |
| `terminal.md` - "Other status labels do not prove SSH is reachable" / "Valid syntax is not a reachability test" | `BroadcastPanel.tsx` | About broadcast, which is desktop-only via `pty`. Unaffected. |
| No page claims reachability is unavailable on Android | grep of `docs/help/*.md` for platform exclusions | Confirmed. The exclusions are deep-link OS registration (`deep-links.md`), tray (`tray.md`), embedded SSH (`terminal.md`) and storage fallbacks (`getting-started.md`, `templates.md`). None mentions the badge, so adding the capability falsifies no page and needs no new exclusion note. |

New user-facing strings, and the line that renders each:

- `Port <n> not checked` - the `error === 'other'` arm of the failure pill in `ReachabilityBadge.tsx`. Grey rather than red, because nothing was learned about the port.
- That pill's `title` - the probe's `detail`, with the SSH-override note appended when an override is set.
- `Close` - `aria-label` on the card's dismiss button in `ReachabilityBadge.tsx`, rendered below `sm` only.

Supersedes, rather than contradicts, one line in **SSH address follow-up (6 September 2026)**: "probing remains unchanged" was true when written. Probing is still unchanged on the desktop; it is newly implemented on Android.

### Checks performed

- `npm run typecheck`: both TypeScript projects and all five guards (mutation, UI, help, PTY, updater).
- `npm run build`: production main, preload and renderer bundles.
- `isIpLiteral` agreement: both implementations extracted from source verbatim and run against the same 28 cases, including hostname, port-suffix and mixed-form bypasses. Both accept and refuse identically. `1.2.3.4:22` was accepted before this change: it passes a character-class check, is not a literal, and would have reached `InetAddress.getByName`, which resolves what it cannot parse.
- Real Electron, 1280x840 at 100%, isolated `userData` and the synthetic fleet with every cloud write rejected (0 attempted): the "why" card opens on keyboard focus, stays 320px and `absolute`, keeps zero right padding, and its close button is present in the DOM but `display: none` above `sm`; no horizontal page overflow; no renderer errors.
- Real Electron, `error: 'other'` injected: the pill reads `Port 22 not checked`, background `#e9ecef`, the reason in its `title`, and no firewall explanation offered - there is no rule to blame for a probe that never ran.

- Physical device, Samsung SM-S948B (Galaxy S26 Ultra), Android 16 / API 36, 1440x3120 at 560dpi giving 411 CSS px, driven over `adb forward` with CDP and real `Input.dispatchTouchEvent` touches:
  - `typeof window.bldeskApi.probeTcp === 'function'` and `setProbeTargets` likewise, so `useReachability` reports `supported` on Android for the first time. `window.bldeskApi.pty` is `undefined` there, which is what makes the "no custom SSH destination on Android" row above true rather than merely untested.
  - The chip renders on a real server detail and carries a real result from the device: `Port 22 unreachable`, with the no-rules explanation, and its re-check control present. The probe ran natively; nothing was stubbed.
  - The "why" card: tapping `?` opens it `position: fixed` and screen-centred, 320px wide with 46px clear on the left and 45px on the right of a 411px viewport; tapping the close button **actually closes it**, and `?` reopens it afterwards. This is the failure that beat `blur()` and beat a `.is-dismissed` class on specificity; conditional rendering holds under a real finger.

Everything above was produced by `NetProbePlugin.java`, `MainActivity.java`,
`api/mobile-bridge.ts` and `components/servers/ReachabilityBadge.tsx`, which are
the files this branch changes. Phone layout results belong to the branch that
changes the layout and are recorded there.

The harness is out of tree, in a temporary directory, and is not an app dependency: a copy of `scripts/showcase/launcher.cjs` whose `net:probeTcp` stub is env-driven so the failure states can be exercised, plus two check scripts. Playwright is supplied through `BLDESK_PLAYWRIGHT_MODULE` and is not installed in the repo. On Windows that variable must be a `file://` URL pointing at Playwright's `index.mjs`; `index.js` is CommonJS and its `_electron` export is not visible to a direct ESM file import.

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
