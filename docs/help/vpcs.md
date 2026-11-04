---
title: VPCs
summary: Create private networks, inspect members and detach servers.
keywords: [vpc, private network, subnet, attach, detach]
---

# VPCs
Use VPCs to create private networks with a name and an IP range, inspect member servers, attach or detach a member or delete a network. The create form has no region selector, route editor or MTU control. A server can also be moved into a VPC from its [Network tab](help:server-network).

## Attaching and detaching restart the server
Attach Server and Detach both restart a running server: BinaryLane shuts it down, makes the change and starts it again. The Attach Server form shows a note saying so, and the Detach confirmation carries the same note. After you submit, a toast reads “Applying this change. A running server is restarted to do it.” until the action finishes, and [History](help:history) records how it ended.

## Guest networking
Before detaching a member, identify anything using its private address. BLDesk's membership controls do not edit application configuration inside the guest. For the service's networking behaviour, see [what is a VPC](https://support.binarylane.com.au/support/solutions/articles/11000050498-what-is-a-vpc-do-i-need-one-).

## Worked example
Before detaching a server, the confirmation warns:

“The server leaves its private network and reverts to the default public network. Anything reaching it over its VPC address will stop working.”

Below it, a note says:

“A running server is restarted to do this: BinaryLane shuts it down, makes the change and starts it again, so everything running on it stops and starts again.”

Move private dependencies before proceeding. Deleting a VPC instead warns:

“The private network and its address range are removed. There is no undo.”

Check remaining members, type the target's name and confirm only when the network is no longer needed. Inspect History afterwards. The [Map](help:map) helps you inspect relationships but is not a traffic capture.
