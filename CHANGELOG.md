# Changelog

All notable changes to the **BLDesk** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
 
## [1.0.63-beta.3] - 2026-10-30

**Firewall Import and Export speak mPanel's format**

### Added
- **Firewall Export writes the text mPanel's Import/Export dialog shows, and Import reads it** (#354, #349). A backup taken in mPanel, a configuration from a knowledge-base article written for it, or another server's rules pasted from it now import into BLDesk, and a BLDesk export can be pasted into mPanel. Import tells the two formats apart by their keys, so files saved by earlier versions of Export still import; a file that mixes them, or an mPanel rule with a key BLDesk has no place for, is refused naming the rule and the key rather than guessed at. A netmask that is a whole range is written as CIDR. The address `0.0.0.255/0.0.0.255`, which mPanel's default multicast rule uses and the API reference does not document, is kept only as a destination in a rule the server already has, exactly as it is; Import never adds it to a new or changed rule, and refuses it as a source and any other netmask with a gap, each with the reason.

## [1.0.63-beta.2] - 2026-10-30

**Every export saves on Android, through its own Save as dialog**

### Fixed
- **Export on the Firewall tab, Export and Export all on Templates, and Export PNG and Export SVG on the Network Map save in the Android app** (#351, #352, #353, #346, #347, #348). Each of them built a download link, which an Android WebView ignores, so a tap did nothing and said nothing. They now go through the Save as dialog that Export tags introduced, where you choose the folder and can change the name; backing out saves nothing and shows no error, Android adds a number to the name when a file with it is already there, and Templates and the Network Map say the name the file was saved under. A write that fails shows why. The desktop app and the browser build download the same files as before.
- **Templates: Import file can choose a .yaml file in the Android app** (#352). Android does not know `.yaml` as a type, so its chooser greyed every YAML file out and a template exported on the desktop could only be imported with Paste. The chooser now also offers files of unknown types, and the Android app saves YAML under a type that keeps the `.yaml` ending when Android numbers the name.
- **A large export no longer closes the Android app, and two exports cannot swap files** (#353). The map's PNG was handed to the save dialog in one piece, which exceeded what Android lets one call carry and killed the app as the dialog opened; the bytes now go over in 256 KB pieces, and text over 100,000 characters takes the same route. Saves also take turns: an export started while another's dialog is open waits for it, so each file holds its own bytes under its own name and every export reports back. Drawing the PNG can take several seconds on a phone, so the map's header says "Preparing the PNG…" while it does, and a drawing that fails is reported rather than silently dropped.

## [1.0.63-beta.1] - 2026-10-28

**Add a firewall rule with a destination and a picker, and a refused backup says so**

### Added
- **The Add Rule form has the same fields as a rule, and a list under every address and ports field** (#344). The form now takes Source, Destination, Destination ports, Protocol, Action and Description, in the order the table and mPanel use, one address or port to a line. A magnifier under each address field, on the form and on every rule in the table, lists any address, the account's other servers and each of their addresses, and this server's own public, private and all addresses; the ports magnifier lists the usual ports and the system, user and dynamic ranges. A choice is added to what the field holds without repeating a value. On a rule it is an edit like any other, held until Save changes. Add Rule is switched off at BinaryLane's limit of 100 rules per server, with the reason shown; a server that already has more may keep, edit or remove its rules, and an import that would exceed what it has is refused before any confirmation. The vendored API reference is updated to 0.46.0, which states the limit. mPanel's Current IP entry is not offered: the public API has no way to learn the caller's address.

### Fixed
- **Take Backup and Download report a refusal that comes with no body** (#343, #313). An error response labelled JSON but empty was taken as success: the Take Backup form closed and History stayed Submitted, and Download said no URL was returned. Both now report the HTTP status, Take Backup keeps the form open and records Failed, and the reason BinaryLane gives is shown when there is one. The help for Backups and Change Plan explains what a refusal shows and that a reason under `pre_action_backup` refers to the Backup first step.

## [1.0.62-beta.37] - 2026-10-27

**Edit firewall rules in place, and import images from a URL**

### Added
- **Firewall rules can be edited where they are, dragged into order, and saved explicitly** (#342). Each rule in a server's list is now a row with editable source, destination, ports, protocol, action and description; drag a rule by any part that is not a field, or touch and hold it on a phone, or use the arrows. Nothing is sent until Save changes, which shows the whole list's diff in one confirmation and writes once, with one History entry. Before this a rule could not be edited at all, and the move arrows wrote to BinaryLane on every click without asking. Save reads the server's rules before and after the confirmation and sends nothing if they changed under the edits; a save BinaryLane accepts and then fails puts the edits back. Unsaved edits are kept per server while BLDesk is open.
- **Import an image from an HTTP or HTTPS URL into a backup slot** (#341, #308). Import Image on the Backups page asks BinaryLane to download an image into a free slot, or to replace the oldest, newest or a chosen image, with an optional label. The backup list and server are read again before one confirmation, the returned action is tracked, and an unknown outcome stays Submitted in History while the lists refresh rather than retrying. An ISO image is marked ISO and offers Attach only, as the public reference says it cannot be restored or downloaded.

## [1.0.62-beta.36] - 2026-10-27

**The top bar fits a phone, and two notes stop lying**

### Fixed
- **The top bar fits phone widths** (#339, #293). Its right-hand controls could not shrink, so below about 400 px the account chip and the key button ran off the right edge. Below 640 px the bar now lets its controls drop to a second row when they cannot fit on one, below 420 px the padding tightens, and below 400 px the logo and the shield icon make way for the account name. The Ctrl+K hint shows from 768 px, so the Settings button is no longer cut off at exactly 640 px.
- **A command review in the palette no longer shows an earlier backup's replacement warning** (#340, #330). After a backup review that named the backup a take would replace, the review of another command, such as a reboot of a different server, kept that amber note and that server's backup. The note is now cleared whenever the palette returns to its input stage, so a review only ever shows what its own check found.
- **On Android and in the browser, a notification setting saved during a storage outage stays saved** (#338). The settings store keeps a copy in the app preferences and one in localStorage, and a load takes the newer. A save made while the preferences could not be read could tie with the copy they held, and when they recovered the older copy won: notifications switched off came back on. A save's version now also carries the time, so a save made during an outage outranks anything the unreadable store holds once the clock has moved on.

## [1.0.62-beta.35] - 2026-10-27

**A refused request shows the reason, not just the summary**

### Fixed
- **When BinaryLane refuses a request, the reason it gave is shown** (#325, #318). A validation refusal can carry a generic summary and the useful reason under the field it concerns, and BLDesk showed only the summary: a backup refused for want of a free slot read "Validation of the request failed." and nothing more. It now reads the summary and then the reason, as `backup_type: There are no free Temporary slots.`, unless the summary already says it. The Take Backup form's failure card, the Download button's card and a template's firewall step built their own text and could print the raw response body; they now use the same wording as the rest of the app, and a body of an unexpected shape reads as a plain failure rather than `[object Object]`.

## [1.0.62-beta.34] - 2026-10-27

**Android no longer resends a write when the answer is lost**

### Fixed
- **On Android, a request that changes something is sent exactly once** (#334, #196). Android's HTTP layer could silently send a POST a second time on a reused connection when the first answer was lost, so one tap on Create Server could make two servers. BLDesk now ships a small patch to Capacitor Android that streams each JSON body once instead of buffering it, so the native layer cannot replay it. If a connection dies before the request is handled, the request now fails with the existing "check before trying again" message instead of being retried out of sight. Desktop builds are unchanged.

### Changed
- **The GUI mock refuses a plan change over the temporary-backup allowance the way BinaryLane does** (#333, #322): the same validation body as an ordinary take, with the reason under `pre_action_backup.backup_type`, and a regression that checks the resize does not happen.

## [1.0.62-beta.33] - 2026-10-24

**Electron 44.9.3, with the block for compromised eMudhra certificates**

### Security
- **Electron is updated from 44.4.5 to 44.9.3** (#332). It adds the same block for the compromised eMudhra intermediate certificates that browsers have shipped (Electron advisory GHSA-jr5w-w6x2-84p9), to both Chromium's networking and Node's TLS, which cover every connection BLDesk makes. It also brings Chromium 152.0.7977.167 and Node.js 24.22 inside the app, and a fix for `net.fetch` failing for good after the network service restarts. Nothing in BLDesk's own code changed.

## [1.0.62-beta.32] - 2026-10-24

**Firewall warnings follow how BinaryLane applies rules, and Ubuntu updates no longer freeze the window**

### Fixed
- **The firewall audit and the Network Map read rules the way BinaryLane applies them** (#327, #326). For each of a server's public IPv4 addresses the rules are followed first to last and the first match decides, so a rule written only for the VPC range or a private address no longer counts as open to the world, and a server with no public IPv4 is never flagged. A port that no rule decides is open, because BinaryLane lets through traffic that matches no rule: a list with no final drop now shows its open ports, which it did not before. Port ranges are read as the API writes them (`8000:9000`); they were invisible to the audit, the map and the reachability verdict. The map label shows the closed ports when that is the shorter list (`all but 22 3389`). BinaryLane confirmed the behaviour on 23 October 2026.
- **The Ubuntu .deb update no longer freezes the window** (#323). Restart to update opens the system's password prompt with a message that says what it is for, and BLDesk stays usable behind it; it closes only once the password is accepted, and opens again by itself when the install is done. Cancelling leaves it running with the update still ready. Before installing, BLDesk looks at the feed once more and takes a newer release if one has been published. Checks now run hourly, and when the window gets focus or the computer wakes. The AppArmor profile is kept across upgrades, the install script no longer rebuilds the MIME database, and the updater writes a log in the user-data folder. An installed older version uses its old flow once, for the update that brings this in.
- **The command palette's backup review shows the temporary-backup terms** (#329, #313): kept up to 48 hours, at most two in any seven days.

### Changed
- **Backup help describes the temporary-backup allowance as checked live** (#331, #322): a backup taken before a plan change counts toward the two in seven days, and replacing the held backup does not reset it. The GUI mock answers an over-limit take with the API's own refusal.

## [1.0.62-beta.31] - 2026-10-21

**Enable Daily Backups looks like a button you can press**

### Fixed
- **Enable Daily Backups no longer looks disabled** (#314). On a server with no scheduled backups the button was blue text on a faint blue fill, which read as greyed out. It now uses the same solid blue as Take Backup. Remove Daily Backups keeps its red style, and nothing else on the page changed.

## [1.0.62-beta.30] - 2026-10-21

**A server with no scheduled backups says what that means**

### Added
- **A warning on a server that keeps no scheduled backups** (#314). Under the Backups banner, an amber line says BinaryLane keeps backups of a server only on a backup schedule, so apart from one you take by hand (kept for up to 48 hours) it holds no copy of the server's data, and anything lost from the server is lost for good. The empty state adds that a backup taken now is a temporary one, and points at Enable Daily Backups and the Backups section of Change Plan. The banner's text now also says offsite backups are set in Change Plan. It follows the server's backup settings, not the backups it holds, so a server with only a temporary backup still shows it, and a server with daily, weekly or monthly backups is unchanged. BinaryLane confirmed the statement; the API reference does not give it.

### Fixed
- **Change Plan no longer says to replace a named backup when there is none** (#314). On a server whose only free slot is the temporary one, the hint under Backup slot now mentions replacing a backup only when the server holds one.

## [1.0.62-beta.29] - 2026-10-21

**A Settings page to mute notifications, and Change Plan's backup-first option follows the backup limits**

### Added
- **A Settings page for notifications** (#320, #316). The gear in the title bar (More, then Settings, on a phone) opens it. "Show notifications" mutes everything at once, and "Choose kinds" has a switch for server state changes, action results, billing, changes you make, and BLDesk updates. The confirmations that had no switch, and the "is ready" notice for an update, are now covered. The tray menu has the same switches and stays in step with the page. Muting stops only the operating system's notifications: action progress, failures and History inside BLDesk are unchanged. A change that cannot be saved on the device says so and applies until BLDesk is closed. On Android the choices are saved, but BLDesk does not show notifications there yet, so they have no effect.

### Fixed
- **Change Plan no longer offers a temporary slot that is already taken** (#315, #312). Backup first lists only slots that are empty now: a server without scheduled backups can use its empty temporary slot, and one that already holds a temporary backup is asked to choose a backup to replace. Locked and attached backups are not offered for replacement. While the backup list is loading, or could not be read, no free slot is offered, and a failed read has a Retry.
- **Change Plan warns when reducing backup retention deletes backups, and keeps the backup-first backup out of a type it turns off** (#319). Any reduction of daily, weekly or monthly backups now asks for the destructive confirmation, which says the oldest backups above the new limits are deleted and that locked or attached backups can be deleted too. A pre-action backup cannot use a type the change sets to 0.
- **The "BLDesk is still running" notice is not lost when notifications are muted.** It is offered again the next time the window is hidden to the tray, instead of being counted as shown.

### Changed
- **Temporary backups are described as the API reference now does** (API reference 0.45.0). The slot reads "Temporary (kept up to 48 hours)" rather than 7 days, and Take Backup and Change Plan add that at most two can be taken of a server in any seven day period. BLDesk has not yet been tried against a live account for the limit, and a refused backup is shown like any other failure.
- **The vendored API reference is 0.45.0** (it was 0.43.3). Only descriptions changed.
- **vite is updated from 7.3.6 to 7.3.7** (#321). It is used only while BLDesk is being built and is not part of the app you run.

## [1.0.62-beta.28] - 2026-10-14

**Add a Cloud Server no longer needs a hostname**

### Fixed
- **A new server can be created with the hostname left blank** (#311, #310). The form used to stop with "Enter a hostname for the server." although the API reference makes the name optional. A blank or spaces-only hostname now sends no name and BinaryLane names the server. The hint under the field says so. When no hostname is set and cloud-init is going to be sent, a note warns that BLDesk does not change a hostname already written into the cloud-init, including one a template filled in. In History the entry starts as "New server" with a Hostname row that says it was left blank, then becomes the server BinaryLane named, with its name and number. Applying a template still asks for a hostname.

## [1.0.62-beta.27] - 2026-10-14

**A hardened NixOS starter template**

### Added
- **NixOS 26.05 hardened starter template** (#309). Converts a fresh Debian 12 server to NixOS 26.05 in place at first boot, using a pinned copy of nixos-infect, and keeps the SSH keys chosen when the server was created. Key-only SSH, TCP BBR, sysctl hardening, flakes, weekly store cleanup and a declarative firewall.

## [1.0.62-beta.26] - 2026-10-13

**Change backup schedules and see every IPv4 address on server tiles**

### Added
- **View and change when scheduled backups run** (#305, #301). The Backups page shows the approximate hour in Australia/Sydney time, plus the weekday for weekly backups and the day of the month for monthly backups. Change Schedule confirms the values being changed, sends only those fields, and records the request in History. Values left untouched follow the server's refreshed schedule while the form is open.
- **Installation instructions for Windows and Linux** (#307). The README now covers the Windows installer, Ubuntu/Debian packages, building on Linux, and the Node.js and compiler prerequisites, with pointers to the macOS and Android downloads.

### Fixed
- **Server tiles show every public and private IPv4 address, with labels and copy buttons** (#304, #296). Secondary public addresses and private addresses are no longer hidden. Servers in a VPC show its name under their private addresses, and a server without a public IPv4 shows None instead of presenting its private address as public. Copy feedback identifies the server as well as the address.

### Changed
- **Backup guidance uses daily rather than nightly and explains where retention is set** (#303, #305). The page points to the Backups section of Change Plan for daily, weekly and monthly retention counts, and to Backup Schedule for the hour and days.

## [1.0.62-beta.25] - 2026-10-07

**The version popup stays on screen on a phone, and the skip reason for archived servers follows the API reference**

### Fixed
- **The popup from the version button no longer runs off the left of the screen on a phone** (#294, #290). On a screen narrower than 640 px the 320 px popup, with the version, the channel and the date of the last check, hung from the button's right edge and ran 55 to 65 px past the left edge of the screen, so its text was cut off. It now sits just under the button, 8 px (or the safe-area inset, if larger) from each side of the screen, and is as wide as fits, up to 320 px. From 640 px up, which covers every desktop window size and zoom, it is unchanged. Between 481 and 639 px it is now right-aligned to the screen, where before it hung under the button. Checked on a Samsung phone at 411 px wide and in the desktop app at widths from 320 to 1280 px; the safe-area insets were only simulated.

### Changed
- **The reason for skipping an archived server now reads "archived (non-payment)"** (#297). When a power command in the palette or Broadcast SSH skips an archived server, the reason said "cancelled or unpaid". It now follows the API reference's 0.43.3 definition of Archived, as the status tooltip and the Servers help page already do (#288). Which servers are skipped has not changed.

## [1.0.62-beta.24] - 2026-10-06

**The Android library is updated to Capacitor 8.5.2, and a build-tool security fix is picked up**

### Changed
- **Capacitor is updated from 8.5.0 to 8.5.2** (#298, replacing #281). The Android app's native library and the Capacitor packages it works with move together. Capacitor's release notes list fixes to how listeners are removed, to the permission checks for Android plugins, to blocking navigation to its internal HTTP proxy path, and to safe-area and system-bar handling. Back, the tag editor and the layout behave the same on an Android 16 emulator as they did on 8.5.0; a screen with edge-to-edge system bars, where the safe-area fix would show, was not tested.

### Security
- **A build tool no longer has a denial-of-service flaw** (#287). `source-map-js` 1.2.1 to 1.2.2 fixes a denial of service from malicious indexed source maps (CVE-2026-93749). The package is used only while BLDesk is being built and is not part of the app you run.

## [1.0.62-beta.23] - 2026-10-06

**Server tags show in the Servers list, and can be edited, coloured and filtered**

### Added
- **Tags show in the Servers list and grid** (#284, #273). A server's tags appear as chips after its name: the first three, then a +N chip whose tooltip names the rest. Tags are still kept on this device for each account profile; BinaryLane does not store them and nothing is sent when you change one. On a computer, double-click a chip (or focus it and press Enter or F2) to rename the tag everywhere, choose its colour or remove it from that server. On a phone the chips are labels, and tags are edited in the server's Settings.
- **A Tags section in a server's Settings** (#284). Add a tag, pick one that other servers already use, remove it, rename it or choose its colour.
- **A tag filter on the Servers page** (#284). Tick tags to show only the servers that have any of them, or all of them. It sits beside the Regions and Status filters, and the three now share one size and look.
- **Search by tag with @** (#284). In the Servers search, a word starting with @ finds servers by tag (`@web`), and typing @ lists the tags in use. Plain text finds servers by name, address or #id only, never by tag. In the command palette, `@word` with no verb lists the matching tags and then the servers that have them. A server called `web` and a tag called `web` stay separate: `restart web` acts on the server and `restart @web` on the tagged servers.
- **Tag colours** (#284). A new tag gets the first of eight preset colours that no tag in use has, and existing tags are not recoloured. A custom colour can be made with a wheel, a brightness slider, a hex code or RGB values, and up to eight are saved. Chip text is adjusted to stay readable in both themes. On a phone, press and hold a saved colour to remove it; the phone buzzes while you hold and once longer when it goes.

### Changed
- **The Android app now declares the VIBRATE permission** (#284). It is a normal permission with no prompt, used only for the hold-to-remove buzz. The desktop apps are not affected. A build check fails if the line is removed.
- **Android Back closes an open tag filter, tag editor or colour picker** (#284). They close the way a dialog does, through the app's existing Back handling.
- **The Fleet matrix draws tags the same way** (#284). It uses the same chips and, on a computer, the same editor. On a phone its tags are labels only.
- **The Servers search no longer reads a field the API does not have** (#284). It looked for a tag field that BinaryLane does not return, so it could not find a tag.

## [1.0.62-beta.22] - 2026-10-06

**The Archived explanation follows the API reference, which is now 0.43.3**

### Changed
- **Archived now says it means powered off for non-payment** (#288). The API reference changed its definition of the Archived status from "cancellation or non-payment" to "non-payment". The tooltip on the status (in the list, the grid, a server's page and the Archive filter) and the sentence on the Servers help page follow it. The label stays Archived.
- **The vendored API reference is now 0.43.3** (#288; it was 0.42.0). It is the same 94 paths and 206 schemas, and no request body, field or list of allowed values changed. One field is now optional: the list of errors in a validation failure, which BLDesk already handled as optional. The other changes are descriptions: cancelling a post-paid server is final, a backup's days are Australia/Sydney calendar days, and a server's `off` status is not returned.
- **Save as template reads the firewall rules without a cast** (#289). The rules are now typed from the reference, so a misspelled field fails the typecheck instead of saving a template with no rules. What the app does is unchanged.

## [1.0.62-beta.21] - 2026-10-06

**Firewall rules are checked against the API reference, and the reference is updated to 0.42.0**

### Changed
- **The vendored API reference is now 0.42.0** (#285; it was 0.40.0). No path, field, type or list of allowed values changed: it is the same 94 paths and 206 schemas. Ten descriptions have new wording: backup hours are in Australia/Sydney time, duplicate reverse nameservers are rejected, and an SSH key's name and fingerprint must be unique on the account. BLDesk's help pages are not changed for them.
- **Firewall rules are typed from the reference** (#170, #285). A rule that is read, imported, built in the Add Rule form or taken from a template is now compiled against the reference's own rule type, so a misspelled field, or a protocol or action the reference does not list, fails the typecheck instead of being sent. What BLDesk sends does not change.
- **A build check keeps that typing from being loosened** (#170, #285). `npm run typecheck` now fails if a function that takes a server action body or a firewall rule is typed as `any`, or if an action body is cast `as any` or `as never`, and it names the function.

## [1.0.62-beta.20] - 2026-10-06

**The macOS install script copes with any folder name, and three unused packages are gone**

### Fixed
- **The macOS update script treats the paths it is given as names** (#267, #279). It wrote the download, staging and installed-app paths inside double quotes, so a path containing a double quote, dollar sign or backtick was read as shell syntax and could point the commands at other paths, or run one. Each path is now written once, single-quoted, and the rest of the script only uses the variable. Nothing else in the script changes, and a failed install still keeps the installed app. A build check now runs the script under bash with awkward names and fails if one is misread. The script is written by the version that is quitting, so this takes effect when updating from this version, not to it.

### Changed
- **Three unused packages are no longer packaged** (#266, #278). `clsx`, `tailwind-merge` and `@electron-toolkit/preload` were installed with the app but nothing imported them. The app archive is about 0.65 MB smaller (6.50 MB to 5.85 MB, measured on Windows) and the licence notices list 35 packages instead of 38. What the app does is unchanged.

## [1.0.62-beta.19] - 2026-10-02

**Failures show inside the app instead of in system pop-ups, and the licences ship with it**

### Fixed
- **A failed save, delete or launch is reported inside BLDesk** (#188). Thirty-six places showed the operating system's own `alert()` box, which froze the window and looked different on Windows, macOS and Linux. They now say what failed and why, in the words they used before, and the message stays until you close it, and can be selected and copied. If a dialog is open, it shows inside that dialog, above the form, so it never covers Save or Cancel on a small window, in landscape or with the on-screen keyboard up, and it can be reached with Tab. Otherwise it is a card at the bottom right, below any dialog, like the progress cards for background actions. The same failure raised again counts up (×2) instead of stacking, a failure from one account is cleared when you switch to another, and a failed Add Record leaves its form open as before. A build check now fails if a native `alert()` is added again.

### Added
- **BLDesk ships its licence and the licences of what it bundles** (#275). The repository has a `LICENSE` (MIT, Mammoth Media Pty Ltd), and the build writes `THIRD_PARTY_NOTICES.txt` with the licence text of every package that ends up in the app or its bundle. It is in the desktop app's resources folder and in the Android app, and packaging stops if it is missing. The build fails if a package states no licence, and now also if the renderer build recorded no packages (a `node_modules` that is a symlink would otherwise leave their licences out).

### Changed
- **Server action requests are checked against the API's published types** (#170). A body sent to `POST /v2/servers/{server_id}/actions` is now compiled against the reference's own types, so a misspelled or unknown field, like the `partner_id` and `size` mistakes in #123 and #124, fails the typecheck instead of being sent. What BLDesk sends does not change. The rules inside the firewall actions are not covered yet, and Boot into Rescue Mode, which the reference does not list, is named as the one exception.

## [1.0.62-beta.18] - 2026-10-02

**The macOS updater checks its download and keeps your app when an update fails**

### Fixed
- **A macOS update is installed only if it is the file that was published** (#134). Any zip over 1 MB in the updates folder counted as a finished download, so one cut off part-way could be offered and installed, and a finished download was never compared with the checksum the release publishes. The zip is now offered only when its size and SHA-512 match what the release's `latest-mac.yml` lists for it. One that does not match is deleted and reported, and the next check downloads it again. A release feed that lists no size or checksum for the zip is refused before anything is downloaded.
- **A failed macOS install keeps the installed app** (#133). The install script ignored `unzip`'s exit status and removed the installed app before copying the new one, so a damaged archive, a full disk or a failed copy could leave a broken app or none at all. It now copies the new app next to the old one and swaps the two by renaming, so if anything fails the installed app stays and the reason is written to the system log (tag `BLDesk`). The script is written by the version that is running when you quit, so this protects updates from this version onward.
- **The macOS update download reports its failures and follows the system proxy** (#135). A failed write (a full disk, say) was an uncaught error, a download that broke off left its partial file, and the download ignored the proxy settings the update check uses. It now goes through Electron's network stack, stops at the first write error, deletes what it wrote, gives up with "The update download stopped: nothing arrived for 60 seconds." when nothing arrives for a minute, and reports the first error.
- **The Billing data transfer card no longer says pooled or unlimited** (#95). It was titled "Pooled Bandwidth", and read "Unlimited" with the bar at 5% whenever the allowance added up to 0, including an account with no servers. It is now "Data Transfer": a total of 0 reads `0 GB` with an empty bar, and a line says how many servers were added up, each for its own current period. BinaryLane's API reference does not say when pooling applies, so the card does not claim it is or is not happening, and the pooling indicator that #95 proposes is not built. The Billing help page has a new section about the card.
- **Boot into Rescue Mode says it is not in the public reference** (#129). Its confirmation notes that BinaryLane's public API reference does not list the action, so its behaviour is not documented there and it could change or stop working. The action stays, as a recorded exception.

### Changed
- **The packaged app is smaller** (#161, #272). React, the icon library, the query library, the API client and the terminal were in the install twice, once in the bundle the window loads and once as loose modules nothing opened. The app archive is about 6 MB instead of 37 MB (measured on Linux), and what the app does is unchanged. `clsx` and `tailwind-merge` are still packaged although nothing uses them (#266).
- `docs/AUTO_UPDATE.md` describes the new macOS download and install steps.

## [1.0.62-beta.17] - 2026-10-02

**Links, passwords and the terminal behave as described**

### Fixed
- **A deep link that names an account opens its server on that account** (#138). `bldesk://server/42?account=Work` switched profile but looked the server up in the account still in use, said it was not found there and left you on the server list. It now waits for the switch and opens the server. It also waits for the saved profiles to load when it is what started the app, and a newer link replaces one that is waiting.
- **Password reset says what it does** (#141). The card and the confirmation said a new password is emailed, for every server. Where BinaryLane cannot change the password (`password_change_supported` is false) the action only clears it, a new one is set at the server's web console, and nothing is emailed. The text now follows the server.
- **Plain Ctrl+F belongs to the terminal session** (#152). It was taken for scrollback search, so a shell's forward-char and vim's page down never arrived. Search is Cmd+F, or Ctrl+Shift+F.
- **A rescue console that cannot load says so** (#153). The window stayed blank. It now closes and reports the error, without the console address, which carries a token.
- **The iTerm2 launcher works** (#156). Its command had quotes that ended the string, so every launch with iTerm2 failed. It is fixed and tested; it could not be run on a Mac here.
- **Restarting after a Linux update no longer replays the link that started BLDesk** (#157).
- **Android tells you when no SSH app opened** (#158). "Open native terminal" reported success whatever happened. It now says BLDesk could not tell that an app opened the link, and copies the command. **The update channel is saved on Android** (#159); Beta was forgotten on every launch.
- **uuid is updated to 11.1.1 in the build tools** (Dependabot alert 3). It was a development-only dependency of the iOS tooling, and does not ship in the app.

### Changed
- `docs/AUTO_UPDATE.md` is rewritten to match the code (#163): the release workflow, the `.deb`, AppImage and macOS update paths, Android's own check, and that betas are full releases, so the Stable channel is offered them (decision #166 is still open). The GUI test mock gained `links.pages` on list responses (#237), a second account with its own server, and switches for the rescue console address. Nothing else in the app changes.

## [1.0.62-beta.15] - 2026-10-02

**Backups, updates and Cancel Server say what is true**

### Fixed
- **The backup schedule banner follows the schedule** (#120, #191). One on-demand backup made a server with no schedule read "Enabled", with a button that removes daily backups. The banner now reads Enabled only when the server has daily backups, and its button is "Remove Daily Backups", which is what it does (it is not a pause). A server with weekly or monthly backups and no daily ones reads "No nightly" and has no enable button. The banner wraps on a phone instead of squeezing its button.
- **A downloaded update stays ready** (#136). Restart to update used to disappear when a later check found nothing newer or failed, for example when the machine was offline. It now stays until you install it, change the update channel, or a newer one starts to download. On Windows and Linux the waiting update is dropped when a different version is announced, because the updater deletes the installer then.
- **Cancel Server quotes what the server bills** (#146). The note was the plan's list price, without extra memory and storage, the image surcharge, extra addresses, backups or licences, and without tax. It is now the figure Change Plan compares against, with the account's tax added and named, and "at least" until the server's licences have been read.
- **Cancel Server no longer closes another server's view** (#221). If you opened a second server while the confirmation for the first was open, confirming took you back to the server list. The view changes only if the cancelled server is the one you are viewing.
- **Switching account no longer leaves History stale** (#142). An action still being followed when you switch is closed as "Lost track" in the account that made it, instead of staying "Submitted" for ever, and a template's firewall rules change is recorded in the account the server was built in, not the one that was active when the build finished.
- **A failed backup attach or detach is recorded in History** (#165).
- **"Flush DNS Cache" reported success when BinaryLane refused it.** It now shows the failure.
- **The firewall matrix does not call loading servers unreadable** (#253). While rules were still being read it said "28 could not be read".
- **Network Map cards no longer draw ports over addresses** (#239). A card's ports and addresses are measured so they cannot overlap; the private address is shown where it fits, and a long port list is cut with an ellipsis (the whole label is in the card's tooltip).
- **Local SSH keys are named from the file name without its ".pub" ending** (#220). `my.pubkey.pub` was listed as `mykey.pub` and reported as having no private key.

### Changed
- The GUI test harness can accept a second token (`extraToken`) and make the update feed fail (`feedStatus`), and has unit tests for the map footer and key names. Nothing else in the app changes.

## [1.0.62-beta.14] - 2026-10-01

**A failed load no longer looks like an empty account**

### Fixed
- **VPCs, load balancers, SSH keys, DNS zones and DNS records say when they could not be loaded** (#261). They showed "No VPC Networks", "Create Your First VPC" and the like when BinaryLane's answer was an error. They now show a red notice with the reason and a Retry button, and keep an older list under it when they have one. The SSH Keys page offers no Import until the account's keys have been read, and the DNS zone's record count (and the "and all N records in it" in Remove DNS hosting) is the number actually read.
- **The sidebar's API status is real** (#261). "API Online" was a fixed label. It now follows the server-list read: "API not answering", or "API refused the token" for a 401 or 403. The Servers page says when it is showing a saved list it could not refresh.
- **The Network Map says what it could not read** (#261). Instead of "0 VPCs" and a missing SSH-exposure note, the header reads "VPCs not read" or "firewall rules not read on N, so exposure is unknown there".
- **Take Backup uses the slot you chose for this server** (#261). A "Replace" choice made on one server was still selected on the next, and the backup was sent to replace the first server's image.
- **Advanced features** (#128). The video device list is the four devices the API reference lists. Choosing Default for the machine type or processor model sends the automatic setting, the confirmation shows only what changed, and Save is off when nothing did.
- **DNS records** (#127). MX records ask for a priority, SRV for priority, weight and port, and CAA for flags and a tag. The record list shows them, and its data column no longer breaks values letter by letter on a phone. In the palette, `dns add` takes a priority only for MX, and refuses SRV and CAA (add those from the DNS tab).
- **Create Server starts clean** (#261). After a create, the hostname, the ticked terms, backups and extra IP addresses are no longer carried into the next form, and a template starts from the form's default region, image and plan.
- **Palette tags show the name that is stored** (#261). `tag add "my tag"` read `@my tag` in the preview and stored `@mytag`.
- **Template export has no YAML anchors** (#261), and DNS zones are read like the other lists, so a failed page fails the read instead of leaving a shorter list.

### Changed
- The GUI test harness has `check-requests.mjs`, which checks the request bodies the app sent against `openapi.json`. Nothing else in the app changes.

## [1.0.62-beta.13] - 2026-10-01

**Create Server sends what it shows, and template firewall rules are IPv4 only**

### Fixed
- **The SSH keys ticked are the keys deployed** (#175, #176, #177). Unticking every key sends no keys, and a background reload of your key list no longer ticks the defaults again afterwards. A template can say "no keys", and Save as template records it when none are ticked; before, a template with an empty key list still deployed the account's default key. A template that names keys now decides the selection: the keys the account has are ticked, the ones it lacks are listed in the form, and the form opens in View All so you can see them. A template that says nothing about keys ticks the defaults, as a new form does. History now records which keys were requested.
- **Offsite backups are not sent without on-site backups** (#197). Ticking Offsite Backups and then setting every retention back to none left it ticked, and sent it.
- **Storage follows the image back down** (#132). An image that needs more storage raised it, and it stayed raised, and billed, after you chose the previous image again. A size you picked yourself is kept.
- **Prices on the Create Server form use one basis** (#251). Every "+$" amount, in the simple view, in View All and on the extra IP addresses, is what choosing it adds to the Monthly Total, with the account's tax added and marked, for example "+$2.20 incl. GST". Before, the simple view's backup options included GST and the others did not, and none said which.
- **Change Plan's Monthly Change says what it includes** (#252). It already included GST, beside a before-tax summary, without saying so.
- **Setting weekly backups to 0 warns** (#122). BinaryLane removes all of a server's weekly backups when they are reduced to 0. The confirmation now says so, and is a destructive one, instead of only showing "2 → 0".
- **A template with malformed firewall rules no longer crashes the Templates tab** (#140). It is listed as invalid with the reason, and the rest of the tab works. A template whose key list is not a list of names is invalid too, and importing a bundle with an invalid template tells you which one.
- **`create <host> from <template>` works on first use** (#178). From the palette, before the Templates tab had been opened, it answered "No template called …". It no longer does.
- **Template firewall rules are IPv4 only** (#260). BinaryLane's external firewall covers IPv4, not IPv6, but the starter templates and every new rule in the template editor used `::/0` as "anywhere", and applying a template wrote it to the server. They now use `0.0.0.0/0`. When a template is applied, IPv6 addresses in its rules (older templates carry `::/0`) are left out, and a rule that was about IPv6 alone is not written. The editor says so when a rule has an IPv6 address.

### Changed
- The GUI test harness has a Linux image that needs 30 GB, to reproduce the storage fix (#259). Nothing else in the app changes.

## [1.0.62-beta.12] - 2026-10-01

**Firewall changes use the current list, and dialogs keep the keyboard**

### Fixed
- **A firewall edit is built from the list as it is now** (#113, #206). BinaryLane applies a firewall change a few seconds after it accepts it. Until it landed, the tab still showed the old list, so the next edit could write a deleted rule back. Editing is now switched off while your own change is being applied, the list is read again when it lands, and closing the progress notice does not switch editing back on early. Fleet matrix reads the source and every target again when you press Review diff, so a rule added to a target in the last minute shows as removed in the diff instead of the target being skipped as already matching.
- **Removing every rule is confirmed like Disable firewall** (#112). Importing an empty list and deleting a server's last rule ask you to type the server's name. A matrix copy from a server with no rules is refused.
- **A new rule goes where it can match** (#114). One added after Drop All used to land behind it and never match. It now goes ahead of the first drop that would swallow it, and a block on a single address stays in front of it.
- **Every firewall rule is written with a destination** (#125). The API reference requires one, and a rule from Add Rule or a pasted import had none. A rule with none is now written with 0.0.0.0/0 (any destination), which the confirmation shows, for Add Rule, Import, Clone, Fleet matrix copy and templates. An import is checked before you are asked: addresses must be IPv4, ports must be named, a description at most 250 characters, and the first rule that is not is named. Add Rule refuses a port of "," and a source that is not IPv4.
- **Dialogs keep the keyboard** (#172, #173, #174). Tab and Shift+Tab stay inside an open dialog, a held Enter key no longer confirms a dialog or repeats a side action, Ctrl+K does not open the command palette over a dialog (and Enter in it no longer confirms the dialog beneath), Escape closes only the dialog on top, and focus goes back to what opened the dialog.
- **Take Backup goes to the server you started it for** (#249, #254). Cancel and close are off while it checks the server's backups and sends the request. Before, cancelling still sent the backup, and picking another server in the meantime sent it to that server and named the wrong one in the dialog. The check gives up after 20 seconds and asks as if the backups could not be read.
- **A double-click no longer confirms the next queued dialog** (#250, #255). The second click of a double-click is ignored by the confirm button. One click, Enter and Space confirm as before.
- **One rule reads "1 rule"** (#207).

### Changed
- **Every dialog is the same shell** (#186): Firewall Import and Clone, Create and Attach for VPCs and load balancers, Add DNS Record, Add Public SSH Key, the API Token Vault, the question BinaryLane asks about an action, and Take Backup. Escape and a click outside close them, and they fit small windows. Their wording is unchanged. On Android the back button closes a dialog, but leaves the question dialog alone, and the sign-in dialog while there is no account.
- The GUI test harness checks firewall bodies against the schema and can raise a question from an action (#256). BinaryLane has confirmed that plan prices are before GST, which is what the app already assumed (#257). Nothing else in the app changes.

## [1.0.62-beta.11] - 2026-10-01

**A failed load now says so instead of looking empty**

### Fixed
- **Failed loads say what went wrong** (#248, #147, #200, #222, #223). When BinaryLane could not return something, several screens showed it as empty or as "none". Billing now says "Couldn't load the invoices." or "Couldn't load the payment details.", and "Couldn't check whether any invoices are unpaid." when that check fails, each with Retry, instead of "No past invoices found." or "No payment method configured". Create Server says "Couldn't load the locations." with Retry. A server list or backups list with one page that failed now fails as a whole instead of showing the pages that did load as if they were everything. Error messages are plain words, never raw JSON, and the "Error invoking remote method" prefix is gone from messages that come from inside the app (#219).
- **A refused request is not always a failed token** (#148, #185). A 403 when deleting a VPC is BinaryLane refusing that delete, and now says so instead of "API token authorization failed". Reads answered with 401, 403 or 404 are reported at once instead of being retried first.
- **Firewall rules that never load give up** (#189). The read now stops after 20 seconds and shows the failure with Retry, instead of staying on "Fetching…". It can take about a minute to show, because a failed read is tried three times first.
- **The backups list shows every backup** (#199). It read only the first page, so a server with many backups could show some of them. The command palette's check before a backup replaces one reads the whole list too.
- **A damaged saved server list no longer crashes BLDesk at start** (#240). It is ignored and the list is fetched again, so Reload recovers without Reset Cache & Reload.
- **A change BinaryLane accepted is no longer shown as failed** (#242). BinaryLane answers some Settings and Network changes, a rename for one, with "accepted" and no action to follow. BLDesk showed a red error and recorded Failed in History. It now says the change was accepted, and History records it as Submitted.
- **Two confirmations in a row no longer lock the second** (#243). The second one opened with its buttons disabled and could not be closed. Clicking Apply Rules in Firewall clone twice quickly queued two; it now asks once.
- **No false "is now off" at launch** (#244). A powered-off server could raise "is now off" and "Was running." just after BLDesk started, although it had not been seen running.
- **Network Map export keeps its colours and fonts** (#245). SVG and PNG exports came out mostly black.

### Changed
- A reply with no body, such as a 204, is no longer rebuilt by the request layer, which hid errors it hit (#187). The GUI test harness gives its invoices the account's tax code (#241), and a dev-only dependency (brace-expansion) is updated to its patched releases (#247). Nothing else in the app changes.

## [1.0.62-beta.10] - 2026-10-01

**Safer backups and prices, and a batch of fixes from testing**

### Fixed
- **Take Backup says what it will replace** (#202, #236). A backup taken into a full slot replaces an existing one, and BinaryLane then no longer has it. BLDesk now asks first and names that backup, or says it can't tell when it can't read the server's backups. The command palette's `backup` review lists the backup each server would lose before you run it. Choosing "Replace Existing Image" now works: BinaryLane refused it because BLDesk left out the backup's type.
- **Create Server prices** (#203, #211). The Monthly Total now follows the backups you pick in both the simple and View All views, and each backup option shows exactly what choosing it adds to the total. Tax comes from your account's tax code instead of a fixed rate; when it can't be read, prices are labelled "before tax".
- **Failed loads no longer look like empty data** (#210, #229). Firewall Clone and Copy never write onto a server whose rules couldn't be read, and Save as Template no longer stores an empty firewall after a failed read. A failed balance, pending charges or data usage load shows as a failure instead of $0.00 or Unlimited, and a failed refresh keeps the last figure. A failed backups list shows an error with Retry instead of "No Backups Found".
- **Android: a request that got no answer is no longer sent again** (#201). It could create a second server or repeat an action. You now see "No response from BinaryLane", and for a change you are told to check before trying again.
- **Add Disk and Resize Disk** (#217) now send the size field BinaryLane expects.
- **Change Partner** (#230) names the current partner in its confirmation.
- **Reset Cache & Reload** (#231) asks before it clears your saved tags, groups and settings.
- **Open mPanel Web** (#228) opens mPanel's home page.
- **Server details** (#225) start from a clean state for each server instead of carrying over the previous one's edits. The usage chart (#232) ends at the current time on every refresh. DNS zones with no TTL no longer show "TTL s" (#216).
- **Smaller fixes:** one unreadable `.pub` file no longer hides your other local SSH keys (#214); saving a template should no longer fail on Windows (#212); Windows PowerShell handles curly apostrophes in key paths (#213); uninstalling the Linux package removes the leftover `/usr/bin/bldesk` link (#226).

### Changed
- The updater's install-script check now parses the script that ships (#227), and the GUI test harness models backups, pricing and tax (#204, #233, #234). Nothing in the app itself changes.

## [1.0.62-beta.9] - 2026-09-29

**Updates show that they are installing**

### Fixed
- **Installing an update no longer looks frozen or runs twice** (#195). On Linux the install blocks the window for ten seconds or more, with "Restart to update" still on screen, and a second click could make the same package install a second time. The button now changes to "Installing" straight away, the update menu says what is happening, and repeat clicks are ignored.

### Changed
- The GUI test harness can offer a newer version to a packaged app (`scripts/gui-test`), for testing updates. Nothing in the app itself changes.

## [1.0.62-beta.8] - 2026-09-29

**Seven fixes from testing the app screen by screen.**

### Fixed
- **Android: a successful delete no longer runs twice** (#193). Deleting an SSH key, DNS record, VPC, load balancer or server, and flushing the DNS cache, sent the request twice on Android. The second attempt got "not found", so the app said "Delete failed" for something that had worked, and the list stayed out of date. Each now runs once.
- **Firewall: a failed read is no longer shown as "no rules"** (#192). If BinaryLane could not return a server's firewall rules, the tab said "Firewall Inactive / Open", and adding a rule then replaced the server's real rules with just that one. It now says the rules couldn't be read, with a Retry button, and editing stays off until they have loaded.
- **Confirmation dialogs: Enter on Cancel cancels** (#180). Pressing Enter with Cancel focused ran the action. A focused button now does what it says (Cancel, close, help, the side action); Enter elsewhere in the dialog still confirms.
- **HA partner** (#182). Choosing a partner server removed the partnership instead of setting it, because BLDesk sent the wrong field. It now sets it.
- **Create Server: unticking every SSH key** (#184). This still deployed the account's default keys. It now deploys none.
- **DNS: adding a record** (#183). The form always failed, because it sent a TTL BinaryLane doesn't accept. It now sends none, so BinaryLane's default of 3600 applies.
- **Disabling automated backups** (#181, #194). The confirmation said existing backups are kept. BinaryLane removes the daily backups when you disable them; temporary backups you took with Take Backup are not removed. The dialog now says so, and the change is recorded in History.

### Changed
- A GUI test harness for developers (`scripts/gui-test`) runs the app against a fake API. Nothing in the app itself changes (#168).

**Linux (.deb):** if this update fails to install with a message to close BLDesk and open it again from your app menu, do that once and install again. It is needed only if BLDesk restarted itself after its last update.

## [1.0.62-beta.7] - 2026-09-25

### Fixed
- **Plan availability matches your operating system** (#107): the create form and Change Plan now ask BinaryLane which plans are in stock for the chosen image (and, in Change Plan, for that server), as mPanel does. Before, they showed a general figure that matched no operating system, so plans mPanel shows as unavailable could be picked. Unavailable plans show a crossed-out circle and mPanel's wording, and plans too small for the image are no longer listed.
- **Memory and storage choices** (#107): storage runs from the plan's minimum (or the image's, if larger) to its maximum in the steps BinaryLane accepts. Memory and storage are sent only when you change them, so an untouched plan gets its included amounts at no extra cost. In Change Plan, a server on a retired plan sees it listed as its current plan; once another plan is picked, the retired one can't be chosen again.
- **Storage changes can fail safely** (#107): Change Plan now says, on the page and in the confirmation, that if the disk can't be resized (for example, the data doesn't fit), the change fails after the server has shut down, and the server restarts with its storage and data unchanged.
- **Change Plan** (#108) no longer shows a current plan summary or a "no longer offered" notice above the plans, matching mPanel.
- **Linux updates** (#103): after installing an update, BLDesk restarted in a way that stopped the next update from installing ("Command pkexec exited with code 127"). It now restarts normally, and a window that was restarted the old way says what to do instead of showing the error.

**Linux (.deb): if this update fails to install,** close BLDesk completely, open it again from your app menu and install again. This is needed once, only if BLDesk restarted itself after its last update; later updates install normally.

### Changed
- **Help search** (#104) finds the SSH Keys page for "generate key pair", "ed25519", "ssh-keygen", "default key" and "rename key".

## [1.0.62-beta.6] - 2026-09-24

### Added
- **Generate SSH key pairs** (#102, desktop only): SSH Keys → Generate Key Pair, also beside "+ Add SSH Key" on the create form. BLDesk creates an Ed25519 key pair with your system's `ssh-keygen`, saves it in `~/.ssh` and adds the public key to your account. From the create form the new key is ticked for the server and set as its SSH key, so the first connection works. The private key never leaves your device, and nothing in `~/.ssh` is overwritten: a name already in use gets the date added. The key has no passphrase; the result screen shows how to add one.
- **Edit SSH keys** (#101): rename a key, or set it as a default for new servers, as in mPanel. Each edit is confirmed and recorded in History. SSH Keys has a Default column, a Refresh button, and the default option when adding a key.

### Fixed
- **"+ Add SSH Key" on the create form** (#101) always failed with a 400 error. It now adds the key, honours the default option, ticks the key for the server being created and records it in History.
- **Default SSH keys on the create form** (#101): only the first default key was ticked, so other defaults were left off the new server. Every default is now ticked, the selection resets to your defaults each time the form opens, and a key deleted in mPanel is no longer offered.
- **SSH key errors** (#101) show BinaryLane's message instead of the raw response.

Android installs still on 1.0.62-beta.2 or beta.3 need one manual install; see 1.0.62-beta.5 below.

## [1.0.62-beta.5] - 2026-09-24

Replaces 1.0.62-beta.4, which was withdrawn; everything in it is here. Older releases have been removed from GitHub, so this is the release every desktop and Android install updates to.

- **Android: install this version by hand.** 1.0.62-beta.2 and beta.3 cannot find new releases (fixed below), so download `BLDesk-android.apk` from this release and open it. It is signed with the same key as beta.2 and beta.3, so it installs over them and keeps your account; no uninstall is needed. Updates after this one arrive in the app again.
- **Android, from a build older than 1.0.62-beta.2:** uninstall first, then install this APK. The signing key changed in beta.2 (see below), so Android will not update over an older install; add your token again afterwards.

### Fixed
- **Long lists cut off at 20** (#94): VPCs, SSH keys, DNS records, load balancers and usage rows only ever showed the API's first page of 20. Every list now fetches all pages, so VPC 21 onwards appears in the VPC manager, the network map and every VPC picker. The VPC cards are shown 20 at a time.
- **Android update check** (#93): since 1.0.62-beta.2 the in-app update check failed with "Failed to fetch", because the Content Security Policy blocked the local proxy Android's HTTP layer routes requests through.
- **Android back button** (#93): back closed the app from any screen. It now steps back through the app: an open dialog, the command palette, the navigation drawer, a server's sub-tab, the server, then any tab back to Servers. On the Servers screen it sends the app to the background instead of closing it.

## [1.0.62-beta.3] - 2026-09-24

### Fixed
- **SSH to a server with no public address** (#87): with Default SSH address set to Public address, a VPC-only server failed with "No host given". BLDesk now names the server, says it has no public IPv4, and points to Remote Access → Connect to → Custom… (suggesting its private address over a VPN) or Server name.

### Changed
- **Releases are published last** (#88): each release is created as a draft, every installer and the Android APK are attached, and only then is it published. Pull requests are checked by a typecheck, guard and build workflow.
- **Build tooling** (#89, #91): vite 7, electron-vite 5 and @vitejs/plugin-react 5, and js-yaml 4.3.2, clearing the development-tool security alerts. Nothing shipped in the app changed.

Android installs updated to 1.0.62-beta.2 already use the new signing key and update in place.

## [1.0.62-beta.2] - 2026-09-24

A security release. Two things need action from Android users:

- **Android: uninstall, then install this APK.** The app is now signed with a new key, and Android will not update an app signed with a different one. Your token is removed with the old app; add it again after installing.
- **Android: rotate your API token if you ever ran a build older than 1.0.44.** Those builds kept the token in plain storage that Android could back up to the cloud. Create a new token in mPanel and delete the old one.

### Security
- **Main window locked to the app** (#77): it can no longer be navigated to another page, every privileged request checks that it comes from the app's own page, external links open only for http, https and mailto, web permission requests are denied, and a Content Security Policy limits scripts to the app and network requests to the services it uses. Release notes are rendered without raw HTML. The rescue console runs sandboxed in its own session and accepts only https.
- **Sandbox and web security on** (#80): the renderer now runs in Chromium's sandbox with same-origin rules enforced; the page can no longer read local files.
- **Token storage** (#79): on a system with no working keyring, BLDesk refuses to save a token unencrypted unless you explicitly choose to, and labels such profiles. A token that can no longer be decrypted asks to be re-entered. Android stores tokens only in Keystore-backed secure storage. Switching accounts clears the previous account's cached data, and History and settings files are private to your user.
- **Electron 44 and electron-builder 26** (#82): moves off an unsupported Electron release, and fixes an AppImage library-loading issue.
- **Hardened packaged binary** (#83): BLDesk's executable can no longer be used to run other JavaScript.
- **Android** (#85): new signing key kept out of the repository, HTTPS only with system certificate authorities, and no cloud backup or device transfer of app data. The in-app updater opens only BLDesk's own release downloads.
- **Help** (#81): text that looks like a token or key is never sent to the help service.
- **Release pipeline** (#78, #86): builds run with read-only tokens, actions are pinned to exact versions, and only a separate final step can publish, once every build has passed.

### Changed
- The token vault is now titled "API Token Vault".
- "Save server as template" warns that captured user data may contain secrets.
- In-app help: quoted dialog text is checked against the app at build time (#76).

## [1.0.61-beta.11] - 2026-09-23

### Changed
- **Server List Sorted by Name** (#71):
  - Servers still building stay at the top, and the rest are now listed by name instead of the API's order. Sorting is numeric-aware, so `web-2` comes before `web-10`.

### Fixed
- **Help Button Beside Page Actions** (#70):
  - On VPCs, DNS & Domains, SSH Keys, Load Balancers and History, the help `?` now sits next to the page's action button instead of drifting to the far edge of the header.
- **Templates on a Phone** (#67):
  - Below the large breakpoint the template library is capped in height and scrolls, so the selected template is reachable on the first screen. The header's buttons wrap instead of pushing the help `?` off the edge.
- **Cancel Reported as Failed After Succeeding** (#68):
  - A "not found" reply to a server cancellation means the server is already gone, so it is now recorded in History as completed rather than failed.
- **Archived Status Explained** (#69):
  - "Archived" keeps BinaryLane's own name and now has a tooltip explaining it: powered off due to cancellation or non-payment.
- **Network Map Zoom Help** (#66):
  - The map's help page explains that Cmd/Ctrl+scroll, the zoom buttons and pinch zoom the map, while Cmd/Ctrl+plus and minus zoom the whole app.
- **Android Release Build**:
  - The Android workflow now installs the SDK packages the build uses, after the obsolete `tools` package it requested by default stopped being served.

## [1.0.61-beta.10] - 2026-09-23

### Added
- **Every Address in Network & Addressing** (#64, #74):
  - The server overview now lists the primary public IPv4, every secondary public IPv4, every private address and IPv6, each with its own copy control. Previously only the first public address was shown, so a second IPv4 bought through Change Plan appeared nowhere else in the app.
  - One row per kind of address, with the label pluralised when a server holds more than one.

### Fixed
- **In-App Help Crash on Windows** (#65, #72):
  - Every `?` control crashed with "Cannot read properties of undefined (reading 'id')" in Windows builds, whose help pages are bundled with CRLF line endings.
  - The help outline and renderer now split lines through one helper and assign heading anchors as they go, so they can no longer disagree.
- **VPC-Only Servers Labelled as Public** (#74):
  - A server with no public address showed its private VPC address under "Public IPv4". It now appears under "Private IPv4", and the public row is shown only when a public address exists.
- **Screens Unusable on a Phone** (#63):
  - The disk images and SSH keys tables scroll sideways instead of clipping their actions, firewall rule cards wrap, and the Network tab's VPC row stacks on narrow screens.
  - The server header truncates long hostnames, drops the "Server:" label below the small breakpoint, and shortens "Launch SSH" to "SSH" on a phone. The desktop layout is unchanged.
  - Custom thin scrollbars now apply to mouse and trackpad devices only, giving touch screens their native overlay scrollbar back.
- **Credential Vault Permissions** (#73):
  - The token vault file is now written readable by its owner only (`0600`), and an existing vault is tightened on the next launch.

## [1.0.61-beta.9] - 2026-09-09

### Added
- **Network Map Touch Gestures** (#61):
  - Added pan and pinch-to-zoom touch gesture support to the interactive Network Map on mobile and touch devices.
  - One-finger touch pans across the canvas smoothly, and two-finger pinch zooms in and out (`[0.2, 3]` clamp range) anchored to the midpoint of the gesture.
  - Container utilizes `touch-action: none` to prevent the browser/WebView from capturing touch events for page scrolling.

### Fixed
- **Action Polling Resilience on Dropped Requests** (#59):
  - Action settlement poller (`pollActionToSettled`) now treats network transport drops (`TypeError: Failed to fetch`) the same as slow poll timeouts, retrying until the deadline instead of immediately failing the action as `lost`.
  - Fixes false-positive action failures on mobile devices when long-running actions (such as server resizes) encounter radio sleeps, network handovers, or device lock/unlock cycles.
- **Action Progress Toast Positioning on Mobile** (#60):
  - Repositioned the action progress toast on viewports below `md` breakpoint (`fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px)+0.75rem)]`) so it clears the mobile bottom navigation bar and gesture navigation inset, keeping the toast and close button fully visible and accessible.

## [1.0.61-beta.8] - 2026-09-07

### Added
- **Browse & Remember Custom SSH Key Files**:
  - Added a **Browse…** button in **Remote Access** directly beside *Key for this server* to select an existing private key from anywhere on disk with any filename.
  - No longer requires a neighbouring `.pub` file or standard `~/.ssh` directory structure.
  - Security & Privacy: BLDesk retains only the exact local file path string per server and profile. Private-key contents are never read, copied, imported, or transmitted, and passphrase storage is deliberately not attempted.
  - Full launcher integration: Selected keys are checked by metadata and supported seamlessly across all SSH launch buttons, terminal reopen, session key-learning, and parallel broadcast.
  - UI display: Shows the key filename in the selector and the complete path beneath it.

## [1.0.61-beta.7] - 2026-09-06

### Fixed
- **macOS In-Place Auto-Update Process Swap**:
  - Fixed an issue where the updater hung during the update swap when upgrading on macOS.
  - Root cause: `installMacUpdate` executed `unzip` synchronously on the main thread, freezing the UI and event loop, while calling `app.quit()` which was intercepted by tray window-close handlers (`event.preventDefault()`). The helper script sat in an unbounded wait loop for the old PID, and `before-quit` triggered duplicate concurrent extraction jobs.
  - Solution: Offloaded archive extraction directly to the detached helper script after process termination, added a re-entrancy installation guard (`macInstalling`), bounded the process wait loop with a force-kill fallback, and switched from `app.quit()` to `app.exit(0)` to prevent tray interception during an update restart.

## [1.0.61-beta.6] - 2026-09-06

### Fixed
- **Windows Embedded SSH Session Close** (fixes #55):
  - Fixed an issue on Windows where clicking the close button on an embedded SSH tab had no effect while SSH was attempting to connect, leaving the tab open until the connection timed out.
  - Root cause: `node-pty` on Windows throws `Signals not supported on windows.` when any signal argument is passed to `kill()`. The unhandled rejection prevented the renderer from closing the tab and caused Windows to leak background SSH processes on application exit.
  - Solution: `close()` now invokes a bare `process.kill()` with no arguments on Windows, directly terminating the ConPTY process. Other platforms (macOS, Linux) continue sending `SIGHUP`.
  - Updated test runner assertions in `scripts/test-terminal.cjs` to handle platform-specific termination signals.

## [1.0.61-beta.5] - 2026-09-06

### Added
- **Per-Server SSH Connect Address & Tailscale/VPN Support** (addresses #56):
  - Configurable per-server connection target under Remote Access: **Public address** (default), **Server name** (resolves Tailscale MagicDNS / local DNS short names), or **Custom…** (arbitrary hostname, Tailscale 100.x IP, FQDN, or `~/.ssh/config` Host alias). Resolves issue #56.
  - Per-profile default connect address setting (**Default SSH address**) in the Terminal header (Public address or Server name).
  - Unified SSH resolution (`openServerSsh`) across all entry points: Server List row button, Server Details header & Remote Access, Network Map, Command Palette, Context Menu, Tray menu, Deep Links (`bldesk://ssh/...`), Terminal tab reopen, and Broadcast panel.
  - Profile fallback logic ensures callers without explicit profile context resolve the active profile's preferences rather than ignoring overrides.
  - Broadcast panel execution preview displays the resolved target host per server and skips any server with an invalid or missing connect address with a clear `invalid connect address` reason.
  - Reachability badge tooltip clarifies *"Checks the public address"* when an override is active so users know ping checks the public IP even when SSH connects over a private tailnet.
  - System OpenSSH architecture: delegates hostname/alias resolution to the OS and system OpenSSH binary without embedding VPN credentials or altering local configuration.
  - Updated Help documentation (`server-remote-access.md`, `terminal.md`, `troubleshooting.md`) with setup guides for firewalled public SSH, Tailscale MagicDNS, WireGuard, and `~/.ssh/config` host aliases.

## [1.0.61-beta.4] - 2026-09-06

### Fixed
- **macOS Unsigned Auto-Update Engine**:
  - Bypassed Squirrel.Mac on macOS to allow unsigned application builds to auto-update without hitting `SQRLCodeSignatureErrorDomain` ("code object is not signed at all").
  - Direct universal zip download streaming with real-time transfer progress, in-place atomic application bundle swap on restart or quit via detached helper script, and automatic Gatekeeper quarantine (`xattr -cr`) clearance.
  - Added structural updater guard suite (`scripts/check-updater-guards.mjs`) to verify auto-update invariants on every build.
  - *Note for macOS users on beta.2/beta.3*: Install this build once manually (via DMG or Zip) to upgrade to the new self-updating engine; subsequent updates will install automatically.

## [1.0.61-beta.3] - 2026-09-06

### Added
- **Per-server SSH Key Associations**:
  - Per-profile, per-server local SSH key-path associations, editable in Remote Access and the server details header, with embedded-session learning after ten seconds live or a normal non-255 exit. No private-key contents are read or retained by BLDesk.
  - Connect-picker key-source labels (`associated`, `last used`, `ssh default`) and per-host broadcast key previews, including explicit skips for missing associated keys.

### Fixed
- **SSH Multi-Key Fleet Resolution**:
  - SSH entry points now resolve the server association, then the profile's last working key, then OpenSSH defaults instead of selecting the first discovered key. Broadcast resolves identities independently for each host.
  - Explicit SSH keys now include `IdentitiesOnly=yes` so unrelated agent identities do not crowd out the selected key; default-identity connections retain their existing OpenSSH behaviour.
- **Server Overview Formatting**:
  - Aligned Disk Storage card formatting with Memory card (used percentage large, with capacity and NVMe description beside it).

## [1.0.61-beta.2] - 2026-09-06

### Added
- **Desktop Embedded SSH**:
  - Interactive multi-session terminal tabs powered by `node-pty` and `xterm.js`, with per-session scrollback search (Ctrl+F), refit and native zoom tracking.
  - Non-interactive parallel SSH broadcast with real OpenSSH remote command execution, per-host exit status, and history logging without persisting sensitive remote output.
  - Process lifecycle management capped at 32 concurrent sessions with automatic cleanup on tab close and application quit.
  - Reopen previous sessions prompt after application restart.
  - Desktop-only safeguards: Android retains external SSH client intent handoff.
- **PTY Security & IPC Guards**:
  - Strict host, user, port, and key argument validation preventing shell injection; OpenSSH is invoked via argv array directly from PATH.
  - IPC restricted to main window and main frame; comprehensive typecheck guards (`scripts/check-pty-guards.mjs`).
- **Packaging & Electron 33 Native Build**:
  - Pinned `@electron/rebuild: 3.7.2` via npm overrides to guarantee ABI 130 compatibility across macOS, Linux, and Windows.
  - Package validation hook in `scripts/after-pack.cjs` that fails builds loud if any platform target is missing `pty.node` or platform spawn helpers.
  - Verified live SSH connectivity to a real BinaryLane VPS instance.

## [1.0.61-beta.1] - 2026-09-05

### Fixed
- **Mobile in-app updater semver comparison**:
  - Implemented proper SemVer 2.0 comparison in the mobile bridge (`semverCompare`), resolving an issue where Android in-app updates ignored prerelease/beta increments (e.g. comparing `1.0.60-beta.7` vs `1.0.60-beta.3` as identical).
  - Version bump to 1.0.61-beta.1 ensures currently installed 1.0.60-beta.X devices trigger the update immediately.
- **Unpacked desktop updater feed**:
  - Ensured `app-update.yml` is generated across all platforms in `after-pack.cjs`, and configured static GitHub feed URL in `main/updater.ts` with graceful `check-failed` handling.

---

## [1.0.60-beta.7] - 2026-09-05

### Fixed
- **Ask BinaryLane Ordering & Search Relevance** (*PR #50 by @termau*):
  - Ask BinaryLane answer card now renders first once a question is submitted, keeping the answer above the fold.
  - Local help hits capped at 5 with a "Show all N topics" toggle.
  - Ignored conversational stop words (how, do, I, an, the, etc.) in `searchHelp` and dropped incidental body matches on multi-word queries.
  - Added IP address keywords to Server Network and Change Plan help pages.

---

## [1.0.60-beta.6] - 2026-09-05

### Added
- **Help & Ask BinaryLane** (*PR #48 by @termau*):
  - Bundled, searchable documentation for every tab, server sub-tab and palette verb; contextual question-mark links, worked examples and help deep links.
  - Ask BinaryLane answers and source articles from BinaryLane's published-article service directly in the search box, with suggestions, feedback and offline-safe local results. Questions use a fixed-origin, unauthenticated transport and contain only the visible search text.
  - Help coverage and internal-link guards run with `npm run typecheck` (`scripts/check-help-guards.mjs`).

### Fixed
- **Android offline detection**:
  - Android WebView now declares the read-only `ACCESS_NETWORK_STATE` permission, so offline help detects disconnected Wi-Fi/mobile data instead of attempting a request. Verified with the installed APK on an Android 36 ARM emulator, including native HTTP answers, suggestions, feedback, keyboard and rotation.

---

## [1.0.60-beta.5] - 2026-09-05

### Fixed
- **Desktop zoom shortcuts and scrollable navigation** (#18, *PR #47 by @termau*):
  - Enabled desktop zoom shortcuts (`Ctrl/Cmd` + plus/minus/equals, and `0` to reset), with an 80–150% bounded range (80%, 90%, 100%, 110%, 125%, 150%) shared by keyboard, View menu, and native `zoom-changed` events.
  - Allowed both desktop navigation columns (global navigation and server sub-nav) to scroll vertically when the window is short or zoomed in, keeping lower items reachable while maintaining the footer.
  - Added a lightweight UI source guard to `npm run typecheck` (`scripts/check-ui-guards.mjs`) verifying zoom ownership, shortcut configurations, and menu handler boundaries.

---

## [1.0.60-beta.4] - 2026-09-04

### Fixed
- **Change Plan transfer hand-over and narrow layout** (*PR #45 by @01ax*):
  - Changing base size now resolves transfer to the target plan's included transfer allowance (matching web panel behaviour), and displays the resulting allowance in the before → after review table as a Data row.
  - Backup retention selectors and option grids no longer overflow in narrow windows (`min-w-0`).
  - IP Addresses dropdown is constrained to `max-w-sm` instead of stretching across the screen.
  - Backups view inside a server's page is pinned to that server (`initialServerId`) rather than presenting a redundant server picker.
  - Standardised terminology across the UI and command palette: BinaryLane creates backups rather than snapshots (`snapshot` / `snap` remain silent palette aliases).
  - Dropped temporary AI-written unit tests and `vitest` devDependency.

---

## [1.0.60-beta.3] - 2026-09-04

### Fixed
- **Offsite backup frequency surcharge** (*PR #43 by @termau, absorbing PR #42 by @01ax*): The surcharge shipped in beta.2 took the largest rate among the enabled backup frequencies. The web panel, and the API's own description of `offsite_backup_frequency_cost`, apply the rate of the highest *frequency* enabled: daily, else weekly, else monthly. The two only agree while rates are published in that order, so this is invisible today and would have diverged from the panel the moment a rate shipped out of order. Tests now use out-of-order rates so the wrong rule cannot pass, and also pin that the offsite storage term counts raw selected backups without deducting plan inclusions, as the panel does. 46 tests.

---
 
## [1.0.60-beta.2] - 2026-09-04

### Fixed
- **Change Plan review follow-up** (*PR #40 by @01ax*): A required licence group (cPanel images ship no opt-out tier) now defaults to its cheapest real option and holds the submit until one is chosen, instead of the API rejecting the resize after confirmation. Billing counts backups against the plan's included counts, charges the offsite surcharge for the highest enabled frequency, and prices transfer above the allowance; none of these move a number on today's plans. The resize payload now carries `transfer`, clamped to the target plan's range, so a plan change no longer resets the allowance. The pre-action backup offers only genuinely free slots and, where none is free, asks for the exact backup to replace. Windows SAL copy points at support rather than the web panel. Adds `vitest` with 43 tests over `lib/licences.ts` and `lib/serverPricing.ts`, run by `npm run typecheck`.
- **Template dialogs and the sidebar** (*PR #41 by @termau*): The template editor, apply and paste dialogs had no body or footer padding, so fields sat flush against the panel edge; they now match the other dialogs. Every dialog starts below the title bar instead of over it. Leaving Server Details (for example via **Save server as template**) shifted the whole app 48px because the icon rail plus server sub-nav was wider than the plain sidebar; the sub-nav is now sized so both layouts are the same width, and the width transition is gone.

---
 
## [1.0.60-beta.1] - 2026-09-04

### Added
- **Change Plan: licences, reinstall, pre-action backup, and billing summary** (*PR #35 by @01ax and @termau*):
  - Change, add, or remove licences during plan resizing with OS compatibility validation.
  - Reinstall OS option directly within the Change Plan panel.
  - Optional pre-action backup slot selection.
  - Real-time billing calculation and changes summary before confirmation.

### Fixed
- **Template saves rejected on desktop** (#34, *PR #36 by @termau*): Saving any template through the Electron bridge failed with `Template YAML requires string fields "name" and "user_data"`, including **Save server as template** and **Save this form as a template instead**. The main-process store still validated the first-cut `name` + `user_data` shape while the app has written `kind: bldesk/server-template@1` documents with a `spec` block since full server templates landed; the validator now accepts the current schema (and still the old one), with the kind constant shared between main and renderer. The template editor also swallowed the rejection into the page banner behind the open dialog, so Save appeared to do nothing; store errors now show inside the dialog.
- **Templates page margins** (#33, *PR #38 by @termau*): Fixed layout margins so the Templates tab has the same padding as every other tab (`p-4 md:p-6`).

### Chore
- **Enforce LF line endings in repository via `.gitattributes`** (*PR #37 by @termau*): Repository-level line ending enforcement ensuring LF text storage, proper platform script endings (`.sh`/`gradlew` LF, `.bat`/`.cmd`/`.ps1`/`.nsh` CRLF), and binary asset protections.
- **Features roadmap update** (*PR #39 by @termau*): Scorecard and documentation update reflecting features shipped through v1.0.59.

---

## [1.0.59] - 2026-09-03

### Fixed
- **Fleet Heatmap rate floors** (*PR #32 by @termau*): On quiet fleets, rate colours previously reached red at low numbers (e.g. 5.8 KB/s) because intensities were purely relative to the fleet maximum. Added absolute floors (~40 Mbit/s for network in/out and 10 MB/s for disk read/write) so cells only colour when activity is notable. Tooltips now explain whether the cell is scaled against the floor or the fleet maximum, and the CPU tooltip formats as a clear percentage of 100 × vCPUs.

---

## [1.0.58] - 2026-09-03

### Added
- **Fleet Utilisation Heatmap** (FEATURES.md #9, *PR #31 by @Freewheelin*): a sortable live grid for CPU, RAM, disk, network and storage IO across every server. Capacity metrics use each server's provisioned resources, throughput rates use fleet-relative intensity, and stale, unavailable, building and inactive servers remain explicit. Active-server metrics refresh once per 5-minute sample period, timed to the period end, four requests at a time, and a sweep already in flight is not duplicated; selecting a row opens that server's Usage tab.

### Fixed
- **Frameless window had no edge on Linux** (*PR #26 by @termau*): Without the OS frame nothing drew a border or shadow, so the window was a flat rectangle against the desktop. A one-pixel inset border now stands in for the window manager's, Linux only, and disappears when maximised.

---

## [1.0.57] - 2026-09-03

### Changed
- **Server templates, first class** (FEATURES.md #8, replaces the cloud-init-only templates):
  - A template is a whole server: region, plan + options (memory, disk, IPv4 count, backups), image, VPC and SSH keys by name, firewall rules, local tags, and cloud-init with `{{variables}}` (`{{hostname}}` built in; secrets prompted per apply and never stored).
  - New **Templates** tab with a library, editor, file/paste import and single/bundle export (`bldesk/server-template@1` YAML). Existing cloud-init templates are read as-is and migrate on first save.
  - Seven starters shipped read-only: Ubuntu baseline, **CIS-hardened Ubuntu 24.04**, Docker host, WordPress, WireGuard bastion, k3s node, PostgreSQL 16 — real cloud-init, every firewall set ending in an explicit drop.
  - **New server from this**: variables prompt → create form prefilled (still the review) → after BinaryLane accepts, BLDesk waits for the build, applies the template's firewall rules (recorded in History) and tags the server.
  - **Save server as template** (server → Cloud-init tab) captures plan, image, region, VPC, firewall rules and user data; **Save this form as a template instead** on the create form.
  - Palette verb: `create <hostname> from <template>`.
- `CreateServerModal` gains an `initial` prefill prop and passes the new server's id to `onCreated`.

### Removed
- `CloudInitTemplates.tsx` and `lib/templates.ts` (superseded; the server list's Templates button now opens the tab).

---

## [1.0.56] - 2026-09-03

### Changed
- **Change Plan: full size options configuration** (*PR #29 by @01ax*):
  - Change Plan now sends the complete `ChangeSizeOptionsRequest` configuration rather than only `{size, memory, disk}`.
  - Pre-populates and manages `ipv4_addresses`, `ipv4_addresses_to_remove`, backup retention schedules (`daily_backups`, `weekly_backups`, `monthly_backups`), and `offsite_backups` directly from the server's current `selected_size_options`.
  - Enforces explicit address selection when decreasing IPv4 address counts, preventing accidental loss of arbitrary IP addresses.
  - Adds "Continue using <OS>" option directing to Rebuild for intentional OS changes.
  - Corrects address price fallback calculation (`+$2.00` per additional address) when current plan is retired.

---

## [1.0.55] - 2026-09-03

### Changed
- **One dialog shell.** The confirm dialog, the create-server form (and its add-key sub-dialog) and the traceroute viewer now render through a single `Modal` component: same backdrop, panel, header, close button, Escape and backdrop-click everywhere. The mutation guard's rule 2 is now "no `createPortal` outside the shell", so a new kind of dialog fails CI instead of needing a review discussion. Mutating dialogs still go through `useConfirm()`; read-only ones are a `Modal` with their own body.

---

## [1.0.54] - 2026-09-03

### Changed
- **Reachability UI Polish** (FEATURES.md #11, *PR #27 by @01ax*):
  - **Compact Status Pill**: Folded multi-line reachability explanation into a single neat status pill (`⚠ Port 22 unreachable  ?  ⟳`), keeping header height stable.
  - **Single-Blink "?" Indicator**: The `?` icon blinks once on new probe failures (keyed by probe sequence) without ongoing visual distraction.
  - **Accessible Hover Card**: Explanation, firewall link, and traceroute trigger now live in a card reachable via both hover and keyboard `focus-within`, with zero mouse-out dead zones.
  - **Traceroute Dialog**: Route output now renders inside a dedicated modal dialog with live tracing state, backdrop dismissal, and hop explanations.
  - **No-Flash Re-check**: Retains previous probe results on screen during manual refresh, spinning only the leading icon.

---

## [1.0.53] - 2026-09-03

### Fixed
- **Release notes rendered as raw HTML in update popover**: GitHub Releases API provides release descriptions as pre-rendered HTML (`body_html`). The update menu previously escaped this as plain text, exposing raw HTML tags (`<h2>`, `<p>`, `<a>`). Added `ReleaseNotesView` to safely parse and sanitize HTML / Markdown, render styled headings, lists, code pills, and links, and route clicked links to the default system browser via `openExternal`.

---

## [1.0.52] - 2026-09-03

### Added
- **Reachability Probes & Firewall Verdict** (FEATURES.md #11, *PR #25 by @01ax*):
  - Local latency and connectivity chip alongside the **Launch SSH** button on Server Details, qualifying whether port 22 is reachable directly from the user's current workstation.
  - Three distinct probe states: `connected` (with round-trip latency), `refused` (port closed / sshd not running on guest), and `timeout` (silently dropped by firewall).
  - **Firewall Verdict**: When a timeout occurs, analyzes the server's rules against BinaryLane's stateless first-match firewall semantics to diagnose whether the packet was `blocked` (naming the exact rule number and definition), had `no-matching-rule` (drop occurred on the guest OS or intermediate route), or `no-rules` (unfiltered by BinaryLane).
  - Source-scoping awareness: only universal (`0.0.0.0/0`) accept rules shadow subsequent drop rules.
  - Rate-limited reachability probe worker (`main/reachability.ts`) enforcing account IP allowlists and rolling 30 probes/min throttle.

### Fixed
- **Double Window Chrome**: Removed redundant OS title bar frames on Windows and Linux (app title bar now handles window drag, minimize, maximize/restore tracking, and close). On macOS, native traffic lights are preserved and overlaid with inset padding.

---

## [1.0.51] - 2026-09-03

### Fixed
- **AppImage startup crash on Ubuntu 24.04 resolved via launcher hook**: 1.0.49 tried to append `--no-sandbox` from Electron's `main/index.ts`, but Chromium spawns its zygote and validates the sandbox before any application JavaScript executes. We now use an electron-builder `afterPack` hook (`scripts/after-pack.cjs`) to install a wrapper launcher script (`bldesk`) that invokes `bldesk.bin` with `--no-sandbox` only when `$APPIMAGE` is set and unprivileged user namespaces are restricted. The `.deb` package's AppArmor profile was updated to attach to `bldesk.bin`.

---

## [1.0.50] - 2026-09-03

### Fixed
- **Create server History entries never left "Submitted"** (#23, reported by @01ax). The handler recorded the change and then discarded the id, so nothing ever wrote the outcome back. It now resolves to completed (with the new server's id) or failed. The mutation guard gained a rule for it: an id from `recordChange()` must reach `updateChange()` or `track()` and must not be `void`ed.

---

## [1.0.49] - 2026-09-03

### Fixed
- **AppImage aborted on Ubuntu 24.04** with "The SUID sandbox helper binary was found, but is not configured correctly". AppArmor there blocks unprivileged user namespaces, so Chromium falls back to a setuid helper that cannot be root-owned inside a FUSE mount. The `.deb` failed the same way for a different reason: electron-builder's post-install tests for user namespaces as root, where they always work, and so deliberately left the helper without its setuid bit. The `.deb` now installs an AppArmor profile granting `userns` to the binary (what Ubuntu documents and what Chrome's own package does), so Chromium's preferred sandbox works there and the setuid helper is never used; it only falls back to a setuid helper where the kernel restricts namespaces *and* AppArmor is absent. The AppImage, which cannot install a profile, now ships a launcher that checks that kernel setting and starts the real binary with `--no-sandbox` only in that case (1.0.49 tried to do this from inside the app, which is too late: Chromium sandboxes before any app code runs). The `.deb` is the recommended package on those releases. It also now depends on `libasound2`, without which the binary would not load on a machine that lacked ALSA.

---

## [1.0.48] - 2026-09-03

### Added
- **Cloud-Init Template Library** (FEATURES.md #8, *thanks @Freewheelin!*):
  - Device-wide YAML template library with local file storage under `<userData>/templates/` on desktop and encrypted fallback on Android.
  - Create, view, rename, delete, copy/paste, and reveal templates on disk.
  - Create-server integration: user data is enabled only for images that advertise `user-data` support; load and save templates directly within the deployment flow.
  - Server details Cloud-init subtab displaying the exact user data used at server initialisation (`GET /v2/servers/{id}/user_data`) with copy and save-as-template actions.
  - On-demand fleet user-data coverage inspection table.

### Changed
- **Server Sub-Nav Reorganisation** (*thanks @01ax!*):
  - Moved **Change Plan** and **Cancel Server** out of Settings into their own primary server sub-navigation tabs, matching mPanel layout. Both tabs are fully deep-linkable.
  - Passed custom confirmation metadata through to preserve the Change Plan before → after diff table.
- **Accurate Building Server Status** (*thanks @01ax!*):
  - Properly detects and maps `new` status to an amber "Building" indicator with an animated spinner, sorting newly provisioned servers to the top of the fleet list.
  - Fixed hardcoded "Online" network status literal on server cards to accurately reflect actual provisioning and power state.
  - Added `.pb-bottom-nav` padding utility to prevent mobile navigation bar from obscuring bottom page content.
- **Network Map VPC Grouping Polish**:
  - Grouped fleet by VPC across regional columns so multi-region VPC clusters stay cleanly contained in single boxes.
  - Added authoritative `useVpcMembers` query (`/v2/vpcs/{id}/members`) for precise membership resolution.

---

## [1.0.47] - 2026-09-03

### Added
- **Network Map** (FEATURES.md #10): a new tab that draws the account as a schematic, tiered the way traffic flows — the internet on a rail at the left, then load balancers, then VPCs, then the servers in them. VPC boxes come from the account's VPC list and their member lists (empty VPCs get a box too), with a region column inside each box, so a cluster that spans Brisbane and Sydney is one box with two columns rather than two boxes. The VPC a load balancer belongs to (or fronts) is drawn first. Every server carries an *exposure port*: the ports the world can reach, coloured by the firewall audit (red for SSH/RDP open to the internet, amber for no rules or shadowed rules). Click a node to draw its paths and open a detail panel (addresses, VPC, what's reachable, findings, Open / SSH); "Public paths" draws every internet edge at once. Search dims everything that doesn't match. Pan by dragging, zoom with ⌘/Ctrl + wheel, fit to window. Export as SVG or 2× PNG for a ticket or a doc. The layout is deterministic, so the same fleet always draws the same picture. `go map` in the palette.

---

## [1.0.46] - 2026-09-03

### Changed
- **One confirm dialog, everywhere.** Cancel Server and Remove DNS Hosting no longer have their own dialogs: both use the shared confirm, which gained a **reason picker** (select + detail, forwarded to BinaryLane and recorded) and an **in-dialog side action** ("Copy the zone file first"). Both are `irreversible`, so the target's name must be typed, and both now land in History with their outcome — Cancel Server previously left no entry at all.
- **Change Plan shows a before → after table** (plan, memory, storage, monthly cost ex-GST on both sides) instead of a sentence, and says the server restarts.
- **Guard rails for contributors and agents.** `npm run typecheck` now also runs `scripts/check-mutation-guards.mjs`, which fails CI on a native `confirm()`, a new bespoke confirmation dialog, or any API mutation call whose handler neither confirms nor records to History (per call, not per file; a genuine non-change carries `// history: n/a — reason`). The rules and the fixes are written up in `AGENTS.md` under "Mutations, confirmation and History".
- **Every create and attach now lands in History too.** The guard found ten silent mutations: take backup, add DNS record, add / import SSH key, create load balancer, add a backend, create VPC, attach a server to a VPC, attach / detach a backup drive. Each is recorded before it is submitted and settles to completed or failed.

---

## [1.0.45] - 2026-09-03

### Added
- **Change Plan (Resize) Tab** (*thanks @01ax!*):
  - Added dedicated Change Plan subtab under Server Details driving the `resize` action.
  - Shares pricing and availability calculations (`serverPricing.ts`) with create form, ensuring consistent licensing surcharges and exact mPanel storage ladders.
  - Gracefully displays current plan details even for retired plans (e.g. `a-3040`) with legacy notices.
  - Warns when shrinking memory or storage volumes.
- **Cancel Server Modal** (*thanks @01ax!*):
  - Added guarded `DELETE /v2/servers/{id}` cancellation flow with optional cancellation reason dropdown and free-text input.
  - Requires typing the exact server hostname to confirm irreversible deletion, displays current billing rate, and warns of attached backup removal.
- **Customer-Facing Advanced Features Filter** (*thanks @01ax!*):
  - Filters raw operator-level hypervisor flags (`local-rtc`, `uefi-boot`, etc.) to customer-facing switches with mPanel labels and descriptions.
  - Preserves hidden operator switches when saving (`mergeHiddenFeatures`).
- **Machine Type and VPC Name Display** (*thanks @01ax!*):
  - Formats QEMU machine types cleanly as `pc-i440fx-7.2` rather than raw API enum strings.
  - Displays human-readable VPC network names with network glyphs instead of internal IDs (`VPC #4213`).

---

## [1.0.44] - 2026-09-03

### Fixed
- **Android Mutation Transport Fix** (*thanks @01ax!*):
  - Fixed mobile bridge request extraction where `Request` objects were treated as empty options, causing mutations (power actions, reboots, DNS edits, backups) to be sent as silent `GET` requests instead of `POST`/`PUT`/`DELETE`.
  - Re-enabled deduplication guards on duplicate in-flight submissions.
- **Hardware-Backed Keystore Encryption on Android** (*thanks @01ax!*):
  - Migrated profile and token storage to `@aparajita/capacitor-secure-storage` using AES-GCM keys backed by the Android Keystore.
  - Automatically migrates existing cleartext SharedPreferences tokens and purges unencrypted legacy copies.
  - Set `allowBackup="false"` in Android manifest to prevent token exfiltration via cloud backups.
- **Mobile Safe-Area Insets on All Modals & Drawers** (*thanks @01ax!*):
  - Applied `.overlay-safe` and `.panel-safe` rules across all 16 modal dialogs and side drawers to prevent content overlapping Android status and gesture bars.
- **Mobile Create Server Form & Table Layout** (*thanks @01ax!*):
  - Constrained dialog sizing to `max-h-full` within safe-area boundaries, making the bottom submission buttons and cloud-init inputs fully reachable.
  - Optimized plan table with single-line rows, centred headers, and responsive column widths fitting 412px phone viewports without horizontal drag.
  - Sized distribution tiles and logos responsively for mobile screens.
  - Replaced hover tooltips on blocked plans with tap-friendly inline explanations.
  - Matched storage sizing steps to mPanel's exact dropdown ladder (5 GB to 60, 10 GB to 200, 100 GB to 2000).
- **Status Indicator Dot Deforming**:
  - Added `shrink-0` to circular status indicators across server rows and headers to prevent oval squishing beside wrapping text.
- **Region Filter Completeness**:
  - Pre-seeded region dropdown from `/v2/regions` so all available regions (including ADL, PER, SIN) appear even before servers exist in those locations.

---

## [1.0.43] - 2026-09-02

### Improved
- **Firewall Matrix Pinned Audit & Navigation**:
  - Pinned the **Audit** findings column sticky beside the server name (`left-[220px]`) so findings remain visible while scrolling through wide rule matrices.
  - Enhanced horizontal scrolling with always-visible scrollbar tracks and quick `◀` / `▶` navigation buttons.

---

## [1.0.42] - 2026-09-02

### Added
- **Fleet-wide firewall matrix** (FEATURES.md #2): a "Fleet matrix" view on the Firewall tab — servers down the side, rule signatures (protocol, ports, source) across the top, accept / drop / absent per cell, read from every server four at a time. An audit column flags SSH, RDP, VNC or Docker open to the world (red), database ports open to the world, servers with no rules at all, rules shadowed by a catch-all drop (amber), and sources that are not one of your servers (info). Flagged servers sort first; "Only flagged" narrows to them.
- **Copy ruleset to N servers** from the matrix, with one combined before → after diff per target in the confirm, servers that already match skipped, and one History entry per server written.
- **Server groups and tags**, kept locally per account since the API has none. Tag a server from its matrix row or from the palette (`tag add web wp-*`, `tag remove web #101`); a tag is a group, so `@web` works as a target anywhere the palette takes one (`restart @web`, `backup @db "nightly"`) and as a scope in the matrix. Saved groups can also be a pattern (`wp-web-*,wp-ha-lb`) that keeps matching new servers.
- **Clone firewall rules now shows a true before → after**: it reads the target's current rules first.

### Fixed
- **A failed server-list poll no longer blanks the app.** One transient API error on the 15-second refresh used to replace the server list with an empty one (empty sidebar, tray at 0, empty matrix) until the next poll succeeded. The last good list is kept and the poll retries.
- The Firewall tab now uses the app's server list rather than its own query with a different cache key, so it sees the cold-start cache and the inferred power state.

---

## [1.0.41] - 2026-09-02

### Added
- **Diff-based change review and a local change log** (FEATURES.md #5):
  - **One confirm dialog for every mutation**, replacing sixteen bare `window.confirm()` boxes. It names the target, says in a sentence what will happen, shows a before → after table or a line diff where there is one (firewall rule lists, DNS records, renames, disk sizes, region moves, rebuild images), and carries warnings in amber. Destructive actions get a red button; irreversible ones (rebuild, restore, delete disk, delete VPC, delete load balancer, disable firewall) make you type the target's name. Enter confirms, Esc cancels.
  - **Firewall edits now show the diff** — adding, deleting, reordering, importing and cloning rules all preview the exact rule list that will be written, since every one of them replaces the whole set.
  - **Diagnostics no longer ask "are you sure?"** — ping, uptime and is-running change nothing.
  - **History tab**: every change confirmed in BLDesk, per account, newest first, with what was confirmed and how it ended (submitted / completed / errored / failed / lost track) as reported by the action tracker. Filter by server, action or outcome; expand for the diff; clear from the same view. Stored on this machine under `<userData>/changelog/`, never sent anywhere. Palette commands are logged too and marked with a ⚡.

---

## [1.0.40] - 2026-09-02

### Added
- **Rebuilt Create Server Form to Match mPanel Flow** (*thanks @01ax!*):
  - Restructured into three numbered sections: Location & OS, Resources & Plan, and Settings & Deployment.
  - **Distribution Tiles & Version Hierarchy**: Interactive distro tiles with greyscale-to-color transitions and versions sorted newest-first with long-term releases ahead of variants.
  - **Full Pagination for Images & Sizes**: Replaced unpaged API endpoints with `fetchAllPages`, revealing all 27 OS distributions and all 21 compute plans.
  - **Accurate Licensed Image Pricing**: Integrated OS surcharges (Windows Server per-MB memory licensing caps and cPanel flat bases) into displayed monthly totals with GST breakdown.
  - **Live Availability & Capacity Reasons**: Surfaces exact plan availability and out-of-stock reasons per region rather than failing at submission.
  - **Expandable Settings View**: Configurable VPC networking, SSH keys (with MASTER key pre-selected and inline creation), extra IPv4 addresses, backup frequencies, and cloud-init scripts.
  - **Modal Portal Rendering**: Rendered create dialog through `createPortal` into `document.body` for pristine full-viewport backdrop dimming.

---

## [1.0.39] - 2026-09-02

### Added
- **Tray / menu bar that earns its spot** (FEATURES.md #3):
  - **Live fleet counts** in the tray tooltip and menu (running / off / other / actions in progress, prepaid credit); on macOS a `↻N` title appears beside the icon only while actions are running.
  - **Servers submenu** — every server with Open in BLDesk, Copy IP and SSH as root, straight from the tray.
  - **Things that need you, surfaced**: actions BinaryLane has paused on a question (including ones started from mPanel or another machine) and invoices whose payment failed get their own menu lines that open the right view, a notification when they appear, and on macOS a `!N` beside the icon until dealt with.
  - **Native notifications** when a server changes state, appears or disappears (diffed against the first live fetch, never the local cache), when a tracked action completes, fails or pauses for a question, and when prepaid credit drops below $20 AUD or a payment fails. Each category can be muted from the tray's Settings submenu.
  - **Keep running in tray when the window is closed** (on by default, with a one-time notice the first time it hides) and **Launch at login** (macOS/Windows), both toggled from the tray.
  - **Check for updates** from the tray on packaged builds.

- **Client-side power state**: the API's `status` never turns `off`, so BLDesk now infers power state itself. A read-only sweep every two minutes reads each server's latest performance sample; a server whose latest five-minute bucket is more than 15 minutes old is shown as Stopped. Samples are produced host-side only while the VM runs, so this also catches `sudo poweroff` inside the guest, which nothing else can see. After a power action settles, one `is_running` diagnostic asks the hypervisor directly and the toast reports "Server is off" / "Server is running" — or calls out a shutdown the OS ignored. The status pill's tooltip says where its verdict came from and what the API claims.

### Fixed
- **Server details header went stale**: the view read status from the object clicked in the list, so a server shut down from its own page kept saying "Running" until re-opened. It now follows the live server list.
- **Palette no longer gates power verbs on `active`/`off`.** The API was observed leaving a server at `active` after a completed hard power-off, so `start` would have skipped a server that was really off. Only `new` and `archive` are skipped now; BinaryLane rejects genuine no-ops and the palette reports that per target.
- **"Shutdown completed" no longer implies the server is off.** BinaryLane completes a `shutdown` action when the ACPI signal is delivered, within seconds, whether or not the OS halts. The toast and notification now say "signal sent" and point at Power off if the server stays running; the "is now off" notification remains the real confirmation.

---

## [1.0.38] - 2026-09-02

### Added
- **Verb-first Command Palette** (FEATURES.md #4): `Cmd+K` now accepts commands, not just nouns.
  - **Fleet actions with glob targets**: `restart wp-*`, `shutdown jumpbox,db-1`, `start #12345`, `cycle 43.224`, `backup web "pre-upgrade"`. Targets accept a name or prefix, a glob (`*`/`?`), `#id`, an IPv4 or IPv4 prefix, or a comma-separated mix.
  - **Status-aware preview**: servers that can't take the action (already off / already running) are shown as skipped with the reason, and patterns that match nothing are called out, before anything is submitted.
  - **Review step**: every mutating command shows the exact target list and needs a second `Enter` to run; submissions go one at a time and each is handed to the background action tracker, so outcomes arrive as toasts.
  - **Navigation verbs**: `ssh <server|ip>`, `console <server>`, `open <server> [network|firewall|…]`, `link <server>` (copies a `bldesk://` link), `go dns`.
  - **DNS from the keyboard**: `dns add A foo.example.com 203.0.113.9` resolves the hosted zone by longest suffix; MX/SRV require a priority.
  - **Recent commands**, verb suggestions while typing, `Tab` to fill a server name, and `?` for the full list. The old fuzzy server/tab search still works when the query doesn't start with a verb.

---

## [1.0.37] - 2026-09-02

### Fixed
- **Windows NSIS Auto-Updater Relaunch Target** (*thanks @01ax!*):
  - Configured custom NSIS installer script (`nsis/installer.nsh`) overriding `$launchLink` to target `$INSTDIR\${APP_EXECUTABLE_FILENAME}` directly instead of the Start Menu shortcut link.
  - Fixes missing shortcut error dialogs upon restart after applying auto-updates on Windows 11.
- **Linux Package Maintainer Metadata**:
  - Updated `author` in `package.json` with an explicit email address (`support@binarylane.com.au`) to satisfy Debian package control metadata requirements and enable clean Linux `.deb` packaging.

---

## [1.0.36] - 2026-09-02

### Fixed
- **Mobile Responsive Layout & Safe Area Insets**:
  - **TitleBar Mobile Uncluttering**: Resolved header overlap and colliding badges on small screens by removing duplicate version pills, making brand titles responsive, and optimizing profile selector widths.
  - **Android Status Bar & Safe Areas**: Added viewport-fit support and safe-area top/bottom insets (`pt-[env(safe-area-inset-top)]` on titlebar, `pb-[env(safe-area-inset-bottom)]` on bottom nav) to prevent Android status bar clock/icons from overlapping the UI.
  - **Horizontal Table Scrolling**: Changed server list table container from `overflow-hidden` to `overflow-x-auto` to prevent column text clipping on mobile displays.

---

## [1.0.35] - 2026-09-02

### Added
- **Full Domain List Pagination & DNS Suite** (*thanks @01ax!*):
  - **Full Multi-Page Domain Paging**: Fetches all hosted DNS zones (supporting 144+ domains) with 25-per-page client controls and live search filtering.
  - **Zone Delegation Status**: Displays **Live** vs **Not in use** status indicators by verifying domain delegation against BinaryLane authoritative nameservers.
  - **Domain Context Menu**: Right-click actions to copy domain name, copy nameservers, copy BIND zone file, or launch mPanel.
  - **Guarded Zone Deletion Modal**: Deleting DNS hosting now requires typing the domain name, shows affected record counts, and includes a 1-click zone file backup button.

### Fixed
- **Profile Vault & Key Updating** (*thanks @01ax!*):
  - **Profile Key Replacement**: Added explicit "Update key" flow to replace tokens for existing profiles without creating duplicate entries.
  - **Refuse Duplicate Name Overwrites**: Refuses saving a new profile under an existing name to prevent accidental token overwrites.
  - **Auth Error Banner Reset**: Automatically dismisses stale 401 authentication failure banners when switching to a working profile.
  - **API Token Link**: Pointed token creation link to `/api-info` (fixing 404 from `/api-tokens`).

---

## [1.0.34] - 2026-09-02

### Fixed
- **Android In-Place APK Upgrade & Keystore Signing**:
  - Replaced dynamic debug signing with a permanent, consistent Android signing keystore (`bldesk.keystore`) across all release builds.
  - Fixes Android package signature mismatch (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`), enabling seamless in-place APK upgrades without requiring an uninstall or losing account tokens and profiles.

---

## [1.0.33] - 2026-09-02

### Added
- **Android In-App Update Detection & APK Downloading**:
  - Automatically checks GitHub Releases API for newer Android APK builds on launch and on demand.
  - Compares semantic versions against `currentVersion` (`v1.0.33`).
  - Displays prominent update pill in title bar and popover with one-click **"Download APK"** button that directly grabs `BLDesk-android.apk` from GitHub Releases.
  - Supports switching between **Stable** and **Beta** update channels on mobile.

---

## [1.0.32] - 2026-09-02

### Added
- **Truthful Async Server Action Tracking & Toast Engine** (*massive props to @Freewheelin!*):
  - **4-Tier Async Architecture**: Long hypervisor operations (`rebuild`, `change_region`, `resize_disk`, `take_backup`, `restore`) no longer falsely report "complete" at queue time; they now track in the background and confirm when finished.
  - **`ActionTrackerContext` & Floating Toast Host (`ActionToasts.tsx`)**: Zero-dependency floating toast stack reporting live step descriptions (e.g. *"Backup of SYSTEM: 38.5GB of 40.0 GB (310MB/s) - less than 1 min remaining"*), completion state, or failure reasons.
  - **Adaptive Polling Cadence**: Smart polling easing (3s for first 30s → 8s up to 2m → 15s thereafter) to prevent server request spam.
  - **Operator Interaction Handling (`user_interaction_required`)**: Properly detects when an action is paused waiting for user confirmation (e.g. `allow-unclean-power-off`) and surfaces `ActionInteractionPrompt.tsx` instead of timing out.
  - **Invoice Block Detection (`blocking_invoice_id`)**: Detects actions blocked by unpaid invoices and alerts the user immediately.
- **Fixed Diagnostics & Uptime Reporting** (*thanks @Freewheelin & @01ax!*):
  - Fixed ping and uptime diagnostics by reading `result_data` and `error_message` (replacing previous permanent "in-progress" display).
  - Clarified guest ping diagnostics vs real host node uptime.

### Fixed
- **Usage Charts Scaling & 24-Hour Paging** (*thanks @01ax!*):
  - Paginates `GET /v2/samplesets` to retrieve all 288 samples for the full 24-hour window rather than dropping the last 7 hours at the 200-sample limit.
  - Fixed mixed-unit axes on Activity Overview with independent series scaling (`scaleBy="series"` vs `scaleBy="unit"`).
  - Handles absent memory reporting agents (`memory_usage_bytes === 0`) by displaying a helpful information banner linking to setup documentation rather than asserting 0 GB usage.
- **Billing Details Links** (*thanks @01ax!*):
  - Pointed "Change billing details" buttons directly to `/billing/payment-details`.

---

## [1.0.31] - 2026-09-02

### Added
- **Account Details Tab** (*thanks @01ax!*):
  - Dedicated **Account Details** tab in the sidebar displaying account metadata (`GET /v2/account`):
    - Email address with verified/unverified status badge.
    - Account status, tax code, 2FA enabled status, and additional IPv4 limits.
    - Configured payment method indicators.
    - Direct web links for password changes, API token management, 2FA setup, and contact details.
- **Tabbed Billing & Invoices Suite** (*thanks @01ax!*):
  - Reorganized the Billing interface into 3 mPanel-style tabs:
    - **Invoices**: Full server-side pagination (`page` and `per_page`) with previous/next controls, fixing previous truncation where only 20 invoices were visible.
    - **Pending Charges**: Itemized breakdown of unbilled charges (`balance.charges[]`) with descriptions, dates, status, and running totals.
    - **Payment Details**: Configured payment method status, PayPal manual payment guidance, and update links.
  - **Unpaid Invoice Alert Banner**: Prominent banner displayed when payment failed invoices require attention.

### Fixed
- **Windows Portable / NSIS Artifact Collision** (*thanks @01ax!*):
  - Assigned explicit `artifactName` for the Windows `portable` target (`BLDesk-${version}-${os}-${arch}-portable.exe`) so it no longer overwrites the NSIS installer executable during multi-target packaging.
- **Honest Auto-Updater Reporting** (*thanks @01ax!*):
  - Introduced `check-failed` status (grey *"Couldn't check"* pill with error details in dropdown) for unreachable feeds or missing manifests, preventing false green *"Up to date"* indications when update checks fail.

---

## [1.0.30] - 2026-09-02

### Added
- **Deep Links (`bldesk://`) Protocol Handler**:
  - Registered `bldesk://` OS protocol handler across Windows (Registry), macOS (`CFBundleURLTypes`), and Linux (`.desktop`).
  - Direct deep linking grammar support:
    - `bldesk://server/<id>[/<subtab>]` — Jump straight to any server and sub-tab.
    - `bldesk://console/<id>` — Launch the rescue console window directly.
    - `bldesk://ssh/<id>` — Launch native SSH terminal connection.
    - `bldesk://tab/<name>` — Open top-level navigation tabs (`vpcs`, `firewall`, `dns`, `backups`, etc.).
    - `?account=<name or email>` — Switch profile automatically before navigating.
- **Server Row Context Menu**:
  - Right-click context menu on server rows with quick actions (Open, SSH, Copy IP, Copy `bldesk://` Link, Copy Console Link, Reboot, Shutdown, Power on).
- **Copy Link Buttons**:
  - Quick copy link icon on server rows and **Copy link** button in Server Details header.
- **Documentation**:
  - Added [`docs/DEEP_LINKS.md`](docs/DEEP_LINKS.md) detailing deep link architecture, routing lifecycle, and usage.

---

## [1.0.29] - 2026-09-02

### Fixed
- **ESM / CommonJS Interoperability**: Fixed `SyntaxError: Named export 'autoUpdater' not found` by adding dynamic getter resolution for `electron-updater` in Node.js ESM.
- **Auto-Updater 404 Resilience**: Gracefully handle missing GitHub Release manifests as "Up to date" check instead of throwing uncaught UI error dialogs.
- **Windows Tray Icon**: Added `.ico` fallback for Windows notification tray initialization to prevent platform crashes.
- **Window Display Robustness**: Added `did-finish-load` fallback event listener to guarantee main window visibility on startup.

### Added
- **Prominent Version Indicators**: Display running app version (`BLDesk v1.0.X`) in the top-left titlebar header, auto-update pill, and sidebar footer.

---

## [1.0.28] - 2026-09-02

### Added
- **Cross-Platform Auto-Updates (`electron-updater`)**:
  - In-app silent background update checks every 6 hours and on launch.
  - Multi-OS GitHub Release publishing (`latest.yml`, `latest-mac.yml`, `latest-linux.yml`, and blockmaps).
  - Title bar `UpdateMenu` with manual "Check now" button, channel selector, progress bar, and "Restart to update" pill.
  - Channel switching between **Stable** and **Beta** channels with persistent state in user configuration.
- **Developer Documentation**:
  - Added [`AGENTS.md`](AGENTS.md) and [`docs/AUTO_UPDATE.md`](docs/AUTO_UPDATE.md).

---

## [1.0.27] - 2026-09-01

### Added
- **Backup Downloads**:
  - Direct hypervisor disk image downloading and action tracking for backups.
  - Automatic rotation of oldest temporary backups.
- **OS Distribution Logos**:
  - Added official vector logos for AlmaLinux, Debian, Fedora, FreeBSD, KDE Neon, openSUSE, Rocky Linux, Ubuntu, Windows, and BYO.
- **Server Details Enhancements**:
  - Enhanced network, usage, settings, and metrics views.

---

## [1.0.26] - 2026-08-27

### Added
- **Terminal Launching**:
  - macOS Terminal.app and Linux emulator environment configurations.
  - Inline terminal launcher and command generation helper.
