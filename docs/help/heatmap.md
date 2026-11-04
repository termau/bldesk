---
title: Fleet heatmap
summary: Compare utilisation across the fleet and drill into server graphs.
keywords: [heatmap, cpu, memory, utilisation, fleet, metrics]
---

# Fleet heatmap
Use Fleet Heatmap to compare utilisation across the active account without opening every server. Sort by a column heading and inspect CPU, RAM, disk, network and IO cells. Refresh fetches current fleet metrics; historical time windows belong to each server's Usage page.

CPU, RAM and disk colours compare usage with that server's capacity. CPU usage is summed across vCPUs: 200% on a four-vCPU server is half its 400% capacity, not an overload. Network and IO colours compare rates with the fleet's current maximum above the displayed minimum threshold. Read the values, tooltips and legend rather than comparing unlike colours.

## Missing data
A missing sample is not zero usage. Loading appears as …; other explicit states include No samples yet, Not reported, Capacity unknown and Error. A non-running server shows its state instead of metric cells. Old values are dimmed and marked stale. Hover for details before treating a quiet cell as spare capacity or a powered-off server.

## Threshold alerts
A red bell beside a server's name means BinaryLane lists that server as having a current exceeded threshold alert. Hover it, or focus it and press Enter, to see which alert and its latest reading against its threshold. Click or tap it for a small popup with the same detail and an Open alert settings button, which opens that server's Alerts settings. Close the popup with its X, Escape, a click or tap outside it, or Back on Android. Back closes the popup first and does not leave the page.

BinaryLane reports which servers have an alert, not which alert. BLDesk compares each enabled alert's latest reading with its threshold and shows the ones at or above it. If none is, the popup says so and the settings show every rule. The bell does not follow the cell colours: those compare usage with capacity, not with the thresholds you set for each server. Alert status is read again every minute and when you select Refresh. If it cannot be read the heatmap says so, and a server without a bell may still have an alert.

## Drill down
Select a server to open its Usage tab and inspect the detailed graphs. The heatmap reads BinaryLane performance data; it does not run a workload or change the server.

For connection failures use [troubleshooting](help:troubleshooting), not colour alone. For inferred power state see [Servers](help:servers#power-is-not-reachability).
