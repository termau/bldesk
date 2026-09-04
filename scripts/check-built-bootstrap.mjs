#!/usr/bin/env node
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const localPackageConfig = require(resolve(root, 'electron-builder.local.cjs'))
const entryPath = resolve(root, 'out/main/index.js')
const markerPath = resolve(root, 'out/main/build-flavor.json')
const flavorArg = process.argv.indexOf('--flavor')
assert.ok(flavorArg >= 0, 'pass the expected compiled flavor with --flavor production|local')
const expectedFlavor = process.argv[flavorArg + 1]
assert.ok(expectedFlavor === 'production' || expectedFlavor === 'local', 'expected flavor must be production or local')
assert.ok(existsSync(entryPath), 'built main entry is missing; run the Electron build first')
assert.ok(existsSync(markerPath), 'compiled build-flavor marker is missing')

assert.equal(packageJson.build.appId, 'com.termau.bldesk', 'production package id changed unexpectedly')
assert.equal(packageJson.build.productName, 'BLDesk', 'production product name changed unexpectedly')
assert.equal(packageJson.build.beforePack, 'scripts/before-pack.cjs', 'production packaging must enforce flavor pairing')
assert.match(packageJson.scripts.build, /--mode production/, 'production build script must choose its flavor explicitly')
assert.match(packageJson.scripts['build:local'], /--mode localdev/, 'local build script must choose its flavor explicitly')
assert.match(packageJson.scripts.start, /build:local/, 'local preview must never compile or launch the production flavor')
assert.equal(localPackageConfig.appId, 'com.termau.bldesk.localdev', 'local package id must be distinct')
assert.equal(localPackageConfig.productName, 'BLDesk Local Dev', 'local product name must be distinct')
assert.equal(localPackageConfig.extraMetadata?.name, 'bldesk-local-dev', 'local internal package name must be distinct')
assert.equal(localPackageConfig.publish, undefined, 'local packages must not embed an update publisher')
assert.equal(localPackageConfig.protocols, undefined, 'local packages must not register the production protocol')
assert.deepEqual(localPackageConfig.win?.target, ['nsis', 'portable'], 'local Windows output must include NSIS and portable artifacts')
assert.deepEqual(
  localPackageConfig.mac?.target,
  [{ target: 'dmg', arch: ['universal'] }, { target: 'zip', arch: ['universal'] }],
  'local macOS output must include universal DMG and zip artifacts'
)
assert.deepEqual(localPackageConfig.linux?.target, ['AppImage', 'deb'], 'local Linux output must include AppImage and deb artifacts')
assert.equal(localPackageConfig.deb?.afterInstall, undefined, 'local deb must not run the production installation hook')
assert.equal(localPackageConfig.deb?.afterRemove, undefined, 'local deb must not remove the production AppArmor integration')

const marker = JSON.parse(readFileSync(markerPath, 'utf8'))
assert.deepEqual(marker, { flavor: expectedFlavor }, 'compiled flavor marker does not match the requested build')

const entry = readFileSync(entryPath, 'utf8')
const chunksDirectory = resolve(root, 'out/main/chunks')
const chunkFiles = existsSync(chunksDirectory)
  ? readdirSync(chunksDirectory).filter((name) => name.endsWith('.js')).map((name) => resolve(chunksDirectory, name))
  : []
const chunkSources = new Map(chunkFiles.map((file) => [file, readFileSync(file, 'utf8')]))
const allMainJavaScript = [entry, ...chunkSources.values()].join('\n')
const importSpecifiers = [...entry.matchAll(/^import(?:\s+.+?\s+from\s+|\s*)["']([^"']+)["'];?$/gm)]
  .map((match) => match[1])

