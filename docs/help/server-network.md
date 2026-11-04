---
title: Server network
summary: Inspect interfaces and change IPv6, port blocking or VPC membership.
keywords: [ipv6, interfaces, port blocking, vpc, ddos, reverse dns, ip address, ipv4, ipv6, add ip]
---

# Server network
Use Network to inspect public and private interfaces, IPv6, port-blocking controls, VPC membership and Edge DDoS information for this server.

## IPv6 and guest configuration
Enabling an address through the API does not guarantee that a customised guest is configured to use it. Check both the cloud interface and the OS. BinaryLane's external firewall is IPv4-only; configure IPv6 filtering in the guest. See [configuring IPv6 on Linux](https://support.binarylane.com.au/support/solutions/articles/11000137324-configuring-ipv6-on-linux-vpss).

Adding or releasing paid IPv4 addresses belongs in [Change Plan](help:server-change-plan), not the interface list.

## Changes that restart the server
Three changes on this tab restart a running server: Move server (into a VPC, to another VPC or back to the public network), turning Separate private interface on or off, and Change address on a private IPv4 address. BinaryLane applies each one by shutting the server down and starting it again, so everything running on it stops and starts again. The reference describes these actions only by what they change and does not mention a restart; the confirmation and the hint beside each control say so, and so does the label of the Change address editor.

After you confirm, a toast reads “Applying this change. A running server is restarted to do it.” and shows the step BinaryLane reports, such as shutting the server down and then starting it, until the action finishes. The controls on this tab stay locked until then, and [History](help:history) records how it ended. Changes that do not restart the server, such as reverse DNS, IPv6 and port blocking, are unchanged: they ask for confirmation and report on this tab.

## Worked example
Choose the public network in the VPC selector and choose Move. For a server named web-01, the confirmation says:

“Move web-01 to the public network? Its private IP will change and existing private connections will drop.”

Below it, a note says:

“A running server is restarted to do this: BinaryLane shuts it down, makes the change and starts it again, so everything running on it stops and starts again.”

Your server's name replaces web-01. This is a normal-severity review; the separate VPCs page's Detach action uses different wording. Review dependencies, and move or stop anything that must not be interrupted, first. Changing membership does not update application configuration for you. See [VPCs](help:vpcs).
