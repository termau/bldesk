# Help verification

## Plan availability per operating system (24 September 2026, after 1.0.62-beta.6)

Branch: `fix/size-availability-per-image`. No new runtime dependencies. No help page describes plan availability, so no help text changes.

| String | Rendered by | Result |
| --- | --- | --- |
| “We currently do not have resources available to provision a server on these plans.” | `PlanBlockNotes` in `PlanBlocks.tsx`, under the plan table on the create form and Change Plan | Changed: shown whenever any listed plan is blocked by stock, region or retirement, beside any other note. Before, a Windows image's memory note made it fall back to "Out of stock in this region." |
| Crossed-out circle on a blocked plan | `BlockedMark`, in place of the radio on both forms | New, matching the web panel. |
| Storage choices | `diskChoices`, `diskFloor`, `defaultDisk` in `serverPricing.ts` | Changed: from the larger of the plan's `disk_min` (20 GB on every Standard plan) and the image's `min_disk_size`, to `disk_max`, on the reference's steps (multiples of 5 GB, of 10 above 60, of 100 above 200); `restricted_disk_values` used as given. Before, the list started at the plan's included amount (100 GB on 4 vCPU). The plan's included amount is the untouched choice even when it is off the steps: std-8vcpu starts at its included 340 GB at no extra cost. On a server's current plan the untouched choice is the server's own storage instead, and the included amount is offered only if it is a step. |
| `memory` and `disk` in the create and resize requests | `CreateServerModal.tsx`; `startingFigures` in `ChangePlanPanel.tsx` | Changed: each is sent only when the customer moves it off where the form started (the plan's defaults, or the server's own figures on its current plan), as the reference's "leave null" wording describes. Before, both were always sent, so an untouched std-8vcpu went out as `disk: 400`. |
| “If the disk can't be resized, for example because the data doesn't fit in the new size or the disk has been changed inside the server, the change fails after the server has shut down, and the server restarts with its storage unchanged.” | `STORAGE_CHANGE_NOTE` in `ChangePlanPanel.tsx`, above the options and in the confirmation | New: shown whenever storage changes, up or down, except on a reinstall. It replaces “Reducing memory or storage shrinks the disk. The guest has to fit inside the smaller volume, and resizing back up afterwards does not restore anything lost.”, which was shown on any memory or storage reduction. |
| Retired current plan row | `ChangePlanPanel.tsx`, `isRetiredCurrent` | New: listed in price order, ticked and greyed with its memory and storage fixed; crossed out once another plan is picked, and cannot be picked again. The notice above the table is unchanged. |

### Checks performed

- `npm run typecheck`, `npm run test:terminal` and `npm run build`.
- Public API: `/v2/sizes` without `image` reports a stock figure that matches no OS. With `image=windows-2022`, std-6vcpu and std-8vcpu are out of stock in Brisbane; with `image=ubuntu-24.04`, std-4vcpu to std-8vcpu are out of stock in Melbourne; the unfiltered list showed both in stock. With `server_id`, the list is the sizes that server can be resized to, with that server's stock (lb1 could still move to cpu-2thr and cpu-4thr, which are out of stock in Brisbane in general), and it includes the server's own retired plan. `image` accepts legacy slugs (`ubuntu-24.04.0`, `cpanel-whm-rocky-8`).
- `serverPricing.ts` bundled and run over every size and distribution image the API lists (21 x 27, 45 hidden as below the image minimum): no storage or memory value offered that the reference's rules reject, none below the plan's or image's floor, none above the maximum; CPU Optimised plans offer exactly their `restricted_disk_values`. Memory stays the doubling list from the included amount to `memory_max`, all valid values. Rerun after the change to `defaultDisk`: the only off-step value offered anywhere is std-8vcpu's own 340 GB as its untouched default, and with a current-plan `keep` of 400 it offers 300, 400, 500 without 340. In the app: a 4 vCPU server's Change Plan lists 20 to 2000 GB with its 100 GB selected, and std-8vcpu shows 340 GB at $156.80.
- Dev build against a live account, compared with the web panel by Blake: Brisbane Windows Server 2022 server on a retired plan (Change Plan: 1 GB hidden, current plan first and ticked at $17.50, 6 and 8 vCPU and 6 and 8 threads crossed out, then crossed out itself after picking 1 VCPU / 2 GB); create form Brisbane + Windows Server 2022 (6 and 8 vCPU crossed out, 1 GB hidden), Melbourne + Ubuntu 24.04 (4 to 8 vCPU crossed out, 1 GB listed), Sydney + Windows Server 2022 (all listed from 2 GB). A server on a current plan (std-4vcpu) behaves as before, apart from the "(current)" label, which is gone as in the web panel.
- Requests read from the dev build with the create and resize POSTs intercepted in the page (nothing sent to the API), on a live std-1vcpu server with 3 GB memory and 40 GB storage:
  - Change Plan, current plan, storage 40 → 20 GB: `options` has `disk: 20` and no `memory`. The storage note shows above the options and in the confirmation.
  - Change Plan, std-8vcpu untouched: no `disk` or `memory`. The row reads 340 GB, $156.80; the storage note shows (40 → 340 GB).
  - Change Plan, current plan, memory 3 → 4 GB: `memory: 4096` and no `disk`. No storage note.
  - Create form, std-8vcpu untouched: no `disk` or `memory`. Storage changed to 400 GB: `disk: 400`, row priced $163.40.
