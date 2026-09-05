---
title: Terminal
summary: Desktop SSH tabs, search, reviewed parallel commands and native handoff.
keywords: [terminal, ssh, xterm, shell, native, private key, broadcast, reconnect, search]
---

# Terminal
Embedded SSH runs your device's OpenSSH client inside BLDesk. Each session has its own tab and stays connected across app views and account switches. Check the host and username: switching profiles does not change existing SSH connections. Android hides this tab and retains its ssh:// app handoff.

## Connect to a server
Choose + Connect. Pick a server to fill its primary public IPv4, or enter Host yourself. Set User (root by default), Port (22 by default) and Key, then choose Connect in BLDesk. Default SSH identities leaves identity selection to OpenSSH.

Your private key stays on your device; the account's public-key list is separate. See [SSH keys](help:keys).

Answer password, passphrase and host-key prompts inside the terminal. BLDesk does not bypass host verification. Connecting means the SSH process is being created; live means it is running, not necessarily authenticated. Exit 255 usually means an SSH error; other codes can come from the remote shell/command. Reconnect starts a new connection; Close ends the local SSH process.

## Native alternative
The connect bar and connection-error message offer Open in native terminal. Prefer native terminal changes the default for server buttons, map/context-menu access, tray SSH, deep links and palette SSH. Connect in BLDesk remains explicit. Use ssh jumpbox --native in the [palette](help:palette) to force native launch without changing the preference.

## Search and reopen
Ctrl/Cmd+F while the terminal has focus opens scrollback search. Use Find next, Previous, or Escape to return to the session. Each terminal keeps up to 5,000 scrollback lines in memory, not a recording.

On restart, the terminal view offers Reopen or Dismiss for previously open interactive tabs. Nothing connects automatically. Only server names, usernames, hosts and server IDs are remembered; no key paths, custom ports, commands or output. Reopen uses default SSH configuration/identities; use the connect bar instead when a custom port/key is required. Renderer reload can recover running connections, but not old scrollback.

## Broadcast
Choose Broadcast, enter a target expression such as wp-*, @web or #123,#456, and inspect Eligible, Skipped and Unmatched. Building/archived servers and servers without a public IPv4 are skipped. Other status labels do not prove SSH is reachable. User, port and key come from the connect bar.

Run broadcast opens the shared destructive confirmation with the expression, command and every host. More than five eligible hosts requires typing the expression. After confirmation, SSH runs the command on all eligible hosts in parallel, after each authenticates. Answer prompts separately in each output pane. Results show running/authentication, launch failure, or exit status. Exit 0 is green; non-zero exits/signals are red. Up to 32 SSH processes may run across interactive and broadcast sessions combined; excess launches fail visibly.

Command text is saved in local History for the originating account; never include secrets. Remote output is never saved there. Interactive commands are not recorded. Closing broadcast closes its SSH connections, but cannot guarantee remote commands stop.

## Worked example
Suppose wp-* matches two eligible test servers. Enter hostname and choose Run broadcast. The dialog title is “Broadcast SSH command”, with summary:

“Run this command in parallel on 2 servers: hostname”

The host table identifies both root@address destinations. The notes include:

“The command text is saved in local History. Do not include secrets.”

“Closing SSH connections does not guarantee remote commands stop.”

Choose Run on all targets only after checking both hosts. Each pane shows output and SSH exit status. History records Completed only when every process exits 0 without a signal; failures record Errored. Closing an unfinished panel records Lost track, not success.

## Requirements and limits
Desktop OpenSSH must be installed and on PATH. Windows needs Windows 10 1903 or later for this implementation's ConPTY path; older systems can use native handoff. Interactive splits, serial broadcast, file transfer and recording are not implemented. Use the [rescue console](help:server-remote-access) when the guest's network path is broken.
