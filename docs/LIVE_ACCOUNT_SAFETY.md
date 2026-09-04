# Live-account safety

BLDesk can keep ordinary account management usable while placing durable,
local-only limits around selected entities. Safety policy is stored with the
local account profile; it is not sent to BinaryLane and does not change API
permissions.

## Choose a mode and tier

Use the account menu, open **Live-account safety**, and choose a profile mode:

- **Observe only** allows views and non-mutating diagnostics, but no changes or
  remote guest access.
- **Protected mode** applies the tier saved for each server or resource.
- **Full access** is the legacy unrestricted mode. Once a tier is saved, the
  profile cannot be promoted back to Full through the app.

In Protected mode, each entity has one compact tier:

| Tier | Server behavior | Resource behavior |
| --- | --- | --- |
| **Read-only** (`READ`) | View, ping, uptime, and running-state checks; no changes or remote access | View only; no changes |
| **Maintenance** (`MAINT`) | Diagnostics, SSH/RDP or console, firewall work, reboot, power cycle, and a non-replacing temporary backup | Reviewed in-place or child-resource work; no delete/cancel |
| **Normal** (`NORMAL`) | Ordinary reviewed BLDesk actions | Ordinary reviewed BLDesk actions |

Unlisted and newly created entities are Normal. Saved tiers can only become
more restrictive in the UI. A compact badge beside an entity opens its policy
entry directly.

## Entity boundaries

Tiers do not cascade through membership. A Read-only server does not lock its
VPC or load balancer, and a Read-only VPC or load balancer does not lock its
members. Domains, VPCs, load balancers, SSH keys, local templates, and servers
are classified independently.

An operation that changes more than one entity checks only the identities it
actually touches. For example, moving a server checks the server, its current
VPC (if any), and the destination VPC (if any). The privileged desktop or
mobile transport reads current server state immediately before dispatch,
re-checks the active profile, token, and tiers, and fails closed if that context
is missing or malformed.

Firewall rules are currently a server subresource rather than a saved reusable
rule-set entity, so firewall writes follow the server tier. DNS record changes
follow their domain tier. Template edits follow the template slug; renaming a
slug is structural and therefore requires Normal.

## Diagnostics and reachability

Ping, uptime, and running-state actions remain available for every server tier.
The reachability probe checks only the selected server: Windows images use RDP
on TCP 3389, while explicit SSH-capable and other images use SSH on TCP 22.
Failure can also mean a firewall or guest service is not answering; it is not a
proof that the server is down.

## Deterministic code-to-doc map

| Documented claim | Implementation source of truth |
| --- | --- |
| Server operation matrix and API request authorization | `src/shared/binarylane-policy.ts` |
| Durable resource identities and tiers | `src/shared/resource-safety.ts` |
| Desktop credential and policy boundary | `src/main/binarylane.ts`, `src/main/safeStorage.ts` |
| Mobile policy parity | `src/renderer/src/api/mobile-bridge.ts` |
| Firewall first-match interpretation | `src/renderer/src/lib/firewallMatrix.ts`, `src/renderer/src/lib/networkMap.ts` |
| UI confirmation and History boundary | `src/renderer/src/context/ConfirmContext.tsx`, `scripts/check-mutation-guards.mjs` |

Run `npm run typecheck` for TypeScript, the existing mutation guard, and the
project test suite.
