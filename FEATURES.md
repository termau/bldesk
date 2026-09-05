# BLDesk — Implemented Features and Roadmap

Source audit: 5 September 2026, package version 1.0.61-beta.1. This inventory describes the checked-in implementation, not every capability of BinaryLane's API and not unmerged PRs. Release history lives in [CHANGELOG.md](CHANGELOG.md). User workflows live in [bundled help](docs/help).

## Implemented today

| Area | What BLDesk implements | Source |
| --- | --- | --- |
| Compute fleet | Grid/list, name/IP/tag and region/status filters, per-server actions, inferred power state | `ServerList.tsx`, `lib/powerState.ts` |
| Server detail | Overview, embedded/native SSH and console, historical Usage, stored cloud-init, Network, Backups, Firewall, Settings, Recovery, Change Plan, Cancel | `ServerDetails.tsx`, `src/shared/deeplink.ts` |
| Create and Change Plan | Resource/region/image selection, licences, backup retention/offsite options, pre-action backup, price comparison and explicit address-release/reinstall review | `CreateServerModal.tsx`, `ChangePlanPanel.tsx`, `lib/serverPricing.ts`, `lib/licences.ts` |
| Templates | Built-in starters, capture from a server, YAML edit/import/export, variables and reviewed creation, local tags and follow-up firewall application | `TemplatesView.tsx`, `lib/templateJobs.ts` |
| Firewall | Ordered IPv4 rules, import/export/clone, fleet matrix, audit flags, per-target copy diff and local groups/tags | `FirewallManager.tsx`, `FirewallMatrix.tsx`, `lib/firewallMatch.ts` |
| Network map | VPC membership, regional topology, load-balancer backends, rule-derived exposure, selection, mouse pan/zoom and SVG/PNG export | `NetworkMap.tsx`, `lib/networkMap.ts` |
| Fleet heatmap | CPU/RAM/disk capacity ratios, network/IO rates, sorting, stale/missing-data states and links to Usage | `FleetHeatmap.tsx`, `lib/heatmap.ts` |
| VPCs and load balancers | VPC create/member inspection/detach/delete; balancer create, forwarding-rule display, backend attach/detach/delete | `VpcManager.tsx`, `LoadBalancerManager.tsx` |
| Backups | Slot/replacement selection, restore, read-only attachment/detachment, download link and nightly schedule toggle | `BackupManager.tsx`, `lib/backupSlots.ts` |
| DNS and SSH keys | Paginated hosted zones, add/delete records, zone export before removal; account public-key add/import/copy/delete | `DnsManager.tsx`, `SshKeysManager.tsx` |
| Account and billing | Read-only account/security fields, balances, pending charges, paginated invoices and mPanel links | `AccountOverview.tsx`, `BillingOverview.tsx` |
| Review and History | Shared page-action review, typed irreversible confirmations, change tables/diffs, per-profile local outcomes | `context/ConfirmContext.tsx`, `HistoryView.tsx`, `lib/changelog.ts` |
| Action tracking | Completion/error tracking and handling of actions waiting for user interaction or invoice payment | `context/ActionTrackerContext.tsx`, `ActionInteractionPrompt.tsx` |
| Palette and deep links | Sixteen verbs, aliases, glob/ID/IP/group targets, target-list review, help search and server/tab/help URLs | `CommandPalette.tsx`, `lib/commands.ts`, `src/shared/deeplink.ts` |
| Help | 33 bundled pages, contextual links, local search, Ask BinaryLane articles/suggestions/feedback; answers first and local hits initially capped at five | `HelpView.tsx`, `lib/help.ts`, `src/shared/help-api.ts` |
| Desktop tools | Native SSH, local TCP reachability and on-demand traceroute, tray server shortcuts/notifications, bounded 80–150% zoom, light/dark themes | `src/main/terminal.ts`, `src/main/reachability.ts`, `src/main/tray.ts`, `src/main/zoom.ts` |
| Profiles and updates | One active profile at a time, token replacement, desktop update channels and Android APK update checks with prerelease-aware version comparison | `AuthModal.tsx`, `src/main/safeStorage.ts`, `src/main/updater.ts`, `api/mobile-bridge.ts` |

Component basenames above are under `src/renderer/src/components/`; `lib/`, `context/` and `api/` are under `src/renderer/src/`. See [source verification and screenshot provenance](docs/SHOWCASE.md).

## Important boundaries

