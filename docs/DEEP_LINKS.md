# BLDesk Deep Links — `bldesk://` Scheme

BLDesk registers itself as the OS handler for `bldesk://` URLs. A link pasted into a support ticket, a chat, a runbook or a browser address bar opens BLDesk (launching it if needed), switches to the right account, and lands on the right server / tab / console.

This also covers the "usability polish" items from FEATURES.md #12 that sit on the same plumbing: **Copy link** buttons and a **right-click context menu** on server rows.

---

## URL grammar

| Link | Effect |
|---|---|
| `bldesk://server/<id>` | Open the server's overview |
| `bldesk://server/<id>/<subtab>` | Open a sub-tab: `overview`, `remote-access`, `usage`, `network`, `backups`, `firewall`, `settings`, `recovery` |
| `bldesk://console/<id>` | Open the server, then pop the out-of-band rescue console window |
| `bldesk://ssh/<id>` | Open the server and launch native SSH (`root@<primary IPv4>`) |
| `bldesk://tab/<name>` | Jump to a top-level tab: `servers`, `vpcs`, `firewall`, `loadbalancers`, `dns`, `backups`, `keys`, `billing`, `terminal` |
| `bldesk://home` (or bare `bldesk://`) | Just bring the window to the front |

Any link accepts `?account=<profile name or email>`. If a saved profile matches (case-insensitive on name or email), BLDesk switches to it before routing. If nothing matches it logs a warning and uses the active profile.

```
bldesk://server/12345/firewall?account=user%40example.com
```

Unknown hosts, non-numeric ids, unknown sub-tabs (silently dropped → overview), and anything not starting with `bldesk:` are rejected by the parser; nothing user-controlled reaches a shell or a file path.

---

## Files

### New

| File | Purpose |
|---|---|
| `src/shared/deeplink.ts` | `DeepLink` type, `parseDeepLink`, `formatDeepLink`, `findDeepLinkInArgv`. Shared by main and renderer — one grammar, one parser |
| `src/main/deeplink.ts` | `DeepLinkManager` — OS registration (`app.setAsDefaultProtocolClient`), macOS `open-url`, Windows/Linux argv on cold start and `second-instance`, queueing until the renderer is listening |
| `src/renderer/src/lib/deeplinks.ts` | `useDeepLinkRouter()` hook (subscribes, waits for profile/client/servers, then acts), `copyDeepLink()`, `primaryIpv4()` |
| `src/renderer/src/components/servers/ServerContextMenu.tsx` | Right-click menu for a server row: Open, SSH, Copy IP, Copy link, Copy console link, Reboot / Shutdown / Power on |
| `docs/DEEP_LINKS.md` | This file |

### Modified

| File | Change |
|---|---|
| `package.json` | `build.protocols` — makes the NSIS installer write the registry keys, adds `CFBundleURLTypes` to the macOS bundle, and `x-scheme-handler/bldesk` to the Linux `.desktop` MimeType |
| `src/main/index.ts` | Imports `DeepLinkManager`; calls `register()` **before** `whenReady` (required for cold-start `open-url` on macOS); passes `argv` from `second-instance`; adds `deeplink:getPending` / `deeplink:ready` IPC; resets on window close |
| `src/preload/index.ts` | Exposes `getPendingDeepLink`, `deepLinkReady`, `onDeepLink` |
| `src/shared/ipc-types.ts` | Adds the three methods to `IpcApi` |
| `src/renderer/src/api/mobile-bridge.ts` | Stubs: reads a `#bldesk://…` hash on web; `onDeepLink` is a no-op on Android for now |
| `src/renderer/src/App.tsx` | Mounts `useDeepLinkRouter` with the existing profile / server / tab state |
| `src/renderer/src/components/servers/ServerDetails.tsx` | `#id` + **Copy link** button in the header (copies the current sub-tab) |
| `src/renderer/src/components/servers/ServerList.tsx` | Link icon in the Actions column; `onContextMenu` on each row rendering `ServerContextMenu` |

