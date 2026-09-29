# GUI test harness

Runs the real app against a fake BinaryLane API, signed in with a fictitious token, so every screen can be driven and inspected without a BinaryLane account. It is a manual tool, not part of CI: it needs Electron and a display.

Nothing here can reach the real API. The app's hostnames resolve to a local mock and every other host fails to resolve. The token is random, made per run, and only the mock accepts it. Your own BLDesk settings and vault are never touched: each run uses its own data directory under your temp folder.

## Requirements

- Node 22 and a build (`npm run build`), or an installed BLDesk (`--bin`).
- OpenSSL, once per run, to make a throwaway certificate for the mock (Git for Windows includes one; set `OPENSSL` if it isn't on your PATH).
- Playwright is not an application dependency. Point `BLDESK_PLAYWRIGHT_MODULE` at the absolute path of its entry module, for example `/path/to/node_modules/playwright-core/index.mjs`, or install `playwright-core` where Node can resolve it. Not needed if you only start the app and look at it.

## Quick start

```sh
npm run build
node scripts/gui-test/launch.mjs                       # mock API + the app from this checkout
node scripts/gui-test/signin.mjs                       # signs in through the real token dialog
node scripts/gui-test/launch.mjs --stop                # when finished
```

Backup-model regressions can also run without Electron or Playwright:

```sh
node --test scripts/gui-test/mock.test.mjs
```

This starts a local HTTP mock on a free port with a fictitious token, then stops it. It checks plan backup options, per-server ownership, free and full slots, replacement strategies, locked/attached images, failed actions and reset.

`launch.mjs` options: `--name NAME` (run several at once; default `default`), `--mock-port` (8443), `--cdp-port` (9333), `--bin PATH` (an installed BLDesk instead of this checkout, to test the packaged app with its production CSP), `--mock-only`, `--http`, `--stop`. Everything for a run, including the mock log (`mock.log`, every request with its body), the app log and screenshots, is in `<tmp>/bldesk-gui-test/NAME/`.

On Linux the app is started with `--password-store=basic`, so it never touches your keyring; the sign-in dialog then shows the "no keyring" warning and the script ticks "save without encryption". That warning screen is itself worth a look.

## Driving it

`lib.mjs` exports what the scripts use, so your own Playwright scripts can too: `loadState(name)`, `connect(state)` (returns `{browser, ctx, page, problems, state}`; `problems` collects console errors and page exceptions), `shot(page, state, name)`, `layoutReport(page)` and `setViewport(page, w, h)`. Electron has no window-resize command over CDP, so sizes are emulated; at a 1280px window, 80% zoom is about 1600 css px, 125% about 1024 and 150% about 853. `layoutReport` flags horizontal page scroll, text such as "undefined" or "NaN", elements past the right edge, and overflowing text; it can't tell a clipped element from one inside a scrollable container, so confirm with a screenshot. `sheet.mjs OUT.png a.png b.png ...` builds a contact sheet so one look covers several screenshots.

## The mock

Responses are generated from `openapi.json`, then overridden with fleet data, so field names and shapes follow the public reference. Most request bodies are not validated; backup requests check slot availability, the replacement strategy, ownership and locked/attached images. Read the bodies in `mock.log` and compare them with the spec, which is how wrong field names show up.

Plan backup pricing follows the public sizes snapshot reported in [#198](https://github.com/termau/bldesk/issues/198) on 2026-09-29: no included daily, weekly or monthly backups; $0.05 per backup per GB and $0.05 per offsite copy per GB; `daily_per_gigabyte`, `weekly_per_gigabyte` and `monthly_per_gigabyte` frequency costs all zero. The fleet and other plan figures remain fictitious.

Fixture fleet (28 servers, more than 20 so paging is exercised):

- 8100-8117: the "Atlas" fleet across syd/bne/mel, VPCs 901-903, load balancers 950-952.
- 9001 `win-app-01`: Windows Server 2022 with a data disk and licences. 9002 `legacy-gs1`: on a retired plan. 9003 `stopped-batch-01`: off, no backups. 9004 `vpc-only-01`: no public IPv4. 9005 `building-01`: status new. 9006/9007: an HA pair. 9008: a very long name. 9009: three public IPv4s, IPv6 and a failover IP. 9010 `cpanel-host-01`.
- Regions syd, bne, mel, per, sin and an unavailable adl. Sizes `std-min` to `std-8vcpu` (`std-8vcpu` includes 340 GB, which is off the valid storage steps), a CPU Optimised size with restricted disk values, and the retired `a-3040` (returned only in the resize list of a server on it). Stock is per operating system: a Windows image makes `std-6vcpu` and `std-8vcpu` out of stock in bne, an Ubuntu image makes 4 vCPU and up out of stock in mel.
- Seven images (Linux, Windows, Windows with SQL, cPanel), 4 SSH keys, 3 domains with every record type, 27 invoices (the newest unpaid), and backups with distinct IDs and state per server. Each server with a schedule starts with a temporary, daily, weekly and monthly image; `backup_info` identifies its actual slot type, originating server and disks.

Actions complete after about 2.5 seconds. Power actions, resize, taking/attaching/detaching backups and firewall writes change the mock's state; other server settings (rename, add disk, and so on) complete without changing anything.

`take_backup` uses the server's selected retention counts for scheduled slots. `none` needs a free slot; `oldest` and `newest` use a free slot first, then replace the selected unlocked, unattached image of that type; `specified` replaces a named image belonging to that server and inherits its slot type. Taking a temporary backup requires no scheduled retention. Temporary images are not automatically expired by the mock. Image GET/PUT supports inspecting backup metadata, renaming images and locking/unlocking scheduled images; attaching an image protects it from replacement until it is detached.

Control endpoints (POST JSON to the mock, for example `curl -sk -X POST -d '{"empty":true}' https://127.0.0.1:8443/__mock/config`):

- `/__mock/config`: `{"empty":true}` an account with nothing in it; `{"rejectAuth":true}` every call returns 401; `{"unpaid":true}` the unpaid-invoice banner; `{"actionMs":8000}` slower actions; `{"actionOutcome":"errored"}` actions fail with an error message; `{"latencyMs":1500}` slow responses.
- `/__mock/config` `{"updateVersion":"1.0.62-beta.9"}` also offers a newer version through the mock GitHub feed, so a packaged app (`--bin`) finds, downloads and shows "Restart to update". The download is a stand-in file, not a real package: do not click Restart against a real `pkexec`, which would ask for your password and try to install it. To test the install path, put a stand-in `pkexec` that just sleeps and exits 0 first on the app's `PATH`. A build made with `electron-builder --dir` also needs a `resources/package-type` file containing `deb`, or electron-updater treats it as an inactive AppImage and the check never finishes.
- `/__mock/fail`: `{"match":"advanced_firewall","status":500,"count":3}` injects HTTP errors (500, 429...) on paths matching a regex.
- `/__mock/reset`: restore the fixtures.

Not app bugs: usage graphs are synthetic (CPU can exceed 100% on multi-vCPU servers), billing's Pending Charges are empty, console links open a stub page, help answers are canned, and the embedded SSH terminal has nowhere to connect.

## Android

The Android app is the same UI over Capacitor's HTTP layer, and its API address is fixed in the code, so testing it needs a throwaway build:

1. `node scripts/gui-test/launch.mjs --name android --mock-port 8445 --mock-only --http`. The mock listens on the host's loopback, which the emulator reaches as `10.0.2.2`.
2. In a throwaway copy (`git worktree add --detach ../bldesk-android-gui main`, then link or install `node_modules`), make three test-only edits: in `src/renderer/src/api/client.ts` set `baseUrl` to `http://10.0.2.2:8445`; in `electron.vite.config.ts` add `http://10.0.2.2:8445` to the CSP `connect-src`; in `android/app/src/main/res/xml/network_security_config.xml` add `<domain-config cleartextTrafficPermitted="true"><domain includeSubdomains="false">10.0.2.2</domain></domain-config>`. Do not commit these; they exist only so the unmodified app code talks to the mock.
3. Build: `npm run build && npx cap sync android && touch android/capacitor-cordova-android-plugins/cordova.variables.gradle && (cd android && ./gradlew assembleDebug)`, then `adb install -r android/app/build/outputs/apk/debug/app-debug.apk` on an emulator.
4. Sign in by tapping the fields and typing the token from `<tmp>/bldesk-gui-test/android/token.txt` with `adb shell input text`. The debug WebView can be inspected (`adb forward tcp:9335 localabstract:webview_devtools_remote_<pid>`); Playwright can't attach to an Android WebView, so use `adb exec-out screencap -p` and a small raw CDP client (Node 22 has a global `WebSocket`).
5. Remove the worktree afterwards (`git worktree remove --force ../bldesk-android-gui`).

`mock.log` shows every request, which is the quickest way to check what a tap actually sent (for example, how many DELETEs one tap produced).