- **Terminal:** desktop SSH tabs and parallel broadcast; native handoff remains available. No local shell, interactive splits, serial broadcast, file transfer or recording. Android has handoff only. Broadcast command text (not output) is saved in local History.
- **Profiles:** switching is implemented; a merged cross-account fleet is not.
- **Review:** the palette uses its own target-list panel, not the shared change-table/diff dialog. Create Server uses its form as the review. History is local to this installation/profile, not an account-wide audit service.
- **Networking:** VPC route/MTU editing is not exposed. Load-balancer health-check path/protocol settings exist in mPanel/API but have no BLDesk editor.
- **DNS:** the page adds/deletes records; it does not edit existing records. Its add form fixes TTL at 300 and has no priority/weight/port inputs. The palette accepts a priority.
- **Monitoring:** map exposure is inferred from firewall rules, not measured connectivity. CPU utilisation is summed across vCPUs. Power state uses sample freshness and post-action checks rather than a guaranteed live hypervisor feed.
- **Backup safety:** palette backup uses a free temporary slot first, otherwise replaces the oldest unlocked, unattached temporary backup.
- **Templates:** tags apply locally immediately; firewall follow-up is an in-memory job, polling for up to 15 minutes. Reloading/quitting abandons it. Unmatched VPC/key names and unsupported cloud-init do not block creation; inspect the final form.
- **Storage:** desktop safeStorage and Android secure storage have weaker fallbacks on failure/unavailability; do not describe all stored credentials as hardware-encrypted.
- **Platforms:** tray, desktop zoom and native desktop probes are not universal mobile capabilities. Launch at login is offered on macOS/Windows, not Linux. Android external deep-link delivery is not implemented. PR #51's Android probe/map gestures are not counted as shipped here.

## Original expansion ideas — current status

The original numbers are retained because code comments and older discussions refer to them. “Built” describes the implemented subset below, not every original proposal.

### 1. Real embedded terminal (pty)

Implemented on desktop: SSH-only PTYs, persistent tabs, scrollback search, opt-in reopen after restart, parallel broadcast with shared destructive review and per-host outcomes, native preference/override, and a 32-process cap. Interactive splits, serial broadcast and recording remain out of scope. See [terminal verification](docs/TERMINAL_VERIFICATION.md) for tested platforms and remaining release checks.

### 2. Fleet-wide firewall matrix

Implemented: fleet comparison, audit flags, groups/tags, ruleset copying with per-target diffs. Independent named ruleset storage and direct grid editing remain proposals; templates can carry firewall rules.

### 3. A tray / menu bar that earns its spot

Implemented on desktop: fleet summary, server Open/Copy IP/SSH shortcuts, notifications, close-to-tray, and supported-platform launch at login. No tray power-action controls.

### 4. Verb-first command palette

Implemented: power verbs, backup, DNS add, local tags, template-based create, SSH, console, open/link/go/help/ask. Mutating plans review targets before running. Firewall command syntax and general argument completion remain proposals. Use [actual command examples](docs/help/palette.md), not speculative grammar.

### 5. Diff-based change review and local changelog

Implemented for page-level workflows, with the palette/create exceptions described above. History labels are Submitted, Completed, Errored, Failed and Lost track. Invoice/interaction waits belong to the running-action tracker. History export is not exposed.

### 6. Cross-account views

Not implemented. Multiple saved profiles exist, but only one fleet is displayed/searched at a time.

### 7. Backup timeline

Part-built: backup operations, explicit slot replacement and pre-action backup in Change Plan exist. A timeline and fleet-wide backup overview do not.

### 8. Server templates

Implemented: whole-server YAML definitions, starters, variables, capture, import/export and create-form review. See the lifecycle limitations above and [template help](docs/help/templates.md).

### 9. Fleet heatmap + metrics history + threshold alerts

Implemented: fleet heatmap, API-backed historical Usage graphs and per-server threshold settings. No heatmap sparklines or local historical database.

### 10. Network map

Implemented: topology and rule-derived exposure, selection, mouse pan/zoom and export. It is not traffic telemetry, a route editor or a guest-to-guest dependency discovery system.

### 11. Reachability checks from the client

Implemented on desktop: TCP probe beside SSH controls and on-demand traceroute. A native ping operation exists, but there is no general standalone ping dashboard. Refusal, timeout and inability to probe are distinct; none alone proves application health. Renderer-declared targets prevent stray calls, not a hostile renderer proving account ownership.

### 12. Usability polish that compounds

Implemented: React-rendered row context menu (not a native Menu), deep links, auto-updates, theme switching and bounded desktop zoom with scrollable navigation. Server-list j/k shortcuts, favourites ordering, column chooser and saved filters remain proposals.

### 13. Help & Ask BinaryLane

Implemented: 33 local pages, contextual `components/ui/HelpLink.tsx`, palette entry points and help deep links. `HelpView.tsx` requests suggestions after three characters/200 ms and answers after three words/600 ms or explicit submission. The shared fixed origin is `https://uai.adamhomenet.com`, not the BinaryLane cloud API. Only visible query text is sent; local help remains usable offline. Generated-answer controls are separate from this internal documentation inventory.

## Roadmap, not commitments

Potential next work: cross-account views and a fleet backup timeline. These are not advertised as existing features. New work remains subject to [AGENTS.md](AGENTS.md): API-driven BinaryLane controls plus focused client conveniences, without policy layers or architecture rewrites hidden inside a feature.