- Public API, for the storage note. The same server's disk was split by hand into `/` (10 GB) and a second ext4 partition (30 GB), with a marker file on each, the second placed past 20 GB. Resizes to 20 GB and to 60 GB were each accepted (HTTP 200) and then errored at "Configuring virtual disk" after "Shutting down server"; the server restarted by itself at 40 GB with both markers intact. A memory-only resize completed. A same-plan resize without `memory`, on the server at 3 GB, was refused with "This would result in no effective change.", so leaving `memory` out keeps the current value.
- Same-plan resize with `memory` and `disk` left out, the case the reference contradicts itself on (`Resize.options` says fields left out are removed; `memory` and `disk` say null keeps the current value on the same plan). A std-1vcpu created with 4 GB memory and 60 GB storage, above the plan's 2 GB and 40 GB. From Change Plan, staying on the plan and changing only daily backups (0 → 1): the request's `options` held no `memory` or `disk`, and the confirmation showed only the backup change. The resize completed. Afterwards the server's `memory` was 4096 and `disk` 60, and `selected_size_options` read `daily_backups: 1`, `memory: 4096`, `disk: 60`. Memory and storage left out are kept, not reset to the plan's defaults.

## Generate SSH key pairs (24 September 2026, after 1.0.62-beta.5)

Branch: `feat/ssh-keygen` (#100). No new runtime dependencies: generation uses the system's `ssh-keygen`, found on PATH like `ssh`.

| String | Rendered by | Result |
| --- | --- | --- |
| `keys.md` - "Generate a key pair" section | `GenerateKeyPairDialog.tsx`, opened from the SSH Keys header and beside Add SSH Key on the create form; `src/main/sshKeygen.ts` | New. Buttons render only when `window.bldeskApi.generateSshKeyPair` exists, so not on Android. |
| "The name you give is used for both the file in ~/.ssh and the key on your account ... the date is added to it" | `resolveKeyName` in `sshKeygen.ts`, fed the live account key names | Checked: a clash on disk or on the account gets `-YYYYMMDD-HHMM`, then `-2` and up. An empty name becomes `bldesk-YYYYMMDD-HHMM`. |
| "Nothing in ~/.ssh is ever overwritten, and ~/.ssh is created if it does not exist." | `generateKeyPair`, `ensureSshDir`; `ssh-keygen` runs with no stdin | Checked: an existing file is skipped by name; if one appears mid-call, `ssh-keygen`'s overwrite prompt reads end-of-file and exits 1, file unchanged. |
| "ssh-keygen writes it, and BLDesk reads only the .pub file" | `generateKeyPair` reads `${privateKeyPath}.pub` only | The private key is never opened. |
| "becomes its Key for this server once the create is accepted" | `CreateServerModal.tsx` calls `setKeyAssociation` with the generated key's path after `POST /v2/servers` returns an id | Checked live, below. |

### Checks performed

- `npm run typecheck`, `npm run test:terminal` and `npm run build`.
- `sshKeygen.ts` bundled and run against a temporary home, with both Microsoft's `C:\Windows\System32\OpenSSH\ssh-keygen.exe` (9.5p2) and Git for Windows' `ssh-keygen`: missing `.ssh` created; disk clash, account clash and empty name resolved as above with the first file's hash unchanged; `../evil`, `config`, `x.pub`, `.hidden`, `has space` rejected; missing `ssh-keygen` reported; `ssh-keygen -y` on each private key reproduces its `.pub`. Microsoft's `ssh-keygen` sets the private key's own ACL (the user, SYSTEM, Administrators); Git's inherits the same from the profile. Both are accepted by Microsoft's OpenSSH.
- Dev build against a live account: generated from the SSH Keys page (the key appears on the account with the same public key as the local `.pub`, and under the local ~/.ssh card as Linked), and again with the same name (dated name). "config" disables Generate with the reason shown. From the create form, the dialog prefilled the hostname and the new key was ticked beside MASTER.
- End to end: created a std-min Ubuntu 26.04 server in Sydney from the create form with a generated key. BLDesk stored the key's path as that server's key, and Remote Access showed it as Key for this server. `ssh -i <key> -o IdentitiesOnly=yes -o BatchMode=yes -o PasswordAuthentication=no root@<ip>` logged in, and the key was in `authorized_keys`. The server, the test keys and their files were deleted afterwards.
- Linux: `sshKeygen.ts` bundled and run with Node 18 on Ubuntu 24.04 as a new user with no `~/.ssh` (OpenSSH 9.6, `/usr/bin/ssh-keygen` from PATH). `~/.ssh` was created 700, the private key 600 and the `.pub` 644; the clash, no-overwrite and `ssh-keygen -y` checks passed as on Windows; with the `.pub` in that user's `authorized_keys`, sshd (StrictModes on, the default) accepted a key-only login. This exercises the main-process generator, not the Linux app window.
- Not exercised: macOS. The build is not sandboxed (DMG and zip, no Mac App Store target), `ssh-keygen` is `/usr/bin/ssh-keygen`, which is on the PATH a Finder-launched app gets, and a new `~/.ssh` is chmodded 700 as on Linux. It needs a check on a Mac before this ships.

## SSH key editing and defaults (24 September 2026, after 1.0.62-beta.5)

Branch: `feat/ssh-key-edit`. No new runtime dependencies.

| String | Rendered by | Result |
| --- | --- | --- |
| `keys.md` - "Rename a key or make it a default" section | `SshKeysManager.tsx`: the pencil (`aria-label="Edit key"`) opens `EditSshKeyDialog` (name and default only); the Default column reads `k.default`; the Add form's checkbox sends `default` | New. The API's update call is `PUT /v2/account/keys/{key_id}` with `name` and `default`; `useUpdateSshKeyMutation` always sends the current name and omits `default` when it is unchanged. |
| “Select this SSH Key for all new Cloud Server Installations” | `EditSshKeyDialog` and the SSH Keys Add form, matching the create form's `AddSshKeyDialog` | mPanel's wording. |
| “New servers get this key unless you pick their keys yourself. Existing servers are not changed.” | `handleEditKey` confirm summary when default is turned on | New. Per the spec's `ssh_keys` on server create: no list deploys the defaults, a list deploys only those keys. |
| `keys.md` - "The create-server form ticks every default key for you. Untick one and that server does not get it." | `CreateServerModal.tsx` pre-selection effect | Changed: it ticked only the first default key, so with two defaults the second was dropped from new servers. |

### Checks performed

- `npm run typecheck`, `npm run test:terminal` and `npm run build`.
- Dev build against a live account, with disposable keys (since deleted):
  - Create form, "+ Add SSH Key": before, every add failed with a 400 (`public_key` was never sent; the caller passed `public_key` to a hook that reads `publicKey`). After, the key is created, with default set when ticked. History records it as Completed, and a rejected add (duplicate key) as Failed. Before, this path wrote no History entry.
  - With two default keys, the create form pre-ticks both (before: only the first).
  - Opening the create form fresh (not from a template) resets the ticks to the account's current defaults: MASTER unticked and the form closed, then reopened, came back ticked; a key made default through the API while the app was open was ticked on the next open (before, the previous ticks were kept). Template opens are unchanged, since the reset is skipped when the form has a prefill; not exercised live, as no template on the account sets keys.
  - A key added from the create form is ticked for that server straight away, as in the web panel, alongside the keys already ticked. A rejected key shows the API message (e.g. "The provided SSH key was not in a recognised format"), not the raw JSON body.
  - Edit: rename plus default off, then default on alone, each confirmed with a before → after table and read back from the API. An edit with nothing changed closes without a confirm or History entry.
  - Add SSH Key with the checkbox ticked creates a default key.
  - Freshness, with keys created and deleted through the API while the app was open: the create form dropped a deleted key the next time it opened (before, it kept offering it until Servers was reopened); the SSH Keys page showed an added key and dropped a deleted one on Refresh, and on leaving and returning within 20s (before, the cached list was reused for 20s). `keys.md` - "The list reloads from BinaryLane each time you open the page, and Refresh reloads it on demand" is `refetchOnMount: always` on `useSshKeys` plus the Refresh button.
- Table width, emulated CSS widths: at 1280 and 1600 the Actions column fits. At 1024 and below the table scrolls sideways, as it already did (59px before, 159px now, from the Default column). The column heading is "Default", with the full mPanel wording as its tooltip, so it fits at 1280.

## List paging: VPCs, SSH keys, DNS records, load balancers (24 September 2026, for 1.0.62-beta.5)

Branch: `fix/vpc-list-paging`. No new runtime dependencies.

| String | Rendered by | Result |
| --- | --- | --- |
| Pager range "1–20 of 51" and "1 / 3" | `VpcManager.tsx`, below the VPC cards | New. Rendered only when the account has more than `VPCS_PER_PAGE` (20) VPCs, matching the DNS list's pager. No help page describes the VPC list's length, so no help text changes. |

### Checks performed

- `npm run typecheck`, `npm run test:terminal` and `npm run build`.
- Dev build against a live account with 51 VPCs (50 disposable, since deleted). Before: the VPCs page showed 20, the API's default page. After: 51, as 1–20, 21–40 and 41–51, with Previous disabled on page 1 and Next on page 3. With one VPC, no pager renders.
- The same fix for SSH keys, DNS records, load balancers and current data usage, all of which also read only the first 20. SSH keys, with 25 disposable keys added (since deleted): the page read "Account SSH Keys (20)" before and "Account SSH Keys (28)" after. DNS records on a live zone with 25 records: 20 rows and "20 records" before, 25 and "25 records" after. The Load Balancers page renders as before.
- Not exercised live: more than 200 VPCs, which would take `fetchAllPages` past its first 200-item request. That path is the one `useImages` already uses.
- Not exercised live: more than 20 load balancers, which cost money, or more than 20 servers for data usage. Both go through the same `fetchAllPages` call as the lists above.

## Honest token storage (security batch 4)

Branch: `security/honest-storage`.

| Text | Rendered by | Result |
| --- | --- | --- |
| `getting-started.md` "The local vault" paragraph | `src/main/safeStorage.ts` (`canEncrypt`, `encryptToken`, `decryptRecord`, `saveProfile`), `AuthModal.tsx`, `App.tsx` `refreshProfiles`, `api/mobile-bridge.ts` `saveStoredProfiles` | Rewritten. `canEncrypt` treats Linux `basic_text`/`unknown` as unavailable; `saveProfile` then returns `errorCode: 'encryption-unavailable'` unless `allowUnencrypted` is sent, which AuthModal only sends after the user ticks "Save this token without encryption on this device". AuthModal labels such profiles "Token not encrypted" and undecryptable ones "Token needs re-entering"; `refreshProfiles` opens the vault when the active token is ''. Android's `saveStoredProfiles` throws instead of falling back. |
| Vault title "API Token Vault" (was "Hardware Encrypted Vault") | `AuthModal.tsx` header | The old title was untrue for the keyring-less and pre-fix fallback cases. |
| Template capture note: "User data is copied exactly as it is on the server, including any passwords, keys or tokens in it: remove those before saving or sharing the template." | `ServerDetails.tsx` Cloud-init tab, above "Save server as template" | `templateFromServer` copies `userData` verbatim into `spec.cloudInit`; nothing strips secrets from it. |

## Server order, Archived, map zoom keys (23 September 2026, after 1.0.61-beta.10)

Branch: `fix/issues-66-71`. No new runtime dependencies.

| String | Rendered by | Result |
| --- | --- | --- |
| `servers.md` - "Servers that are still building are listed first, then the rest by name." | `compareServersForList` in `lib/serverStatus.ts`, used by `ServerList.tsx` | New. The comparator ranks `status === 'new'` first, then compares `name` with `localeCompare`, numeric-aware and case-insensitive. Checked in the dev build against the live account: all 33 servers render in that order. |
| `servers.md` - "Archived is BinaryLane's status for a server that is powered off due to cancellation or non-payment. The Archive filter shows only those servers." | `describeStatus('archive')`; the `archive` option in `ServerList.tsx` filters on `s.status === statusFilter` | New. The definition is the API reference's, `schema.d.ts` on `ServerStatus`: "The server is powered off due to cancellation or non payment." The label stays `Archived` / `Archive`, BinaryLane's own term (#69). |
| Tooltip "Powered off due to cancellation or non-payment" | `ARCHIVE_HINT` in `lib/serverStatus.ts`, on the list's status dot, the grid and detail status pills and the Archive filter option | New. Shown only for `archive`; every other state keeps its existing power-source tooltip. |
| `map.md` - "To zoom the map itself, hold Cmd/Ctrl and scroll, use the zoom buttons, or pinch on a touch screen. Cmd/Ctrl+plus and minus zoom the whole app, not the map." | `NetworkMap.tsx` `onWheel` (`ctrlKey \|\| metaKey`), its zoom buttons and two-finger pinch handler; `src/main/zoom.ts` claims `control \|\| meta` with plus, equals and minus | New (#66). Wording matches the Cmd/Ctrl form `shortcuts.md` already uses. |

### Checks performed

- `npm run typecheck` and `npm run build`.
- Dev build with isolated `userData` against the live account, read-only views only. Server list is A-Z. The Archive option carries the tooltip. On VPCs, DNS & Domains, SSH Keys, Load Balancers and History the gap between the action button and the `?` is 8px on one row, at 1400px and 411px (#70; VPCs measured 324px before). Templates at 411px: the library is capped at 256px with the detail below it on the first screen; at 1400px it is the 300px sidebar as before (#67).
- Header layout at the `AGENTS.md` sizes, emulated as their CSS widths (1280, 819 and 683 for 1024x680 at 80%, 125% and 150%; 1600, 1024 and 853 for 1280x840) plus 411px, on the five pages above and Templates: `?` within 12px of its button, on the same row, inside every clipping ancestor, and no horizontal page scroll. 42 checks, all passing. This emulates the zoomed layout; it does not drive `zoom.ts`'s key handler. The first run found the Templates header's `?` 5px past the edge at 411px, because its button row could not wrap; it now wraps.
- Not exercised live: the cancel 404 path (#68), which would cost a server. The change is one condition: an error whose response status is 404 no longer throws, so History records the cancel as completed.

## Network & Addressing lists every address (9 September 2026, 1.0.61-beta.8)

Branch: `feat/show-all-public-ipv4`. No new runtime dependencies.

| String | Rendered by | Result |
| --- | --- | --- |
| `Secondary IPv4` / `Secondary IPv4s` | `ServerDetails.tsx`, Network & Addressing, one row holding every `type: 'public'` address after the first | New, and pluralised on count. One row per **kind** of address, with every address of that kind stacked in the value column: a row each repeated the label, which read as several different fields that happened to share a name. Matches the language `ChangePlanPanel.tsx` already uses, where `publicIps[0]` is "primary - stays with the server" and the rest are the releasable secondaries. |
| `Private IPv4` / `Private IPv4s` | `ServerDetails.tsx`, same pane, every `type: 'private'` address | New, pluralised the same way - a VPC server can hold more than one. Every private address is listed. |
| `Public IPv4` | `ServerDetails.tsx`, same pane, the first `type: 'public'` address | Now rendered only when the server has a public address. It used to show `primaryV4`, which falls back to the first address of any kind, so a VPC-only server listed its private address as `Public IPv4`. Checked on a real VPC-only account server: before, its `10.241.x` VPC address was labelled `Public IPv4`; after, there is no public row and the address is under `Private IPv4`. |
| `server-overview.md` - "Network & Addressing below lists every address the server holds..." | the pane itself | New sentence, added because the pane was previously undocumented. Checked against the rows above: primary, secondaries, private, and IPv6 which is rendered only when `server.networks.v6[0]` exists. |
| `server-overview.md` - "The header shows its name, ID, primary IPv4, region..." | `ServerDetails.tsx` title row and meta row | Unchanged and still true. The header still shows only the primary; this change adds rows to the pane below it, not to the header. |
| `server-remote-access.md` - "Public address uses the server's primary public IPv4." | `lib/sshKeyAssociations.ts` | Unchanged and still true. This diff touches only the addressing pane's rows: it adds no SSH route, changes no probe target, and does not alter `useReachability`, which still takes `primaryV4`. |

### Checks performed

- `npm run typecheck` and `npm run build`.
- On a physical Samsung SM-S948B at 411 CSS px, against a real account server holding a primary, a secondary and a private address. **The build was this branch on top of `main` and nothing else**, confirmed in the run by `typeof window.bldeskApi.probeTcp === 'undefined'`. 9 checks, all passing: one row per kind of address with no duplicated label; the label agreeing with its count; every listed address carrying its own copy control; no row overflowing its container; and the page not scrolling sideways. Before this change that server displayed one address of the three, while Change Plan on the same server listed both public addresses by name in order to offer one for release.
- An earlier draft of the bullet above was measured on a build combining six branches. It is re-measured here on this branch alone, which is the same correction applied to the mobile-overflow entry.
- Plural and singular both exercised in real Electron against fixture servers, since no account server has more than one secondary: a server with three public and two private addresses renders exactly one `Secondary IPv4s` row holding both secondaries and one `Private IPv4s` row holding both private addresses, each stacked address keeping its own copy control; a server with one of each keeps the singular labels. The primary row is unchanged, and IPv6 keeps its own truncation because a v6 address is long enough to widen the row on a phone.

## Mobile overflow and the server header (9 September 2026, 1.0.61-beta.8)

Branch: `fix/mobile-overflow`. No new runtime dependencies. Responsive fixes
only: every change is either inside a scroll container that did not exist, or
gated on a breakpoint so the desktop renders as it did.

User-facing text this change touches, and the line that renders each:

| String | Rendered by | Result |
| --- | --- | --- |
| `Server:` | `ServerDetails.tsx` title row | Wording unchanged; now `hidden sm:inline`, so it reads exactly as before from `sm` up and is dropped only where the row must also fit a hostname and the power pill. |
| `All servers` | `ServerDetails.tsx`, `aria-label` and `title` on the back control | Replaces the visible word "Servers" below `md` only. The desktop sidebar keeps its own "All Servers" control, which is unchanged. |
| `SSH` / `Launch SSH` | `ServerDetails.tsx` action cluster | The same button. `SSH` below `sm`, `Launch SSH` from `sm` up; the terminal icon carries the meaning at the narrow end. |
| Help pages that mention the wording | grep of `docs/help/*.md` for "Server:" and "Launch SSH" | One hit: `server-remote-access.md` front matter, "Launch SSH or the out-of-band console without uploading private keys." That is the verb phrase, not a quotation of the button's label, and the button still reads `Launch SSH` at every width the desktop uses. No page mentions the `Server:` prefix. Nothing is falsified. |

Deliberately **not** in this change, having been split out as discretionary
desktop work: moving the reachability chip out of the action cluster, grouping
the reboot and shutdown buttons, and changing the meta row's gap. This diff
touches `ServerDetails.tsx` but not the chip's call site, so its position is
unchanged from `main`.

### Checks performed

- `npm run typecheck` and `npm run build`.
- The full `AGENTS.md` zoom matrix in real Electron, isolated `userData` and
  synthetic fixtures, 0 cloud writes attempted and no renderer errors: **53
  checks, all passing**, at 1024x680 and 1280x840, each at 80%, 125% and 150%.
  Zoom is applied by `sendInputEvent` with Control, so `src/main/zoom.ts`'s
  `before-input-event` handler is what is under test rather than a direct
  `setZoomFactor`.
  - CSS width equals window width over factor at every combination: 1280 / 819
    / 683 at 1024, and 1600 / 1024 / 853 at 1280.
  - Last navigation item (`Embedded SSH`, 15th of 15) reachable at every
    combination, with the sidebar's own scroller confirmed to scroll.
  - At 1024x680 / 150% the CSS width is 683, below the 768 breakpoint, so the
    desktop sidebar is hidden by design and navigation is the mobile drawer.
    Checked through the drawer there: 17 items, last one reachable.
  - Both dense tables reach their last column inside their own `overflow-x:
    auto` scroller, while the page itself never scrolls sideways. Disk images
    813px in a 450px box at the tightest combination; SSH keys 776px in 546px.
  - Dialog: the close control stays pinned in the header and the confirm
    (`Add Server`) is reachable by scrolling the body, at every combination.
- Range limits: reset returns to 100%, zoom in clamps at 150%, zoom out clamps
  at 80%.

- Physical device, Samsung SM-S948B (Galaxy S26 Ultra), Android 16 / API 36, 411 CSS px, over CDP. **The build was this branch on top of `main` and nothing else** - confirmed in the run by `typeof window.bldeskApi.probeTcp === 'undefined'` and by the reachability chip being absent from the server detail, neither of which would hold on a build that also carried the Android probe work. 17 checks, all passing:
  - No horizontal page scroll on the servers list, firewall, SSH keys, backups, or a server detail. The network map is not listed: this diff does not touch it.
  - Both dense tables reach their last column inside their own `overflow-x: auto` wrapper while the page itself stays put - SSH keys 718px of table in a 362px box, disk images 676px in 362px.
  - Server detail header: the configuration summary is one line with `white-space: nowrap`, `Server:` is hidden at this width, the hostname truncates, the title row does not overflow, and the back control measures 24px.
  - A probe of the scrollbar gutter returns 0px with `(pointer: coarse)` matching and `(pointer: fine)` not, so the platform's overlay bar is back and costs no layout width.

An earlier draft of this entry took its numbers from a build combining six
branches, which is how results reached the wrong diff elsewhere in this file.
They are re-measured here on this branch alone.

Noted while verifying, pre-existing and **not** changed here: the create-server
dialog's submit sits inside the Modal's scrolling body rather than its `footer`
slot, so at 1280x840 it starts 338px below the fold and is reached by scrolling.
Confirmed identical on `origin/main` with this branch stashed, so it is not a
regression from this work. Every other checked dialog behaviour matches the
`Modal` contract.

The harness is out of tree and is not an app dependency: a copy of
`scripts/showcase/launcher.cjs` with an env-driven probe stub and synthetic
`ssh_keys`, plus the check scripts. Playwright comes from
`BLDESK_PLAYWRIGHT_MODULE`.

## Browse existing SSH key files (7 September 2026, 1.0.61-beta.8)

Checked `help/keys.md`, `help/server-remote-access.md` and `help/terminal.md` against the Browse… button, Key file display and cancellation flow in `ServerDetails.tsx`; the main-process `vault:chooseSshKeyFile` / `vault:getLocalSshKeys` handlers; `existingKeyFiles` in `src/main/sshKeyFiles.ts`; and `availableSshKeys` in `lib/sshKeyAssociations.ts`. Selected files use stat metadata only, with no private-content read, copy or passphrase persistence. Existing automatic discovery still reads public `.pub` files only. Local filenames are not BinaryLane account public keys. All SSH consumers include persisted selected paths when checking availability, so an external file does not become missing merely because discovery cannot find it.

Cancellation preserves the association. The file browser has no extension restriction and does not validate cryptographic format; OpenSSH does that. Documentation names the required OpenSSH format and does not promise PuTTY-format support. See [key-file browser verification](SSH_KEY_FILE_VERIFICATION.md).

## SSH address follow-up (6 September 2026, 1.0.61-beta.5)

- `help/server-remote-access.md`: Connect to options, Custom SSH host input, inheritance, invalid-name fallback and address warning checked against `ServerDetails.tsx` and `lib/sshKeyAssociations.ts`. Public-probe tooltip checked against `ReachabilityBadge.tsx`; probing remains unchanged. `src/shared/ssh.ts` and the native/PTY launchers pass a hostname to system OpenSSH without renderer DNS resolution. The loopback test verifies an OpenSSH Host/HostName alias. VPN availability remains the user's responsibility; no automatic short-name extraction or VPN configuration is claimed.
- `help/terminal.md`: Default SSH address, separate Host/Key origin labels and reopen rules checked against `TerminalView.tsx`; Host column and invalid-connect-address skips against `BroadcastPanel.tsx` and `lib/terminalSessions.ts`. Existing confirmation quotes are unchanged. `sshArgv` still supplies root for server buttons and connect-bar user/port explicitly, so docs do not promise that an alias's User/Port overrides those arguments.
- `help/troubleshooting.md`: distinguishes intentionally firewalled public SSH from private-route availability; points to the implemented Connect to control rather than suggesting a firewall relaxation. Source: `useReachability(primaryV4, 22, ...)` in `ServerDetails.tsx` and the unchanged reachability implementation.

See [SSH host verification](SSH_HOST_VERIFICATION.md) for test evidence and the outstanding real-tailnet acceptance check.

## SSH key association follow-up (6 September 2026, unreleased)

- `help/server-remote-access.md`: checked control names and manual/learned labels against `ServerDetails.tsx`; resolution and pruning against `lib/sshKeyAssociations.ts`; lifetime/exit conditions against `lib/terminalSessions.ts`.
- `help/terminal.md`: checked picker source labels and reopen behaviour against `TerminalView.tsx`, per-host preview/skips and confirmation wording against `BroadcastPanel.tsx`, entry-point resolution against `lib/openSsh.ts`, and conditional identity options against `src/shared/ssh.ts`.
- `help/keys.md`: checked discovery against `vault:getLocalSshKeys` in `src/main/index.ts`: reads `.pub` contents, tests private-path existence, does not read private-key contents. Connection selectors filter to entries with a private path. Association storage contains paths/source metadata, not private-key material.
- Corrected the previous statements that broadcast shares the connect-bar key and reopen always uses SSH defaults. Documented the ten-second rule as a heuristic, native non-learning, and the distinction between individual fallback and broadcast missing-key skips. `IdentitiesOnly=yes` excludes unrelated agent identities; it does not erase other configured `IdentityFile` entries.

See [SSH key verification](SSH_KEYS_VERIFICATION.md) for automated results and the outstanding packaged, real-server acceptance test. Earlier verification records below describe their original feature passes.

Implementation branch: `feat/help-and-ask-binarylane`. No version bump or new runtime dependencies.

## Content accuracy review (5 September 2026)

The initial runtime pass below verified rendering and interaction, not sentence-by-sentence factual accuracy. PR #48's review exposed that gap. This follow-up checks bundled BLDesk documentation against the UI handlers and shared helpers, and distinguishes controls offered by BLDesk from capabilities offered by BinaryLane's API and mPanel. It does not audit or change Ask BinaryLane's answer-generation controls.

### Sources checked for each page

Paths below are relative to `src/renderer/src/` unless another root is shown. This is a manual source audit, not a claim that the help guard proves prose correct. Quoted examples were checked against the originating handler and its helpers, including the palette's `POWER_VERBS` labels rather than the shared dialog's text.

The embedded-terminal additions were also checked against `src/main/pty.ts`,
`src/shared/ssh.ts`, the installed OpenSSH `ssh(1)` manual (remote command and
exit-status semantics), and the installed `node-pty@1.1.0` Windows backend
(ConPTY fallback threshold). Full runtime/package evidence is in
`docs/TERMINAL_VERIFICATION.md`.

| Page in `docs/help/` | Components and helpers checked |
| --- | --- |
| account | `components/account/AccountOverview.tsx` — read-only fields and mPanel links |
| backups | `components/backups/BackupManager.tsx` — slot selection, restore, attach, schedule |
| billing | `components/billing/BillingOverview.tsx`, `context/ActionTrackerContext.tsx` |
| confirm-and-history | `context/ConfirmContext.tsx`, `components/palette/CommandPalette.tsx`, `components/servers/CreateServerModal.tsx` |
| deep-links | `src/shared/deeplink.ts`, `lib/deeplinks.ts`, `src/main/deeplink.ts` |
| dns | `components/dns/DnsManager.tsx`, `components/palette/CommandPalette.tsx` |
| firewall | `components/firewall/FirewallManager.tsx`, `FirewallMatrix.tsx`, `lib/firewallMatrix.ts` |
| getting-started | `components/auth/AuthModal.tsx`, `src/main/safeStorage.ts`, `api/mobile-bridge.ts` |
| heatmap | `components/heatmap/FleetHeatmap.tsx`, `lib/heatmap.ts` |
| help | `components/help/HelpView.tsx` — client request triggers, not generated-answer content |
| history | `components/history/HistoryView.tsx`, `lib/changelog.ts`, `context/ActionTrackerContext.tsx` |
| keys | `components/keys/SshKeysManager.tsx`, server local-key selector |
| loadbalancers | `components/loadbalancers/LoadBalancerManager.tsx`; service sources below |
| map | `components/map/NetworkMap.tsx`, `lib/firewallMatrix.ts` |
| palette | `components/palette/CommandPalette.tsx`, `lib/commands.ts`; backup semantics below |
| server-backups | `components/servers/ServerDetails.tsx`, `components/backups/BackupManager.tsx` |
| server-cancel | `components/servers/ServerDetails.tsx` cancellation handler |
| server-change-plan | `components/servers/ChangePlanPanel.tsx`, `ServerDetails.tsx` resize handler |
| server-cloud-init | `components/servers/ServerDetails.tsx` Cloud-init panel and template capture |
| server-firewall | `components/servers/ServerDetails.tsx`, `components/firewall/FirewallManager.tsx` |
| server-network | `components/servers/ServerNetwork.tsx` Move handler, not VPC Manager's Detach handler |
| server-overview | `components/servers/ServerDetails.tsx`, `lib/actionLabels.ts` |
| server-recovery | `components/servers/ServerDetails.tsx`, `lib/actionLabels.ts` rescue fallback |
| server-remote-access | `components/servers/ServerDetails.tsx`, `lib/actionLabels.ts` |
| server-settings | `components/servers/ServerSettings.tsx`, `context/ConfirmContext.tsx` |
| server-usage | `components/servers/ServerUsage.tsx`, `api/queries.ts` |
| servers | `components/servers/ServerList.tsx`, `lib/powerState.ts`, `lib/actionLabels.ts` |
| shortcuts | `components/palette/CommandPalette.tsx`, `components/layout/Sidebar.tsx`, `BottomNav.tsx`, `src/main/zoom.ts` |
| templates | `components/templates/TemplatesView.tsx`, `components/servers/CreateServerModal.tsx`, `lib/templateJobs.ts`, `src/shared/templates.ts` |
| terminal | `components/terminal/TerminalView.tsx`, `TerminalTab.tsx`, `BroadcastPanel.tsx`, `lib/terminalSessions.ts`, `lib/openSsh.ts`, `src/main/pty.ts`, `src/shared/ssh.ts` |
| tray | `src/main/tray.ts` |
| troubleshooting | `components/servers/ReachabilityBadge.tsx`, `lib/powerState.ts`, `components/layout/UpdateMenu.tsx`, `scripts/after-pack.cjs`, client help transport |
| vpcs | `components/vpcs/VpcManager.tsx`, `components/servers/ServerNetwork.tsx` |

### Service facts and review reconciliation

- **Health checks are configurable.** `openapi.json` defines `HealthCheckRequest.path` and `.protocol` in create/update load-balancer requests, and mPanel's load balancer settings show an editable Path. BLDesk's current component neither displays nor edits those settings. Its help now directs users to mPanel, without presenting this client limitation as an API limitation.
- **Backup replacement is conditional, not unconditional.** OpenAPI's `BackupReplacementStrategy.oldest` documents it: use a free slot first, otherwise the oldest unlocked, unattached backup of the requested type. The palette requests `temporary`; its help now warns about replacement explicitly.
- **History and running-action states differ.** History has five outcome labels. Interaction/invoice waits are real states in `ActionTrackerContext`, but are not extra History outcomes. The page now explains that the History entry remains Submitted during those waits.
- **Disk confirmation uses the disk label or ID.** “Target name” was ambiguous even though it did not explicitly say “server name”; the page now names the required value precisely.
- **Navigation changes at the width breakpoint.** `hidden md:flex` hides the sidebar below 768 CSS pixels, while `BottomNav` exposes More. A 1024-wide window at 150% crosses that breakpoint; 1280 at 150% does not.
- **Client help triggers already supported automatic requests.** The internal help page now gives the exact suggestion/answer thresholds and delays. No service prompts, answer filters or output controls were changed.
- **Templates are not durable jobs.** Tags are local and immediate; firewall work polls every ten seconds for up to fifteen minutes and is lost on renderer reload/quit. Missing names and unsupported user data do not block creation. The page now explains those limitations.

The BinaryLane implementation was consulted read-only. No private implementation code is copied into bundled help. `docs/DEEP_LINKS.md` was also reconciled with the parser/router, including the full tab lists, account-free help routing and already-implemented palette/confirmation behaviour.

Validation for this documentation revision: rerun typecheck (including all three guards), production build, whitespace checks and focused assertions for the corrected palette label, backup strategy, network confirmation, disk label and load-balancer schema. The earlier desktop/Android screenshots are pre-copy-edit evidence of layout and interaction, not screenshots of the revised prose. No new native Android or live cloud workflow is required or claimed for these content-only changes.

## Architecture and content

- 33 bundled Markdown pages cover 15 top-level tabs, 11 server sub-tabs and all 16 palette verbs. Sources live in `docs/help`, loaded through the renderer's Vite `@help` raw-import alias. Nothing reads the filesystem at runtime.
- The local search and article-service search are separate sources in one view. The service does not index the bundled BLDesk docs; its answer appears below local results.
- Main-process IPC and the mobile bridge share the fixed `HELP_API_ORIGIN`, validators and 20-second timeout. There is no account client or token in this transport. Only visible search text is attached; feedback sends the returned answer ID as a number and a boolean.
- Markdown renders as escaped React nodes. Remote answers cannot launch local help actions, SSH deep links or arbitrary external domains. Local documentation can navigate through the existing deep-link parser.
- Opening help from a confirmation cancels that review. It never confirms the pending action.

## Checks performed

- `npm run typecheck`: both TypeScript projects, mutation guards, UI guards and help guards.
- `npm run build`: production main, preload and renderer bundles.
- Real Electron driven by Playwright, with isolated user data, fabricated account/server fixtures and cloud mutation requests rejected. No real cloud resources were modified.
- Sidebar and every top-level contextual question mark, `help firewall`, `??` and `bldesk://help/firewall#copy-a-ruleset` routing; confirmation-help cancellation; optional chip excludes a deliberately private custom image name. No nested action buttons or accidentally opened mutation dialogs in the contextual-link sweep.
- All 33 pages opened and their rendered content read in both light and dark themes. Representative screenshots visually inspected.
- 1024×680 and 1280×840 windows at 80%, 100%, 125% and 150% actual Electron zoom. Both index and article scroll independently, the search remains visible, and the document has no horizontal viewport overflow. At 1024×680/150%, the article retains approximately 285 CSS pixels of height. The initial stacked layout left only 66 pixels and was corrected before completion.
- Fixture answers: numbered steps, escaped HTML, blocked unsafe/deep links, four source rows, numeric feedback payload, disabled feedback after Thanks, suggestion keyboard selection, out-of-order answers, service errors and offline state with no request and intact local results.
- Live service: `how do I enable ipv6` returned an answer and four source articles; helpful feedback completed successfully through the real IPC/HTTP path. Only this generic query and its feedback were sent to the live service.
- Helper checks: empty Markdown headings terminate, duplicate heading IDs are stable, malformed percent-encoded links are rejected, palette aliases parse, unsafe article origins are rejected and invalid feedback IDs fail validation.

## Repeating the UI checks

Build first, then launch Electron through Playwright with a temporary `userData` path set before importing `out/main/index.js`. Supply fabricated vault responses and intercept BinaryLane cloud requests; reject all cloud writes. Test help-service fixtures separately, allowing only the fixed help origin through for the live question and feedback check.

Use Electron `webContents` zoom, not CSS scaling. Capture screenshots with `webContents.capturePage()`; browser screenshots can clip incorrectly at Electron zoom. Confirm that the last index item and the end of a long page are independently reachable while the search remains visible. Also try the named entry points above and verify the actual article heading, not merely that the Help tab opened.

The isolated scripts used for this pass live in `/private/tmp/bldesk-help.x4y9Gb` (`launcher.cjs`, `smoke.mjs`, `helpers.ts`); they are disposable verification harnesses, not app dependencies. The permanent source checks live in `scripts/check-help-guards.mjs` and run in CI through `npm run typecheck`.

## Screenshots and limits

The original help screenshots used fabricated account data and a generic public-article answer. `help-light.png` and `help-dark.png` have since been refreshed with the Atlas dummy fleet; see [current screenshot provenance](SHOWCASE.md). `help-150.png` and `ask-binarylane.png` remain from the original verification run. Their displayed Electron runtime version comes from the isolated launcher, not a release version bump.

Packaged Windows/Linux deep-link registration and native platform menu behaviour were not rerun for this feature; the shared parser and Electron renderer routing were tested on macOS. No destructive workflow was executed against a live account. Android emulator verification is recorded below; physical-device and older-Android testing remain outside this pass.

## Android native smoke test

Installed the actual debug APK on an isolated Pixel 7-profile ARM64 emulator, Android 36, using Emulator 37.1.11 and Java 21. Playwright attached to the installed Capacitor WebView at `https://localhost/`; the runtime reported `platform: android` and `isNativePlatform(): true`. No profile or API token was added.

- APK build: `npx cap sync android`, then `./gradlew assembleDebug --no-daemon --console=plain` with the Android SDK and Java 21 configured. Build passed; existing Gradle deprecation/SDK XML-version warnings were non-fatal.
- Drawer → Help navigation and all 33 pages in both themes passed.
- Actual native `CapacitorHttp` calls were observed without replacing their implementation: live IPv6 answer, four source articles, suggestions and successful numeric-ID feedback. Requests used the pinned public help origin with no Authorization header.
- Portrait viewport 412×839: search visible, index scrollable, article approximately 451 CSS pixels high, no page-level horizontal overflow.
- Native Android keyboard opened with ADB input: viewport 412×527, search visible and approximately 139 pixels of independently scrollable article remained. This was not a simulated browser viewport.
- Landscape viewport 863×360: independent index/article scrolling, approximately 247 pixels of article height, no page-level horizontal overflow.
- Disabled both emulator Wi-Fi and mobile data, verified `navigator.onLine === false`, submitted a local-matching search and observed the offline message with intact local hits and zero native HTTP calls. Connectivity and portrait rotation were restored afterwards.

The first offline test exposed a real packaging omission: without `android.permission.ACCESS_NETWORK_STATE`, WebView kept reporting online. Adding this normal, read-only permission fixed detection in the rebuilt APK. The help guard now checks that it remains declared. Chromium documents the permission requirement in its [network notifier implementation](https://chromium.googlesource.com/chromium/src/net/+/refs/heads/main/android/java/src/org/chromium/net/NetworkChangeNotifier.java).

Android screenshots are `docs/screenshots/android-help-light.png`, `android-help-dark.png`, `android-help-keyboard.png`, `android-ask-live.png` and `android-help-offline.png`. They contain an empty account vault and generic help text only. The landscape screenshot caught Android's rotation animation and was excluded from the documentation; the landscape bounds/scroll assertions passed. The disposable harness and native-call report are in `/private/tmp/bldesk-android.F1nb3h`.

### Local emulator setup retained

The SDK is installed at `/Users/adam/Library/Android/sdk`, the AVD is named `bldesk-help-api36`, and Java 21 is at `/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`. The SDK, AVD and Gradle cache occupy roughly 9 GB; no shell profile or global Java configuration was changed. To rebuild, supply `JAVA_HOME` and `ANDROID_HOME` for the Gradle command. To restart this emulator:

```sh
/Users/adam/Library/Android/sdk/emulator/emulator -avd bldesk-help-api36 -no-snapshot -no-boot-anim -gpu swiftshader -memory 2048 -no-audio
```

Use the SDK's `platform-tools/adb -s emulator-5554` for this emulator rather than an unqualified command that might select a physical device. The APK is under `android/app/build/outputs/apk/debug/app-debug.apk`; this is a local debug build, not a published release.
