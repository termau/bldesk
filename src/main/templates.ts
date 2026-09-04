import { app, shell } from 'electron'
import { closeSync, existsSync, fstatSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { parse } from 'yaml'
import { MAX_TEMPLATE_BYTES, TEMPLATE_KIND, templateSlug } from '../shared/templates'
import type { TemplateGetResult } from '../shared/ipc-types'

function templatesDir(): string {
  const path = join(app.getPath('userData'), 'templates')
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 })
  else if (!statSync(path).isDirectory()) throw new Error('Templates path is not a directory.')
  return path
}

function validateDocument(input: string): { slug: string; name: string; document: string } {
  const document = input.endsWith('\n') ? input : `${input}\n`
  const bytes = Buffer.byteLength(document, 'utf8')
  if (bytes > MAX_TEMPLATE_BYTES) {
    throw new Error(`Template YAML is ${bytes} bytes; the maximum is ${MAX_TEMPLATE_BYTES} bytes (256 KiB).`)
  }
  const value = parse(document)
  if (!value || typeof value !== 'object' || typeof value.name !== 'string' || !value.name.trim()) {
    throw new Error('Template YAML requires a string "name".')
  }
  // Current schema: `kind: bldesk/server-template@1` with an optional `spec` map.
  // First cut: `name` + `user_data` — still readable, and still accepted here.
  const current = value.kind === TEMPLATE_KIND && (value.spec === undefined || (value.spec && typeof value.spec === 'object'))
  const legacy = value.kind === undefined && typeof value.user_data === 'string'
  if (!current && !legacy) {
    throw new Error(`Template YAML must have kind "${TEMPLATE_KIND}" (or the older "name" + "user_data" form).`)
  }
  return { slug: templateSlug(value.name), name: value.name, document }
}

function pathFor(slug: string): string {
  return join(templatesDir(), `${templateSlug(slug)}.yaml`)
}

function syncFile(path: string): void {
  const fd = openSync(path, 'r')
  try { fsyncSync(fd) } finally { closeSync(fd) }
}

function syncDirectory(path: string): void {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    fsyncSync(fd)
  } catch (err: any) {
    // Windows does not permit opening/fsyncing directory handles through Node.
    if (process.platform !== 'win32' || !['EACCES', 'EINVAL', 'EPERM'].includes(err?.code)) throw err
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

export class TemplateStore {
  static slugForDocument(input: string): string {
    return validateDocument(input).slug
  }

  static list(): string[] {
    let names: string[]
    try {
      names = readdirSync(templatesDir())
    } catch (err: any) {
      if (['ENOTDIR', 'EACCES', 'EPERM', 'ENOENT'].includes(err?.code)) throw new Error('Templates directory cannot be read.')
      throw err
    }
    return names
      .filter((name) => name.endsWith('.yaml'))
      .map((name) => name.slice(0, -5))
      .filter((stem) => {
        try { return templateSlug(stem) === stem } catch { return false }
      })
      .sort()
  }

  static get(slug: string): TemplateGetResult {
    const path = pathFor(slug)
    let fd: number
    try {
      fd = openSync(path, 'r')
    } catch (err: any) {
      if (err?.code === 'ENOENT') return { ok: false, code: 'missing', message: 'Template file does not exist.' }
      if (['EACCES', 'EPERM'].includes(err?.code)) return { ok: false, code: 'unreadable', message: 'Template file cannot be read.' }
      throw err
    }
    try {
      const stats = fstatSync(fd)
      if (!stats.isFile()) return { ok: false, code: 'unreadable', message: 'Template path is not a regular file.' }
      const bytes = stats.size
      if (bytes > MAX_TEMPLATE_BYTES) {
        return { ok: false, code: 'too_large', message: `Template is ${bytes} bytes; the maximum is ${MAX_TEMPLATE_BYTES} bytes (256 KiB).`, bytes }
      }
      const document = readFileSync(fd, 'utf8')
      const encodedBytes = Buffer.byteLength(document, 'utf8')
      const normalisedBytes = document.endsWith('\n') ? encodedBytes : encodedBytes + 1
      if (normalisedBytes > MAX_TEMPLATE_BYTES) {
        return { ok: false, code: 'too_large', message: `Template is ${normalisedBytes} bytes after newline normalisation; the maximum is ${MAX_TEMPLATE_BYTES} bytes (256 KiB).`, bytes: normalisedBytes }
      }
      return { ok: true, document }
    } catch (err: any) {
      if (['EISDIR', 'EACCES', 'EPERM', 'ENOENT'].includes(err?.code)) {
        return { ok: false, code: 'unreadable', message: 'Template file cannot be read.' }
      }
      throw err
    } finally {
      closeSync(fd)
    }
  }

  static save(input: string, oldSlug?: string): string {
    const { slug, name, document } = validateDocument(input)
    const destination = pathFor(slug)
    const previous = oldSlug ? pathFor(oldSlug) : undefined
    if (existsSync(destination) && (!oldSlug || templateSlug(oldSlug) !== slug)) {
      throw new Error(`A template named "${name}" already exists.`)
    }
    const temporary = `${destination}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`
    try {
      writeFileSync(temporary, document, { encoding: 'utf8', mode: 0o600 })
      syncFile(temporary)
      renameSync(temporary, destination)
      if (previous && previous !== destination && existsSync(previous)) {
        try { unlinkSync(previous) } catch { /* The new file is already durable; leave the stale file for a later retry. */ }
      }
      syncDirectory(templatesDir())
      return slug
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary)
    }
  }

  static remove(slug: string): void {
    const path = pathFor(slug)
    if (existsSync(path)) {
      unlinkSync(path)
      syncDirectory(templatesDir())
    }
  }

  static reveal(slug: string): void {
    const path = pathFor(slug)
    if (!existsSync(path)) throw new Error('Template file does not exist.')
    shell.showItemInFolder(path)
  }
}
