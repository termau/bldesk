const { readdirSync, statSync, accessSync, constants } = require('node:fs')
const { join, relative, basename } = require('node:path')
module.exports = function verifyPtyPackage(resourcesDir, platform) {
  const root = join(resourcesDir, 'app.asar.unpacked', 'node_modules', 'node-pty')
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])
  const files = walk(root)
  const nativeName = platform === 'win32' ? 'conpty.node' : 'pty.node'
  const candidates = [join(root, 'build', 'Release'), join(root, 'build', 'Debug'), join(root, 'prebuilds', `${platform}-${process.arch}`)]
  const activeDir = candidates.find((dir) => files.includes(join(dir, nativeName)))
  if (!activeDir) throw new Error(`Packaged node-pty is missing ${nativeName}`)
  const binary = join(activeDir, nativeName)
  if (platform !== 'win32') {
    const helper = join(activeDir, 'spawn-helper')
    if (!files.includes(helper)) throw new Error('Packaged node-pty is missing the active spawn-helper')
    accessSync(helper, constants.X_OK)
  }
  if (platform === 'linux' && activeDir !== join(root, 'build', 'Release')) throw new Error('Linux node-pty must include its source-built build/Release/pty.node')
  console.log(`  • verified unpacked node-pty (${platform}): ${relative(root, binary)}; ${files.reduce((n, p) => n + statSync(p).size, 0)} bytes`)
}
