---
title: SSH keys
summary: Manage account public keys and distinguish them from local private keys.
keywords: [ssh, public key, private key, fingerprint, authentication]
---

# SSH keys
Use SSH Keys to register public keys in BinaryLane and inspect their fingerprints. These are the public keys you can select when building a server.

## Keep private keys local
Only paste a public key into the account form. Your SSH private key belongs on your device. The server header's local-key selector chooses a file for SSH, embedded or native; it does not upload that private key.

Adding an account key does not automatically update every existing guest's authorized_keys.

## Worked example
Deleting an account key shows:

“Removes the public key from your BinaryLane account. Servers that already have it installed keep it.”

If a key is compromised, deleting it here alone is insufficient: remove it from each affected guest and rotate credentials. If a connection fails, compare the intended public key with the local private key and see [Remote access](help:server-remote-access).
