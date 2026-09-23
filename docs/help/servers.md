---
title: Servers
summary: Browse your fleet and understand power actions and inferred state.
keywords: [list, grid, filter, power, signal sent, running, off, samples]
---

# Servers
Browse the active account's servers, filter the list, and switch between grid and list layouts. Servers that are still building are listed first, then the rest by name. Select a server for its detailed controls. The context menu gives you Open, SSH, copy actions and power controls.

Archived is BinaryLane's status for a server that is powered off due to cancellation or non-payment. The Archive filter shows only those servers.

## Power is not reachability
BinaryLane's server status does not reliably report a powered-off VM. BLDesk infers power from performance sample freshness and follows power actions with a hypervisor check. Old samples are evidence, not proof: collection or connectivity problems can also make them stale. See the [API's server diagnostics](https://api.binarylane.com.au/reference/#tag/ServerActions).

The fleet sample sweep runs every two minutes. A newest sample older than 15 minutes is inferred as off; a missing timestamp is unknown. After a tracked power action settles, BLDesk waits eight seconds before one is_running diagnostic. Its verdict takes precedence over samples for 20 minutes. These are client inference rules, not a guarantee of guest health.

The reachability badge checks a port from your device. It does not prove that the application is healthy. See [port 22 unreachable](help:troubleshooting#port-22-unreachable).

## Worked example
Choose Shutdown when you want the guest to shut down cleanly. The confirmation says:

“Sends an ACPI shutdown signal. The OS decides whether to honour it — BinaryLane reports the signal delivered, not the server off.”

A successful signal is not proof of shutdown. Check the resulting power state. Reboot requests a clean OS restart; Power off cuts power; Power cycle cuts power and starts again. Unsaved guest data can be lost with either hard power action.

## Create and organise
Create Server opens the review form for hostname, image, region, plan, networking, keys and backups. Check the price and terms before submitting. For repeatable builds use [Templates](help:templates). Palette targets can use [local tags and groups](help:palette#targets).
