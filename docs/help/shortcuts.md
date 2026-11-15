---
title: Keyboard shortcuts
summary: Navigate the palette, dialogs and help and adjust desktop zoom.
keywords: [keyboard, shortcut, zoom, cmd k, ctrl k, escape, enter]
---

# Keyboard shortcuts

Cmd+F, or Ctrl+Shift+F, inside an embedded SSH session opens scrollback search. Plain Ctrl+F is left to the session (forward-char in a shell, a page down in vim and less). Find next and Previous navigate matches; Escape closes the find bar. See [Terminal](help:terminal).

Use Cmd on macOS and Ctrl on Windows or Linux for the command palette and desktop zoom.

## Palette
- Cmd/Ctrl+K opens or closes the palette. It does not open while a dialog or the navigation drawer is open.
- Up and Down select a result.
- Tab accepts the current completion. Shift+Tab does not.
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
Escape closes the dialog on top when it is idle and has a close button; busy dialogs prevent accidental dismissal, and the dialog that asks for an answer about an action stays until it is answered or put off with Decide later. Enter submits forms when valid, and holding it down does not repeat. In a review with a blue button, Enter confirms. In one with a red button and nothing to type or choose, Cancel has focus when it opens, so Enter or Space cancels: press Tab to reach the red button, or click it. Tab and Shift+Tab stay inside the open dialog, and closing it puts focus back where it was. With a mouse and keyboard, a dialog opens with focus on its first control, top to bottom, unless it starts on a particular field, such as the name to type in a red review.

In the Android app, Back does what Escape does to whatever is open on top: it closes a menu, a list of suggestions or a dialog, and in the palette it goes from a review back to the command. A dialog that asks for an answer, and the palette while a command runs, are left as they are and nothing behind them changes. With nothing open, Back steps back a screen, and on Servers it puts the app in the background. The API Token Vault, while there is no account profile yet, has nothing behind it to go back to, so Back puts the app in the background instead of closing it.

In Help, Up and Down choose a suggestion; Enter accepts it into the search box. Press Enter to submit a query explicitly. Escape dismisses suggestions.

In a firewall-matrix tag editor, Enter adds the typed tag and Escape closes the editor (on a phone the matrix only shows tags). On a tag chip, Enter or F2 opens the tag editor, where Enter saves and Escape cancels. In the tag filter on the Servers page, Space ticks the focused tag and Escape closes the list. Typing @ in the Servers search lists tags: Up and Down choose, Enter completes the tag and Escape hides the list. On the colour wheel in the tag editor, the arrow keys change the hue and the saturation, and Shift makes the steps smaller. In a Network inline field, Enter commits and Escape cancels editing. In the server context menu, and in the menu a right-click on a zone opens in DNS, Up, Down, Home and End move between items, and Escape or Tab closes it. Escape also dismisses the update popover. Each puts focus back where it was. Tabbing out of the update popover closes it too.

## Desktop tools
F5 reloads the desktop renderer; Cmd+R also reloads on macOS. F12 opens developer tools; Cmd+Option+I does the same on macOS. Native menus display the platform's standard editing, reload and window shortcuts.

Server-list j/k, single-key SSH/restart and slash-to-filter are proposed features, not implemented shortcuts. Do not rely on them.