const dynamicImport = /await import\(["'](\.\/chunks\/[^"']+\.js)["']\)/.exec(entry)
assert.ok(dynamicImport, 'built bootstrap must dynamically import one application chunk')
const applicationPath = resolve(dirname(entryPath), dynamicImport[1])
assert.ok(existsSync(applicationPath), 'deferred application chunk is missing')
const application = readFileSync(applicationPath, 'utf8')
assert.match(application, /requestSingleInstanceLock/, 'single-instance/application startup must remain deferred')

const bootstrap = entry.slice(0, dynamicImport.index)
assert.doesNotMatch(
  bootstrap,
  /requestSingleInstanceLock|setAsDefaultProtocolClient|electron-updater|safeStorage|VaultManager/,
  'application, updater, protocol, and vault code must remain outside the bootstrap entry'
)

if (expectedFlavor === 'production') {
  assert.deepEqual(importSpecifiers.sort(), ['electron', 'fs', 'path'], 'production bootstrap may import only inert externals')
  assert.doesNotMatch(
    allMainJavaScript,
    /BLDESK_DEV_USER_DATA|bldesk-dev-local|BLDesk Local Dev|com\.termau\.bldesk\.localdev/,
    'production bundles must compile out every local storage and identity override'
  )
  assert.doesNotMatch(entry, /configureDevelopmentUserData/, 'production startup must not contain a runtime flavor escape hatch')
  assert.match(application, /com\.termau\.bldesk/, 'production Windows application identity must be baked in')
  assert.match(application, /setAsDefaultProtocolClient/, 'production package must retain reviewed bldesk protocol support')
  assert.match(application, /checkForUpdates/, 'production package must retain auto-update support')
} else {
  const isolationImports = importSpecifiers.filter((specifier) => specifier.startsWith('./chunks/'))
  assert.equal(isolationImports.length, 1, 'local bootstrap must statically import exactly one isolation chunk')
  assert.deepEqual(
    importSpecifiers.filter((specifier) => !specifier.startsWith('./chunks/')).sort(),
    ['electron', 'fs', 'path'],
    'local bootstrap may otherwise import only inert externals'
  )
  const isolationPath = resolve(dirname(entryPath), isolationImports[0])
  const isolation = readFileSync(isolationPath, 'utf8')
  assert.ok(
    entry.indexOf('configureDevelopmentUserData();') >= 0 &&
      entry.indexOf('configureDevelopmentUserData();') < dynamicImport.index,
    'local storage isolation must run before deferred application startup'
  )
  assert.match(isolation, /BLDESK_DEV_USER_DATA/, 'local bundle must retain its dedicated unpackaged path override')
  assert.match(isolation, /app\.isPackaged\s*\?\s*void 0\s*:\s*process\.env/, 'packaged local builds must ignore runtime path overrides')
  assert.ok(
    isolation.indexOf('app.setName(LOCAL_PRODUCT_NAME)') < isolation.indexOf('app.setPath("userData"') &&
      isolation.indexOf('app.setPath("userData"') < isolation.indexOf('app.setPath("sessionData"'),
    'local product name, userData, and sessionData must be isolated in order'
  )
  assert.match(isolation, /app\.getAppPath\(\)/, 'local storage must reject paths overlapping the application/worktree')
  assert.match(isolation, /\.git/, 'local storage must reject source-controlled trees')
  assert.match(isolation, /PUBLIC/, 'local storage must reject public profile storage')
  assert.match(isolation, /OneDrive/, 'local storage must reject common synced storage')
  assert.match(allMainJavaScript, /com\.termau\.bldesk\.localdev/, 'local Windows application identity must be baked in')
  assert.doesNotMatch(application, /com\.termau\.bldesk["']/, 'local application must not retain the production application id')
  assert.doesNotMatch(application, /setAsDefaultProtocolClient/, 'local application must compile out OS protocol registration')
  assert.doesNotMatch(application, /checkForUpdates|quitAndInstall/, 'local application must compile out updater network/install actions')
}

console.log(`built bootstrap ok (${expectedFlavor} flavor and package boundaries verified)`)
