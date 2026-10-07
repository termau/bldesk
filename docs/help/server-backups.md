---
title: Server backups
summary: Manage backup images for this server without changing the target.
keywords: [backup, restore, image, attach, schedule]
---

# Server backups
This is the Backups view pinned to the selected server. Check its header before taking, attaching or restoring an image.

## Restore versus attach
Restore replaces the live disk. Attach mounts an image as a read-only secondary drive so you can recover files without replacing the current disk.

## Worked example
For an example backup named before-upgrade with image ID 123, Restore shows:

“Overwrites the server's current disk with image "before-upgrade" (#123). Everything written since that image was taken is lost.”

The name and ID in your dialog will match your chosen image. Type the target server's name and choose Restore only after checking it. Follow the full [backup restore example](help:backups#worked-example), including checking History afterwards.

## Taking a backup
Take Backup can replace an existing backup when the slot is full, and asks first. See [Take Backup](help:backups#take-backup).

## Backup schedule
The Backup Schedule card says when this server's scheduled backups run, and Change Schedule changes it. See [Backup schedule](help:backups#backup-schedule).

## Retention
Use [Change Plan](help:server-change-plan) for purchased backup counts and offsite options. Automatic backup retention is controlled by BinaryLane, not by keeping BLDesk running.
