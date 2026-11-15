---
title: Network map
summary: Inspect fleet topology and export a visual inventory.
keywords: [map, topology, svg, png, ipv4, network, vpc]
---

# Network map
Use Map to inspect the active account's topology: Internet, load balancers, regions, private networks and servers. Select a server to inspect it.

## Read the relationships
Links show resource relationships, not measured packet flows, throughput or proof of connectivity. Server exposure labels and colours come from the external-firewall audit: they describe rule exposure, not live connectivity or an IPv4 allocation audit. A label lists the ports that a server's rules let the internet reach on its public IPv4 addresses, read in order as [the firewall help](help:firewall#rules-and-access) describes: a rule for a VPC range or a private address does not count, a port that no rule matches counts as open, a server with no public IPv4 address shows none, and allowing ping adds nothing because ICMP has no port. The label lists the open ports or, when naming the closed ports makes a shorter list, says all but followed by the closed ones, with a range written as BinaryLane writes it (start:end), and a port counts as open on it if either TCP or UDP gets through. The map has no reachability-test control. Open a server for its reachability badge or Usage graphs.

When a read fails, the header says so instead of counting zero: “VPCs not read”, “load balancers not read”, or a note that firewall rules were not read on that many servers, so their exposure is unknown. Servers whose rules could not be read show a question mark rather than a colour, and are left out of the SSH-exposure count.

Each server card shows its open ports at the left of its bottom line and its addresses at the right: the public address, and the private one when both fit beside the ports. A long port list is cut with an ellipsis, and hovering the label shows all of it. Select the server for its full details.

## Navigate and export
Use the map's zoom and fit controls to inspect a dense fleet. To zoom the map itself, hold Cmd/Ctrl and scroll, use the zoom buttons, or pinch on a touch screen. Over the details panel that opens when you select something, Cmd/Ctrl and scroll zooms neither the map nor the app; scroll there without Cmd/Ctrl to move through the panel. Cmd/Ctrl+plus and minus zoom the whole app, not the map. Export SVG or PNG when you need a static inventory: the files are named bldesk-network-map.svg and bldesk-network-map.png, and the PNG is twice the size of the map. In the Android app the export opens Android's own Save as dialog instead of a download, where you choose the folder and can change the name; backing out saves nothing and shows no error. Drawing the PNG can take several seconds on a phone, during which the buttons are dimmed and the map's header says “Preparing the PNG…”. Android adds a number to the name if a file with that name is already there, and the map's header says the name the file was saved under. If the file cannot be written, a “Could not export the network map” card says why. An export can expose server names and addresses; review it before sharing or attaching it to a ticket.

Desktop application zoom is separate from map zoom. If controls are too large, use [the bounded desktop zoom shortcuts](help:shortcuts#zoom), then fit the map again.
