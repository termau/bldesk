---
title: Getting started
summary: Connect an account and switch between local profiles.
keywords: [profiles, token, vault, login, account]
---

# Getting started
BLDesk gives you BinaryLane account controls with desktop conveniences. Add a profile with your BinaryLane API token, then select it in the title bar. Check the active profile before making changes.

## Add an account
1. Create an API token in mPanel with the access you need.
2. Open the profile picker and add an account. Give the saved profile a recognisable name.
3. Paste the token and save. Your server list belongs to the selected account, not a combined fleet.

Token permissions are enforced by BinaryLane. See [BinaryLane's API guide](https://api.binarylane.com.au/reference/#section/Introduction).

## The local vault
Desktop profiles encrypt the API token with the operating system's keyring through Electron's safeStorage. On Linux without a working keyring, Electron's fallback is not real encryption, so BLDesk refuses to save the token and says why; you can then choose to save it without encryption on that device, and the vault shows such a profile as "Token not encrypted". If a saved token can no longer be decrypted, for example because the keyring was replaced, the profile shows "Token needs re-entering" and the vault opens for you to enter it again. Android stores tokens only in its Keystore-backed secure storage; if that fails, the token is not saved. Protect your OS account and device either way.

Removing a saved profile does not cancel cloud resources or revoke its API token. Revoke a compromised token in mPanel.

## Find your way
Use the sidebar, a page's circled question mark, or [the command palette](help:palette). [History](help:history) and running actions are scoped to profiles. Local help works offline; cloud controls and Ask BinaryLane need a connection.
