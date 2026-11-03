---
title: Server settings
summary: Change labels, tags, disks, hypervisor features, alerts, region and HA partner.
keywords: [rename, tags, colour, disk, resize, migrate, partner, alerts, features]
---

# Server settings
Use Settings for the server's display name, its tags, extra disks, advanced features, monitoring thresholds, location and high-availability partner. Review each change separately.

## Labels and guest configuration
Renaming changes the name in mPanel and the API, not the hostname inside the guest. Growing a block device does not grow its filesystem automatically. Hypervisor feature changes take effect on the next reboot.

## Tags
The Tags section lists this server's tags as chips: use “Add a tag” and Enter, or pick a tag that other servers already use, and the cross on a chip takes it off this server. Tags are local labels, kept on this device for the active account profile. BinaryLane does not store them, so they are not in mPanel or the API, they are not shared with other devices or profiles (the Tags card in [Settings](help:settings#tags) exports them to a JSON file and imports them from one), and nothing in this section sends a request, asks for confirmation or writes History. They show next to the server's name on the [Servers](help:servers#tags) list.

Edit on a chip, a double-click on it, or Enter or F2 while it has focus, opens the tag editor with the name, a colour and “Remove from this server”; here it opens under the list (on a phone as a panel inside the visible screen, with Save and Cancel fixed at its foot so a soft keyboard does not hide them), elsewhere as a small panel by the chip. Enter or Save keeps the changes; Escape or Cancel discards them. A tag is one shared name: renaming it renames it on every server that has it (the editor says how many), and renaming to a name already in use merges the two. A tag is also a target: use @name in the [command palette](help:palette#tags) or the terminal broadcast, with the new name after a rename. In a target, plain text is a server and @name is a tag, so a server called web and a tag called web never mix. A saved group in the Fleet matrix keeps its own name and pattern when a tag is renamed; a group with the same name as a tag also includes the servers carrying that tag, and the editor says when that applies.

A name is lower-cased and keeps letters, numbers, dots, dashes and underscores; anything else is dropped, and a name with nothing left is refused with the reason.

### Tag colours
The colour belongs to the name, so it is the same on every server. Choose Default, one of eight presets, or a custom colour. A tag that is new, one no server had, is given a colour of its own: the first preset that no tag in use has, or a random colour once all eight are in use. A tag that already exists is never recoloured, and one without a colour stays without. A colour goes when no server has the tag any more.

Custom colour opens a wheel (hue around the rim, saturation toward the middle), a Brightness slider, a hex field that takes #rgb or #rrggbb with or without the #, and Red, Green and Blue fields; the wheel is only one way in. “Save as custom colour” puts the colour in a row of eight places, filled in the order the colours are saved (an empty place is a dotted circle), kept for the whole app on this device and not per account profile. With all eight filled the button does not save at once: it warns “Saving will overwrite the oldest saved colour. Click Save again to confirm.”, and a second click replaces the oldest saved colour. Changing the colour, choosing another swatch or closing the editor withdraws the question. The cross on a saved colour removes it (not on a phone, see below). Saving a colour that is already saved, or that is one of the presets, does nothing and says so. A tag keeps its colour even after that colour's saved swatch is removed. The picker is always closed when the editor opens, including for a tag that has a custom colour. Choosing a preset puts its hex in the field. On a phone the controls are larger and a saved colour has no cross: press and hold it for about a second and a half to remove it. A ring fills around it while you hold, the phone vibrates three short times and then once longer when the colour is removed, if the device allows it, and lifting your finger early, or moving it, cancels with nothing removed. A tap still just chooses the colour, a line under the row says “Hold a saved colour to remove it”, and Delete or Backspace on a focused saved colour removes it from a keyboard. The Default circle is drawn like the presets and is told apart by its name; an empty place in the saved row is a dotted ring. The text of a custom chip is moved lighter in the dark theme and darker in the light theme until it reads at 4.5 to 1 against the chip, and falls back to black or white if the colour cannot get there. Resetting BLDesk's local data deletes tags, their colours and the saved custom colours with the rest of it.

## Alerts
The Alerts tab lists every threshold alert rule BinaryLane has for the server: CPU, disk I/O requests, incoming and outgoing network traffic, data transfer, disk space, memory and locked backup slots. Each has an on box, its threshold and BinaryLane's own description of it. Change what you need and select Save Alert Thresholds. The confirmation lists each changed rule before and after, and only the rules you changed are sent, so a rule you did not touch is never overwritten. Saving stays off until something has changed, and while a threshold box holds something BinaryLane would refuse: a whole number of at least 1, and at most 100 for a percentage (memory includes swap, so it can go higher). If the rules cannot be loaded the tab says so and offers Retry instead of a form, so nothing can be saved over them.

When one of this server's alerts is triggered, a yellow banner at the top names it and its latest reading against its threshold, and the pill under the server's name says how many there are. Both are read again after you save.

## Worked example
For an example 20 GB secondary disk labelled data, deleting it warns:

“Permanently deletes the 20 GB secondary disk "data". Everything on it is gone.”

The actual size and label come from the selected disk. Check your backup and type the disk label (data in this example), not the server name. For an unlabelled disk, type its numeric ID. Confirm only if you intend to destroy it. A normal disk-growth confirmation instead says:

“Grows the disk. The filesystem inside the OS still has to be extended to use the space.”

## Migration and HA
Read the region-change review carefully; address retention and migration eligibility are BinaryLane decisions. Check the [migration guide](https://support.binarylane.com.au/support/solutions/articles/11000130817-how-to-migrate-your-server-change-location-) before scheduling it. Selecting an HA partner requests placement separation; it does not configure application failover.

## Rebuild and password reset
Settings also contains password reset, hard power cycle and OS rebuild. For an example image slug ubuntu-example, the rebuild confirmation says:

“Erases the disk and reinstalls from image "ubuntu-example". Every file on the server is destroyed; the IP addresses are kept.”

The actual image appears in your dialog. Take a backup, verify the target and type its name before choosing Rebuild. Rebuild is not an in-place OS upgrade. Password reset depends on the server. Where BinaryLane supports changing the password, it generates a new one and emails the account address. Where it does not, it only clears the root or administrator password and a new one is set at the server's web console; nothing is emailed. Either way, anything using the old password stops authenticating.

For guest diagnostics and booting rescue mode see [Recovery](help:server-recovery).
