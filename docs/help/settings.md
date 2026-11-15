---
title: Settings
summary: Mute notifications from BLDesk, choose a light or dark theme, and export or import your local tags as a JSON file.
keywords: [settings, notifications, mute, alerts, preferences, tray, theme, dark mode, light mode, appearance, tags, export, import, json, backup]
---

# Settings
Settings holds preferences for this device. Open it with the gear button in the title bar. On a phone the title bar has no room for it, so open More and choose Settings instead. Nothing here is saved to your BinaryLane account or changes anything on it; the choices stay on this device.

It holds the notification switches, the theme, and the export and import of local tags. Other preferences are not on this page yet.

## Notifications
The Notifications card has two controls. “Show notifications” is the master switch: turn it off to mute every notification. Under it, “Notify me about” says how many kinds are on, and “Choose kinds” opens a dialog, also titled “Notify me about”, with a switch for each kind:

- “Server state changes”: a server appears, changes state or is no longer listed.
- “Action results”: a server action is requested, finishes, fails, or pauses to ask you a question.
- “Billing”: prepaid credit runs low, or an invoice payment fails.
- “Changes you make”: confirmations after you change something in BLDesk, such as starting a backup, editing firewall rules or adding an SSH key, and the one-time note that BLDesk is still running in the tray.
- “BLDesk updates”: a new version has finished downloading and is ready to install.

A switch takes effect as soon as you click it; Done only closes the dialog. While “Show notifications” is off the dialog's switches are greyed out and keep their settings, so turning the master switch back on restores them.

Muting only stops notifications sent through your operating system. Action progress, failures and History inside BLDesk are not affected, and your operating system can still hide notifications on its own, so check the action status and [History](help:history) when an outcome matters.

On Android BLDesk does not show notifications at the moment, so these switches have no effect there yet.

If a change cannot be saved on the device, BLDesk shows a failure card saying so. The change still applies until BLDesk is closed, and then goes back to what was saved.

## Appearance
The “Appearance” card has one choice, “Theme”, with three buttons: “System”, “Light” and “Dark”. “System” follows your operating system's light or dark setting and changes with it while BLDesk is open; it is what BLDesk uses until you choose otherwise. “Light” and “Dark” keep that theme whatever the operating system says. The sun and moon switch at the bottom of the navigation also changes the theme: it chooses “Light” or “Dark”, so after using it the theme no longer follows the system until you choose “System” here again. The choice is kept on this device.

## Tags
The “Tags” card, headed “Export and import tags”, copies this account profile's [tags](help:servers#tags) to a JSON file and reads them back from one. Tags are local labels kept on this device for the active account profile and BinaryLane does not store them, so a file is how you keep a copy or bring them to another device. Under the heading the card says how many tags are on how many servers, or that no server has a tag yet, or that the account has no servers listed. It has two buttons, “Export tags” and “Import tags”, and neither sends a request to BinaryLane.

Export tags downloads a file named bldesk-tags- followed by today's date, such as bldesk-tags-2026-10-29.json. The button is greyed out while no listed server has a tag. In the Android app it opens Android's own Save as dialog instead of a download, where you choose the folder and can change the name; backing out saves nothing and shows no error. Android adds a number to the name if a file with that name is already there, and the card says the name the file was saved under. The file has one entry for each listed server that carries a tag, with its id, name and tags, and the colour of each of those tags that has one, as a preset name or a #rrggbb colour. Tags left behind on servers that no longer exist are not exported. The file is plain text you can read and edit:

```json
{
  "kind": "bldesk/tags@1",
  "exported_at": "2026-10-29T01:02:03.000Z",
  "servers": [
    { "id": 1001, "name": "web-1", "tags": ["prod", "web"] },
    { "id": 1002, "name": "db-1", "tags": ["db", "prod"] }
  ],
  "colors": { "db": "teal", "prod": "red", "web": "#1e90ff" }
}
```

Import tags opens a file chooser for a .json file of up to 1 MB, and is greyed out while no server is listed for this account. BLDesk checks the whole file first. A file that is not a tags file, is not valid JSON, or has an entry it cannot read (a server without a whole-number id, a tag with no usable characters, a colour that is neither a preset nor a hex) is refused as a whole, with the reason in a card titled “Could not import tags”, and nothing is imported. Tag names are tidied as they are when you type them, so Prod and @prod both become prod.

The import is a merge. It adds the file's tags to the servers that have the same id, it never takes a tag off, and it never changes the colour a tag already has: a colour in the file is used only for a tag that has none. A server in the file that this account does not list is skipped, and a file in which no server matches is refused. A tag that is new and that the file does not colour gets a colour the way any new tag does (see [Tag colours](help:server-settings#tag-colours)). If the file would change nothing, the card says “Nothing to import: the servers in the file already have these tags.”

Otherwise a dialog titled “Import tags” lists, under “Before → after”, each server that changes: its tags as they will be, and above them as they are now if it has any. A note above the list says how many servers are skipped, how many tags get a colour from the file, and how many are coloured differently in the file and keep the colour they have, for each of those that is not zero. “Import tags” in the dialog applies it and Cancel leaves everything as it was. The dialog and the result name the account profile the file was chosen in, so it stays clear if you switch accounts meanwhile. Like other local tag changes it is not written to [History](help:history). Afterwards the card says how many tags were added to how many servers. If this device cannot save the tags (its storage is full or turned off), BLDesk says so in the “Could not import tags” card and nothing is imported: anything already written is put back, so an import is never kept in part. In the unlikely case that the old tags cannot be put back either, the card says some of the import may have been saved.

## The tray menu
On desktop, the tray menu's Settings submenu has the same switches: Show notifications and one for each kind. A change made there shows up on this page, and the other way round. Close to tray and launch at login are set from the tray menu only.

Notifications were already switchable from the tray menu before this page existed. A choice made there is kept; the kinds that had no switch start on.

## Related pages
[Tray and notifications](help:tray) covers the tray menu and close-to-tray. The link `bldesk://tab/settings` opens this page; see [Deep links](help:deep-links).