### IPC surface

| Channel | Direction | Payload |
|---|---|---|
| `deeplink:getPending` | invoke | → `string \| null` — one-shot read of a link that arrived before the renderer mounted |
| `deeplink:ready` | invoke | renderer is subscribed; main flushes anything queued |
| `deeplink:open` | main → renderer | `string` — the raw URL |

---

## How delivery works per platform

**macOS.** The OS sends `open-url` to the running app, or launches it and sends `open-url` shortly after. That event can fire before `app.whenReady`, so `DeepLinkManager.register()` is called at module load, not inside `whenReady`.

**Windows / Linux.** The OS launches `BLDesk.exe bldesk://…`. Because the app holds the single-instance lock, a second launch is collapsed into a `second-instance` event on the already-running process, with the new `argv`. On a cold start the URL is in `process.argv`.

**Development.** With `npm run dev`, Electron itself is the executable, so `setAsDefaultProtocolClient` is called with `process.execPath` and the script path so the OS launches the right thing. On Windows this writes `HKCU\Software\Classes\bldesk` pointing at `electron.exe`; a packaged install later overwrites it with the real path. On macOS, dev-mode registration only works from a packaged `.app` — test links against `npm run build:unpack` output instead.

**Renderer timing.** The window may not exist, or React may not have mounted, when a link arrives. Main queues it; the renderer calls `getPendingDeepLink` on mount and `deepLinkReady` to flush. The router hook then holds the parsed link in state until the profile has switched (if `?account=` asked for it), a client exists, and the server list has loaded — so a link that cold-starts the app behaves exactly like one clicked while it's open.

---

## Steps to implement

1. **Sync dependencies** — nothing new was added. `npm install` is not required.

2. **Typecheck and run**
   ```bash
   npm run typecheck
   npm run dev
   ```
   Right-click a server row → context menu. Open a server → **Copy link** in the header. Paste anywhere to see `bldesk://server/<id>`.

3. **Test delivery on Windows (dev)**
   With `npm run dev` running, open a second terminal:
   ```powershell
   Start-Process "bldesk://server/12345"
   ```
   The running app should come to the front and open that server. Cold-start: quit the app, run the same command — Electron launches with the script and routes after load.

4. **Test delivery packaged**
   ```bash
   npm run build:unpack
   ```
   Run the unpacked app once (registers the scheme), then from a browser address bar or `Start-Process` / `open` / `xdg-open` try:
   - `bldesk://tab/dns`
   - `bldesk://server/<id>/network`
   - `bldesk://console/<id>`
   - `bldesk://ssh/<id>`
   - `bldesk://server/<id>?account=<other profile name>`

5. **Release** — tag as usual. The NSIS installer registers the scheme on install; the macOS DMG bundle carries it in `Info.plist`; the AppImage/deb `.desktop` file declares it (AppImage users may need `update-desktop-database` or a re-login before `xdg-open` honours it).

---

## Follow-ups

- **Android**: add an `intent-filter` for `bldesk` in `android/app/src/main/AndroidManifest.xml` and wire `@capacitor/app`'s `appUrlOpen` event into `onDeepLink` in `mobile-bridge.ts`. The parser and router are already platform-agnostic.
- **Command palette**: add "Copy link to <server>" and accept a pasted `bldesk://` URL as a palette query.
- **Universal links** (`https://link.binarylane.com.au/server/123` falling back to mPanel if BLDesk isn't installed) need an `apple-app-site-association` / `assetlinks.json` on a BinaryLane domain plus Windows "web-to-app" registration — worth it once the app is public, since a plain `bldesk://` link is a dead click for anyone without the app.
- **Confirm dialogs**: the context menu's Reboot / Shutdown / Power on reuse the existing `window.confirm` flow in `ServerList.handleAction`; they'll pick up the proper confirm modal (FEATURES.md #5) when that lands.
