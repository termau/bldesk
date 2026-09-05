---
title: Server overview
summary: Inspect a server's identity, capacity, status and quick actions.
keywords: [overview, specifications, address, status, reachability]
---

# Server overview
Use Overview to check that you have the right server before acting. The header shows its name, ID, primary IPv4, region, plan resources and image. Copy link includes the currently selected sub-tab.

## Quick actions
Select a local SSH key and open SSH (embedded desktop tab by default, or native with that preference), or open the rescue console. A failed reachability probe is a reason to investigate, not proof that the VM is off. Power actions and diagnostics have different effects; [Servers](help:servers) explains the distinction.

## Worked example
The shared header offers Reboot and Graceful Shutdown when the server is considered running, or Power On otherwise. Graceful Shutdown says:

“Sends an ACPI shutdown signal. The OS decides whether to honour it — BinaryLane reports the signal delivered, not the server off.”

There is no hard Power Off button in this header. Check the resulting power state; a submitted shutdown signal does not prove the guest stopped. [History](help:history) records action outcomes.

## Next steps
Use Usage for historical graphs, Network for interface settings, Settings for disks and hypervisor options, and Change Plan for billing-affecting resource changes. Opening these tabs changes nothing.
