---
title: Remote access
summary: Launch SSH or the out-of-band console without uploading private keys.
keywords: [ssh, console, keys, root, connection, remote access]
---

# Remote access
Use Remote Access to connect to the selected server. SSH opens an embedded desktop tab using the chosen local key unless Prefer native terminal is enabled. Android hands off to an SSH app. See [Terminal](help:terminal); no file upload is involved.

## SSH and console
Check the target address and key before connecting. Public keys saved in BinaryLane are separate from the private key files on your device. Adding an account key does not install it into every existing guest.

Use the rescue console when ordinary network access is broken. It follows BinaryLane's console path rather than the guest's SSH port.

## Worked example
An SSH launch is not a cloud mutation and has no cloud-change confirmation. If you instead choose Shutdown from the shared controls, its dialog says:

“Sends an ACPI shutdown signal. The OS decides whether to honour it — BinaryLane reports the signal delivered, not the server off.”

Do not shut down merely because SSH failed. Start with [reachability troubleshooting](help:troubleshooting#port-22-unreachable) and [Keys](help:keys).
