/**
 * electron-builder afterPack hook (Linux only).
 *
 * Chromium decides how to sandbox before Electron runs any of our JS, so a
 * `--no-sandbox` from app.commandLine.appendSwitch() is too late: on Ubuntu
 * 23.10+ (kernel.apparmor_restrict_unprivileged_userns=1) an AppImage aborts
 * in setuid_sandbox_host before main.js executes. The only place to add the
 * flag is the command line itself. So the packaged executable becomes a tiny
 * launcher that checks the kernel setting and execs the real binary — with
 * `--no-sandbox` only when running as an AppImage on such a kernel. Installed
 * .deb users get an AppArmor profile instead (see linux/after-install.sh) and
 * keep the full sandbox; the launcher passes them straight through.
 */
const { chmodSync, existsSync, renameSync, writeFileSync } = require('fs')
const { join } = require('path')
const { execFileSync } = require('child_process')
const { FuseVersion, FuseV1Options } = require('@electron/fuses')

/*
 * Electron fuses, flipped in the packaged binary so another program cannot
 * use BLDesk's trusted executable as a general-purpose Node or debugger host
 * (ELECTRON_RUN_AS_NODE, NODE_OPTIONS, --inspect), and so the app code is only
 * ever loaded from app.asar.
 *
 * Left alone on purpose:
 * - GrantFileProtocolExtraPrivileges stays on. The UI is an ES-module page
 *   loaded from file://, which needs it; turning it off first needs the app
 *   served from its own protocol.
 * - EnableEmbeddedAsarIntegrityValidation stays off until the macOS and
 *   Windows builds are signed, since a missing or stale integrity hash stops
 *   the app starting.
 *
 * Flipped here rather than through electron-builder's `electronFuses` option:
 * that runs after this hook, and on Linux the executable is by then the
 * launcher script below, not Electron. On macOS only the final universal app
 * is flipped (the per-arch temp builds are merged into it), and flipping
 * breaks the ad-hoc signature, so it is reset and then verified - an
 * unverifiable app will not launch on Apple Silicon.
 */
const FUSES = {
  version: FuseVersion.V1,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.OnlyLoadAppFromAsar]: true
}

async function applyFuses(context) {
  const platform = context.electronPlatformName
  if (platform === 'darwin' && context.appOutDir.endsWith('-temp')) return
  await context.packager.addElectronFuses(context, { ...FUSES, resetAdHocDarwinSignature: platform === 'darwin' })
  if (platform === 'darwin') {
    const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
    execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
    console.log('  • fuses flipped and ad-hoc signature verified:', app)
  }
}

const LAUNCHER = `#!/bin/bash
# BLDesk launcher — see scripts/after-pack.cjs for why this exists.
HERE="$(dirname "$(readlink -f "$0")")"
if [ -n "$APPIMAGE" ] && [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = "1" ]; then
  # AppImage on a kernel that denies user namespaces to unconfined binaries:
  # Chromium's setuid fallback can't live in a FUSE mount, so run unsandboxed.
  exec "$HERE/bldesk.bin" --no-sandbox "$@"
fi
exec "$HERE/bldesk.bin" "$@"
`

exports.default = async function afterPack(context) {
  const resourcesDir = context.resourcesDir || (
    context.electronPlatformName === 'darwin'
      ? join(context.appOutDir, 'BLDesk.app', 'Contents', 'Resources')
      : join(context.appOutDir, 'resources')
  )
  if (resourcesDir && existsSync(resourcesDir)) {
    require('./verify-pty-package.cjs')(resourcesDir, context.electronPlatformName)
    const updateYml = join(resourcesDir, 'app-update.yml')
    if (!existsSync(updateYml)) {
      writeFileSync(updateYml, 'owner: termau\nrepo: bldesk\nprovider: github\nupdaterCacheDirName: bldesk-updater\n')
    }
  }

  // Before the Linux launcher swap below: fuses live in the Electron binary.
  await applyFuses(context)

  if (context.electronPlatformName !== 'linux') return
  const dir = context.appOutDir
  const real = join(dir, 'bldesk')
  const bin = join(dir, 'bldesk.bin')
  if (existsSync(bin)) return // already wrapped (second target on the same output)
  if (!existsSync(real)) throw new Error(`afterPack: expected ${real} to exist`)
  renameSync(real, bin)
  writeFileSync(real, LAUNCHER, { mode: 0o755 })
  chmodSync(real, 0o755)
  console.log('  • wrapped bldesk → launcher + bldesk.bin (conditional --no-sandbox for AppImage on restricted kernels)')
}
