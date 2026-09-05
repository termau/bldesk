# Feature inventory and screenshot provenance

Checked against the source on 5 September 2026, package version 1.0.61-beta.1. This is an implementation inventory, not a statement that every checked-in change has a published installer.

## Documentation changes

README now includes Templates, Fleet Heatmap, Change Plan/licensing, Help, action tracking and the existing fleet/desktop tools. FEATURES.md separates implemented capabilities, limitations and the original numbered roadmap. The source column identifies the component/helper for each feature group; the detailed internal-help audit remains in [HELP_VERIFICATION.md](HELP_VERIFICATION.md).

Corrections made during this pass:

- Removed the unmeasured “0ms” startup claim, embedded SSH-session claim and unconditional hardware-encryption claim.
- Distinguished DNS add/delete from editing, VPC membership from route editing, and balancer pool management from health-check configuration in mPanel/API.
- Documented palette/create-form review exceptions and the temporary-backup replacement behaviour.
- Added the template job lifecycle and credential-storage fallback limitations.
- Corrected the HelpLink source path and help-service origin; recorded answer-first ordering and the five-result local search limit from PR #50.
- Corrected the context menu description: it is React-rendered, not Electron's native Menu.
- Did not count unmerged Android changes from PR #51 as implemented features.

Sources were checked through the components/helpers listed in FEATURES.md, `src/shared/deeplink.ts` (15 tabs and 11 server sub-tabs), `lib/commands.ts` (16 verbs), `src/shared/help-api.ts`, the current `HelpView.tsx`, `src/main/safeStorage.ts`, and `api/mobile-bridge.ts`. No API capability was inferred to imply an existing BLDesk control. Ask BinaryLane's generated-answer controls were not changed or audited in this documentation pass.

## New screenshots

The README gallery and the desktop help light/dark images are fresh, unretouched captures of the real production-bundled Electron renderer at 1600×1000 and 100% application zoom. The map screenshot uses its own zoom-in button once and pans to frame the topology. No controls, badges or graphs were painted onto an image or added to the application for marketing.

The fictional Atlas demo fleet contains 18 servers across three regions, three private networks and three load balancers, with web/API, PostgreSQL, Redis, worker and monitoring roles. Metrics and backups are generated fixtures. Public addresses use documentation ranges 192.0.2.0/24, 198.51.100.0/24 and 203.0.113.0/24; private addresses use 10.0.0.0/8. Names/email use example.com or invented machine names. Values and fixture prices are illustrative, not current BinaryLane quotes or benchmarks.

| File under `docs/screenshots/` | Subject |
| --- | --- |
| dashboard-dark.png | Multi-region server grid |
| network-map-dark.png | Load balancers, private networks and application tiers |
| heatmap-dark.png | Populated fleet utilisation |
| firewall-light.png | Tier-specific firewall matrix |
| backups-light.png | Database backup recovery controls |
| usage-showcase-dark.png | A full day of synthetic performance history |
| templates-dark.png | Actual bundled starter templates |
| help-dark.png / help-light.png | Actual bundled firewall guide |

These replace the README's older dashboard/firewall/backups captures and add the newer feature views. Older technical screenshots not listed here remain historical material; they are not presented as captures of this dummy fleet. In particular, the existing native Android help images remain evidence from their original emulator test, not desktop screenshots relabelled as Android.

## Reproduce safely

Run `npm run build`, then use the documentation-only launcher and capture script in `scripts/showcase/`. Playwright must be available to the capture script; it is not a new application dependency. If installed outside this repository, point to its entry module:

```sh
BLDESK_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/showcase/capture.mjs
```

The launcher creates a fresh temporary Electron userData/session directory, substitutes a synthetic profile before rendering, intercepts HTTP and HTTPS in the default Electron session, and rejects non-GET requests. It stubs TCP/ping results instead of opening probe sockets. Never point this launcher at a real profile or change its request handler to forward to the network. Local temporary fixture directories are retained for diagnosis; they do not contain real credentials.

The capture run checks for renderer exceptions and attempted cloud writes. Inspect each resulting image before committing: no loading/error placeholders, unreadable framing, accidental tooltips or live identities. This is a documentation capture, not the complete desktop/native Android regression suite. No application UI or transport code changes are part of this refresh.
