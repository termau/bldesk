/*
 * Local packaging is deliberately a different application, not a production
 * BLDesk package with a runtime flag. Keep this config paired with the baked
 * `local` bundle flavor (enforced again by scripts/before-pack.cjs).
 */
const { build: productionBuild } = require('./package.json')

const config = JSON.parse(JSON.stringify(productionBuild))
delete config.publish
delete config.protocols

config.appId = 'com.termau.bldesk.localdev'
config.productName = 'BLDesk Local Dev'
config.artifactName = '${productName}-${version}-${os}-${arch}.${ext}'
config.directories = { ...config.directories, output: 'release/local-dev' }
config.extraMetadata = { name: 'bldesk-local-dev' }
config.win = {
  ...config.win,
  target: ['nsis', 'portable']
}
config.portable = {
  ...config.portable,
  artifactName: '${productName}-${version}-${os}-${arch}-portable.${ext}'
}
config.mac = {
  ...config.mac,
  target: [
    { target: 'dmg', arch: ['universal'] },
    { target: 'zip', arch: ['universal'] }
  ]
}
config.linux = {
  ...config.linux,
  executableName: 'bldesk-local-dev',
  target: ['AppImage', 'deb']
}
// Production's Debian hooks intentionally manage /opt/BLDesk, /usr/bin/bldesk,
// and its AppArmor profile. Local packages must use electron-builder's generic
// integration for the distinct local identity and never touch those paths.
config.deb = { ...config.deb }
delete config.deb.afterInstall
delete config.deb.afterRemove

module.exports = config
