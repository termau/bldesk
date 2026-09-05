---
title: Keyboard shortcuts
summary: Navigate the palette, dialogs and help and adjust desktop zoom.
keywords: [keyboard, shortcut, zoom, cmd k, ctrl k, escape, enter]
---

# Keyboard shortcuts

Ctrl/Cmd+F inside an embedded SSH session opens scrollback search. Find next and Previous navigate matches; Escape closes the find bar. See [Terminal](help:terminal).

Use Cmd on macOS and Ctrl on Windows or Linux for the command palette and desktop zoom.

## Palette
- Cmd/Ctrl+K opens or closes the palette.
- Up and Down select a result.
- Tab accepts the current completion.
- Enter opens a result or advances an action to its review.
- Enter again runs a reviewed action when its required fields are complete.
- Escape backs out of the current palette state or closes it.

Read the [palette grammar](help:palette). A non-mutating navigation action does not need two confirmations.

## Zoom
- Cmd/Ctrl+plus or equals: zoom in.
- Cmd/Ctrl+minus: zoom out.
- Cmd/Ctrl+0: reset to 100%.

Desktop zoom steps are 80%, 90%, 100%, 110%, 125% and 150%. The View menu uses the same bounds. Below 768 CSS pixels wide, the desktop sidebar is hidden: use the bottom navigation's More button to open the drawer and scroll to other pages. This includes a 1024-pixel-wide window at 150%, but not a 1280-pixel-wide window at 150%. Map zoom changes the map, not the whole application.

## Dialogs and help
Escape closes an idle dialog; busy dialogs prevent accidental dismissal. Enter submits forms when valid. Tab and Shift+Tab move focus.

In Help, Up and Down choose a suggestion; Enter accepts it into the search box. Press Enter to submit a query explicitly. Escape dismisses suggestions.

In a firewall-matrix tag editor, Enter adds the typed tag and Escape closes the editor. In a Network inline field, Enter commits and Escape cancels editing. Escape also dismisses the server context menu and update popover.

## Desktop tools
F5 reloads the desktop renderer; Cmd+R also reloads on macOS. F12 opens developer tools; Cmd+Option+I does the same on macOS. Native menus display the platform's standard editing, reload and window shortcuts.

Server-list j/k, single-key SSH/restart and slash-to-filter are proposed features, not implemented shortcuts. Do not rely on them.
