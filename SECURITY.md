# Security Policy

BLDesk stores BinaryLane API tokens, which can change or delete cloud servers. Please report security problems privately so they can be fixed before they are public.

## Supported versions

Only the latest release receives security fixes. The in-app updater moves desktop installs to it, and Android shows an update prompt, so older releases, including earlier betas, are not patched.

## Reporting a vulnerability

Use **Report a vulnerability** on this repository's [Security tab](https://github.com/termau/bldesk/security/advisories/new). This opens a private advisory that only the maintainers can see. Please do not open a public issue, pull request or discussion for a security problem.

Include:

- the BLDesk version and platform (Windows, macOS, Linux or Android)
- the steps to reproduce it
- what an attacker could do with it

## Scope

In scope: the BLDesk desktop and Android apps, and this repository's build and release pipeline.

Out of scope: BinaryLane's own API, website and infrastructure, which should be reported to BinaryLane directly, and what a valid API token is permitted to do, which BinaryLane controls.

## What happens next

Replies come through the private advisory. If the problem is confirmed, the fix ships in the next release, and the advisory is published once users can update to it.
