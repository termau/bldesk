# Help verification

Implementation branch: `feat/help-and-ask-binarylane`. No version bump or new runtime dependencies.

## Content accuracy review (5 September 2026)

The initial runtime pass below verified rendering and interaction, not sentence-by-sentence factual accuracy. PR #48's review exposed that gap. This follow-up checks bundled BLDesk documentation against the UI handlers and shared helpers, and distinguishes controls offered by BLDesk from capabilities offered by BinaryLane's API and mPanel. It does not audit or change Ask BinaryLane's answer-generation controls.

### Sources checked for each page

Paths below are relative to `src/renderer/src/` unless another root is shown. This is a manual source audit, not a claim that the help guard proves prose correct. Quoted examples were checked against the originating handler and its helpers, including the palette's `POWER_VERBS` labels rather than the shared dialog's text.

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
| terminal | `components/terminal/EmbeddedTerminal.tsx` |
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
