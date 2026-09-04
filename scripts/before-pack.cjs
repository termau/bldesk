/**
 * Refuse to package a bundle under the wrong application identity. This makes
 * the build flavor and electron-builder metadata one fail-closed unit, even if
 * somebody invokes electron-builder directly after a different kind of build.
 */
const { readFileSync } = require('fs')
const { join } = require('path')

const IDENTITIES = {
  'com.termau.bldesk': {
    flavor: 'production',
    productName: 'BLDesk',
    packageName: 'bldesk'
  },
  'com.termau.bldesk.localdev': {
    flavor: 'local',
    productName: 'BLDesk Local Dev',
    packageName: 'bldesk-local-dev'
  }
}

function targetNames(target) {
  if (typeof target === 'string') return [target]
  if (target && typeof target === 'object' && typeof target.target === 'string') return [target.target]
  return []
}

exports.default = async function beforePack(context) {
  const appInfo = context.packager.appInfo
  const identity = IDENTITIES[appInfo.id]
  if (!identity) throw new Error(`beforePack: unreviewed application id ${appInfo.id}`)

  const markerPath = join(context.packager.projectDir, 'out', 'main', 'build-flavor.json')
  let marker
  try {
    marker = JSON.parse(readFileSync(markerPath, 'utf8'))
  } catch {
    throw new Error('beforePack: missing or invalid compiled build-flavor marker; rebuild before packaging')
  }
  if (
    !marker ||
    Object.keys(marker).length !== 1 ||
    marker.flavor !== identity.flavor ||
    appInfo.productName !== identity.productName ||
    appInfo.name !== identity.packageName
  ) {
    throw new Error('beforePack: compiled flavor and package identity do not match')
  }

  const config = context.packager.config
  if (identity.flavor === 'local') {
    if ((config.protocols?.length ?? 0) !== 0 || config.publish != null) {
      throw new Error('beforePack: local packages must not declare protocols or update publishers')
    }
    const localTargets = {
      win32: ['nsis', 'portable'],
      darwin: ['dmg', 'zip'],
      linux: ['AppImage', 'deb']
    }[context.electronPlatformName]
    const configured = (context.packager.platformSpecificBuildOptions.target ?? []).flatMap(targetNames)
    if (!localTargets || configured.some((target) => !localTargets.includes(target))) {
      throw new Error('beforePack: local packages may use only non-installing artifact targets')
    }
  } else {
    const schemes = (config.protocols ?? []).flatMap((protocol) => protocol.schemes ?? [])
    if (!schemes.includes('bldesk') || config.publish == null) {
      throw new Error('beforePack: production packages require the reviewed protocol and update publisher')
    }
  }
}
