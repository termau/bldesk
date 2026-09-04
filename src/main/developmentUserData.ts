import { app } from 'electron'
import { existsSync, lstatSync, mkdirSync, realpathSync } from 'fs'
import { basename, dirname, isAbsolute, join, parse, relative, resolve } from 'path'

const DEVELOPMENT_USER_DATA_ENV = 'BLDESK_DEV_USER_DATA'
declare const __BLDESK_BUILD_FLAVOR__: 'production' | 'local'

export const BUILD_FLAVOR = __BLDESK_BUILD_FLAVOR__
export const IS_LOCAL_BUILD = BUILD_FLAVOR === 'local'
export const IS_PRODUCTION_BUILD = BUILD_FLAVOR === 'production'
export const LOCAL_PRODUCT_NAME = 'BLDesk Local Dev'
export const LOCAL_APP_ID = 'com.termau.bldesk.localdev'
export const PRODUCTION_APP_ID = 'com.termau.bldesk'

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right
}

function canonicalizePotentialPath(value: string): string {
  const absolute = resolve(value)
  if (existsSync(absolute)) return realpathSync.native(absolute)
  const parent = dirname(absolute)
  if (parent === absolute) return absolute
  return join(canonicalizePotentialPath(parent), basename(absolute))
}

function containsPath(parent: string, candidate: string): boolean {
  if (samePath(parent, candidate)) return true
  const remainder = relative(parent, candidate)
  return remainder.length > 0 && !remainder.startsWith('..') && !isAbsolute(remainder)
}

function pathsOverlap(left: string, right: string): boolean {
  return containsPath(left, right) || containsPath(right, left)
}

function safeEnvironmentPath(name: string): string | null {
  const value = process.env[name]?.trim()
  if (!value || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value) || !isAbsolute(value)) {
    return null
  }
  return canonicalizePotentialPath(value)
}

function commonSharedStorageRoots(): string[] {
  const roots = new Set<string>()
  for (const name of ['PUBLIC', 'OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
    const candidate = safeEnvironmentPath(name)
    if (candidate) roots.add(candidate)
  }

  const profile = safeEnvironmentPath(process.platform === 'win32' ? 'USERPROFILE' : 'HOME')
  if (profile) {
    for (const folder of ['OneDrive', 'Dropbox', 'Google Drive', 'iCloudDrive']) {
      roots.add(canonicalizePotentialPath(join(profile, folder)))
    }
  }
  return [...roots]
}

function isInsideSourceControlledTree(candidate: string): boolean {
  let cursor = candidate
  while (!existsSync(cursor)) {
    const parent = dirname(cursor)
    if (parent === cursor) return false
    cursor = parent
  }
  if (!lstatSync(cursor).isDirectory()) cursor = dirname(cursor)

  for (;;) {
    if (existsSync(join(cursor, '.git'))) return true
    const parent = dirname(cursor)
    if (parent === cursor) return false
    cursor = parent
  }
}

function defaultDevelopmentUserData(installedUserData: string): string {
  const windowsLocalAppData = process.platform === 'win32' ? process.env['LOCALAPPDATA']?.trim() : ''
  if (
    windowsLocalAppData &&
    windowsLocalAppData.length <= 4096 &&
    !/[\u0000-\u001f\u007f]/.test(windowsLocalAppData) &&
    isAbsolute(windowsLocalAppData)
  ) {
    return join(windowsLocalAppData, 'bldesk-dev-local')
  }
  return join(dirname(installedUserData), `${basename(installedUserData)}-dev-local`)
}

/**
 * Run as the first main-process import. Every bundle compiled with the local
 * flavor — unpackaged or packaged — is forced onto isolated userData and
 * sessionData before the vault or Chromium session can load. Production
 * bundles compile the local branch out and cannot be redirected by a leftover
 * runtime environment variable.
 */
export function configureDevelopmentUserData(): void {
  if (!IS_LOCAL_BUILD) return

  // Packaged local artifacts use the deterministic local directory. Only an
  // unpackaged developer process may request another reviewed local path.
  const configured = app.isPackaged ? undefined : process.env[DEVELOPMENT_USER_DATA_ENV]
  const requested = configured === undefined
    ? defaultDevelopmentUserData(app.getPath('userData'))
    : configured.trim()
  if (
    !requested ||
    requested.length > 4096 ||
    /[\u0000-\u001f\u007f]/.test(requested) ||
    !isAbsolute(requested)
  ) {
    throw new Error(`${DEVELOPMENT_USER_DATA_ENV} must be an absolute development-data path when provided.`)
  }

  const requestedPath = resolve(requested)
  if (samePath(requestedPath, parse(requestedPath).root)) {
    throw new Error('The BLDesk development data path cannot be a filesystem root.')
  }

  const installedUserData = canonicalizePotentialPath(app.getPath('userData'))
  const appData = canonicalizePotentialPath(app.getPath('appData'))
  const productionUserDataCandidates = [
    installedUserData,
    canonicalizePotentialPath(join(appData, 'bldesk')),
    canonicalizePotentialPath(join(appData, 'BLDesk'))
  ]
  const applicationPath = canonicalizePotentialPath(app.getAppPath())
  const unpackagedWorkingTree = app.isPackaged ? null : canonicalizePotentialPath(process.cwd())
  const requestedPotential = canonicalizePotentialPath(requestedPath)
  if (
    samePath(requestedPotential, parse(requestedPotential).root) ||
    productionUserDataCandidates.some((reserved) => pathsOverlap(requestedPotential, reserved)) ||
    pathsOverlap(requestedPotential, applicationPath) ||
    (unpackagedWorkingTree !== null && pathsOverlap(requestedPotential, unpackagedWorkingTree)) ||
    commonSharedStorageRoots().some((sharedRoot) => containsPath(sharedRoot, requestedPotential)) ||
    isInsideSourceControlledTree(requestedPotential)
  ) {
    throw new Error('BLDesk local data must be outside installed, source-controlled, public, and synced locations.')
  }

  mkdirSync(requestedPath, { recursive: true, mode: 0o700 })
  const stats = lstatSync(requestedPath)
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('The BLDesk development data path must be a real directory, not a link.')
  }

  const developmentUserData = realpathSync.native(requestedPath)
  if (
    productionUserDataCandidates.some((reserved) => pathsOverlap(developmentUserData, reserved)) ||
    pathsOverlap(developmentUserData, applicationPath) ||
    (unpackagedWorkingTree !== null && pathsOverlap(developmentUserData, unpackagedWorkingTree)) ||
    commonSharedStorageRoots().some((sharedRoot) => containsPath(sharedRoot, developmentUserData)) ||
    isInsideSourceControlledTree(developmentUserData)
  ) {
    throw new Error('BLDesk local data must be outside installed, source-controlled, public, and synced locations.')
  }

  const sessionData = join(developmentUserData, 'session')
  mkdirSync(sessionData, { recursive: true, mode: 0o700 })
  const sessionStats = lstatSync(sessionData)
  if (!sessionStats.isDirectory() || sessionStats.isSymbolicLink()) {
    throw new Error('The BLDesk development session-data path must be a real directory, not a link.')
  }

  app.setName(LOCAL_PRODUCT_NAME)
  app.setPath('userData', developmentUserData)
  app.setPath('sessionData', realpathSync.native(sessionData))
  delete process.env[DEVELOPMENT_USER_DATA_ENV]
}
